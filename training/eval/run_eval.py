"""Run the fixed evaluation prompts through a model (via Ollama) and score the replies.

    backend/.venv/bin/python training/eval/run_eval.py base-full llama3.2:3b --prompt full
    backend/.venv/bin/python training/eval/run_eval.py base-short llama3.2:3b --prompt short

Uses the app's own system prompt and sampling settings, so the numbers describe what users get.
Writes results/<name>.jsonl (every reply with its scores) and updates results/summary.json.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "backend"))
from app.config import Settings  # noqa: E402
from app.llm.prompt import SYSTEM_PROMPT  # noqa: E402
from score import Score, is_correct, score, summarise  # noqa: E402

# What a fine-tuned model should need: the persona's name only, no style rules (fewer tokens).
SHORT_PROMPT = "You are Ellie, a warm, friendly conversational partner from England."
PROMPTS = {"full": SYSTEM_PROMPT, "short": SHORT_PROMPT, "none": None}


def run(name: str, model: str, prompt: str, repeats: int, url: str) -> dict:
    settings = Settings(_env_file=None)
    options = {"temperature": settings.temperature, "top_p": settings.top_p,
               "num_predict": settings.num_predict, "repeat_penalty": settings.repeat_penalty,
               "num_ctx": settings.num_ctx}
    system = PROMPTS[prompt]
    cases = [json.loads(line) for line in (HERE / "prompts.jsonl").read_text().splitlines() if line.strip()]
    (HERE / "results").mkdir(exist_ok=True)
    rows: list[dict] = []
    started = time.time()
    with httpx.Client(base_url=url, timeout=300) as client:
        for rep in range(repeats):
            for case in cases:
                messages = ([{"role": "system", "content": system}] if system else []) + case["messages"]
                d = client.post("/api/chat", json={
                    "model": model, "messages": messages, "stream": False, "think": False,
                    "keep_alive": "10m", "options": {**options, "seed": 1000 + rep},
                }).json()
                rows.append({"id": case["id"], "category": case["category"], "repeat": rep,
                             "reply": d["message"]["content"], "done_reason": d.get("done_reason", "stop"),
                             "prompt_tokens": d.get("prompt_eval_count")})
            print(f"  {name}: pass {rep + 1}/{repeats} done ({time.time() - started:.0f}s)", flush=True)
    return save(name, {"model": model, "prompt": prompt, "repeats": repeats}, rows, cases)


def rescore(name: str) -> dict:
    """Score saved replies again (after a change to the checks), without generating new ones."""
    path = HERE / "results" / f"{name}.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    meta = json.loads((HERE / "results" / "summary.json").read_text())[name]
    cases = [json.loads(line) for line in (HERE / "prompts.jsonl").read_text().splitlines() if line.strip()]
    return save(name, {k: meta[k] for k in ("model", "prompt", "repeats")}, rows, cases)


def save(name: str, meta: dict, rows: list[dict], cases: list[dict]) -> dict:
    expect = {c["id"]: c["expect"] for c in cases if "expect" in c}
    scores: list[Score] = []
    correct: list[bool] = []
    by_id = {c["id"]: c for c in cases}
    for r in rows:
        users = [m["content"] for m in by_id[r["id"]]["messages"] if m["role"] == "user"]
        s = score(r["reply"], r.get("done_reason", "stop"), users[-1], len(users) > 1)
        scores.append(s)
        r.update(s.as_dict())
        if r["id"] in expect:
            r["correct"] = is_correct(r["reply"], expect[r["id"]])
            correct.append(r["correct"])
    out_dir = HERE / "results"
    (out_dir / f"{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    summary = {**meta, "avg_prompt_tokens": round(sum(r["prompt_tokens"] or 0 for r in rows) / len(rows)),
               **summarise(scores, correct)}
    summary_path = out_dir / "summary.json"
    all_summaries = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    all_summaries[name] = summary
    summary_path.write_text(json.dumps(all_summaries, indent=2) + "\n")
    return summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("model", nargs="?")
    ap.add_argument("--prompt", choices=PROMPTS, default="full")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--url", default="http://localhost:11434")
    ap.add_argument("--rescore", action="store_true", help="re-score saved replies, generate nothing")
    a = ap.parse_args()
    result = rescore(a.name) if a.rescore else run(a.name, a.model, a.prompt, a.repeats, a.url)
    print(json.dumps(result, indent=2))
