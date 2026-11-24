"""How British is Ellie? Her replies measured against real British conversation (Spoken BNC2014).

    python3 research/britishness.py            # reads research/data/ (not in git), writes research/results/

The Spoken BNC2014 (Love, Dembry, Hardie, Brezina & McEnery 2017) is ~11.4 million words of informal
British conversation recorded in 2012-16. Its licence forbids redistributing any part of it or
storing it in the cloud, so the corpus stays in research/data/ (git-ignored, local only) and only
aggregate statistics are written out.

Four measures, each for every model setup we evaluated (training/eval/results/*.jsonl):

1. Britishness index: of the words that have a British and an American variant (colour/color,
   holiday/vacation, mum/mom ...), the share that are British.
2. Conversational features per 10,000 words (discourse markers, hedges, British favourites, tag
   questions), compared with the corpus using Log Ratio (Hardie 2014: the binary log of the ratio
   of relative frequencies; 1 = twice as frequent) and log-likelihood (G2) for significance.
3. Keywords: the words a model over- and under-uses compared with the corpus (LL, filtered by LR).
4. Turn length: words per reply versus words per conversational turn.

Standard library only.
"""

import json
import math
import re
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "data" / "spoken" / "untagged"
EVAL = ROOT.parent / "training" / "eval" / "results"
OUT = ROOT / "results"

MODELS = {
    "base-full": "llama3.2:3b + full style prompt (the live app)",
    "tuned-short": "ellie-british LoRA fine-tune + one-line prompt",
    "base-short": "llama3.2:3b + one-line prompt (no fine-tune)",
    "teacher-full": "qwen3.5:35b + full prompt (wrote the training data)",
}

TOKEN = re.compile(r"[a-z]+(?:'[a-z]+)?")

# --- 1. British / American variants (chosen to be unambiguous in conversation) ------------------
VARIANTS = [
    ("colour", "color"), ("colours", "colors"), ("colourful", "colorful"), ("favourite", "favorite"),
    ("favourites", "favorites"), ("flavour", "flavor"), ("flavours", "flavors"), ("neighbour", "neighbor"),
    ("neighbours", "neighbors"), ("behaviour", "behavior"), ("humour", "humor"), ("honour", "honor"),
    ("favour", "favor"), ("centre", "center"), ("theatre", "theater"), ("realise", "realize"),
    ("realised", "realized"), ("organise", "organize"), ("organised", "organized"), ("recognise", "recognize"),
    ("apologise", "apologize"), ("analyse", "analyze"), ("grey", "gray"), ("travelled", "traveled"),
    ("travelling", "traveling"), ("cancelled", "canceled"), ("jewellery", "jewelry"), ("defence", "defense"),
    ("catalogue", "catalog"), ("cosy", "cozy"), ("pyjamas", "pajamas"), ("mum", "mom"), ("mummy", "mommy"),
    ("maths", "math"), ("aeroplane", "airplane"), ("holiday", "vacation"), ("holidays", "vacations"),
    ("rubbish", "trash"), ("biscuit", "cookie"), ("biscuits", "cookies"), ("lorry", "truck"),
    ("pavement", "sidewalk"), ("motorway", "freeway"), ("trainers", "sneakers"), ("nappy", "diaper"),
    ("nappies", "diapers"), ("petrol", "gasoline"), ("film", "movie"), ("films", "movies"),
    ("sweets", "candy"), ("jumper", "sweater"), ("torch", "flashlight"), ("takeaway", "takeout"),
    ("fortnight", "two-weeks"), ("queueing", "lining"),
]

# --- 2. Conversational features (regexes over the lower-cased, space-joined tokens) --------------
FEATURES = {
    # British favourites
    "lovely": r"\blovely\b", "brilliant": r"\bbrilliant\b", "cheers": r"\bcheers\b", "cuppa": r"\bcuppa\b",
    "quite": r"\bquite\b", "rather": r"\brather\b", "reckon": r"\breckon\b", "fancy": r"\bfancy\b",
    "a bit": r"\ba bit\b", "loads": r"\bloads\b", "mate": r"\bmate\b", "proper": r"\bproper\b",
    # American-leaning
    "awesome": r"\bawesome\b", "i guess": r"\bi guess\b", "gotten": r"\bgotten\b",
    # Discourse markers and hedges of everyday talk
    "yeah": r"\byeah\b", "okay / ok": r"\b(?:okay|ok)\b", "really": r"\breally\b", "actually": r"\bactually\b",
    "you know": r"\byou know\b", "i mean": r"\bi mean\b", "sort of": r"\bsort of\b", "kind of": r"\bkind of\b",
    "i think": r"\bi think\b", "like": r"\blike\b",
    # Filled pauses (transcribed in the corpus)
    "erm / er / um": r"\b(?:erm|er|um|uh)\b",
    # Tag questions: "isn't it?", "don't you?" ...
    "tag questions": r"\b(?:is|are|was|were|do|does|did|have|has|had|would|could|should|will|can|wo|ca)n't "
                     r"(?:it|you|they|we|he|she|i|there|that)\b(?= ?\?)",
}


def tokens(text: str) -> list[str]:
    return TOKEN.findall(text.lower().replace("’", "'"))


def joined(text: str) -> str:
    """Lower-cased tokens with ? kept (for tag questions), single-spaced."""
    t = text.lower().replace("’", "'")
    return " ".join(re.findall(r"[a-z]+(?:'[a-z]+)?|\?", t))


# --- reading ----------------------------------------------------------------------------------------
U = re.compile(r"<u\b[^>]*>(.*?)</u>", re.S)
DROP = re.compile(r"<(?:vocal|event|pause|unclear|shift|anon)\b[^>]*/>|<anon\b[^>]*>.*?</anon>|<trunc>.*?</trunc>", re.S)
TAG = re.compile(r"<[^>]+>")


def read_corpus():
    """Utterances of the Spoken BNC2014 (tags removed: names, laughter, pauses, truncated words)."""
    for f in sorted(CORPUS.glob("*.xml")):
        xml = f.read_text(encoding="utf-8")
        for m in U.finditer(xml):
            text = TAG.sub(" ", DROP.sub(" ", m.group(1)))
            if text.strip():
                yield text


def read_model(name: str) -> list[str]:
    path = EVAL / f"{name}.jsonl"
    return [json.loads(line)["reply"] for line in path.read_text().splitlines() if line.strip()]


# --- statistics --------------------------------------------------------------------------------------
def log_ratio(a: int, n_a: int, b: int, n_b: int) -> float:
    """Hardie's Log Ratio with 0.5 added to zero frequencies."""
    return math.log2(((a or 0.5) / n_a) / ((b or 0.5) / n_b))


def log_likelihood(a: int, n_a: int, b: int, n_b: int) -> float:
    e_a = n_a * (a + b) / (n_a + n_b)
    e_b = n_b * (a + b) / (n_a + n_b)
    ll = 0.0
    for o, e in ((a, e_a), (b, e_b)):
        if o:
            ll += o * math.log(o / e)
    return 2 * ll


def profile(texts: list[str]) -> dict:
    words = Counter()
    lengths = []
    flat = []
    for t in texts:
        tok = tokens(t)
        words.update(tok)
        lengths.append(len(tok))
        flat.append(joined(t))
    big = "\n".join(flat)
    return {"n": sum(words.values()), "words": words, "lengths": lengths,
            "features": {k: len(re.findall(p, big)) for k, p in FEATURES.items()}}


def britishness(words: Counter) -> dict:
    br = sum(words[b] for b, _ in VARIANTS)
    am = sum(words[a] for _, a in VARIANTS)
    used = sorted(((b, words[b]) for b, _ in VARIANTS if words[b]), key=lambda x: -x[1])
    am_used = sorted(((a, words[a]) for _, a in VARIANTS if words[a]), key=lambda x: -x[1])
    return {"british": br, "american": am, "index": round(br / (br + am), 3) if br + am else None,
            "british_forms": used[:8], "american_forms": am_used[:8]}


def keywords(focus: dict, ref: dict, top: int = 15, min_freq: int = 5) -> dict:
    n_f, n_r = focus["n"], ref["n"]
    rows = []
    for w in set(focus["words"]) | {w for w, c in ref["words"].most_common(3000)}:
        a, b = focus["words"][w], ref["words"][w]
        if a + b < min_freq:
            continue
        rows.append((w, a, b, log_likelihood(a, n_f, b, n_r), log_ratio(a, n_f, b, n_r)))
    over = sorted((r for r in rows if r[4] > 1 and r[1] >= min_freq), key=lambda r: -r[3])[:top]
    under = sorted((r for r in rows if r[4] < -1), key=lambda r: -r[3])[:top]
    fmt = lambda r: {"word": r[0], "ellie_per_10k": round(r[1] / n_f * 1e4, 1),
                     "bnc_per_10k": round(r[2] / n_r * 1e4, 1), "log_ratio": round(r[4], 2), "ll": round(r[3], 1)}
    return {"overused": [fmt(r) for r in over], "underused": [fmt(r) for r in under]}


def main() -> None:
    if not CORPUS.is_dir():
        raise SystemExit("Spoken BNC2014 not found: unzip bnc2014spoken-xml.zip into research/data/")
    print("Reading the Spoken BNC2014 ...")
    bnc = profile(list(read_corpus()))
    print(f"  {bnc['n']:,} words in {len(bnc['lengths']):,} turns")
    results = {
        "corpus": {
            "name": "Spoken BNC2014 (Love et al. 2017)", "words": bnc["n"], "turns": len(bnc["lengths"]),
            "words_per_turn": {"mean": round(statistics.mean(bnc["lengths"]), 1),
                               "median": statistics.median(bnc["lengths"])},
            "britishness": britishness(bnc["words"]),
            "features_per_10k": {k: round(v / bnc["n"] * 1e4, 2) for k, v in bnc["features"].items()},
        },
        "models": {},
    }
    for name, label in MODELS.items():
        m = profile(read_model(name))
        feats = {}
        for k, v in m["features"].items():
            ref = bnc["features"][k]
            feats[k] = {"per_10k": round(v / m["n"] * 1e4, 1), "bnc_per_10k": round(ref / bnc["n"] * 1e4, 1),
                        "count": v, "log_ratio": round(log_ratio(v, m["n"], ref, bnc["n"]), 2),
                        "ll": round(log_likelihood(v, m["n"], ref, bnc["n"]), 1)}
        results["models"][name] = {
            "label": label, "replies": len(m["lengths"]), "words": m["n"],
            "words_per_reply": {"mean": round(statistics.mean(m["lengths"]), 1), "median": statistics.median(m["lengths"])},
            "britishness": britishness(m["words"]),
            "features": feats,
            "keywords_vs_bnc": keywords(m, bnc),
        }
        b = results["models"][name]["britishness"]
        print(f"  {name:13} {m['n']:6,} words  Britishness {b['index']} ({b['british']} British / {b['american']} American)")
    OUT.mkdir(exist_ok=True)
    (OUT / "britishness.json").write_text(json.dumps(results, indent=2))
    print(f"Wrote {OUT / 'britishness.json'}")


if __name__ == "__main__":
    main()
