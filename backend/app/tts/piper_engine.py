"""TTSEngine implementation using Piper (local ONNX voices)."""

import io
import logging
import threading
import wave
from collections import OrderedDict
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

from app.config import Settings
from app.tts.base import EmptySpeechError, TTSError, VoiceInfo, VoiceNotFoundError
from app.tts.normalise import normalise_for_speech

log = logging.getLogger(__name__)

VOICE_LABELS = {
    "en_GB-cori-high": "Cori (female, southern English)",
    "en_GB-jenny_dioco-medium": "Jenny (female, English)",
    "en_GB-alan-medium": "Alan (male, English)",
    "en_GB-northern_english_male-medium": "Northern English (male)",
    "en_GB-alba-medium": "Alba (female, Scottish)",
    "en_GB-southern_english_female-low": "Southern English (female)",
}


class PiperEngine:
    name = "piper"

    def __init__(self, settings: Settings):
        self.voices_dir = Path(settings.voices_dir)
        self.default_voice = settings.default_voice
        self._syn_config = SynthesisConfig(length_scale=settings.tts_length_scale)
        self._max_chars = settings.tts_max_chars
        self._cache_size = settings.tts_cache_size
        self._voices: dict[str, PiperVoice] = {}
        self._cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()
        self._lock = threading.Lock()

    # --- voices -----------------------------------------------------------
    def _installed(self) -> list[str]:
        if not self.voices_dir.is_dir():
            return []
        return sorted(
            p.stem for p in self.voices_dir.glob("*.onnx") if p.with_suffix(".onnx.json").exists()
        )

    def list_voices(self) -> list[VoiceInfo]:
        return [
            VoiceInfo(id=v, label=VOICE_LABELS.get(v, v), is_default=v == self.default_voice)
            for v in self._installed()
        ]

    def _get_voice(self, voice_id: str) -> PiperVoice:
        # Only ids that exist on disk are accepted, which also rules out path traversal.
        if voice_id not in self._installed():
            raise VoiceNotFoundError(f"Voice '{voice_id}' is not installed")
        with self._lock:
            if voice_id not in self._voices:
                log.info("Loading Piper voice %s", voice_id)
                self._voices[voice_id] = PiperVoice.load(self.voices_dir / f"{voice_id}.onnx")
            return self._voices[voice_id]

    def preload(self) -> None:
        try:
            self._get_voice(self.default_voice)
        except VoiceNotFoundError:
            log.warning(
                "Default voice %s not found in %s. Run scripts/download_voices.sh",
                self.default_voice,
                self.voices_dir,
            )

    # --- synthesis --------------------------------------------------------
    def synthesize(self, text: str, voice_id: str | None = None) -> bytes:
        voice_id = voice_id or self.default_voice
        speech = normalise_for_speech(text)[: self._max_chars]
        if not speech:
            raise EmptySpeechError("Nothing to speak after normalisation")

        key = (voice_id, speech)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]

        voice = self._get_voice(voice_id)
        buf = io.BytesIO()
        try:
            with wave.open(buf, "wb") as wav:
                voice.synthesize_wav(speech, wav, syn_config=self._syn_config)
        except Exception as exc:  # onnxruntime / espeak errors
            raise TTSError(f"Synthesis failed: {exc}") from exc
        audio = buf.getvalue()

        with self._lock:
            self._cache[key] = audio
            if len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return audio

    def health(self) -> dict:
        voices = self._installed()
        result = {"ok": self.default_voice in voices, "engine": self.name, "voices": len(voices)}
        if not result["ok"]:
            result["error"] = f"Default voice {self.default_voice} not installed"
        return result
