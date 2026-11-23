#!/bin/sh
# Cloud Run entrypoint: Ollama in the background (local only), then the API on Cloud Run's $PORT.
# The API warms the model up in the background, so the first visitor's request finds it loaded.
set -e
ollama serve > /tmp/ollama.log 2>&1 &
i=0
until ollama list > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then echo "Ollama did not start:"; cat /tmp/ollama.log; exit 1; fi
  sleep 0.5
done
echo "Ollama ready with: $(ollama list | tail -n +2 | awk '{print $1}' | tr '\n' ' ')"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}" --proxy-headers --forwarded-allow-ips="*" --no-server-header
