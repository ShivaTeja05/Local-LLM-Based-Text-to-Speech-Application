#!/usr/bin/env bash
# Create the Ollama model "ellie-british" from the fine-tuned, merged GGUF (Q4_K_M, like the base).
#
#   training/ollama/install.sh                         # from training/colab/output/
#   SRC=../kaggle/output training/ollama/install.sh    # from a Kaggle run
#
# Ollama 0.40 no longer loads LoRA adapters (ADAPTER), so training merges the adapter into the
# weights. The chat template, stop words and licence are copied from llama3.2:3b, so the prompt
# format is exactly the one the model was trained on and the base model uses.
set -euo pipefail
cd "$(dirname "$0")"

SRC="${SRC:-../colab/output}"
NAME="${1:-ellie-british}"
GGUF="$SRC/ellie-british-Q4_K_M.gguf"
[ -f "$GGUF" ] || { echo "No $GGUF: run the training first" >&2; exit 1; }

mkdir -p build
{
  echo "FROM $(cd "$(dirname "$GGUF")" && pwd)/$(basename "$GGUF")"
  # Everything but FROM from the base model's Modelfile: TEMPLATE, stop words and the Llama 3.2
  # licence (this model is a derivative of Llama 3.2, so it carries the same licence).
  ollama show llama3.2:3b --modelfile | grep -v -e '^FROM ' -e '^# '
} > build/Modelfile
grep -c '^PARAMETER stop' build/Modelfile >/dev/null || { echo "Template copy failed" >&2; exit 1; }
echo "Modelfile: $(grep -c . build/Modelfile) lines, FROM $(basename "$GGUF")"
ollama create "$NAME" -f build/Modelfile
ollama show "$NAME" | head -12
