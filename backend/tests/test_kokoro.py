"""Kokoro engine (real model, skipped if not downloaded) and routing voices between engines."""

import io
import wave

import pytest

from app.config import Settings
from app.main import create_tts
from app.tts.base import EmptySpeechError, VoiceInfo, VoiceNotFoundError
from app.tts.multi_engine import MultiEngine

settings = Settings(_env_file=None)
have_kokoro = settings.kokoro_model.is_file() and settings.kokoro_voices.is_file()
from app.tts.piper_engine import REGIONAL  # noqa: E402

have_piper = (settings.voices_dir / f"{REGIONAL[settings.default_voice].model}.onnx").is_file()


class Fake:
    def __init__(self, name, voices, default):
        self.name, self._voices, self.default_voice, self.calls = name, voices, default, []

    def list_voices(self):
        return [VoiceInfo(v, v.title(), v == self.default_voice) for v in self._voices]

    def synthesize(self, text, voice_id=None):
        self.calls.append((text, voice_id))
        return f"{self.name}:{voice_id}".encode()

    def health(self):
        return {"ok": True, "engine": self.name, "voices": len(self._voices)}


def test_multi_engine_routes_each_voice_to_its_engine():
    piper, kokoro = Fake("piper", ["cori", "alan"], "cori"), Fake("kokoro", ["kokoro-bf_emma"], "kokoro-bf_emma")
    multi = MultiEngine([piper, kokoro])
    assert multi.name == "piper+kokoro" and multi.default_voice == "cori"
    assert multi.synthesize("Hi", "kokoro-bf_emma") == b"kokoro:kokoro-bf_emma"
    assert multi.synthesize("Hi") == b"piper:cori"
    assert [v.id for v in multi.list_voices() if v.is_default] == ["cori"]  # one default overall
    assert multi.health()["voices"] == 3
    with pytest.raises(VoiceNotFoundError):
        multi.synthesize("Hi", "nobody")


def test_engine_setting_with_missing_kokoro_falls_back_to_piper(tmp_path):
    tts = create_tts(Settings(_env_file=None, tts_engine="piper+kokoro", kokoro_model=tmp_path / "missing.onnx"))
    assert tts.name == "piper"


@pytest.mark.integration
@pytest.mark.skipif(not have_kokoro, reason="run scripts/download_voices.sh first")
def test_kokoro_speaks_british_english():
    from app.tts.kokoro_engine import KokoroEngine

    engine = KokoroEngine(settings)
    voices = [v.id for v in engine.list_voices()]
    assert "kokoro-bf_emma" in voices and "kokoro-bm_george" in voices and len(voices) == 8
    audio = engine.synthesize("I'm very well, thank you. How are you?", "kokoro-bm_george")
    with wave.open(io.BytesIO(audio)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 24000)
        assert 1.5 < wav.getnframes() / wav.getframerate() < 6
    assert engine.synthesize("Cheers!") is engine.synthesize("Cheers!")  # cached
    with pytest.raises(VoiceNotFoundError):
        engine.synthesize("Hi", "en_GB-cori-high")  # a Piper voice
    with pytest.raises(EmptySpeechError):
        engine.synthesize("🙂")


@pytest.mark.integration
@pytest.mark.skipif(not (have_kokoro and have_piper), reason="needs Piper and Kokoro voices")
def test_both_engines_side_by_side_when_switched_on():
    tts = create_tts(Settings(_env_file=None, tts_engine="piper+kokoro", voices=[]))
    ids = [v.id for v in tts.list_voices()]
    assert tts.name == "piper+kokoro" and settings.default_voice in ids and "kokoro-bf_emma" in ids
    assert tts.health()["ok"] and tts.health()["engines"]["kokoro"]["ok"]
