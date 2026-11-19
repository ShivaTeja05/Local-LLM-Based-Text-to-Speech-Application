import pytest

from app.config import Settings
from app.llm.context import ContextError, build_messages, estimate_tokens, group_turns
from app.llm.prompt import pinned_messages

PINNED = pinned_messages()


def settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def conversation(n_turns: int, words: int = 30) -> list[dict]:
    """n_turns completed user/assistant exchanges + one new user message."""
    msgs = []
    filler = " ".join(["word"] * words)
    for i in range(n_turns):
        msgs.append({"role": "user", "content": f"question {i} {filler}"})
        msgs.append({"role": "assistant", "content": f"answer {i} {filler}"})
    msgs.append({"role": "user", "content": "latest question?"})
    return msgs


def test_pinned_prompt_always_first():
    out = build_messages(conversation(200), settings()).messages
    assert out[: len(PINNED)] == PINNED
    assert out[-1] == {"role": "user", "content": "latest question?"}


def test_short_history_is_untouched():
    hist = conversation(3)
    res = build_messages(hist, settings())
    assert res.turns_dropped == 0
    assert res.messages[len(PINNED):] == hist


def test_history_fits_budget():
    s = settings(history_token_budget=1000)
    res = build_messages(conversation(100), s)
    history = res.messages[len(PINNED):]
    assert sum(estimate_tokens(m["content"]) for m in history) <= 1000
    assert res.est_history_tokens <= 1000
    assert res.turns_dropped > 0


def test_turns_stay_paired():
    res = build_messages(conversation(100), settings(history_token_budget=1000))
    history = res.messages[len(PINNED):-1]
    assert history[0]["role"] == "user"
    roles = [m["role"] for m in history]
    assert roles == ["user", "assistant"] * (len(roles) // 2)


def test_dropped_turns_are_whole_chunks():
    s = settings(history_token_budget=1000, trim_chunk_turns=6)
    for n in range(20, 80):
        res = build_messages(conversation(n), s)
        assert res.turns_dropped % 6 == 0 or res.turns_dropped == res.turns_total


def test_prefix_is_stable_across_consecutive_turns():
    """The point of chunked trimming: most consecutive requests share the same prompt start,
    so Ollama can reuse its KV cache."""
    s = settings(history_token_budget=1000, trim_chunk_turns=6)
    stable = 0
    total = 0
    for n in range(30, 90):
        a = build_messages(conversation(n), s)
        b = build_messages(conversation(n + 1), s)
        total += 1
        if a.turns_dropped == b.turns_dropped:
            # identical prefix: everything before a's latest user message is unchanged in b
            prefix = a.messages[:-1]
            assert b.messages[: len(prefix)] == prefix
            stable += 1
    assert stable / total >= 0.8  # one trim every ~6 turns


def test_latest_message_kept_even_if_large():
    hist = conversation(5) [:-1] + [{"role": "user", "content": "x" * 500}]
    res = build_messages(hist, settings(history_token_budget=150))
    assert res.messages[-1]["content"] == "x" * 500


@pytest.mark.parametrize(
    "hist, msg",
    [
        ([], "empty"),
        ([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}], "from the user"),
        ([{"role": "user", "content": "   "}], "not be empty"),
        ([{"role": "user", "content": "x" * 501}], "longer than 500"),
    ],
)
def test_invalid_history(hist, msg):
    with pytest.raises(ContextError, match=msg):
        build_messages(hist, settings())


def test_old_messages_truncated_and_empties_dropped():
    hist = [
        {"role": "user", "content": "a" * 900},
        {"role": "assistant", "content": ""},
        {"role": "assistant", "content": "b" * 5000},
        {"role": "user", "content": "now"},
    ]
    out = build_messages(hist, settings()).messages[len(PINNED):]
    assert [len(m["content"]) for m in out] == [500, 1000, 3]


def test_group_turns_handles_leading_assistant():
    turns = group_turns([
        {"role": "assistant", "content": "welcome"},
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ])
    assert [len(t) for t in turns] == [1, 2]
