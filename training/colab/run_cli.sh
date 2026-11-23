#!/usr/bin/env bash
# Train Ellie's LoRA adapter on a Google Colab T4 from the terminal, with Google's official Colab CLI
# (https://github.com/googlecolab/google-colab-cli). Same script and data as the Kaggle run.
#
#   uv tool install google-colab-cli      # once; the first command signs in through the browser
#   training/colab/run_cli.sh             # output lands in training/colab/output/
#
# Training runs in the background on the VM, so a dropped connection does not stop it. The VM is
# always released at the end, also on failure or Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")"

S="${COLAB_SESSION:-ellie}"
GPU="${COLAB_GPU:-T4}"
on_vm() { printf '%%%%bash\n%s\n' "$1" | colab exec -s "$S" --timeout 300; }

python3 make_colab.py
echo "== Allocating a $GPU runtime"
colab new -s "$S" --gpu "$GPU"
cleanup() { echo "== Releasing the runtime"; colab stop -s "$S" || true; }
trap cleanup EXIT INT TERM
colab status -s "$S" || true

echo "== Uploading data and script"
colab upload -s "$S" ellie-colab-bundle.zip /content/ellie-colab-bundle.zip
on_vm "mkdir -p /content/ellie && cd /content/ellie && unzip -o -q ../ellie-colab-bundle.zip && ls -la && nvidia-smi --query-gpu=name,memory.total --format=csv"

echo "== Training (in the background on the VM)"
# Started detached from the kernel (a %%bash cell would wait for it and hit colab exec's
# no-output timeout). The wrapper appends "EXIT CODE n" to the log, which is what we wait for.
colab exec -s "$S" --timeout 120 <<'PY'
import os, subprocess
env = dict(os.environ, ELLIE_DATA="/content/ellie", ELLIE_OUT="/content/ellie-out")
cmd = "python train.py > /content/train.log 2>&1; echo \"EXIT CODE $?\" >> /content/train.log"
p = subprocess.Popen(["bash", "-c", cmd], cwd="/content/ellie", env=env, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
print("started training, pid", p.pid)
PY

trap - EXIT INT TERM   # wait_and_fetch.sh releases the runtime itself
./wait_and_fetch.sh "$S"
