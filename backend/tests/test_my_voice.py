"""Use my voice: fingerprint handling, the upload route and speech in the user's voice.

The converter itself (torch + a 131 MB model) is replaced by a fake here; the real one is exercised
by the integration test at the bottom, which skips itself when the model is not downloaded.
"""

import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.main as main_mod
from app.config import Settings
from app.voiceclone.cloner import (
    CloneError, VoiceCloner, decode_fingerprint, encode_fingerprint, speech_only,
)
from tests.test_api import FakeLLM, FakeTTS


def tone(seconds: float, rate: int = 22050, silence: float = 0.0) -> np.ndarray:
    t = np.arange(int(rate * seconds)) / rate
    speech = 0.3 * np.sin(2 * np.pi * 220 * t).astype(np.float32)
    gap = np.zeros(int(rate * silence), dtype=np.float32)
    return np.concatenate([gap, speech, gap])


def wav(audio: np.ndarray, rate: int = 22050) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((audio * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def test_fingerprint_round_trips_and_rejects_anything_else():
    v = np.linspace(-1, 1, 256, dtype=np.float32)
    assert np.array_equal(decode_fingerprint(encode_fingerprint(v)), v)
    for bad in ["AAAA", encode_fingerprint(np.zeros(256)), encode_fingerprint(np.full(256, np.nan)), "!!notbase64!!"]:
        with pytest.raises(CloneError):
            decode_fingerprint(bad)


def test_speech_only_drops_silence():
    audio = tone(2.0, silence=1.5)
    kept = speech_only(audio)
    assert abs(len(kept) / 22050 - 2.0) < 0.05


class FakeCloner:
    name = "fake"

    def __init__(self):
        self.converted = []

    def health(self):
        return {"ok": True, "engine": "fake"}

    def enrol(self, recording: bytes) -> dict:
        if len(recording) < 1000:
            raise CloneError("I need at least 6 seconds of clear speech")
        return {"fingerprint": encode_fingerprint(np.ones(256, dtype=np.float32)), "base": "uk-north", "seconds": 9.5}

    def convert(self, audio: bytes, base: str, target) -> bytes:
        self.converted.append((base, float(target[0])))
        return b"RIFF-converted"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main_mod, "get_settings", lambda: Settings(_env_file=None, rate_limits=False))
    app = main_mod.create_app()
    app.state.llm, app.state.tts, app.state.cloner = FakeLLM(), FakeTTS(), FakeCloner()
    return TestClient(app)


def test_enrol_returns_a_fingerprint_and_a_base_voice(client):
    r = client.post("/api/my-voice", content=b"x" * 5000, headers={"content-type": "audio/webm"})
    assert r.status_code == 200
    body = r.json()
    assert body["base"] == "uk-north" and len(body["fingerprint"]) == 1368


def test_enrol_explains_what_is_wrong(client):
    assert client.post("/api/my-voice", content=b"x" * 10, headers={"content-type": "audio/webm"}).status_code == 422
    assert client.post("/api/my-voice", content=b"hello", headers={"content-type": "text/plain"}).status_code == 415
    assert client.post("/api/my-voice", content=b"", headers={"content-type": "audio/webm"}).status_code == 422


def test_speech_in_my_voice_goes_through_the_converter(client):
    fp = encode_fingerprint(np.full(256, 0.5, dtype=np.float32))
    r = client.post("/api/tts", json={"text": "Hello there.", "fingerprint": fp})
    assert r.status_code == 200 and r.content == b"RIFF-converted"
    base = client.app.state.tts.default_voice  # no voice given: the default one is re-voiced
    assert client.app.state.cloner.converted == [(base, 0.5)]
    # Without a fingerprint, ordinary speech (no conversion).
    assert client.post("/api/tts", json={"text": "Hello there."}).content != b"RIFF-converted"


def test_a_broken_fingerprint_is_refused(client):
    r = client.post("/api/tts", json={"text": "Hi", "fingerprint": "AAAA"})
    assert r.status_code == 422


def test_an_upload_up_to_15_mb_is_accepted_and_bigger_ones_are_refused(client):
    ok = client.post("/api/my-voice", content=b"x" * 9_000_000, headers={"content-type": "audio/mpeg"})
    assert ok.status_code == 200
    big = client.post("/api/my-voice", content=b"x" * 15_000_001, headers={"content-type": "audio/wav"})
    assert big.status_code == 413


def test_switched_off_server_says_so(client):
    client.app.state.cloner = None
    assert client.post("/api/my-voice", content=b"x" * 5000, headers={"content-type": "audio/webm"}).status_code == 503
    fp = encode_fingerprint(np.ones(256, dtype=np.float32))
    assert client.post("/api/tts", json={"text": "Hi", "fingerprint": fp}).status_code == 503
    assert client.get("/api/health").json()["clone"]["ok"] is False


@pytest.mark.integration
def test_real_converter_re_voices_piper(tmp_path):
    settings = Settings(_env_file=None)
    from app.main import create_tts

    tts = create_tts(settings)
    cloner = VoiceCloner(settings, tts)
    if not cloner.available():
        pytest.skip("OpenVoice converter not downloaded (scripts/download_voices.sh --clone)")
    # Enrol with another regional voice as "the user": it should pick that voice as the base.
    sample = tts.synthesize("Hello, I live in Birmingham and I love a good walk along the canals on a "
                            "Sunday morning, followed by a big breakfast and a pot of tea. In the afternoon "
                            "I usually visit my sister, and we talk about the football and the weather.", "uk-midlands")
    result = cloner.enrol(sample)
    assert result["base"] == "uk-midlands"
    out = cloner.convert(tts.synthesize("How are you today?", result["base"]), result["base"],
                         decode_fingerprint(result["fingerprint"]))
    with wave.open(io.BytesIO(out)) as w:
        assert w.getframerate() == 22050 and w.getnframes() > 22050 * 0.5
