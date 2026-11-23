#!/usr/bin/env bash
# Download the British English voices into backend/voices/.
#
#   Piper:  official rhasspy/piper-voices repository on Hugging Face. The default is the VCTK
#           multi-speaker voice (77 MB), which holds the app's five regional accents
#           (South, North, Midlands, East, West: see app/tts/piper_engine.py).
#   Kokoro: optional, kokoro-onnx release files on GitHub (~120 MB), checksummed
#
# Usage:
#   ./scripts/download_voices.sh                      # the five regional voices
#   ./scripts/download_voices.sh --kokoro             # ... plus Kokoro (TTS_ENGINE=piper+kokoro)
#   ./scripts/download_voices.sh en_GB-alba-medium    # specific Piper voice(s) only
set -euo pipefail

cd "$(dirname "$0")/.."

VOICES_DIR="${VOICES_DIR:-voices}"
PYTHON="${PYTHON:-.venv/bin/python}"
KOKORO=0
VOICES=()
for arg in "$@"; do
  case "$arg" in
    --kokoro) KOKORO=1 ;;
    *) VOICES+=("$arg") ;;
  esac
done

if [ "${#VOICES[@]}" -eq 0 ]; then
  VOICES=(en_GB-vctk-medium)   # 109 speakers; the app uses five regional English accents
fi

mkdir -p "$VOICES_DIR"
echo "Downloading ${#VOICES[@]} Piper voice(s) into $VOICES_DIR ..."
"$PYTHON" -m piper.download_voices --data-dir "$VOICES_DIR" "${VOICES[@]}"

if [ "$KOKORO" -eq 1 ]; then
  KDIR="$VOICES_DIR/kokoro"
  BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
  mkdir -p "$KDIR"
  while read -r sha file; do
    if [ ! -f "$KDIR/$file" ]; then
      echo "Downloading Kokoro $file ..."
      curl -fL --retry 3 -o "$KDIR/$file.part" "$BASE/$file"
      mv "$KDIR/$file.part" "$KDIR/$file"
    fi
    echo "$sha  $KDIR/$file" | shasum -a 256 -c -
  done <<'EOF'
6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb kokoro-v1.0.int8.onnx
bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d voices-v1.0.bin
EOF
fi
ls -lh "$VOICES_DIR" "$VOICES_DIR/kokoro" 2>/dev/null || true
