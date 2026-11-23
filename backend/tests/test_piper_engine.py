"""Integration test against a real Piper voice (skipped if it has not been downloaded)."""

import io
import wave

import pytest

from app.config import Settings

from app.tts.piper_engine import REGIONAL

settings = Settings(_env_file=None)
voice_path = settings.voices_dir / f"{REGIONAL[settings.default_voice].model}.onnx"
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


def test_session_leaves_cpu_for_the_llm(engine):
    """Piper's own session would take every core and spin-wait, starving a CPU-only LLM."""
    from app.config import cpu_threads

    session = engine._resolve(settings.default_voice)[0].session
    options = session.get_session_options()
    assert options.intra_op_num_threads == cpu_threads(settings.tts_threads, 1 / 3)
    assert options.get_session_config_entry("session.intra_op.allow_spinning") == "0"


def test_five_regional_accents_each_speak_with_their_own_speaker(engine):
    """North, South, East, West and the Midlands: one shared VCTK model, a different speaker each."""
    ids = [v.id for v in engine.list_voices()]
    for region in ("uk-north", "uk-south", "uk-east", "uk-west", "uk-midlands"):
        assert region in ids
    clips = {r: engine.synthesize("Lovely to meet you, how are you today?", r) for r in ("uk-north", "uk-midlands")}
    assert clips["uk-north"] != clips["uk-midlands"]  # different speakers, different audio


def test_curated_list_offers_exactly_five_and_refuses_others():
    from app.main import create_tts
    from app.tts.base import VoiceNotFoundError

    tts = create_tts(settings)
    assert [v.id for v in tts.list_voices()] == settings.voices and len(settings.voices) == 5
    assert [v.id for v in tts.list_voices() if v.is_default] == ["uk-south"]
    with pytest.raises(VoiceNotFoundError):
        tts.synthesize("Hello", "en_GB-vctk-medium")  # the multi-speaker file itself is not a voice
