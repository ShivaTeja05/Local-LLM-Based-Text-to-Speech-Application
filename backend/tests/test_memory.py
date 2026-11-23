"""Rolling memory note: context building, note clean-up and the /api/memory endpoint."""

from app.api import memory as memory_api  # noqa: F401  (route registered by create_app)
from app.config import Settings, get_settings
from app.llm.context import build_messages
from app.llm.memory import MAX_NOTE_CHARS, NOTE_INTRO, clean_note, memory_messages
from app.llm.prompt import SYSTEM_PROMPT
from tests.test_api import FakeLLM, make_client  # noqa: F401  (fixture)
from tests.test_context import conversation

NOTE = "The user is Sam, studies at Lancaster and has a spaniel called Biscuit."
SMALL = Settings(_env_file=None, history_token_budget=300, trim_chunk_turns=2)


def test_note_goes_into_the_pinned_prompt_once_turns_are_dropped():
    ctx = build_messages(conversation(20), SMALL, note=NOTE)
    assert ctx.turns_dropped > 0
    assert ctx.messages[0]["content"] == f"{SYSTEM_PROMPT}\n\n{NOTE_INTRO} {NOTE}"


def test_note_is_ignored_while_nothing_is_dropped():
    ctx = build_messages(conversation(2), SMALL, note=NOTE)
    assert ctx.turns_dropped == 0
    assert ctx.messages[0]["content"] == SYSTEM_PROMPT


def test_memory_prompt_lists_the_turns_and_previous_note():
    msgs = memory_messages(NOTE, [[{"role": "user", "content": "I'm off to Wales"},
                                   {"role": "assistant", "content": "How lovely!"}]])
    assert "The user" in msgs[0]["content"] and "never add anything" in msgs[0]["content"]
    assert NOTE in msgs[1]["content"] and "User: I'm off to Wales\nEllie: How lovely!" in msgs[1]["content"]


def test_clean_note_strips_labels_and_caps_length():
    assert clean_note("Updated note: The user is Sam.\n") == "The user is Sam."
    assert clean_note("Current note: The user is Sam.") == "The user is Sam."
    long = clean_note("The user likes tea. " * 60)
    assert len(long) <= MAX_NOTE_CHARS and long.endswith(".")


def _client(make_client, llm):
    client = make_client(llm=llm)
    client.app.dependency_overrides[get_settings] = lambda: SMALL
    return client


def test_memory_endpoint_folds_the_dropped_turns(make_client):
    llm = FakeLLM(deltas=("Note: The user is ", "Sam."))
    history = conversation(20)
    ctx = build_messages(history, SMALL)
    r = _client(make_client, llm).post("/api/memory", json={"messages": history, "upto": ctx.turns_dropped})
    assert r.status_code == 200
    assert r.json() == {"note": "The user is Sam.", "turns": ctx.turns_dropped}
    assert llm.last_options == {"temperature": 0.2, "num_predict": 120}
    convo = llm.last_messages[1]["content"]
    assert "question 0 " in convo and f"question {ctx.turns_dropped} " not in convo  # only dropped turns


def test_memory_endpoint_only_folds_new_turns(make_client):
    llm = FakeLLM(deltas=("The user is Sam and likes tea.",))
    history = conversation(20)
    r = _client(make_client, llm).post("/api/memory", json={
        "messages": history, "memory": {"note": NOTE, "turns": 4}, "upto": 6})
    assert r.json()["turns"] == 6
    convo = llm.last_messages[1]["content"]
    assert NOTE in convo and "question 4 " in convo and "question 3 " not in convo


def test_memory_endpoint_with_nothing_new_makes_no_llm_call(make_client):
    llm = FakeLLM()
    r = _client(make_client, llm).post("/api/memory", json={
        "messages": conversation(20), "memory": {"note": NOTE, "turns": 6}, "upto": 6})
    assert r.json() == {"note": NOTE, "turns": 6}
    assert llm.last_messages is None


def test_chat_stream_uses_the_note(make_client):
    llm = FakeLLM()
    client = _client(make_client, llm)
    r = client.post("/api/chat/stream", json={"messages": conversation(20), "memory": {"note": NOTE, "turns": 6}})
    assert r.status_code == 200
    assert NOTE in llm.last_messages[0]["content"]
