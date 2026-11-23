"""Several TTS engines behind one TTSEngine: each voice belongs to one engine, and a request is
routed by its voice id. The picker can then offer Piper and Kokoro voices side by side, and
switching engine is just choosing another voice."""

from app.tts.base import TTSEngine, VoiceInfo, VoiceNotFoundError


class MultiEngine:
    def __init__(self, engines: list[TTSEngine]):
        self.engines = engines
        self.name = "+".join(e.name for e in engines)
        self.default_voice = engines[0].default_voice  # the first engine's default is the app's

    def preload(self) -> None:
        for engine in self.engines:
            if hasattr(engine, "preload"):
                engine.preload()

    def list_voices(self) -> list[VoiceInfo]:
        return [VoiceInfo(v.id, v.label, is_default=v.id == self.default_voice)
                for e in self.engines for v in e.list_voices()]

    def _engine_for(self, voice_id: str) -> TTSEngine:
        for engine in self.engines:
            if any(v.id == voice_id for v in engine.list_voices()):
                return engine
        raise VoiceNotFoundError(f"Voice '{voice_id}' is not installed")

    def synthesize(self, text: str, voice_id: str | None = None) -> bytes:
        voice_id = voice_id or self.default_voice
        return self._engine_for(voice_id).synthesize(text, voice_id)

    def health(self) -> dict:
        parts = {e.name: e.health() for e in self.engines}
        first = parts[self.engines[0].name]  # the default voice's engine decides "ok"
        result = {"ok": first["ok"], "engine": self.name,
                  "voices": sum(p.get("voices", 0) for p in parts.values()), "engines": parts}
        if "error" in first:
            result["error"] = first["error"]
        return result


class CuratedVoices:
    """Offer exactly the allow-listed voices (VOICES), in that order, whatever else is installed.
    Requests for any other voice are refused, so the picker and the API always agree."""

    def __init__(self, engine: TTSEngine, ids: list[str], default_voice: str):
        self.engine, self.ids = engine, ids
        self.name = engine.name
        self.default_voice = default_voice if default_voice in ids else ids[0]

    def preload(self) -> None:
        if hasattr(self.engine, "preload"):
            self.engine.preload()

    def list_voices(self) -> list[VoiceInfo]:
        available = {v.id: v for v in self.engine.list_voices()}
        return [VoiceInfo(i, available[i].label, is_default=i == self.default_voice) for i in self.ids if i in available]

    def synthesize(self, text: str, voice_id: str | None = None) -> bytes:
        voice_id = voice_id or self.default_voice
        if voice_id not in self.ids:
            raise VoiceNotFoundError(f"Voice '{voice_id}' is not offered on this server")
        return self.engine.synthesize(text, voice_id)

    def health(self) -> dict:
        offered = [v.id for v in self.list_voices()]
        result = {**self.engine.health(), "voices": len(offered), "ok": self.default_voice in offered}
        if not result["ok"]:
            result["error"] = f"Default voice {self.default_voice} is not installed"
        return result
