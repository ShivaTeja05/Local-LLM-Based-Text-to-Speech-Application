import pytest

from app.llm.postprocess import clean_delta, finalize
from app.tts.normalise import normalise_for_speech


def test_clean_delta_strips_markdown_and_emoji_keeps_spaces():
    assert clean_delta(" **Lovely**") == " Lovely"
    assert clean_delta(" day 😊") == " day "
    assert clean_delta("# Title") == " Title"


def test_finalize_collapses_whitespace_and_prefix():
    assert finalize("Ellie:  Hello  there.\n\nHow are you?") == "Hello there. How are you?"


def test_finalize_truncated_cuts_to_last_sentence():
    assert finalize("That's lovely. I think the weather will", truncated=True) == "That's lovely."
    assert finalize("No full stop here", truncated=True) == "No full stop here…"
    assert finalize("Not truncated so keep this", truncated=False) == "Not truncated so keep this"


@pytest.mark.parametrize(
    "text, expected",
    [
        ("It costs £5.50 today.", "It costs 5 pounds 50 today."),
        ("Only £1!", "Only 1 pound!"),
        ("£1,200.00 please", "1200 pounds please"),
        ("See https://example.com/page now.", "See a link now."),
        ("On 23/11/2026 we meet.", "On 23rd November 2026 we meet."),
        ("On 1/2/2026.", "On 1st February 2026."),
        ("On 12/11/2026.", "On 12th November 2026."),
        ("Bad date 40/13/2026.", "Bad date 40/13/2026."),
        ("Tea, i.e. a cuppa.", "Tea, that is a cuppa."),
        ("**Cheers** 🎉", "Cheers"),
    ],
)
def test_normalise_for_speech(text, expected):
    assert normalise_for_speech(text) == expected
