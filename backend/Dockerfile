# Ellie backend: FastAPI + Piper and Kokoro (British voices) + Whisper (voice input), all baked in.
# Talks to Ollama over HTTP. Nothing is downloaded at run time.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/hf

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# The voices get their own layer, so code changes don't download them again. One multi-speaker
# model (77 MB) holds the app's five regional English accents.
ARG VOICES="en_GB-vctk-medium"
RUN python -m piper.download_voices --data-dir /app/voices $VOICES

# The Whisper model for voice input (~145 MB). Kokoro is optional: build with
# --build-arg KOKORO=1 (and set TTS_ENGINE=piper+kokoro) to add it (~120 MB).
ARG KOKORO=0
COPY scripts/download_models.py ./scripts/
RUN python scripts/download_models.py --voices-dir /app/voices $([ "$KOKORO" = 1 ] && echo --kokoro)
# From here on, never reach out to Hugging Face: the model is in the image.
ENV HF_HUB_OFFLINE=1

COPY app ./app

# Files stay root-owned and read-only to the app; it runs as an unprivileged user.
RUN useradd --system --uid 10001 --no-create-home ellie
USER ellie

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*", "--no-server-header"]
