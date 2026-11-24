#!/bin/sh
# Runs inside the comparison image build, with a read-only temporary mount of v2's GGUF.
set -eu
GGUF=/finetune/ellie-british-Q4_K_M.gguf
: "${FINETUNE_SHA256:?Expected v2 checksum is required}"
printf '%s  %s\n' "$FINETUNE_SHA256" "$GGUF" | sha256sum -c -

ollama serve > /tmp/finetune-ollama.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT INT TERM
ready=0
for i in $(seq 1 60); do
  if ollama list > /dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { cat /tmp/finetune-ollama.log; exit 1; }
{
  printf 'FROM %s\n' "$GGUF"
  ollama show llama3.2:3b --modelfile | grep -v -e '^FROM ' -e '^# '
} > /tmp/finetune.Modelfile
grep '^PARAMETER stop' /tmp/finetune.Modelfile > /dev/null
ollama create ellie-british -f /tmp/finetune.Modelfile
ollama show ellie-british > /dev/null
