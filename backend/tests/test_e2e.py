"""End-to-end tests of the real LLM + TTS layer.

Runs the actual FastAPI app (lifespan included) against the real Ollama model and real
Piper voices, so nothing is faked. Skipped automatically when Ollama is not reachable or the
default voice is not downloaded.

    .venv/bin/python -m pytest tests/test_e2e.py -v -s     # -s prints the latency report
"""

import io
import json
import re
import time
import wave
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.tts.piper_engine import REGIONAL
from app.llm.ollama_adapter import OllamaAdapter
from app.llm.prompt import FALLBACK_REPLY
from app.main import create_app
from tests.test_api import parse_sse

settings = get_settings()


def _ollama_ready() -> bool:
    try:
        tags = httpx.get(f"{settings.ollama_url}/api/tags", timeout=2).json()
        return any(m["name"] in (settings.llm_model, f"{settings.llm_model}:latest") for m in tags["models"])
    except (httpx.HTTPError, ValueError, KeyError):
        return False


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not _ollama_ready(), reason=f"Ollama with {settings.llm_model} not available"),
    pytest.mark.skipif(
        not (settings.voices_dir / f"{REGIONAL[settings.default_voice].model}.onnx").exists(),
        reason="run scripts/download_voices.sh first",
    ),
]

MARKDOWN_OR_EMOJI = re.compile(r"[*#`~]|[\U0001f300-\U0001faff]")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")
REPORT: list[tuple[str, float]] = []


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:  # context manager → real lifespan: real Ollama + Piper
        yield c
    print("\n\n  ── E2E latency report " + "─" * 40)
    for name, ms in REPORT:
        print(f"  {name:<52} {ms:>8.0f} ms")


def timed(name: str, fn):
    t0 = time.perf_counter()
    result = fn()
    REPORT.append((name, (time.perf_counter() - t0) * 1000))
    return result


def chat_stream(client, messages) -> tuple[list[str], dict]:
    r = client.post("/api/chat/stream", json={"messages": messages})
    assert r.status_code == 200, r.text
    events = parse_sse(r.text)
    assert events[-1][0] == "done", f"expected done, got {events[-1]}"
    tokens = [d["t"] for e, d in events if e == "token"]
    return tokens, events[-1][1]


def wav_info(audio: bytes) -> tuple[int, float]:
    with wave.open(io.BytesIO(audio)) as w:
        assert (w.getnchannels(), w.getsampwidth()) == (1, 2)
        return w.getframerate(), w.getnframes() / w.getframerate()


def assert_speakable_reply(text: str) -> None:
    assert text, "empty reply"
    assert not MARKDOWN_OR_EMOJI.search(text), f"markdown/emoji leaked: {text!r}"
    assert text[-1] in ".!?…\"'", f"reply does not end cleanly: {text!r}"
    assert len(SENTENCE_SPLIT.split(text)) <= 5, f"reply too long for speech: {text!r}"


# --- 1. Health ------------------------------------------------------------------

def test_health_reports_both_components_ok(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok", body
    assert body["llm"]["model"] == settings.llm_model
    assert body["tts"]["voices"] >= 1


# --- 2. LLM layer ---------------------------------------------------------------

def test_brief_example_how_are_you(client):
    tokens, done = timed("chat stream: 'How are you?'", lambda: chat_stream(
        client, [{"role": "user", "content": "How are you?"}]))
    print(f"\n  How are you? → {done['text']}")
    assert len(tokens) > 3, "reply was not streamed token by token"
    assert "".join(tokens).strip().startswith(done["text"][:10])
    assert_speakable_reply(done["text"])
    assert "last time" not in done["text"].lower()  # regression: few-shot repeat bug


REPEAT_WORDS = re.compile(r"\b(again|last time|as before|once more)\b", re.I)


@pytest.mark.parametrize("greeting", ["Hello there!", "Hi!", "Good morning!"])
def test_first_greeting_is_not_treated_as_a_repeat(client, greeting):
    """Regression: with the style example given as earlier conversation turns, the model
    answered a first greeting with 'Hello again!'. Sampled 3 times because replies vary."""
    for _ in range(3):
        _, done = chat_stream(client, [{"role": "user", "content": greeting}])
        assert not REPEAT_WORDS.search(done["text"]), f"{greeting!r} → {done['text']!r}"


def test_no_invented_life_or_robotic_small_talk(client):
    """Sampled replies vary, so this checks rates over 6 replies, not one: never an invented life,
    and robotic phrasing at most twice. The base model's measured robotic rate is ~8%, so allowing
    one would fail ~8% of runs by chance; two keeps false alarms near 1% (training/README.md)."""
    robotic = 0
    for prompt in ("How are you?", "What did you do this morning?"):
        for _ in range(3):
            _, done = chat_stream(client, [{"role": "user", "content": prompt}])
            print(f"\n  {prompt} → {done['text']}")
            text = done["text"].lower()
            robotic += bool(re.search(r"computer program|don't have feelings|collection of code", text))
            assert not re.search(r"\b(just got back|went for a walk|i live in)\b", text), done["text"]
    assert robotic <= 2, f"{robotic} of 6 replies sounded robotic"


@pytest.mark.parametrize("prompt", [
    "Hello there!",
    "Can you recommend something nice to do on a rainy Sunday?",
    "Give me a list of three British desserts.",  # tempts markdown lists
    "I'm feeling a bit down today.",
])
def test_replies_are_short_plain_and_speakable(client, prompt):
    _, done = chat_stream(client, [{"role": "user", "content": prompt}])
    print(f"\n  {prompt} → {done['text']}")
    assert_speakable_reply(done["text"])


def test_multi_turn_memory(client):
    history = [
        {"role": "user", "content": "Hi, my name is Priya and I study linguistics at Lancaster."},
        {"role": "assistant", "content": "Lovely to meet you, Priya! What got you into linguistics?"},
        {"role": "user", "content": "What is my name and what do I study?"},
    ]
    _, done = chat_stream(client, history)
    print(f"\n  memory → {done['text']}")
    assert "priya" in done["text"].lower()
    assert "linguistic" in done["text"].lower()


def test_long_conversation_is_trimmed_within_context(client):
    filler = "Tell me something about British tea culture and afternoon traditions please."
    history = []
    for i in range(70):
        history += [{"role": "user", "content": f"Turn {i}. {filler}"},
                    {"role": "assistant", "content": f"In turn {i}, scones with clotted cream. Milk in yours?"}]
    history.append({"role": "user", "content": "Thanks, that's all for now."})
    _, done = timed("chat stream: 70-turn history (trim, cache miss)", lambda: chat_stream(client, history))
    assert done["turns_dropped"] > 0 and done["turns_dropped"] % settings.trim_chunk_turns == 0
    assert done["prompt_tokens"] < settings.num_ctx - settings.num_predict, done
    assert_speakable_reply(done["text"])

    # Next turn (same chunk): prompt start unchanged, so Ollama should reuse its KV cache.
    history += [{"role": "assistant", "content": done["text"]}, {"role": "user", "content": "One more thing: cheers!"}]
    _, done2 = timed("chat stream: 71-turn history (cache hit)", lambda: chat_stream(client, history))
    assert done2["turns_dropped"] == done["turns_dropped"]


def test_rolling_memory_keeps_facts_from_dropped_turns(client):
    """Turn 0 is pushed out of the context window; the memory note brings its facts back."""
    history = [{"role": "user", "content": "Hi, I'm Priyanka and my spaniel is called Biscuit."},
               {"role": "assistant", "content": "Lovely to meet you, Priyanka, and Biscuit too!"}]
    filler = "Tell me something about British tea culture and afternoon traditions please."
    for i in range(70):
        history += [{"role": "user", "content": f"Turn {i}. {filler}"},
                    {"role": "assistant", "content": f"In turn {i}, scones with clotted cream. Milk in yours?"}]
    history.append({"role": "user", "content": "Remind me: what's my name, and what's my dog called?"})

    _, done = chat_stream(client, history)
    dropped = done["turns_dropped"]
    assert dropped > 1  # turn 0 is no longer in the window...
    assert "biscuit" not in done["text"].lower()  # ...so without a note the model cannot know

    r = timed("memory: fold dropped turns into the note",
              lambda: client.post("/api/memory", json={"messages": history, "upto": dropped}))
    assert r.status_code == 200, r.text
    memory = r.json()
    assert memory["turns"] == dropped and "priyanka" in memory["note"].lower(), memory

    r = client.post("/api/chat/stream", json={"messages": history, "memory": memory})
    text = parse_sse(r.text)[-1][1]["text"].lower()
    assert "priyanka" in text and "biscuit" in text, text


# --- 3. TTS layer ---------------------------------------------------------------

def test_every_installed_voice_speaks(client):
    voices = client.get("/api/voices").json()
    assert any(v["is_default"] for v in voices)
    for v in voices:
        r = timed(f"tts: {v['id']}", lambda: client.post(
            "/api/tts", json={"text": "Good afternoon, lovely to meet you.", "voice": v["id"]}))
        assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
        rate, seconds = wav_info(r.content)
        assert rate in (16000, 22050, 24000) and 1.0 < seconds < 5.0, (v["id"], rate, seconds)  # Kokoro: 24 kHz


def test_tts_normalisation_changes_audio(client):
    """'£5.50' would be read 'pound five point five zero' without normalisation, which is
    longer, so the normalised audio must be shorter than the raw espeak reading."""
    raw = client.post("/api/tts", json={"text": "pound five point five zero"}).content
    norm = client.post("/api/tts", json={"text": "£5.50"}).content
    assert wav_info(norm)[1] < wav_info(raw)[1]


# --- 4. Full pipeline: LLM → sentences → TTS (what the browser will do) ---------

def test_full_pipeline_reply_is_spoken_sentence_by_sentence(client):
    t0 = time.perf_counter()
    r = client.post("/api/chat/stream", json={"messages": [
        {"role": "user", "content": "What's a good way to spend a sunny afternoon in the Lake District?"}]})
    events = parse_sse(r.text)
    text = events[-1][1]["text"]
    llm_ms = (time.perf_counter() - t0) * 1000

    sentences = [s for s in SENTENCE_SPLIT.split(text) if s.strip()]
    total_audio = 0.0
    first_audio_ms = None
    for i, sentence in enumerate(sentences):
        resp = client.post("/api/tts", json={"text": sentence})
        assert resp.status_code == 200, (sentence, resp.text)
        if i == 0:
            first_audio_ms = (time.perf_counter() - t0) * 1000
        _, seconds = wav_info(resp.content)
        words = len(sentence.split())
        assert 0.8 < words / seconds < 5.0, f"implausible speech rate for {sentence!r}"
        total_audio += seconds

    REPORT.append(("pipeline: LLM reply complete", llm_ms))
    REPORT.append(("pipeline: first sentence audio ready", first_audio_ms))
    print(f"\n  pipeline → {len(sentences)} sentence(s), {total_audio:.1f}s of speech: {text}")
    assert sentences and total_audio > 1.0


# --- 5. Robustness --------------------------------------------------------------

def test_concurrent_chat_and_tts(client):
    def chat(i):
        return chat_stream(client, [{"role": "user", "content": f"Say hello to person number {i}."}])[1]["text"]

    def tts(i):
        return client.post("/api/tts", json={"text": f"This is sentence number {i}."}).status_code

    def run_all():
        with ThreadPoolExecutor(max_workers=6) as pool:
            chats = [pool.submit(chat, i) for i in range(3)]
            speech = [pool.submit(tts, i) for i in range(3)]
            return [f.result() for f in chats], [f.result() for f in speech]

    chats, speech = timed("concurrency: 3 chats + 3 TTS in parallel", run_all)
    assert all(chats) and speech == [200, 200, 200]


def test_llm_down_gives_fallback_and_degraded_health():
    app = create_app()
    with TestClient(app) as c:
        dead = Settings(_env_file=None, ollama_url="http://127.0.0.1:9")  # nothing listens here
        app.state.llm = OllamaAdapter(dead)
        r = c.post("/api/chat/stream", json={"messages": [{"role": "user", "content": "Hello?"}]})
        assert parse_sse(r.text) == [("error", {"code": "llm_unavailable", "message": FALLBACK_REPLY})]
        assert c.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello?"}]}).status_code == 503
        health = c.get("/api/health").json()
        assert health["status"] == "degraded" and health["tts"]["ok"]  # TTS still works
        assert c.post("/api/tts", json={"text": "Still talking."}).status_code == 200


def test_sse_event_format_is_browser_compatible(client):
    r = client.post("/api/chat/stream", json={"messages": [{"role": "user", "content": "Hi!"}]})
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-accel-buffering"] == "no"
    for block in r.text.strip().split("\n\n"):
        event_line, data_line = block.split("\n")
        assert event_line.startswith("event: ") and data_line.startswith("data: ")
        json.loads(data_line[len("data: "):])
