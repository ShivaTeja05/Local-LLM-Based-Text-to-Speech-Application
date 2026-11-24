"""Regression checks for the dataset gates; no model calls or corpus text needed."""

from build_dataset import acceptable
from corpus_style import word_edit_ok


def test_quality_gate_uses_the_users_context():
    reply = "I can't check today's forecast, sorry."
    assert acceptable(reply, "stop", user="Will it rain today?") == (True, "ok")
    assert not acceptable(reply, "stop", user="How do I cook rice?")[0]


def test_quality_gate_checks_conversation_memory():
    assert not acceptable("I can't recall your name, sorry.", "stop",
                          user="What's my name?", earlier_turns=True)[0]


def test_word_edit_preserves_punctuation_order_and_repetition():
    original = "That's lovely; do try it, do."
    assert word_edit_ok(original, "That's really nice; do try it, do.", "lovely")
    assert not word_edit_ok(original, "That's nice; try it, do.", "lovely")
    assert not word_edit_ok(original, "That's nice; do it, try do.", "lovely")
    assert not word_edit_ok(original, "That's nice, do try it, do.", "lovely")
    assert not word_edit_ok(original, "That's brilliant; do try it, do.", "lovely")


def test_word_edit_changes_only_one_occurrence():
    assert word_edit_ok("Lovely, lovely!", "Nice, lovely!", "lovely")
    assert not word_edit_ok("Lovely, lovely!", "Nice, nice!", "lovely")
    assert word_edit_ok("That's lovely", "That's good", "lovely")
