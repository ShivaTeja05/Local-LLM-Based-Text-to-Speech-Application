"""v3 dataset: Ellie's training replies moved towards real British conversation (Spoken BNC2014).

    training/.venv/bin/python training/data/corpus_style.py rewrite    # 1. teacher writes 3 candidates per reply
    training/.venv/bin/python training/data/corpus_style.py judge      # 2. teacher approves rewrites (meaning, tone)
    training/.venv/bin/python training/data/corpus_style.py select     # 3. pick the mix closest to the corpus targets
    training/.venv/bin/python training/data/corpus_style.py words      # 4. most "lovely"/"brilliant" -> plain words

The corpus is used as a *target*, never as training text: its licence forbids redistributing any part
of it, and raw transcripts would teach "erm" and false starts. research/britishness.py measured how
real British speakers talk (rates per 10,000 words); this script

1. asks the teacher (qwen3.5:35b, local) for three rewrites of every reply in the v2 dataset, each with
   corpus-based guidance and a different style hint, and keeps only rewrites that pass the same quality
   gate as v2, keep the facts (numbers and names), and stay a question if the original was one;
2. chooses, reply by reply, between the original and its rewrites so that the dataset as a whole has
   feature rates closest to the targets below (greedy coordinate descent on a log-ratio distance).

Targets: stereotypes are capped at about twice their real rate (Ellie used "lovely" 23x as often as
real speakers); conversational markers are moved part of the way towards their real rates (Ellie
answers questions rather than chatting among friends, so not all the way); turns get shorter.
"""

import argparse
import json
import math
import random
import re
import sys
import threading
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_dataset import OLLAMA, TEACHER, acceptable  # noqa: E402

OUT = HERE / "out"
V3 = OUT / "v3"
CANDIDATES = V3 / "candidates.jsonl"
JUDGED = V3 / "judged.jsonl"

JUDGE = """You are checking a rewrite of a chatbot's reply for a training dataset.

The conversation so far:
{convo}

Original reply: {original}
Rewrite: {rewrite}

Answer YES only if ALL of these are true:
1. The rewrite keeps the main point and any real information of the original (names, numbers, facts, advice). Dropping small talk, flourishes or extra pleasantries is fine. It adds no new facts, numbers or claims.
2. It sounds natural, the way a friendly British person would really say it, not forced (no filler or tag question just stuck on).
3. Its tone suits the topic (no casual fillers or "don't you?" on serious or sensitive subjects).
Otherwise answer NO. Answer with one word: YES or NO."""

# Per 10,000 words. (corpus rate from research/results/britishness.json and britishness.py)
CAPS = {  # stereotypes and over-used words: at most this
    "lovely": (r"\blovely\b", 3.86, 8), "brilliant": (r"\bbrilliant\b", 1.48, 3), "wonderful": (r"\bwonderful\b", 0.5, 1),
    "delightful": (r"\bdelightful\b", 0.02, 0.2), "innit": (r"\binnit\b", 1.1, 2), "mate": (r"\bmate\b", 1.28, 2),
    "cheers": (r"\bcheers\b", 0.4, 1), "cuppa": (r"\bcuppa\b", 0.02, 0.5), "proper": (r"\bproper\b", 1.16, 2),
    "fancy": (r"\bfancy\b", 0.59, 1.5), "absolutely": (r"\babsolutely\b", 2.8, 5),
}
MARKERS = {  # natural conversational features: aim for this
    "yeah": (r"\byeah\b", 253.3, 60), "oh": (r"\boh\b", 94.1, 30), "well (opening)": (r"^well\b", 30.7, 12),
    "you know": (r"\byou know\b", 44.6, 12), "i mean": (r"\bi mean\b", 18.9, 6), "sort of": (r"\bsort of\b", 13.6, 6),
    "a bit": (r"\ba bit\b", 14.5, 12), "really": (r"\breally\b", 47.2, 25), "actually": (r"\bactually\b", 17.1, 12),
    "i think": (r"\bi think\b", 34.4, 20), "quite": (r"\bquite\b", 17.0, 12),
    "tag questions": (r"\b(?:is|are|was|were|do|does|did|have|has|had|would|could|should|will|can|wo|ca)n't "
                      r"(?:it|you|they|we|he|she|i|there|that)\b(?= ?\?)", 23.5, 15),
}
TARGET_WORDS = 22          # mean words per reply (v2: 35; real conversational turns: 8.7)
AI_SHARE = 0.03            # replies mentioning being an AI (v2 fine-tune: 16%)
AI = re.compile(r"\b(?:i'm|i am|as) an? (?:ai|artificial)\b", re.I)

HINTS = [
    "Open naturally, the way people do in speech (for example with 'Oh,' 'Yeah,' or 'Well,'), or go straight in.",
    "If it fits, end with a tag question (\"isn't it?\", \"don't you?\", \"wasn't it?\") instead of a full question.",
    "If it fits, use one everyday filler such as 'you know', 'I mean', 'sort of', 'a bit' or 'actually'.",
]
REWRITE = """Rewrite Ellie's last reply so it sounds like everyday spoken British English, the way people really talk.

Keep exactly what it says: every fact, name, number and piece of advice. Keep the warmth.
Real British conversation (from a corpus of recorded everyday speech) is:
- short: say it in at most {limit} words, fewer if it still makes sense;
- plain: words like "lovely", "brilliant", "wonderful", "innit", "mate", "cheers", "cuppa" and "proper" are rare in real speech, so use them very rarely or not at all;
- natural: people say "yeah", "oh", "you know", "I mean", "sort of", "a bit", "really", "actually", and use tag questions, but at most one or two per reply and only where a person really would, never forced;
- standard spelling: no slang spellings such as "wanna", "gonna", "fave", "dunno" or "ya" (this will be read aloud).
{shape}
Only mention being an AI if the user asked about Ellie herself.
{hint}
Output only the new reply, nothing else.

The conversation:
{convo}"""

# A rewrite must not introduce a stereotype the original did not have, stack conversational markers
# (that reads as a caricature), or use slang spellings (the speech engine reads them oddly).
STEREOTYPES = re.compile(r"\b(innit|mate|cuppa|proper|cheers|blimey|crikey|bloody)\b", re.I)
SLANG = re.compile(r"\b(wanna|gonna|gotta|fave|dunno|ya|lemme|kinda|sorta|y'know|whatcha|cos)\b", re.I)
MARKER_WORDS = re.compile(r"\b(yeah|oh|well|you know|i mean|sort of|kind of|a bit|really|actually|right)\b", re.I)
MAX_MARKERS = 2

lock = threading.Lock()


def style_problem(original: str, new: str) -> str | None:
    added = {w.lower() for w in STEREOTYPES.findall(new)} - {w.lower() for w in STEREOTYPES.findall(original)}
    if added:
        return f"added stereotype: {sorted(added)[0]}"
    if m := SLANG.search(new):
        return f"slang spelling: {m.group(0).lower()}"
    if len(MARKER_WORDS.findall(new)) > max(MAX_MARKERS, len(MARKER_WORDS.findall(original))):
        return "too many markers"
    return None


def words(text: str) -> int:
    return len(re.findall(r"[A-Za-z']+", text))


def keeps_facts(original: str, new: str) -> bool:
    """Numbers and names (capitalised words not at a sentence start) must survive the rewrite."""
    nums = set(re.findall(r"\d[\d,.]*", original))
    names = {w for w in re.findall(r"(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,})\b", original) if w not in {"Ellie", "English"}}
    return all(n in new for n in nums) and all(n in new for n in names)


def rows() -> list[dict]:
    out = []
    for split in ("train", "val"):
        for i, line in enumerate((OUT / f"{split}.jsonl").read_text().splitlines()):
            out.append({"id": f"{split}-{i}", "split": split, "messages": json.loads(line)["messages"]})
    return out


def stage_rewrite(workers: int, limit: int = 0) -> None:
    V3.mkdir(exist_ok=True)
    done = {(c["id"], c["turn"]) for c in map(json.loads, CANDIDATES.read_text().splitlines())} if CANDIDATES.exists() else set()
    jobs = [(r, k) for r in rows() for k, m in enumerate(r["messages"]) if m["role"] == "assistant" and (r["id"], k) not in done]
    if limit:
        jobs = jobs[:limit]
    print(f"{len(jobs)} replies to rewrite ({len(done)} already done)")
    client = httpx.Client(timeout=300)

    def work(job):
        r, k = job
        msgs = r["messages"]
        original = msgs[k]["content"]
        user = msgs[k - 1]["content"]
        convo = "\n".join(f"{'User' if m['role'] == 'user' else 'Ellie'}: {m['content']}" for m in msgs[1:k + 1])
        question = original.rstrip().endswith("?")
        limit = max(12, min(28, words(original)))
        shape = "Keep it ending with a question." if question else "End with a statement, not a question."
        kept, rejected = [], []
        for c, hint in enumerate(HINTS):
            prompt = REWRITE.format(limit=limit, shape=shape, hint=hint, convo=convo)
            d = client.post(f"{OLLAMA}/api/chat", json={
                "model": TEACHER, "stream": False, "think": False,
                "options": {"temperature": 0.8, "seed": zlib.crc32(f"{r['id']}/{k}/{c}".encode()), "num_predict": 120},
                "messages": [{"role": "user", "content": prompt}]}).json()
            new = d["message"]["content"].strip().strip('"').removeprefix("Ellie:").strip()
            earlier = sum(m["role"] == "user" for m in msgs[1:k]) > 1
            ok, why = acceptable(new, d.get("done_reason", "stop"), True, user, earlier)
            if ok and not keeps_facts(original, new):
                ok, why = False, "lost a fact"
            if ok and new.rstrip().endswith("?") != question:
                ok, why = False, "changed question/statement"
            if ok and (problem := style_problem(original, new)):
                ok, why = False, problem
            (kept if ok else rejected).append(new if ok else why)
        with lock, CANDIDATES.open("a") as f:
            f.write(json.dumps({"id": r["id"], "turn": k, "original": original, "candidates": kept, "rejected": rejected}) + "\n")

    with ThreadPoolExecutor(workers) as ex:
        for n, _ in enumerate(ex.map(work, jobs), 1):
            if n % 50 == 0:
                print(f"  {n}/{len(jobs)}", flush=True)


OVERUSED = re.compile(r"\b(lovely|brilliant)\b", re.I)
WORD_EDIT = """In this reply, replace the word "{word}" with a plain, natural alternative that fits (for example "nice", "great", "good" or "really nice"). Change nothing else at all: keep every other word, the punctuation and the order exactly the same. Output only the edited reply.

Reply: {reply}"""
KEEP_SHARE = 0.25  # keep about one in four uses (real speakers do say them, just rarely)


def word_edit_ok(original: str, new: str, word: str) -> bool:
    """Allow one target word to change; preserve every other character in order."""
    for match in re.finditer(r"\b" + re.escape(word) + r"\b", original, re.I):
        prefix, suffix = original[:match.start()], original[match.end():]
        if not new.startswith(prefix) or not new.endswith(suffix):
            continue
        end = len(new) - len(suffix) if suffix else len(new)
        replacement = new[len(prefix):end]
        if re.fullmatch(r"[A-Za-z]+(?: [A-Za-z]+)?", replacement) and not OVERUSED.search(replacement):
            return True
    return False


def stage_words(workers: int) -> None:
    """A narrow edit after selection: most uses of "lovely" and "brilliant" (still 6x and 17x the
    corpus rate) become a plain alternative, and nothing else may change. Exact prefix/suffix
    checks preserve punctuation, order and repeated words. Each reply has its own random seed,
    so thread scheduling cannot change which occurrences are kept."""
    client = httpx.Client(timeout=300)
    def edit(reply: str, seed: int) -> str:
        rng = random.Random(seed)
        out = reply
        for m in list(OVERUSED.finditer(reply)):
            if rng.random() < KEEP_SHARE:
                continue
            word = m.group(0)
            d = client.post(f"{OLLAMA}/api/chat", json={
                "model": TEACHER, "stream": False, "think": False, "options": {"temperature": 0.3, "num_predict": 160},
                "messages": [{"role": "user", "content": WORD_EDIT.format(word=word, reply=out)}]}).json()
            new = d["message"]["content"].strip().strip('"')
            if word_edit_ok(out, new, word):
                out = new
        return out

    for split in ("train", "val"):
        path = V3 / f"{split}.jsonl"
        rows_ = [json.loads(line) for line in path.read_text().splitlines()]
        jobs = [(i, k) for i, r in enumerate(rows_) for k, m in enumerate(r["messages"])
                if m["role"] == "assistant" and OVERUSED.search(m["content"])]
        with ThreadPoolExecutor(workers) as ex:
            results = list(ex.map(lambda ik: edit(
                rows_[ik[0]]["messages"][ik[1]]["content"],
                zlib.crc32(f"11/{split}/{ik[0]}/{ik[1]}".encode())), jobs))
        changed = 0
        for (i, k), new in zip(jobs, results):
            changed += new != rows_[i]["messages"][k]["content"]
            rows_[i]["messages"][k]["content"] = new
        path.write_text("".join(json.dumps(r) + "\n" for r in rows_))
        print(f"{split}: {len(jobs)} replies with lovely/brilliant, {changed} edited")
    report_rates()


def report_rates() -> None:
    texts = [m["content"] for split in ("train", "val") for line in (V3 / f"{split}.jsonl").read_text().splitlines()
             for m in json.loads(line)["messages"] if m["role"] == "assistant"]
    n = sum(words(t) for t in texts)
    tot = {k: 0 for k in {**CAPS, **MARKERS}}
    for t in texts:
        for k, v in feature_counts(t).items():
            tot[k] += v
    rates = {k: round(v / n * 1e4, 1) for k, v in tot.items()}
    stats = json.loads((V3 / "stats.json").read_text())
    stats["v3_final"] = {"words_per_reply": round(n / len(texts), 1), **{f"{k} /10k": r for k, r in rates.items()}}
    (V3 / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    for k in ("lovely", "brilliant", "yeah", "you know", "tag questions", "oh"):
        print(f"  {k:15} {rates[k]:6} /10k (corpus {({**CAPS, **MARKERS})[k][1]})")


def stage_judge(workers: int) -> None:
    """The teacher checks every usable rewrite against its original (meaning kept, nothing added,
    natural, right tone). Only approved rewrites can be selected."""
    msgs_by_id = {r["id"]: r["messages"] for r in rows()}
    done = {(j["id"], j["turn"], j["rewrite"]) for j in map(json.loads, JUDGED.read_text().splitlines())} if JUDGED.exists() else set()
    jobs = [(c, w) for c in map(json.loads, CANDIDATES.read_text().splitlines()) for w in c["candidates"]
            if (c["id"], c["turn"], w) not in done]
    print(f"{len(jobs)} rewrites to judge ({len(done)} already done)")
    client = httpx.Client(timeout=300)

    def work(job):
        c, rewrite = job
        msgs = msgs_by_id[c["id"]]
        convo = "\n".join(f"{'User' if m['role'] == 'user' else 'Ellie'}: {m['content']}" for m in msgs[1:c["turn"]])
        d = client.post(f"{OLLAMA}/api/chat", json={
            "model": TEACHER, "stream": False, "think": False, "options": {"temperature": 0, "num_predict": 3},
            "messages": [{"role": "user", "content": JUDGE.format(convo=convo, original=c["original"], rewrite=rewrite)}]}).json()
        ok = d["message"]["content"].strip().upper().startswith("YES")
        with lock, JUDGED.open("a") as f:
            f.write(json.dumps({"id": c["id"], "turn": c["turn"], "rewrite": rewrite, "approved": ok}) + "\n")

    with ThreadPoolExecutor(workers) as ex:
        for n, _ in enumerate(ex.map(work, jobs), 1):
            if n % 200 == 0:
                print(f"  {n}/{len(jobs)}", flush=True)


# --- selection ----------------------------------------------------------------------------------
def feature_counts(text: str) -> dict[str, int]:
    t = " ".join(re.findall(r"[a-z']+|\?", text.lower().replace("’", "'")))
    return {name: len(re.findall(pat, t)) for name, (pat, _, _) in {**CAPS, **MARKERS}.items()}


def distance(totals: dict[str, float], n_words: float, n_replies: int, ai: int) -> float:
    d = 0.0
    for name, (_, _, target) in CAPS.items():  # one-sided: only too many is penalised
        rate = totals[name] / n_words * 1e4
        if rate > target:
            d += 2.0 * math.log((rate + 1) / (target + 1)) ** 2
    for name, (_, _, target) in MARKERS.items():
        rate = totals[name] / n_words * 1e4
        d += 1.0 * math.log((rate + 1) / (target + 1)) ** 2
    d += 4.0 * math.log((n_words / n_replies) / TARGET_WORDS) ** 2
    d += 3.0 * max(0.0, ai / n_replies - AI_SHARE) * 10
    return d


def stage_select() -> None:
    cands = [json.loads(line) for line in CANDIDATES.read_text().splitlines()]
    if JUDGED.exists():  # only rewrites the judge approved
        approved = {(j["id"], j["turn"], j["rewrite"]) for j in map(json.loads, JUDGED.read_text().splitlines()) if j["approved"]}
        judged = {(j["id"], j["turn"], j["rewrite"]) for j in map(json.loads, JUDGED.read_text().splitlines())}
        for c in cands:
            c["judged_out"] = [w for w in c["candidates"] if (c["id"], c["turn"], w) in judged and (c["id"], c["turn"], w) not in approved]
            c["candidates"] = [w for w in c["candidates"] if (c["id"], c["turn"], w) in approved]
    options = [[c["original"], *c["candidates"]] for c in cands]
    feats = [[feature_counts(o) for o in opts] for opts in options]
    lens = [[words(o) for o in opts] for opts in options]
    ais = [[bool(AI.search(o)) for o in opts] for opts in options]
    choice = [0] * len(cands)

    def totals_of(ch):
        tot = {k: 0 for k in {**CAPS, **MARKERS}}
        for i, j in enumerate(ch):
            for k, v in feats[i][j].items():
                tot[k] += v
        return tot, sum(lens[i][j] for i, j in enumerate(ch)), sum(ais[i][j] for i, j in enumerate(ch))

    before_tot, before_words, before_ai = totals_of(choice)
    tot, n_words, n_ai = before_tot.copy(), before_words, before_ai
    rng = random.Random(7)
    order = list(range(len(cands)))
    for _ in range(4):  # greedy passes
        rng.shuffle(order)
        for i in order:
            best, best_d = choice[i], None
            for j in range(len(options[i])):
                t = {k: tot[k] - feats[i][choice[i]][k] + feats[i][j][k] for k in tot}
                w = n_words - lens[i][choice[i]] + lens[i][j]
                a = n_ai - ais[i][choice[i]] + ais[i][j]
                d = distance(t, w, len(cands), a)
                if best_d is None or d < best_d - 1e-12:
                    best, best_d = j, d
            if best != choice[i]:
                for k in tot:
                    tot[k] += feats[i][best][k] - feats[i][choice[i]][k]
                n_words += lens[i][best] - lens[i][choice[i]]
                n_ai += ais[i][best] - ais[i][choice[i]]
                choice[i] = best

    chosen = {(c["id"], c["turn"]): options[i][choice[i]] for i, c in enumerate(cands)}
    for split in ("train", "val"):
        lines = []
        for r in (x for x in rows() if x["split"] == split):
            msgs = [dict(m) for m in r["messages"]]
            for k, m in enumerate(msgs):
                if (r["id"], k) in chosen:
                    m["content"] = chosen[(r["id"], k)]
            lines.append(json.dumps({"messages": msgs}))
        (V3 / f"{split}.jsonl").write_text("\n".join(lines) + "\n")

    def report(t, w, a):
        return {"words_per_reply": round(w / len(cands), 1), "ai_mentions_%": round(100 * a / len(cands), 1),
                **{f"{k} /10k": round(v / w * 1e4, 1) for k, v in t.items()}}
    stats = {
        "replies": len(cands), "with_usable_rewrite": sum(bool(c["candidates"]) for c in cands),
        "judged_out": sum(len(c.get("judged_out", [])) for c in cands),
        "rewrite_chosen": sum(1 for j in choice if j > 0),
        "rejected_reasons": dict(sorted(_count(r for c in cands for r in c["rejected"]).items(), key=lambda kv: -kv[1])),
        "targets_per_10k": {**{k: f"<= {v[2]}" for k, v in CAPS.items()}, **{k: v[2] for k, v in MARKERS.items()},
                            "words_per_reply": TARGET_WORDS},
        "corpus_per_10k": {k: v[1] for k, v in {**CAPS, **MARKERS}.items()},
        "v2": report(before_tot, before_words, before_ai),
        "v3": report(tot, n_words, n_ai),
        "distance": {"v2": round(distance(before_tot, before_words, len(cands), before_ai), 2),
                     "v3": round(distance(tot, n_words, len(cands), n_ai), 2)},
    }
    (V3 / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps({k: stats[k] for k in ("replies", "with_usable_rewrite", "judged_out", "rewrite_chosen", "distance")}, indent=2))
    for k in ("words_per_reply", "ai_mentions_%", "lovely /10k", "brilliant /10k", "yeah /10k", "you know /10k",
              "tag questions /10k", "oh /10k", "really /10k"):
        print(f"  {k:22} v2 {stats['v2'][k]:>7}   v3 {stats['v3'][k]:>7}")


def _count(items) -> dict:
    out: dict = {}
    for x in items:
        out[x] = out.get(x, 0) + 1
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["rewrite", "judge", "select", "words"])
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0, help="rewrite only this many replies (a trial)")
    a = ap.parse_args()
    if a.stage == "rewrite":
        stage_rewrite(a.workers, a.limit)
    elif a.stage == "judge":
        stage_judge(a.workers)
    elif a.stage == "words":
        stage_words(a.workers)
    else:
        stage_select()
