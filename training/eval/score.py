"""Automatic style checks for Ellie's replies.

Each check is a simple, explainable rule, so a score can be traced back to the exact words that
caused it. They are scored on the model's RAW output (before the app's clean-up), because the
fine-tune should make the model itself behave, not rely on the clean-up.
"""

import re
from dataclasses import asdict, dataclass, field

# American spellings and words, each with the British form Ellie should use.
# (Oxford spelling also allows -ize; the app's target is the more common British -ise.)
AMERICAN = {
    "color": "colour", "colors": "colours", "colorful": "colourful", "favorite": "favourite",
    "favorites": "favourites", "flavor": "flavour", "flavors": "flavours", "honor": "honour",
    "humor": "humour", "neighbor": "neighbour", "neighbors": "neighbours",
    "neighborhood": "neighbourhood", "behavior": "behaviour", "labor": "labour",
    "center": "centre", "centers": "centres", "theater": "theatre", "liter": "litre",
    "fiber": "fibre", "gray": "grey", "traveled": "travelled", "traveling": "travelling",
    "canceled": "cancelled", "jewelry": "jewellery", "catalog": "catalogue",
    "organize": "organise", "organized": "organised", "organizing": "organising",
    "realize": "realise", "realized": "realised", "recognize": "recognise",
    "apologize": "apologise", "prioritize": "prioritise", "analyze": "analyse",
    "favor": "favour", "cozy": "cosy", "mom": "mum", "moms": "mums", "apartment": "flat",
    "vacation": "holiday", "vacations": "holidays", "cookie": "biscuit", "cookies": "biscuits",
    "candy": "sweets", "soccer": "football", "trash": "rubbish", "garbage": "rubbish",
    "elevator": "lift", "sidewalk": "pavement", "cellphone": "mobile", "zip code": "postcode",
    "faucet": "tap", "diaper": "nappy", "gotten": "got", "math": "maths",
}
AMERICAN_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, AMERICAN), key=len, reverse=True)) + r")\b", re.I)

EMOJI_RE = re.compile("[\U0001f000-\U0001faff\U00002600-\U000027bf]")
MARKDOWN_RE = re.compile(r"[*#`]|^\s*(?:[-•]|\d+[.)])\s", re.M)
PREFIX_RE = re.compile(r"^\s*(ellie|assistant)\s*:", re.I)
SENTENCE_RE = re.compile(r"[^.!?…]+(?:[.!?…]+|$)")

# First-person claims of a human life. A heuristic: it is checked by reading the flagged replies.
INVENTED_LIFE_RE = re.compile(
    r"\b(?:my (?:mum|mom|dad|husband|wife|partner|kids|children|son|daughter|brother|sister|family|"
    r"flat|house|home|garden|dog|cat|friends?|commute|job|office|car)|"
    r"I (?:went|visited|grew up|was born|had (?:a|some|toast|cereal|porridge|eggs|coffee|tea)|ate|"
    r"live in|lived|spent the|watched|cooked|baked|walked)|"
    r"when I was (?:a |younger|little)|last (?:night|weekend|week|summer|year) I)\b",
    re.I,
)
ROBOTIC_RE = re.compile(
    r"\b(?:as an ai language model|i am (?:just )?a (?:computer )?program(?:me)?|i'm (?:just )?a (?:computer )?program(?:me)?|"
    r"(?:just )?a collection of (?:code|data)|"
    r"i do not have (?:personal )?(?:feelings|emotions)|i don't have (?:personal )?(?:feelings|emotions)|"
    r"i'm not capable of|i am not capable of)\b",
    re.I,
)
# --- Unhelpful habits, judged against the user's message ------------------------------------
# Found by reading the first fine-tune's replies: needless "I can't see live prices" or "I run on
# your computer" remarks, refusals of ordinary requests ("I can't give you a recipe"), and claiming
# to forget something said earlier in the same conversation.
# A "no live information" disclaimer is right only when the user asked for live information.
DISCLAIM = re.compile(r"\b(?:can(?:'|no)t|cannot|unable to|don't have (?:access|internet))\b[^.?!]{0,40}\b(?:live|today's|"
                      r"real[- ]time|current|up[- ]to[- ]date|internet|online|search|look (?:it )?up|browse)\b"
                      r"|\bknowledge base\b", re.I)
ASKS_LIVE = re.compile(r"\b(?:today|tonight|tomorrow|now|currently|current|latest|news|weather|forecast|prices?|"
                       r"cost|what time|time is it|train times?|score|results?|this week|look up|search|link|website|"
                       r"recent(?:ly)?|election|balance)\b", re.I)
# Mentioning that Ellie runs locally, or offline, is right only for live information or questions about her.
LOCAL = re.compile(r"\b(?:without|no|don't have)\s+(?:internet|access to the internet|online access)|"
                   r"\b(?:on|from) your (?:own )?(?:computer|device|machine)|\brun(?:s|ning)? (?:locally|privately)\b", re.I)
ASKS_SELF = re.compile(r"\b(?:are you|where are you|what are you|who are you|do you (?:record|save|store|keep|remember|"
                       r"listen|live|have|eat|sleep)|have you got|your (?:data|privacy|family|home|age|job)|cloud|internet|"
                       r"online|offline|private|privacy|chatgpt|ai\b)", re.I)
# "I can't write/give/…": right only for professional decisions, harmful requests or private data.
REFUSAL = re.compile(r"\bI (?:can(?:'|no)t|cannot|am unable to|'m unable to|won't) (?:give|provide|share|offer|write|"
                     r"tell|create|make|help|recommend|suggest|list|draft|do)\b", re.I)
NEEDS_CARE = re.compile(r"medic|doctor|\bgp\b|nhs|hospital|health|\bill\b|\billness|\bsick|rash|fever|injur|pregnan|"
                        r"symptom|\bpain|diagnos|prescri|legal|lawyer|\blaw\b|\bsue\b|\btax|invest|mortgage|loan|"
                        r"pension|debt|password|bank|account|balance|\bpin\b|address|\bkill|\bhurt|weapon|drug|\bhack|\bsteal|"
                        r"illegal|parameters|weights|predict", re.I)
FORGET = re.compile(r"\b(?:can(?:'|no)t|cannot|don't|do not)\s+(?:remember|recall)|don't have (?:a |any )?memor|"
                    r"starts? fresh|conversation (?:has )?just started", re.I)

def habit(reply: str, user: str, earlier_turns: bool) -> str | None:
    """The unhelpful habits the first adapter learned, judged against the user's message."""
    if DISCLAIM.search(reply) and not ASKS_LIVE.search(user):
        return "unprompted live-information disclaimer"
    if LOCAL.search(reply) and not (ASKS_LIVE.search(user) or ASKS_SELF.search(user)):
        return "unprompted 'I run locally' remark"
    if REFUSAL.search(reply) and not NEEDS_CARE.search(user):
        return "unnecessary refusal"
    if earlier_turns and FORGET.search(reply):
        return "claims to forget this conversation"
    return None


MAX_SENTENCES, MAX_WORDS = 3, 60


@dataclass
class Score:
    words: int
    sentences: int
    american: list[str] = field(default_factory=list)
    too_long: bool = False
    markdown: bool = False
    emoji: bool = False
    prefix: bool = False
    invented_life: list[str] = field(default_factory=list)
    robotic: list[str] = field(default_factory=list)
    lovely: int = 0
    ends_question: bool = False
    cut_off: bool = False
    habit: str | None = None

    @property
    def clean(self) -> bool:
        """No problems at all (asking a question is a style choice, not a problem)."""
        return not (self.american or self.too_long or self.markdown or self.emoji or self.prefix
                    or self.invented_life or self.robotic or self.cut_off or self.habit)

    def as_dict(self) -> dict:
        return {**asdict(self), "clean": self.clean}


def score(reply: str, done_reason: str = "stop", user: str = "", earlier_turns: bool = False) -> Score:
    text = reply.strip()
    sentences = [s for s in SENTENCE_RE.findall(text) if re.search(r"\w", s)]
    words = len(re.findall(r"[\w']+", text))
    return Score(
        words=words,
        sentences=len(sentences),
        american=[m.group(0).lower() for m in AMERICAN_RE.finditer(text)],
        too_long=len(sentences) > MAX_SENTENCES or words > MAX_WORDS,
        markdown=bool(MARKDOWN_RE.search(text)),
        emoji=bool(EMOJI_RE.search(text)),
        prefix=bool(PREFIX_RE.match(text)),
        invented_life=[m.group(0) for m in INVENTED_LIFE_RE.finditer(text)],
        robotic=[m.group(0) for m in ROBOTIC_RE.finditer(text)],
        lovely=len(re.findall(r"\blovely\b", text, re.I)),
        ends_question=text.rstrip("\"') ").endswith("?"),
        cut_off=done_reason == "length",
        habit=habit(text, user, earlier_turns),
    )


def is_correct(reply: str, expect: list[str]) -> bool:
    """For prompts with a known answer: does the reply contain it?"""
    return any(re.search(p, reply, re.I) for p in expect)


def summarise(scores: list[Score], correct: list[bool] | None = None) -> dict:
    """Rates in % of replies (lower is better, except clean, correct and ends_question)."""
    n = len(scores) or 1
    pct = lambda k: round(100 * sum(1 for s in scores if k(s)) / n, 1)  # noqa: E731
    facts = {"correct_%": round(100 * sum(correct) / len(correct), 1)} if correct else {}
    return {
        **facts,
        "replies": len(scores),
        "clean_%": pct(lambda s: s.clean),
        "american_%": pct(lambda s: s.american),
        "too_long_%": pct(lambda s: s.too_long),
        "markdown_%": pct(lambda s: s.markdown),
        "emoji_%": pct(lambda s: s.emoji),
        "invented_life_%": pct(lambda s: s.invented_life),
        "robotic_%": pct(lambda s: s.robotic),
        "cut_off_%": pct(lambda s: s.cut_off),
        "unhelpful_%": pct(lambda s: s.habit),
        "ends_question_%": pct(lambda s: s.ends_question),
        "avg_words": round(sum(s.words for s in scores) / n, 1),
        "lovely_per_reply": round(sum(s.lovely for s in scores) / n, 2),
    }
