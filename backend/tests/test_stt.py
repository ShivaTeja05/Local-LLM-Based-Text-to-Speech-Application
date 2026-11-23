"""Voice input: /api/stt with a fake engine, plus a real round trip (Piper speaks, Whisper listens)."""

import pytest

from app.config import Settings
from app.stt.base import AudioTooLongError, STTError, Transcript
from tests.test_api import make_client  # noqa: F401  (fixture)

settings = Settings(_env_file=None)
from app.tts.piper_engine import REGIONAL  # noqa: E402

voice_path = settings.voices_dir / f"{REGIONAL[settings.default_voice].model}.onnx"


class FakeSTT:
    name, model = "fake", "fake-whisper"

    def __init__(self, result=Transcript("Hello there.", 1.2), fail=None):
        self.result, self.fail, self.calls = result, fail, []

    def preload(self): ...

    def transcribe(self, audio: bytes) -> Transcript:
        self.calls.append(audio)
        if self.fail:
            raise self.fail
        return self.result

    def health(self):
        return {"ok": True, "engine": self.name, "model": self.model, "loaded": True}


def client_with(make_client, stt):
    client = make_client()
    client.app.state.stt = stt
    return client


def test_stt_returns_the_transcript(make_client):
    stt = FakeSTT()
    r = client_with(make_client, stt).post("/api/stt", content=b"RIFF....", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 200
    assert r.json() == {"text": "Hello there.", "seconds": 1.2}
    assert stt.calls == [b"RIFF...."]


@pytest.mark.parametrize("body,ctype,status", [
    (b"", "audio/webm", 422),           # empty
    (b"x", "application/json", 415),    # not audio
    (b"x" * 5_000_001, "audio/webm", 413),  # too big
])
def test_stt_rejects_bad_uploads(make_client, body, ctype, status):
    r = client_with(make_client, FakeSTT()).post("/api/stt", content=body, headers={"Content-Type": ctype})
    assert r.status_code == status


def test_stt_too_long_and_unreadable(make_client):
    long = client_with(make_client, FakeSTT(fail=AudioTooLongError("too long")))
    assert long.post("/api/stt", content=b"x", headers={"Content-Type": "audio/webm"}).status_code == 413
    bad = client_with(make_client, FakeSTT(fail=STTError("garbage")))
    r = bad.post("/api/stt", content=b"x", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 422 and "couldn't make out" in r.json()["detail"]


def test_stt_switched_off(make_client):
    r = client_with(make_client, None).post("/api/stt", content=b"x", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 503
    health = client_with(make_client, None).get("/api/health").json()
    assert health["stt"]["ok"] is False and health["status"] == "ok"  # optional: never "degraded"


def test_health_reports_stt(make_client):
    assert client_with(make_client, FakeSTT()).get("/api/health").json()["stt"]["ok"] is True


@pytest.mark.integration
@pytest.mark.skipif(not voice_path.exists(), reason="run scripts/download_voices.sh first")
def test_real_round_trip_piper_to_whisper():
    pytest.importorskip("faster_whisper")
    from app.stt.whisper_engine import WhisperEngine
    from app.tts.piper_engine import PiperEngine

    wav = PiperEngine(settings).synthesize("Hello Ellie, what's the capital of Australia?")
    try:
        result = WhisperEngine(settings).transcribe(wav)
    except STTError as exc:  # no model cached and no network
        pytest.skip(str(exc))
    assert "capital of australia" in result.text.lower(), result
    assert 1.5 < result.seconds < 6
    with pytest.raises(STTError):
        WhisperEngine(settings).transcribe(b"definitely not audio")
