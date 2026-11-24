"""Use my voice: Piper says it in British English, then OpenVoice v2's converter gives it the user's voice.

The three layers of Ellie's speech stay separate: the LLM (and its LoRA adapter) decides the words,
Piper decides the pronunciation (a British accent), and the converter only changes the voice quality
(timbre) to the user's. So "my voice" is the user's voice speaking with Ellie's British pronunciation:
the "golden speaker" idea from pronunciation teaching, where learners imitate their own voice.

Privacy: the recording is reduced to a fingerprint of 256 numbers and then discarded. The server
keeps nothing; the browser keeps the fingerprint and sends it with each speech request.
"""

import base64
import importlib.util
import io
import json
import logging
import threading
import wave
from pathlib import Path

import numpy as np

from app.config import Settings, cpu_threads

log = logging.getLogger(__name__)

SAMPLE_RATE = 22050  # the converter's rate, and Piper's (medium voices)
FINGERPRINT_SIZE = 256
# Read by each base voice to learn its own fingerprint (the "from" side of the conversion).
CALIBRATION = (
    "Good morning! I hope you slept well. The kettle is on, so shall we have a cup of tea "
    "before we head out for a walk along the river? It looks like a lovely day."
)


class CloneError(Exception):
    """The recording cannot be used (too short, too long, no speech)."""


def encode_fingerprint(vector: np.ndarray) -> str:
    return base64.b64encode(np.asarray(vector, dtype="<f4").tobytes()).decode()


def decode_fingerprint(text: str) -> np.ndarray:
    """A fingerprint from the browser: exactly 256 finite float32 values, or CloneError."""
    try:
        raw = base64.b64decode(text, validate=True)
    except ValueError as exc:
        raise CloneError("The voice fingerprint is not valid") from exc
    if len(raw) != FINGERPRINT_SIZE * 4:
        raise CloneError("The voice fingerprint is not valid")
    vector = np.frombuffer(raw, dtype="<f4")
    if not np.all(np.isfinite(vector)) or not 0 < np.linalg.norm(vector) < 1e4:
        raise CloneError("The voice fingerprint is not valid")
    return vector.copy()


def speech_only(audio: np.ndarray, rate: int = SAMPLE_RATE) -> np.ndarray:
    """Keep the 20 ms frames that contain speech (drop silences and pauses between phrases)."""
    frame = int(rate * 0.02)
    n = len(audio) // frame
    if n == 0:
        return audio[:0]
    frames = audio[: n * frame].reshape(n, frame)
    rms = np.sqrt((frames**2).mean(axis=1))
    threshold = max(0.01, 0.1 * float(np.percentile(rms, 95)))
    return frames[rms > threshold].reshape(-1)


def wav_to_float(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data)) as w:
        if w.getframerate() != SAMPLE_RATE or w.getsampwidth() != 2:
            raise CloneError(f"Expected 16-bit {SAMPLE_RATE} Hz speech")
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return pcm.astype(np.float32) / 32768


def float_to_wav(audio: np.ndarray) -> bytes:
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class VoiceCloner:
    def __init__(self, settings: Settings, tts) -> None:
        self.dir = Path(settings.voice_clone_dir)
        self.tts = tts
        self.base_voices = list(settings.voices) or [tts.default_voice]
        self.min_speech = settings.voice_clone_min_seconds
        self.max_seconds = settings.voice_clone_max_seconds
        self.threads = cpu_threads(settings.tts_threads, 1 / 3)
        self._model = None
        self._hps = None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()  # one conversion at a time: no CPU fight (as with Piper)
        self._base: dict[str, np.ndarray] = {}

    @property
    def name(self) -> str:
        return "openvoice-v2"

    def available(self) -> bool:
        return (self.dir / "checkpoint.pth").is_file() and importlib.util.find_spec("torch") is not None

    def health(self) -> dict:
        return {"ok": self.available(), "engine": self.name, "loaded": self._model is not None}

    # --- model -----------------------------------------------------------------------------
    def _load(self):
        with self._load_lock:
            if self._model is None:
                import torch

                from app.voiceclone.openvoice.models import SynthesizerTrn

                torch.set_num_threads(self.threads)
                config = json.loads((self.dir / "config.json").read_text())
                self._hps = config["data"]
                model = SynthesizerTrn(0, self._hps["filter_length"] // 2 + 1, n_speakers=0, **config["model"])
                state = torch.load(self.dir / "checkpoint.pth", map_location="cpu", weights_only=True)
                model.load_state_dict(state["model"], strict=False)
                self._model = model.eval()
                log.info("Loaded the OpenVoice v2 converter (%d threads)", self.threads)
        return self._model

    def preload(self) -> None:
        self._load()
        for voice in self.base_voices:
            self._base_fingerprint(voice)

    def _spectrogram(self, audio: np.ndarray):
        import torch

        h = self._hps
        y = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).unsqueeze(0)
        pad = (h["filter_length"] - h["hop_length"]) // 2
        y = torch.nn.functional.pad(y.unsqueeze(1), (pad, pad), mode="reflect").squeeze(1)
        spec = torch.stft(y, h["filter_length"], hop_length=h["hop_length"], win_length=h["win_length"],
                          window=torch.hann_window(h["win_length"]), center=False, normalized=False,
                          onesided=True, return_complex=True)
        return torch.sqrt(spec.real.pow(2) + spec.imag.pow(2) + 1e-6)

    def fingerprint(self, audio: np.ndarray) -> np.ndarray:
        import torch

        model = self._load()
        with self._run_lock, torch.no_grad():
            g = model.ref_enc(self._spectrogram(audio).transpose(1, 2))
        return g.squeeze(0).numpy().astype(np.float32)

    def _base_fingerprint(self, voice: str) -> np.ndarray:
        if voice not in self._base:
            self._base[voice] = self.fingerprint(speech_only(wav_to_float(self.tts.synthesize(CALIBRATION, voice))))
        return self._base[voice]

    # --- enrol and convert -------------------------------------------------------------------
    def enrol(self, recording: bytes) -> dict:
        """A recording (webm/mp4/wav...) in; its fingerprint and the closest base voice out."""
        from faster_whisper.audio import decode_audio

        try:
            audio = decode_audio(io.BytesIO(recording), sampling_rate=SAMPLE_RATE)
        except Exception as exc:  # PyAV: not audio, or a format it cannot read
            raise CloneError("The recording could not be read") from exc
        audio = audio[: int(self.max_seconds * SAMPLE_RATE)]  # a long upload: its first part is plenty
        speech = speech_only(audio)
        if len(speech) / SAMPLE_RATE < self.min_speech:
            raise CloneError(f"I need at least {self.min_speech:.0f} seconds of clear speech: "
                             "please read the passage a little longer, somewhere quiet")
        fp = self.fingerprint(speech)
        base = max(self.base_voices, key=lambda v: _cosine(fp, self._base_fingerprint(v)))
        return {"fingerprint": encode_fingerprint(fp), "base": base,
                "seconds": round(len(speech) / SAMPLE_RATE, 1)}

    def convert(self, wav: bytes, base_voice: str, target: np.ndarray) -> bytes:
        """Piper's WAV for `base_voice`, re-voiced with the `target` fingerprint."""
        import torch

        model = self._load()
        audio = wav_to_float(wav)
        source = torch.from_numpy(self._base_fingerprint(base_voice)).view(1, -1, 1)
        goal = torch.from_numpy(target).view(1, -1, 1)
        with self._run_lock, torch.no_grad():
            spec = self._spectrogram(audio)
            out = model.voice_conversion(spec, torch.LongTensor([spec.size(-1)]), sid_src=source,
                                         sid_tgt=goal, tau=0.3)[0][0, 0].numpy()
        return float_to_wav(out)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
