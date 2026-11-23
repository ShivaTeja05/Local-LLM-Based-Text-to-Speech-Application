"""Run: backend/.venv/bin/python -m pytest training/eval -q"""

from score import is_correct, score, summarise


def test_known_answers():
    assert is_correct("It's Canberra, though many guess Sydney.", [r"\bCanberra\b"])
    assert not is_correct("I'm not sure, sorry.", [r"\bCanberra\b"])
    assert summarise([score("a")], correct=[True, False])["correct_%"] == 50.0


def test_british_reply_is_clean():
    s = score("I'm very well, thank you. What's your favourite colour?")
    assert s.clean and s.ends_question and s.american == []


def test_american_spelling_and_words_are_caught():
    s = score("My favorite color is gray. Ask your mom about the vacation.")
    assert s.american == ["favorite", "color", "gray", "mom", "vacation"]


def test_british_words_containing_american_ones_are_not_flagged():
    assert score("The theatre is in the town centre, near the colourful flats.").american == []


def test_lists_and_markdown_are_caught():
    assert score("Here you go:\n1. Flour\n2. Eggs").markdown
    assert score("Try **this** one").markdown
    assert not score("Mix 2.5 cups of flour with the eggs.").markdown


def test_too_long_by_sentences_or_words():
    assert score("One. Two. Three. Four.").too_long
    assert score(" ".join(["word"] * 61) + ".").too_long
    assert not score("One. Two. Three?").too_long


def test_invented_life_is_caught_but_honest_answers_are_not():
    assert score("I had toast this morning with my mum.").invented_life == ["I had toast", "my mum"]
    assert score("When I was little I loved the sea.").invented_life
    assert not score("I don't eat breakfast, being an AI, but what did you have?").invented_life
    assert not score("Your mum sounds lovely.").invented_life


def test_robotic_phrasing_is_caught():
    assert score("As an AI language model, I cannot.").robotic
    assert score("I'm just a computer programme running all day.").robotic
    assert score("I don't have feelings, but thanks.").robotic


def test_cut_off_and_prefix():
    assert score("And then the", done_reason="length").cut_off
    assert score("Ellie: Hello!").prefix


def test_summary_rates():
    out = summarise([score("Hello there!"), score("My favorite one.")])
    assert out["replies"] == 2 and out["american_%"] == 50.0 and out["clean_%"] == 50.0


def test_unhelpful_habits_depend_on_what_the_user_asked():
    recipe = "Give me a recipe for pancakes."
    assert score("I can't give you a recipe since I run locally.", user=recipe).habit
    assert not score("Mix flour, eggs and milk, then fry them.", user=recipe).clean is False
    assert score("I can't see today's forecast, sorry.", user="Will it rain today?").habit is None
    assert score("I can't give medical advice; do see your GP.", user="Is this rash serious?").habit is None
    assert score("I can't recall your name, sorry.", user="What's my name?", earlier_turns=True).habit
    assert score("You're Priya, of course!", user="What's my name?", earlier_turns=True).habit is None


def test_questions_about_live_info_or_ellie_herself_allow_the_explanation():
    assert score("I can't check live news, sorry.", user="Who won the most recent general election?").habit is None
    assert score("I can't check your bank balance.", user="Can you tell me my bank balance?").habit is None
    assert score("I'm an AI running on your device.", user="Whereabouts in England do you live?").habit is None
    assert score("Canberra, though I can't check live times since I run locally.",
                 user="What's the capital of Australia?").habit
