#!/usr/bin/env bash
# Wait for a training run already started on a Colab session (its log ends with "EXIT CODE n"),
# then download the output into training/colab/output/ and release the runtime.
#
#   training/colab/wait_and_fetch.sh [session]
set -uo pipefail
cd "$(dirname "$0")"
S="${1:-ellie}"
on_vm() { printf '%%%%bash\n%s\n' "$1" | colab exec -s "$S" --timeout 120 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; }

started=$(date +%s)
while [ $(( $(date +%s) - started )) -lt 5400 ]; do
  state=$(on_vm 'grep "EXIT CODE" /content/train.log; grep -E "^\[ *[0-9]+s\]|^\{.loss|it/s\]$" /content/train.log | tail -1')
  echo "[$(( ($(date +%s) - started) / 60 )) min] $(echo "$state" | tail -1 | cut -c1-160)"
  echo "$state" | grep -q "EXIT CODE" && break
  sleep 30
done

colab download -s "$S" /content/train.log train.log
if on_vm "test -f /content/ellie-out/eval.json && cd /content/ellie-out && rm -f /content/out.zip && zip -q -r /content/out.zip . && echo ZIPPED" | grep -q ZIPPED; then
  colab download -s "$S" /content/out.zip out.zip
  rm -rf output && mkdir -p output && unzip -q out.zip -d output && rm out.zip
  ls -lh output
else
  echo "No results: see training/colab/train.log"
fi
colab stop -s "$S"
grep "EXIT CODE" train.log
