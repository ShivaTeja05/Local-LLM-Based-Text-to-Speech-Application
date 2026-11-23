"""TTSEngine using Kokoro-82M (kokoro-onnx): more natural than Piper, about 2-3x slower on CPU.

Only Kokoro's British English voices are offered. Voice ids are prefixed ``kokoro-`` so they
can sit next to Piper's in one voice picker (see multi_engine.py).
"""

import io
import logging
import threading
import wave
from collections import OrderedDict
from pathlib import Path

import numpy as np

from app.config import Settings, cpu_threads
from app.tts.base import EmptySpeechError, TTSError, VoiceInfo, VoiceNotFoundError
from app.tts.normalise import normalise_for_speech

log = logging.getLogger(__name__)

PREFIX = "kokoro-"
LABELS = {
    "bf_emma": "Emma (Kokoro, female, English)",
    "bf_isabella": "Isabella (Kokoro, female, English)",
    "bf_alice": "Alice (Kokoro, female, English)",
    "bf_lily": "Lily (Kokoro, female, English)",
    "bm_george": "George (Kokoro, male, English)",
    "bm_lewis": "Lewis (Kokoro, male, English)",
    "bm_daniel": "Daniel (Kokoro, male, English)",
    "bm_fable": "Fable (Kokoro, male, English)",
}


class KokoroEngine:
    name = "kokoro"

    def __init__(self, settings: Settings):
        self.model_path = Path(settings.kokoro_model)
        self.voices_path = Path(settings.kokoro_voices)
        self.default_voice = PREFIX + settings.kokoro_default_voice
        self._speed = settings.kokoro_speed
        self._max_chars = settings.tts_max_chars
        self._cache_size = settings.tts_cache_size
        self._threads = cpu_threads(settings.tts_threads, 1 / 3)
        self._cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()
        self._lock = threading.Lock()
        self._kokoro = None

    def available(self) -> bool:
        return self.model_path.is_file() and self.voices_path.is_file()

    def _load(self):
        with self._lock:
            if self._kokoro is None:
                import onnxruntime
                from kokoro_onnx import Kokoro

                log.info("Loading Kokoro %s (%d threads)", self.model_path.name, self._threads)
                options = onnxruntime.SessionOptions()  # same CPU sharing as Piper (ARCHITECTURE §10.2)
                options.intra_op_num_threads = self._threads
                options.inter_op_num_threads = 1
                options.add_session_config_entry("session.intra_op.allow_spinning", "0")
                options.add_session_config_entry("session.inter_op.allow_spinning", "0")
                session = onnxruntime.InferenceSession(
                    str(self.model_path), sess_options=options, providers=["CPUExecutionProvider"])
                self._kokoro = Kokoro.from_session(session, str(self.voices_path))
            return self._kokoro

    def preload(self) -> None:
        if self.available():
            self._load()

    def list_voices(self) -> list[VoiceInfo]:
        if not self.available():
            return []
        return [VoiceInfo(id=PREFIX + v, label=label, is_default=PREFIX + v == self.default_voice)
                for v, label in LABELS.items()]

    def synthesize(self, text: str, voice_id: str | None = None) -> bytes:
        voice_id = voice_id or self.default_voice
        if not voice_id.startswith(PREFIX) or voice_id.removeprefix(PREFIX) not in LABELS or not self.available():
            raise VoiceNotFoundError(f"Voice '{voice_id}' is not installed")
        speech = normalise_for_speech(text)[: self._max_chars]
        if not speech:
            raise EmptySpeechError("Nothing to speak after normalisation")

        key = (voice_id, speech)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        try:
            samples, rate = self._load().create(speech, voice=voice_id.removeprefix(PREFIX),
                                                speed=self._speed, lang="en-gb")
        except Exception as exc:  # onnxruntime / phonemizer errors
            raise TTSError(f"Synthesis failed: {exc}") from exc
        audio = to_wav(samples, rate)
        with self._lock:
            self._cache[key] = audio
            if len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return audio

    def health(self) -> dict:
        ok = self.available()
        result = {"ok": ok, "engine": self.name, "voices": len(LABELS) if ok else 0}
        if not ok:
            result["error"] = "Kokoro model not downloaded. Run scripts/download_voices.sh --kokoro"
        return result


def to_wav(samples: np.ndarray, rate: int) -> bytes:
    """Float samples in -1..1 → 16-bit mono PCM WAV (the same format as Piper's)."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm.tobytes())
    return buf.getvalue()
