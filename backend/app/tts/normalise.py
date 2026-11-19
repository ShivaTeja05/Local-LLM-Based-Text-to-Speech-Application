"""Text clean-up before speech synthesis.

espeak-ng (Piper's phonemiser) already copes with most things: "&", "%", "e.g.", "Dr",
plain numbers and times. These rules only fix cases it reads badly (checked by phonemising):

    "£5.50"            -> "pound five point five zero"   ✗   becomes "5 pounds 50"
    "https://x.com"    -> "aitch tee tee pee colon slash…" ✗  becomes "a link"
    "23/11/2026"       -> "twenty three slash eleven…"    ✗   becomes "23rd November 2026"
"""

import re

from app.llm.postprocess import EMOJI_RE, MARKUP_RE

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

URL_RE = re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE)
POUNDS_RE = re.compile(r"£\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?\b")
DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")  # UK order: dd/mm/yyyy
ABBREVIATIONS = [
    (re.compile(r"\bi\.e\.", re.IGNORECASE), "that is"),
    (re.compile(r"\bvs\.?(?=\s)", re.IGNORECASE), "versus"),
    (re.compile(r"\bapprox\.(?=\s)", re.IGNORECASE), "approximately"),
]


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _pounds(m: re.Match) -> str:
    whole = m.group(1).replace(",", "")
    pence = m.group(2)
    unit = "pound" if whole == "1" else "pounds"
    if pence and pence != "00":
        return f"{whole} {unit} {int(pence)}"
    return f"{whole} {unit}"


def _date(m: re.Match) -> str:
    day, month, year = int(m.group(1)), int(m.group(2)), m.group(3)
    if 1 <= day <= 31 and 1 <= month <= 12:
        return f"{_ordinal(day)} {MONTHS[month - 1]} {year}"
    return m.group(0)


def normalise_for_speech(text: str) -> str:
    text = EMOJI_RE.sub("", text)
    text = MARKUP_RE.sub("", text)
    text = URL_RE.sub("a link", text)
    text = POUNDS_RE.sub(_pounds, text)
    text = DATE_RE.sub(_date, text)
    for pattern, replacement in ABBREVIATIONS:
        text = pattern.sub(replacement, text)
    return re.sub(r"\s+", " ", text).strip()
