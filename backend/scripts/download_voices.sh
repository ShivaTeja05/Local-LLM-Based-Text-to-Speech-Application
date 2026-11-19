#!/usr/bin/env bash
# Download British English Piper voices from the official rhasspy/piper-voices
# repository on Hugging Face into backend/voices/.
#
# Usage:
#   ./scripts/download_voices.sh                      # default UK voice set
#   ./scripts/download_voices.sh en_GB-alba-medium    # specific voice(s)
set -euo pipefail

cd "$(dirname "$0")/.."

VOICES_DIR="${VOICES_DIR:-voices}"
PYTHON="${PYTHON:-.venv/bin/python}"

if [ "$#" -gt 0 ]; then
  VOICES=("$@")
else
  VOICES=(
    en_GB-cori-high                     # female, clear southern English (default)
    en_GB-jenny_dioco-medium            # female
    en_GB-alan-medium                   # male
    en_GB-northern_english_male-medium  # male, northern English
  )
fi

mkdir -p "$VOICES_DIR"
echo "Downloading ${#VOICES[@]} voice(s) into $VOICES_DIR ..."
"$PYTHON" -m piper.download_voices --data-dir "$VOICES_DIR" "${VOICES[@]}"
ls -lh "$VOICES_DIR"
