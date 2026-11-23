"""Build Ellie's fine-tuning dataset with a local teacher model (qwen3.5:35b via Ollama).

    training/.venv/bin/python training/data/build_dataset.py messages   # 1. user messages
    training/.venv/bin/python training/data/build_dataset.py replies    # 2. teacher replies
    training/.venv/bin/python training/data/build_dataset.py build      # 3. filter + split

Every stage appends to a JSONL file and skips work already done, so it can be stopped and
resumed. Nothing here leaves the machine apart from the one-off OASST2 download.
"""

import argparse
import difflib
import json
import random
import re
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path[:0] = [str(ROOT / "backend"), str(HERE.parent / "eval"), str(HERE)]
from app.llm.prompt import SYSTEM_PROMPT  # noqa: E402
from score import ASKS_LIVE, DISCLAIM, habit, score  # noqa: E402
from topics import THEMES  # noqa: E402

TEACHER = "qwen3.5:35b"
OLLAMA = "http://localhost:11434"
OUT = HERE / "out"
MESSAGES = OUT / "messages.jsonl"
REPLIES = OUT / "replies.jsonl"

# The one-line prompt the adapter is trained (and later run) with.
TRAIN_SYSTEM = "You are Ellie, a warm, friendly conversational partner from England."

# The app's rules plus fixes for what the teacher got wrong in the evaluation.
WRITER_SYSTEM = SYSTEM_PROMPT + """

Extra rules for these replies:
- You run privately on the user's own computer, with no internet access. Mention this ONLY if the user asks about live information (today's weather, the news, current prices, the time) or asks where or what you are. Never mention it otherwise.
- Always help with what was asked. Recipes, lists, stories, poems, descriptions, explanations and advice are all fine: give a short spoken version (the key steps, or two or three items) instead of refusing. Only say you can't for harmful requests, or for personal data you cannot see.
- You remember everything said earlier in this conversation and use it (names, plans, pets, places). You only forget between separate conversations.
- When you know a fact, state it plainly and confidently. Only hedge when you are genuinely unsure.
- About yourself: be honest in a light, warm way ("being an AI", "I don't eat, sadly") and vary the wording. Never call yourself a program, programme, software, code or data.
- Keep the warmth calm and natural: no over-the-top words such as "absolutely", "gut-wrenching", "amazing" or "fantastic".
- At most 40 words: this will be spoken aloud.
- For medical, legal or money decisions, give a sensible general pointer and suggest the right professional.
- Refuse anything harmful kindly, in one sentence."""

MAX_WORDS = 55
NO_QUESTION_SHARE = 0.35  # replies told to end on a statement (the teacher asks questions ~99% of the time)
NO_QUESTION = "\n- For this reply, do not ask a question: end warmly with a statement."
SHORTER = "That's too long to listen to. Say it again in at most 35 words and 3 short sentences, same tone."
BANNED = re.compile(r"\b(cloud|absolutely|gut-wrenching|amazing|fantastic|program|programme|software)\b", re.I)
lock = threading.Lock()


def chat(client: httpx.Client, messages: list[dict], temperature: float, seed: int, num_predict: int = 160) -> dict:
    return client.post("/api/chat", json={
        "model": TEACHER, "messages": messages, "stream": False, "think": False, "keep_alive": "30m",
        "options": {"temperature": temperature, "top_p": 0.95, "num_predict": num_predict, "seed": seed},
    }, timeout=300).json()


def append(path: Path, row: dict) -> None:
    with lock, path.open("a") as f:
        f.write(json.dumps(row) + "\n")


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


# --- 1. user messages ---------------------------------------------------------------------
CODEY = re.compile(r"```|\bcode\b|python|javascript|sql|regex|function|html|css|linux|excel|"
                   r"\bwrite (?:an?|me an?) (?:essay|article|program|script|story|poem)|translate|"
                   r"\\|\{|\}|=|\bAPI\b", re.I)


def oasst_messages(n: int, rng: random.Random) -> list[dict]:
    import pyarrow.parquet as pq

    t = pq.read_table(HERE / "raw" / "oasst2-train.parquet",
                      columns=["message_id", "parent_id", "text", "role", "lang", "deleted",
                               "review_result", "detoxify"]).to_pylist()
    keep = []
    for m in t:
        tox = (m["detoxify"] or {}).get("toxicity") or 0
        text = (m["text"] or "").strip()
        if (m["parent_id"] is None and m["role"] == "prompter" and m["lang"] == "en" and not m["deleted"]
                and m["review_result"] and tox < 0.05 and 12 <= len(text) <= 160 and "\n" not in text
                and not CODEY.search(text)):
            keep.append({"id": f"oasst-{m['message_id'][:8]}", "source": "oasst2", "category": "oasst2",
                         "text": text})
    rng.shuffle(keep)
    return keep[:n]


def seed_messages(client: httpx.Client, category: str, theme: str, i: int) -> list[dict]:
    ask = (f"Write 8 different messages that someone in the UK might type to Ellie, a friendly AI chat "
           f"companion, on this theme: {theme}.\nMix questions, statements and requests. Each 3 to 25 words, "
           f"casual, written the way people really type (some without capitals or full stops). "
           f"Output one message per line, with no numbering, quotes or commentary.")
    d = chat(client, [{"role": "user", "content": ask}], temperature=0.9, seed=i, num_predict=400)
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip().strip('"') for line in d["message"]["content"].splitlines()]
    return [{"id": f"seed-{i:03d}-{j}", "source": "seed", "category": category, "theme": theme, "text": t}
            for j, t in enumerate(x for x in lines if 2 <= len(x.split()) <= 30)][:8]


def stage_messages(n_oasst: int) -> None:
    OUT.mkdir(exist_ok=True)
    have = {r["id"] for r in read(MESSAGES)}
    rng = random.Random(7)
    if not any(i.startswith("oasst-") for i in have):
        for m in oasst_messages(n_oasst, rng):
            append(MESSAGES, m)
        print(f"OASST2: {n_oasst} human-written messages")
    todo = [(i, c, t) for i, (c, t) in enumerate(THEMES) if not any(h.startswith(f"seed-{i:03d}-") for h in have)]
    with httpx.Client(base_url=OLLAMA) as client:
        for i, category, theme in todo:
            for m in seed_messages(client, category, theme, i):
                append(MESSAGES, m)
            print(f"  theme {i + 1}/{len(THEMES)}: {theme}", flush=True)


# --- 2. teacher replies -------------------------------------------------------------------
def acceptable(reply: str, done_reason: str, question_ok: bool = True, user: str = "",
               earlier_turns: bool = False) -> tuple[bool, str]:
    s = score(reply, done_reason)
    if why := habit(reply, user, earlier_turns):
        return False, why
    if not question_ok and s.ends_question:
        return False, "asked a question"
    if not s.clean:
        return False, "scorer: " + ",".join(k for k in ("american", "too_long", "markdown", "emoji", "prefix",
                                                         "invented_life", "robotic", "cut_off") if getattr(s, k))
    if s.words > MAX_WORDS:
        return False, f"{s.words} words"
    if m := BANNED.search(reply):
        return False, f"banned word: {m.group(0)}"
    return True, "ok"


def reply_for(client: httpx.Client, history: list[dict], seed: int, question_ok: bool = True
              ) -> tuple[str | None, list[str]]:
    """Up to 3 attempts; returns the first acceptable reply and the reasons earlier ones failed.
    A reply that is only too long is not thrown away: the teacher is asked to shorten it."""
    system = WRITER_SYSTEM + ("" if question_ok else NO_QUESTION)
    convo = [{"role": "system", "content": system}, *history]
    reasons = []
    for attempt in range(3):
        d = chat(client, convo, temperature=0.8, seed=seed * 10 + attempt)
        reply = d["message"]["content"].strip()
        ok, why = acceptable(reply, d.get("done_reason", "stop"), question_ok, history[-1]["content"],
                             sum(m["role"] == "user" for m in history) > 1)
        if ok:
            return reply, reasons
        reasons.append(why)
        if why.endswith("words") or why == "scorer: too_long":
            convo = [*convo, {"role": "assistant", "content": reply}, {"role": "user", "content": SHORTER}]
        else:
            convo = [{"role": "system", "content": system}, *history]
    return None, reasons


def next_user_turn(client: httpx.Client, history: list[dict], seed: int) -> str:
    convo = "\n".join(f"{'User' if m['role'] == 'user' else 'Ellie'}: {m['content']}" for m in history)
    ask = (f"Here is a chat between a user in the UK and Ellie, a friendly AI companion:\n\n{convo}\n\n"
           f"Write the user's next message: a natural follow-up of 3 to 20 words that refers back to "
           f"something said earlier. Output only the message.")
    d = chat(client, [{"role": "user", "content": ask}], temperature=0.9, seed=seed, num_predict=60)
    return d["message"]["content"].strip().strip('"').removeprefix("User:").strip()


def make_example(client: httpx.Client, msg: dict, seed: int, turns: int) -> dict:
    history = [{"role": "user", "content": msg["text"]}]
    rejected = []
    rng = random.Random(seed)
    for t in range(turns):
        reply, reasons = reply_for(client, history, seed + t, question_ok=rng.random() >= NO_QUESTION_SHARE)
        rejected += reasons
        if reply is None:
            break
        history.append({"role": "assistant", "content": reply})
        if t < turns - 1:
            history.append({"role": "user", "content": next_user_turn(client, history, seed + 100 + t)})
    if history[-1]["role"] == "user":  # last reply failed: drop the unanswered turn
        history.pop()
    return {"id": msg["id"], "source": msg["source"], "category": msg["category"],
            "messages": history, "rejected": rejected}


def stage_replies(workers: int, multi_share: float) -> None:
    msgs = read(MESSAGES)
    done = {r["id"] for r in read(REPLIES)}
    todo = [m for m in msgs if m["id"] not in done]
    rng = random.Random(11)
    plan = [(m, 2 + rng.randint(0, 1) if rng.random() < multi_share else 1) for m in todo]
    started, count = time.time(), [0]

    def work(item):
        msg, turns = item
        with httpx.Client(base_url=OLLAMA) as client:
            ex = make_example(client, msg, seed=zlib.crc32(msg["id"].encode()) % 100_000, turns=turns)
        append(REPLIES, ex)
        with lock:
            count[0] += 1
            if count[0] % 25 == 0:
                rate = count[0] / (time.time() - started)
                print(f"  {count[0]}/{len(plan)} examples, {rate * 60:.0f}/min, "
                      f"~{(len(plan) - count[0]) / rate / 60:.0f} min left", flush=True)

    print(f"{len(plan)} examples to write ({sum(t > 1 for _, t in plan)} multi-turn), {workers} workers")
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(work, plan))


# --- 2b. recall conversations: a fact early on, small talk, then a question about the fact -----
RECALL = [
    ("Hiya, {name} here, just got in from work and fancied a chat.", "name", "Sorry, remind me, what did I say my name was?"),
    ("My dog {pet} has been chewing the sofa again, honestly.", "pet", "What's my dog called again? I bet you've forgotten."),
    ("I'm heading to {city} next week for a few days.", "city", "Where did I say I was going next week?"),
    ("I've just started a new job as a {job}.", "job", "Do you remember what my new job is?"),
    ("My sister's getting married in {month}, I'm so excited.", "month", "When did I say the wedding was?"),
    ("I'm making {food} for tea tonight.", "food", "What did I say I was making for tea?"),
    ("My driving test is on {day}, wish me luck.", "day", "Which day's my driving test again?"),
    ("I've been learning the {instrument} since the summer.", "instrument", "What am I learning to play, do you remember?"),
]
VALUES = {
    "name": ["Aisha", "Tom", "Mei", "Kwame", "Siobhan", "Raj", "Olivia", "Callum", "Fatima", "Dylan"],
    "pet": ["Biscuit", "Pickle", "Bramble", "Toffee", "Murphy", "Luna", "Crumpet", "Nelson"],
    "city": ["Edinburgh", "Cardiff", "York", "Belfast", "Bristol", "Whitby", "Bath", "Inverness"],
    "job": ["nurse", "plumber", "primary school teacher", "software developer", "baker", "bus driver", "pharmacist"],
    "month": ["March", "June", "August", "September", "October", "December"],
    "food": ["shepherd's pie", "jollof rice", "a Thai green curry", "fish pie", "lasagne", "a Sunday roast"],
    "day": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "instrument": ["cello", "ukulele", "piano", "drums", "violin", "guitar"],
}


def stage_recall(n: int, workers: int) -> None:
    """Multi-turn chats where Ellie must use something the user said two turns earlier."""
    done = {r["id"] for r in read(REPLIES)}
    rng = random.Random(23)
    plan = []
    for i in range(n):
        first, key, question = RECALL[i % len(RECALL)]
        value = rng.choice(VALUES[key])
        if f"recall-{i:03d}" not in done:
            plan.append((i, first.format(**{key: value}), value, question))

    def work(item):
        i, first, value, question = item
        seed = 50_000 + i
        with httpx.Client(base_url=OLLAMA) as client:
            history = [{"role": "user", "content": first}]
            for step in range(3):
                reply, _ = reply_for(client, history, seed + step)
                if reply is None:
                    return
                if step == 2 and value.lower() not in reply.lower():  # must use the fact
                    reply, _ = reply_for(client, history, seed + 7)
                    if reply is None or value.lower() not in reply.lower():
                        return
                history.append({"role": "assistant", "content": reply})
                if step == 0:
                    history.append({"role": "user", "content": next_user_turn(client, history, seed + 100)})
                elif step == 1:
                    history.append({"role": "user", "content": question})
        append(REPLIES, {"id": f"recall-{i:03d}", "source": "recall", "category": "memory",
                         "messages": history, "rejected": []})

    print(f"{len(plan)} recall conversations to write")
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(work, plan))


# --- 3. filter and split ------------------------------------------------------------------
def disclaims(row: dict) -> bool:
    """Any reply in the conversation showing one of the unhelpful habits (see habit())."""
    m = row["messages"]
    return any(x["role"] == "assistant"
               and habit(x["content"], m[i - 1]["content"], sum(y["role"] == "user" for y in m[:i]) > 1)
               for i, x in enumerate(m))

def stage_build(val_share: float) -> None:
    eval_texts = [norm(m["content"]) for line in (HERE.parent / "eval" / "prompts.jsonl").read_text().splitlines()
                  for m in json.loads(line)["messages"] if m["role"] == "user"]
    rows = [r for r in read(REPLIES) if any(m["role"] == "assistant" for m in r["messages"]) and not disclaims(r)]
    stats = {"written": len(read(REPLIES)), "no_good_reply": len(read(REPLIES)) - len(rows),
             "near_eval_prompt": 0, "duplicate": 0}
    kept, seen = [], []
    for r in rows:
        first = norm(r["messages"][0]["content"])
        if any(difflib.SequenceMatcher(None, first, e).ratio() > 0.8 for e in eval_texts):
            stats["near_eval_prompt"] += 1
            continue
        # Recall chats open from a few templates on purpose (the fact and the conversation differ).
        if r.get("source") != "recall" and (first in seen or any(difflib.SequenceMatcher(None, first, s).quick_ratio() > 0.95 and
                                difflib.SequenceMatcher(None, first, s).ratio() > 0.9 for s in seen)):
            stats["duplicate"] += 1
            continue
        seen.append(first)
        kept.append(r)

    rng = random.Random(3)
    rng.shuffle(kept)
    n_val = max(1, int(len(kept) * val_share))
    splits = {"val": kept[:n_val], "train": kept[n_val:]}
    for name, part in splits.items():
        (OUT / f"{name}.jsonl").write_text("".join(
            json.dumps({"messages": [{"role": "system", "content": TRAIN_SYSTEM}, *r["messages"]]}) + "\n"
            for r in part))
    replies = [m["content"] for r in kept for m in r["messages"] if m["role"] == "assistant"]
    cats: dict[str, int] = {}
    for r in kept:
        cats[r["category"]] = cats.get(r["category"], 0) + 1
    stats.update({
        "kept": len(kept), "train": len(splits["train"]), "val": len(splits["val"]),
        "multi_turn": sum(1 for r in kept if len(r["messages"]) > 2),
        "assistant_turns": len(replies),
        "avg_reply_words": round(sum(len(x.split()) for x in replies) / len(replies), 1),
        "ends_question_%": round(100 * sum(x.rstrip().endswith("?") for x in replies) / len(replies), 1),
        "lovely_%": round(100 * sum(bool(re.search(r"\blovely\b", x, re.I)) for x in replies) / len(replies), 1),
        "teacher_attempts_rejected": sum(len(r["rejected"]) for r in read(REPLIES)),
        "by_category": dict(sorted(cats.items(), key=lambda kv: -kv[1])),
    })
    (OUT / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["messages", "replies", "recall", "build"])
    ap.add_argument("--recall", type=int, default=80)
    ap.add_argument("--oasst", type=int, default=450)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--multi", type=float, default=0.25, help="share of multi-turn examples")
    ap.add_argument("--val", type=float, default=0.1)
    a = ap.parse_args()
    {"messages": lambda: stage_messages(a.oasst), "replies": lambda: stage_replies(a.workers, a.multi),
     "recall": lambda: stage_recall(a.recall, a.workers), "build": lambda: stage_build(a.val)}[a.stage]()
