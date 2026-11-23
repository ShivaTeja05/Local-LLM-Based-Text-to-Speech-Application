"""Rolling memory summary (docs/ARCHITECTURE.md §4).

When old turns drop out of the context window, they are folded into a short note. The front end
keeps the note and sends it back with every request, so the backend stays stateless. The note is
added to the pinned system prompt, which only changes when more turns are dropped. Those are the
same moments the prompt prefix changes anyway, so the KV cache is not broken any more often.
"""

import re

Message = dict[str, str]

MAX_NOTE_CHARS = 600

MEMORY_PROMPT = """\
You keep a short memory note about the USER in a chat with Ellie, an AI companion.
Rewrite the note so it also covers the new part of the conversation. Keep only facts that matter later: \
the user's name, the people and pets they mention (with their names), their plans, likes and dislikes, \
problems they shared, and the main topics.
Rules: short plain sentences that each start with "The user" or the user's name; at most 60 words; \
never add anything that was not said; output only the note.
Example note: The user's name is Sam. Sam has a cat called Mog. Sam is revising for exams and likes tea."""

# How the note is shown to Ellie, at the end of the pinned system prompt.
NOTE_INTRO = ("Earlier in this conversation the user told you the facts below. Those messages are no longer "
              "shown, but the facts are true: use them when they are relevant.\nMemory:")


def memory_messages(previous_note: str, turns: list[list[Message]]) -> list[Message]:
    convo = "\n".join(f"{'User' if m['role'] == 'user' else 'Ellie'}: {m['content']}" for t in turns for m in t)
    return [
        {"role": "system", "content": MEMORY_PROMPT},
        {"role": "user", "content": f"Current note: {previous_note.strip() or '(empty)'}\n\n"
                                    f"New part of the conversation:\n{convo}"},
    ]


def clean_note(text: str) -> str:
    text = re.sub(r"^\s*(?:current\s+|updated\s+|new\s+)?(?:memory\s+)?note\s*:\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > MAX_NOTE_CHARS:  # cut back to a whole sentence
        cut = text[:MAX_NOTE_CHARS]
        text = cut[: cut.rfind(".") + 1] or cut
    return text
