"""TTSEngine implementation using Piper (local ONNX voices)."""

import io
import logging
import threading
import wave
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import onnxruntime
from piper import PiperVoice, SynthesisConfig

from app.config import Settings, cpu_threads
from app.tts.base import EmptySpeechError, TTSError, VoiceInfo, VoiceNotFoundError
from app.tts.normalise import normalise_for_speech

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SpeakerVoice:
    """One speaker inside a multi-speaker Piper model, with its own pace."""

    model: str            # Piper model file name (without .onnx)
    speaker: str          # key in the model's speaker_id_map
    label: str            # "Name (details)": the picker shows the name, then the details
    length_scale: float   # >1 = slower


# Five regional English accents from the VCTK corpus (CSTR, University of Edinburgh, CC BY 4.0).
# Each speaker's home region is documented in the corpus's speaker-info.txt. Within each region the
# voice was chosen by measured clarity (Whisper wrote every test sentence back word for word) and
# paced to about 225 words a minute (two speakers talk quickly, so they are slowed a little).
REGIONAL = {
    "uk-south": SpeakerVoice("en_GB-vctk-medium", "p228", "Southern England (South · female)", 1.05),
    "uk-north": SpeakerVoice("en_GB-vctk-medium", "p269", "Newcastle (North · female)", 1.12),
    "uk-midlands": SpeakerVoice("en_GB-vctk-medium", "p256", "Birmingham (Midlands · male)", 1.05),
    "uk-east": SpeakerVoice("en_GB-vctk-medium", "p273", "Suffolk (East · male)", 1.22),
    "uk-west": SpeakerVoice("en_GB-vctk-medium", "p239", "South-West England (West · female)", 1.24),
}

# Single-speaker Piper voices that may also be installed (offered only if not curated away).
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
        self._length_scale = settings.tts_length_scale
        self._max_chars = settings.tts_max_chars
        self._cache_size = settings.tts_cache_size
        self._models: dict[str, PiperVoice] = {}
        self._cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()
        self._lock = threading.Lock()
        self._threads = cpu_threads(settings.tts_threads, 1 / 3)

    # --- voices -----------------------------------------------------------
    def _installed_models(self) -> set[str]:
        if not self.voices_dir.is_dir():
            return set()
        return {p.stem for p in self.voices_dir.glob("*.onnx") if p.with_suffix(".onnx.json").exists()}

    def _available(self) -> list[str]:
        """Voice ids that can be used: regional speakers whose model is installed, then plain models."""
        models = self._installed_models()
        regional = [vid for vid, v in REGIONAL.items() if v.model in models]
        speakers_only = {v.model for v in REGIONAL.values()}  # multi-speaker files are not voices themselves
        return regional + sorted(models - speakers_only)

    def list_voices(self) -> list[VoiceInfo]:
        return [
            VoiceInfo(id=v, label=REGIONAL[v].label if v in REGIONAL else VOICE_LABELS.get(v, v),
                      is_default=v == self.default_voice)
            for v in self._available()
        ]

    def _model(self, name: str) -> PiperVoice:
        # Only models that exist on disk are accepted, which also rules out path traversal.
        if name not in self._installed_models():
            raise VoiceNotFoundError(f"Voice model '{name}' is not installed")
        with self._lock:
            if name not in self._models:
                log.info("Loading Piper voice %s", name)
                self._models[name] = self._load(self.voices_dir / f"{name}.onnx")
            return self._models[name]

    def _resolve(self, voice_id: str) -> tuple[PiperVoice, SynthesisConfig]:
        if voice_id in REGIONAL:
            v = REGIONAL[voice_id]
            model = self._model(v.model)
            speaker = model.config.speaker_id_map.get(v.speaker)
            if speaker is None:
                raise VoiceNotFoundError(f"Speaker {v.speaker} is not in {v.model}")
            return model, SynthesisConfig(speaker_id=speaker, length_scale=v.length_scale)
        if voice_id not in self._available():  # also refuses a multi-speaker file used directly
            raise VoiceNotFoundError(f"Voice '{voice_id}' is not installed")
        return self._model(voice_id), SynthesisConfig(length_scale=self._length_scale)

    def _load(self, path: Path) -> PiperVoice:
        voice = PiperVoice.load(path)
        # Piper creates its ONNX session with default options: a thread on every core, each
        # spin-waiting. On a CPU-only server that starves the LLM, so give it its own session
        # with a few threads that sleep when idle.
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = self._threads
        options.inter_op_num_threads = 1
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        options.add_session_config_entry("session.inter_op.allow_spinning", "0")
        voice.session = onnxruntime.InferenceSession(
            str(path), sess_options=options, providers=["CPUExecutionProvider"]
        )
        return voice

    def preload(self) -> None:
        try:
            self._resolve(self.default_voice)
        except VoiceNotFoundError:
            log.warning("Default voice %s not found in %s. Run scripts/download_voices.sh",
                        self.default_voice, self.voices_dir)

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

        voice, config = self._resolve(voice_id)
        buf = io.BytesIO()
        try:
            with wave.open(buf, "wb") as wav:
                voice.synthesize_wav(speech, wav, syn_config=config)
        except Exception as exc:  # onnxruntime / espeak errors
            raise TTSError(f"Synthesis failed: {exc}") from exc
        audio = buf.getvalue()

        with self._lock:
            self._cache[key] = audio
            if len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return audio

    def health(self) -> dict:
        voices = self._available()
        result = {"ok": self.default_voice in voices, "engine": self.name, "voices": len(voices)}
        if not result["ok"]:
            result["error"] = f"Default voice {self.default_voice} not installed"
        return result
