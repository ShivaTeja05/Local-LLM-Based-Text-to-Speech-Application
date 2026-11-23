# Ellie on Google Cloud Run: one container with the Angular app, FastAPI, Piper (five regional
# voices), Whisper and Ollama with llama3.2:3b. Everything is built in, so a cold start downloads
# nothing. Build context: the repository root (see cloudbuild.yaml).

# --- 1. The Angular app -------------------------------------------------------------------
FROM node:24-slim AS frontend
WORKDIR /src
ENV NG_CLI_ANALYTICS=false
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build

# --- 2. Ollama, CPU only (Cloud Run has no GPU here): drop ~3.4 GB of GPU libraries ----------
FROM ollama/ollama:0.40.4 AS ollama
RUN rm -rf /usr/lib/ollama/cuda_* /usr/lib/ollama/rocm* /usr/lib/ollama/vulkan*

# --- 3. The service -------------------------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/hf OLLAMA_MODELS=/models OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NOPRUNE=1 HOME=/tmp
RUN useradd --system --uid 10001 --no-create-home ellie && mkdir /models && chown ellie /models

COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama

# The model, pulled as the runtime user so its files need no chown (which would copy 2 GB).
ARG LLM_MODEL=llama3.2:3b
USER ellie
RUN ollama serve > /tmp/ollama.log 2>&1 & pid=$!; \
    for i in $(seq 1 60); do ollama list > /dev/null 2>&1 && break; sleep 1; done; \
    ollama pull "$LLM_MODEL" && kill $pid && ollama --version 2>/dev/null; du -sh /models
USER root

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt

# The five regional voices (one 77 MB model) and the Whisper model for voice input.
ARG VOICES="en_GB-vctk-medium"
RUN python -m piper.download_voices --data-dir /app/voices $VOICES
COPY backend/scripts/download_models.py ./scripts/
RUN python scripts/download_models.py --voices-dir /app/voices
ENV HF_HUB_OFFLINE=1

COPY backend/app ./app
# The backend serves the app at / when this folder exists, so the service URL is a complete site.
COPY --from=frontend /src/dist/frontend/browser /frontend/dist/frontend/browser
COPY deploy/cloudrun/start.sh /start.sh
RUN chmod 755 /start.sh

USER ellie
ENV OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_KEEP_ALIVE=24h LLM_MODEL=${LLM_MODEL}
EXPOSE 8080
CMD ["/start.sh"]
