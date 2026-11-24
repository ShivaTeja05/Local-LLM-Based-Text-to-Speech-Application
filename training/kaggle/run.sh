#!/usr/bin/env bash
# Train Ellie's LoRA adapter on a Kaggle T4, from this Mac:
#   1. upload the dataset (private)  2. push kernel/train.py (private, GPU)
#   3. wait for it to finish         4. download the adapter and results into output/
#
# The Kaggle account is whichever key sits in $KAGGLE_HOME/.kaggle (default ~/.kaggle-ellie/home),
# kept apart from ~/.kaggle so another account's login is never used by mistake.
#
#   training/kaggle/run.sh                          # everything, on a T4 (Unsloth)
#   ACCEL=NvidiaTeslaP100 training/kaggle/run.sh    # on a P100 (Hugging Face PEFT), as its own job
#   SKIP_DATA=1 training/kaggle/run.sh              # reuse the dataset already on Kaggle
#   training/kaggle/run.sh --fetch                  # only download the output of the last run
#   DATA_DIR=../data/out/v3 OUTDIR=output-v3 training/kaggle/run.sh   # train on another dataset
set -euo pipefail
cd "$(dirname "$0")"

KAGGLE_HOME="${KAGGLE_HOME:-$HOME/.kaggle-ellie/home}"
KBIN="$(command -v kaggle)"
# The CLI prints an "outdated version" notice on stdout: drop it so outputs can be compared.
K() { HOME="$KAGGLE_HOME" "$KBIN" "$@" 2>&1 | sed '/outdated/d'; }
OWNER=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['username'])" "$KAGGLE_HOME/.kaggle/kaggle.json")
ACCEL="${ACCEL:-NvidiaTeslaT4}"
case "$ACCEL" in *P100*) SUFFIX="-p100" ;; *) SUFFIX="" ;; esac  # each GPU type is its own job
DATASET="$OWNER/ellie-british-chat"
KERNEL="$OWNER/ellie-lora-train$SUFFIX"
OUTDIR="${OUTDIR:-output$SUFFIX}"   # e.g. OUTDIR=output-v3 keeps an earlier run's output
DATA="${DATA_DIR:-../data/out}"      # e.g. DATA_DIR=../data/out/v3
BUILD="build$SUFFIX"
echo "Kaggle account: $OWNER, job: $KERNEL on $ACCEL"

fetch() {
  rm -rf "$OUTDIR" && mkdir -p "$OUTDIR"
  K kernels output "$KERNEL" -p "$OUTDIR"
  ls -lh "$OUTDIR"
}
if [ "${1:-}" = "--fetch" ]; then fetch; exit 0; fi

# 1. Dataset ---------------------------------------------------------------------------
rm -rf "$BUILD" && mkdir -p "$BUILD/dataset" "$BUILD/kernel"
if [ -z "${SKIP_DATA:-}" ]; then
cp "$DATA/train.jsonl" "$DATA/val.jsonl" ../eval/prompts.jsonl ../eval/score.py "$BUILD/dataset/"
cat > "$BUILD/dataset/dataset-metadata.json" <<EOF
{"title": "Ellie British chat (LoRA data)", "id": "$DATASET", "licenses": [{"name": "other"}]}
EOF
if K datasets status "$DATASET" >/dev/null 2>&1; then
  K datasets version -p "$BUILD/dataset" -m "Dataset update $(date -u +%FT%TZ)" -d
else
  K datasets create -p "$BUILD/dataset"   # private unless --public is given
fi
fi
for _ in $(seq 1 40); do
  status=$(K datasets status "$DATASET" || true)
  echo "dataset: $status"
  echo "$status" | grep -qi "ready" && break
  sleep 10
done

# 2. Kernel ----------------------------------------------------------------------------
cp kernel/train.py "$BUILD/kernel/"
cat > "$BUILD/kernel/kernel-metadata.json" <<EOF
{
  "id": "$KERNEL",
  "title": "Ellie LoRA train$SUFFIX",
  "code_file": "train.py",
  "language": "python",
  "kernel_type": "script",
  "is_private": true,
  "enable_gpu": true,
  "enable_internet": true,
  "dataset_sources": ["$DATASET"],
  "competition_sources": [],
  "kernel_sources": []
}
EOF
push=$(K kernels push -p "$BUILD/kernel" --accelerator "$ACCEL")
echo "$push"
case "$push" in *rror*) echo "Kaggle refused the job (each account may have 2 GPU jobs, queued ones included)"; exit 1 ;; esac

# 3. Wait ------------------------------------------------------------------------------
started=$(date +%s)
while true; do
  sleep 30
  line=$(K kernels status "$KERNEL" | tr '[:upper:]' '[:lower:]' || true)
  echo "[$(( ($(date +%s) - started) / 60 )) min] $line"
  case "$line" in
    *complete*) break ;;
    *error*|*cancel*) echo "Run failed; the log is in $OUTDIR/"; fetch; exit 1 ;;
  esac
done

# 4. Output ----------------------------------------------------------------------------
fetch
