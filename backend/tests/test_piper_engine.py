"""Integration test against a real Piper voice (skipped if it has not been downloaded)."""

import io
import wave

import pytest

from app.config import Settings

settings = Settings(_env_file=None)
voice_path = settings.voices_dir / f"{settings.default_voice}.onnx"
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not voice_path.exists(), reason="run scripts/download_voices.sh first"),
]


@pytest.fixture(scope="module")
def engine():
    from app.tts.piper_engine import PiperEngine

    return PiperEngine(settings)


def test_synthesize_valid_wav(engine):
    audio = engine.synthesize("I'm very well, thank you. How are you?")
    with wave.open(io.BytesIO(audio)) as wav:
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getframerate() == 22050
        assert 1.5 < wav.getnframes() / wav.getframerate() < 6  # seconds


def test_cache_returns_same_bytes(engine):
    assert engine.synthesize("Cheers!") is engine.synthesize("Cheers!")


def test_default_voice_listed(engine):
    assert any(v.id == settings.default_voice and v.is_default for v in engine.list_voices())
    assert engine.health()["ok"]
