"""Build the Google Colab version of the training run (same script as on Kaggle).

    python3 training/colab/make_colab.py

Writes:
  training/colab/train_ellie_colab.ipynb   open in Colab (File → Upload notebook)
  training/colab/ellie-colab-bundle.zip    upload when the notebook asks: data + training script
"""

import json
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAINING = HERE.parent
FILES = {
    "train.py": TRAINING / "kaggle" / "kernel" / "train.py",
    "train.jsonl": TRAINING / "data" / "out" / "train.jsonl",
    "val.jsonl": TRAINING / "data" / "out" / "val.jsonl",
    "prompts.jsonl": TRAINING / "eval" / "prompts.jsonl",
    "score.py": TRAINING / "eval" / "score.py",
}


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text: str) -> dict:
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True)}


CELLS = [
    md("""
# Ellie: LoRA fine-tune of Llama 3.2 3B (Google Colab)

The same training run as `training/kaggle/kernel/train.py`, on Colab's free **T4** GPU.

1. **Runtime → Change runtime type → T4 GPU → Save.**
2. **Runtime → Run all.**
3. When cell 2 asks, upload **`ellie-colab-bundle.zip`** (from `training/colab/` in the project).
4. Leave the tab open (about 15–20 minutes). The last cell downloads **`ellie-lora-output.zip`**:
   the adapter, its GGUF version for Ollama, the loss curve and a base-vs-adapter comparison.
"""),
    code("""
# 1. Check the GPU (Unsloth needs a T4 or newer; this script also handles older cards).
import subprocess
gpu = subprocess.run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader",
                     shell=True, capture_output=True, text=True).stdout.strip()
assert gpu, "No GPU: Runtime → Change runtime type → T4 GPU, then Run all again."
print("GPU:", gpu)
"""),
    code("""
# 2. Upload ellie-colab-bundle.zip (the training data and script).
import os, zipfile
from google.colab import files

os.makedirs("/content/ellie", exist_ok=True)
uploaded = files.upload()
bundle = next(name for name in uploaded if name.endswith(".zip"))
zipfile.ZipFile(bundle).extractall("/content/ellie")
print(sorted(os.listdir("/content/ellie")))
"""),
    code("""
# 3. Train, then compare base and adapter on the 40 held-out prompts (~15 minutes on a T4).
import os
os.environ["ELLIE_DATA"] = "/content/ellie"
os.environ["ELLIE_OUT"] = "/content/ellie-out"
!cd /content/ellie && python train.py
"""),
    code("""
# 4. Show the results and download them.
import json, shutil
print(json.dumps(json.load(open("/content/ellie-out/eval.json")), indent=2))
shutil.make_archive("/content/ellie-lora-output", "zip", "/content/ellie-out")
files.download("/content/ellie-lora-output.zip")
"""),
]


def main() -> None:
    notebook = {
        "nbformat": 4, "nbformat_minor": 5, "cells": CELLS,
        "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
                     "kernelspec": {"name": "python3", "display_name": "Python 3"},
                     "language_info": {"name": "python"}},
    }
    (HERE / "train_ellie_colab.ipynb").write_text(json.dumps(notebook, indent=1) + "\n")
    with zipfile.ZipFile(HERE / "ellie-colab-bundle.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for name, path in FILES.items():
            z.write(path, name)
    print("wrote train_ellie_colab.ipynb and ellie-colab-bundle.zip")


if __name__ == "__main__":
    main()
