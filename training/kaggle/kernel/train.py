"""Train Ellie's LoRA adapter on a Kaggle GPU. Pushed and run by training/kaggle/run.sh.

T4 (compute capability 7.5): Unsloth, about twice as fast.
P100 (6.0): Unsloth does not support it, so standard Hugging Face PEFT with the same LoRA settings,
            data, prompt format and outputs. Newer PyTorch builds for CUDA 12.8+ dropped Pascal
            GPUs, so if Kaggle's PyTorch cannot run on the card, a CUDA 12.6 build is installed.

Input  (Kaggle dataset): train.jsonl, val.jsonl, prompts.jsonl, score.py
Output (/kaggle/working): ellie-lora/ (PEFT adapter), ellie-lora.gguf (for Ollama),
                          metrics.json (loss curve), eval.json + samples.jsonl (base vs adapter)

Also runs on Google Colab (training/colab/): set ELLIE_DATA to the folder with the input files and
ELLIE_OUT to where the output should go.
"""

import glob
import json
import os
import subprocess
import sys
import time

T0 = time.time()
OUT = os.environ.get("ELLIE_OUT", "/kaggle/working")
os.makedirs(OUT, exist_ok=True)
BASE = "unsloth/Llama-3.2-3B-Instruct"  # the same weights as Ollama's llama3.2:3b, no licence gate
MAX_LEN = 1024
SHORT_SYSTEM = "You are Ellie, a warm, friendly conversational partner from England."


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.0f}s] {msg}", flush=True)


def sh(cmd: str, check: bool = True) -> int:
    log(f"$ {cmd}")
    return subprocess.run(cmd, shell=True, check=check).returncode


# --- Pick the training path from the GPU, before anything imports torch ------------------------
gpu = subprocess.run("nvidia-smi --query-gpu=name,compute_cap --format=csv,noheader",
                     shell=True, capture_output=True, text=True).stdout.strip().splitlines()[0]
GPU_NAME, cap = (x.strip() for x in gpu.split(","))
USE_UNSLOTH = tuple(int(x) for x in cap.split(".")) >= (7, 0)
log(f"GPU: {GPU_NAME} (compute {cap}) -> {'Unsloth' if USE_UNSLOTH else 'Hugging Face PEFT'}")

CUDA_CHECK = "import torch; x = torch.ones(4, device='cuda', dtype=torch.float16); print(float((x @ x)))"


def torch_runs_on_gpu() -> bool:
    r = subprocess.run([sys.executable, "-c", CUDA_CHECK], capture_output=True, text=True)
    if r.returncode:
        log("torch check failed: " + (r.stderr.strip().splitlines() or ["?"])[-1])
    return r.returncode == 0


if USE_UNSLOTH:
    sh("pip install -q unsloth==2026.11.9 unsloth-zoo==2026.11.9")
else:
    if not torch_runs_on_gpu():
        log("this PyTorch build has no kernels for this GPU: installing the CUDA 12.6 build")
        sh(f"{sys.executable} -m pip install -q torch torchvision torchaudio "
           "--index-url https://download.pytorch.org/whl/cu126")
        if not torch_runs_on_gpu():
            raise SystemExit("PyTorch cannot use this GPU")
    sh(f"{sys.executable} -m pip install -q peft==0.22.0")

import torch  # noqa: E402

if USE_UNSLOTH:
    from unsloth import FastLanguageModel  # noqa: E402  (must be imported before transformers)
from datasets import Dataset  # noqa: E402
from transformers import Trainer, TrainingArguments  # noqa: E402

log(f"torch {torch.__version__} (CUDA {torch.version.cuda}), GPU: {torch.cuda.get_device_name(0)}")
DATA = os.environ.get("ELLIE_DATA") or os.path.dirname(glob.glob("/kaggle/input/**/train.jsonl", recursive=True)[0])
sys.path.insert(0, DATA)
from score import is_correct, score, summarise  # noqa: E402


def read(name: str) -> list[dict]:
    with open(os.path.join(DATA, name)) as f:
        return [json.loads(line) for line in f if line.strip()]


train_rows, val_rows = read("train.jsonl"), read("val.jsonl")
log(f"data: {len(train_rows)} train, {len(val_rows)} val conversations")

TARGETS = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
if USE_UNSLOTH:
    model, tok = FastLanguageModel.from_pretrained(BASE, max_seq_length=MAX_LEN, dtype=torch.float16,
                                                   load_in_4bit=False)
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=32, lora_dropout=0, bias="none", target_modules=TARGETS,
        use_gradient_checkpointing="unsloth", random_state=3407,
    )
else:
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.manual_seed(3407)
    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float16, device_map={"": 0},
                                                 attn_implementation="sdpa")
    model.config.use_cache = False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    # PEFT keeps the LoRA weights in float32 while the frozen base stays float16 (mixed precision).
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.0, bias="none",
                                             task_type="CAUSAL_LM", target_modules=TARGETS))
    model.print_trainable_parameters()
if tok.pad_token is None:
    tok.pad_token = "<|finetune_right_pad_id|>"


# --- Exactly Ollama's llama3.2 prompt format (see `ollama show llama3.2:3b --template`) ------
def header(role: str) -> str:
    return f"<|start_header_id|>{role}<|end_header_id|>\n\n"


def system_block(system: str) -> str:
    return header("system") + "Cutting Knowledge Date: December 2023\n\n" + system + "<|eot_id|>"


def encode(messages: list[dict]) -> dict:
    """Token ids plus labels: loss only on Ellie's words and her end-of-turn token."""
    ids, labels = [tok.bos_token_id], [-100]

    def add(text: str, learn: bool) -> None:
        t = tok(text, add_special_tokens=False)["input_ids"]
        ids.extend(t)
        labels.extend(t if learn else [-100] * len(t))

    add(system_block(messages[0]["content"]), False)
    for m in messages[1:]:
        if m["role"] == "user":
            add(header("user") + m["content"] + "<|eot_id|>", False)
        else:
            add(header("assistant"), False)
            add(m["content"] + "<|eot_id|>", True)
    return {"input_ids": ids[:MAX_LEN], "attention_mask": [1] * len(ids[:MAX_LEN]), "labels": labels[:MAX_LEN]}


train_ds = Dataset.from_list([encode(r["messages"]) for r in train_rows])
val_ds = Dataset.from_list([encode(r["messages"]) for r in val_rows])
log(f"tokens per example: avg {sum(map(len, train_ds['input_ids'])) / len(train_ds):.0f}, "
    f"max {max(map(len, train_ds['input_ids']))}")

# v1 (2e-4, 3 epochs): validation loss was lowest after epoch 1 and rose after, and the adapter got
# a fact wrong that the base model knew. v2 learns more gently to keep the base model's knowledge.
EPOCHS, BATCH, ACCUM, LR = 2, 4, 2, 1e-4
total_steps = EPOCHS * -(-len(train_ds) // (BATCH * ACCUM))
wanted = dict(
    output_dir=f"{OUT}/run", num_train_epochs=EPOCHS, learning_rate=LR, lr_scheduler_type="cosine",
    warmup_steps=max(1, round(0.05 * total_steps)), weight_decay=0.01, per_device_train_batch_size=BATCH,
    gradient_accumulation_steps=ACCUM, per_device_eval_batch_size=8, optim="adamw_torch", fp16=True,
    logging_steps=10, eval_strategy="epoch", save_strategy="epoch", save_total_limit=2,
    load_best_model_at_end=True, metric_for_best_model="eval_loss", greater_is_better=False,
    report_to="none", seed=3407,
)
# Transformers renames options between major versions (5.x dropped warmup_ratio): skip, and log,
# any this version does not accept rather than failing the run.
import inspect  # noqa: E402

accepted = set(inspect.signature(TrainingArguments.__init__).parameters)
dropped = sorted(set(wanted) - accepted)
if dropped:
    log(f"TrainingArguments does not accept {dropped}: skipped")
args = TrainingArguments(**{k: v for k, v in wanted.items() if k in accepted})
log(f"{total_steps} optimiser steps over {EPOCHS} epochs")
def collate(batch: list[dict]) -> dict:
    """Right-pad to the longest example; padding is masked out of attention and loss."""
    n = max(len(b["input_ids"]) for b in batch)
    pad = lambda xs, v: xs + [v] * (n - len(xs))  # noqa: E731
    return {
        "input_ids": torch.tensor([pad(b["input_ids"], tok.pad_token_id) for b in batch]),
        "attention_mask": torch.tensor([pad(b["attention_mask"], 0) for b in batch]),
        "labels": torch.tensor([pad(b["labels"], -100) for b in batch]),
    }


trainer = Trainer(model=model, args=args, train_dataset=train_ds, eval_dataset=val_ds, data_collator=collate)
result = trainer.train()
log(f"trained: {result.metrics}")
with open(f"{OUT}/metrics.json", "w") as f:
    json.dump({"train": result.metrics, "log_history": trainer.state.log_history,
               "best_checkpoint": trainer.state.best_model_checkpoint}, f, indent=2)

model.save_pretrained(f"{OUT}/ellie-lora")
tok.save_pretrained(f"{OUT}/ellie-lora")
sh(f"rm -rf {OUT}/run")
log("adapter saved")

# --- Quick base-vs-adapter check on the 40 held-out prompts (the Mac runs the full eval) -----
if USE_UNSLOTH:
    FastLanguageModel.for_inference(model)
else:
    model.eval()
    model.config.use_cache = True
cases = read("prompts.jsonl")


def reply(messages: list[dict]) -> tuple[str, str]:
    text = "<|begin_of_text|>" + system_block(SHORT_SYSTEM) + "".join(
        header(m["role"]) + m["content"] + "<|eot_id|>" for m in messages) + header("assistant")
    inputs = tok(text, return_tensors="pt", add_special_tokens=False).to("cuda")
    out = model.generate(**inputs, max_new_tokens=160, do_sample=True, temperature=0.7, top_p=0.9,
                         repetition_penalty=1.1, eos_token_id=[tok.convert_tokens_to_ids("<|eot_id|>")])
    new = out[0][inputs["input_ids"].shape[1]:]
    finished = tok.convert_tokens_to_ids("<|eot_id|>") in new.tolist()
    return tok.decode(new, skip_special_tokens=True).strip(), "stop" if finished else "length"


evaluation, samples = {}, []
for label in ("adapter", "base"):
    torch.manual_seed(7)
    scores, correct = [], []
    for case in cases:
        if label == "base":
            with model.disable_adapter():
                text, why = reply(case["messages"])
        else:
            text, why = reply(case["messages"])
        s = score(text, why)
        scores.append(s)
        if "expect" in case:
            correct.append(is_correct(text, case["expect"]))
        samples.append({"model": label, "id": case["id"], "reply": text, **s.as_dict()})
    evaluation[f"{label}-short"] = summarise(scores, correct)
    log(f"{label} with the one-line prompt: {evaluation[f'{label}-short']}")
with open(f"{OUT}/eval.json", "w") as f:
    json.dump(evaluation, f, indent=2)
with open(f"{OUT}/samples.jsonl", "w") as f:
    f.writelines(json.dumps(s) + "\n" for s in samples)

# --- The merged model as GGUF Q4_K_M, the same format as Ollama's llama3.2:3b -----------------
# Ollama 0.40 no longer loads LoRA adapters (ADAPTER), so the adapter is merged into the 16-bit
# weights, converted to GGUF and quantised like the base model, for a like-for-like comparison.
MERGED, F16 = "/tmp/ellie-merged", "/tmp/ellie-f16.gguf"
GGUF = f"{OUT}/ellie-british-Q4_K_M.gguf"
if USE_UNSLOTH:
    model.save_pretrained_merged(MERGED, tok, save_method="merged_16bit")
else:
    model.merge_and_unload().save_pretrained(MERGED, safe_serialization=True)
    tok.save_pretrained(MERGED)
log("merged model saved")
LLAMA = "/tmp/llama.cpp"
sh(f"git clone -q --depth 1 https://github.com/ggml-org/llama.cpp {LLAMA}")
sh(f"pip install -q {LLAMA}/gguf-py")
sh(f"python {LLAMA}/convert_hf_to_gguf.py {MERGED} --outtype f16 --outfile {F16}")
sh(f"cmake -S {LLAMA} -B {LLAMA}/build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF "
   f"-DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF > /tmp/cmake.log")
sh(f"cmake --build {LLAMA}/build --target llama-quantize -j {os.cpu_count() or 2} > /tmp/build.log")
sh(f"{LLAMA}/build/bin/llama-quantize {F16} {GGUF} Q4_K_M > /tmp/quantize.log 2>&1")
log(f"quantised: {os.path.getsize(GGUF) / 1e9:.2f} GB")
log("done: " + ", ".join(sorted(os.listdir(OUT))))
