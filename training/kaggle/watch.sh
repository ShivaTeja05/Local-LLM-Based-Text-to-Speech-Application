#!/usr/bin/env bash
# Watch a Kaggle training job that was started elsewhere (e.g. re-run from the website on another
# GPU) and download its output when it finishes. Pushes nothing.
#
#   training/kaggle/watch.sh ellie-lora-train-p100 output-p100
set -euo pipefail
cd "$(dirname "$0")"

KAGGLE_HOME="${KAGGLE_HOME:-$HOME/.kaggle-ellie/home}"
KBIN="$(command -v kaggle)"
K() { HOME="$KAGGLE_HOME" "$KBIN" "$@" 2>&1 | sed '/outdated/d'; }
OWNER=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['username'])" "$KAGGLE_HOME/.kaggle/kaggle.json")
KERNEL="$OWNER/${1:-ellie-lora-train}"
OUTDIR="${2:-output}"

started=$(date +%s)
while [ $(( $(date +%s) - started )) -lt 14400 ]; do   # give up after 4 hours
  line=$(K kernels status "$KERNEL" | tr '[:upper:]' '[:lower:]' || true)
  echo "[$(( ($(date +%s) - started) / 60 )) min] $line"
  case "$line" in
    *complete*) break ;;
    *error*) echo "Run failed"; break ;;
  esac          # queued, running, or cancelled (a new version may be on its way): keep waiting
  sleep 30
done
rm -rf "$OUTDIR" && mkdir -p "$OUTDIR"
K kernels output "$KERNEL" -p "$OUTDIR"
ls -lh "$OUTDIR"
