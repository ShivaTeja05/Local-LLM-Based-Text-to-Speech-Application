"""Prepare the v2-only comparison build locally. Does not upload, deploy, commit or push."""

import argparse
import hashlib
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = "80a361d34066198c10777a7021c8f1d94b293676a266b92c6fbadf0f41cf9b11"
DEST = ROOT / "deploy/cloudrun/finetune/ellie-british-Q4_K_M.gguf"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(source: Path) -> None:
    if sha256(source) != EXPECTED:
        raise SystemExit("Source is not the verified v2 GGUF. Nothing was copied.")
    if not DEST.exists() or sha256(DEST) != EXPECTED:
        shutil.copyfile(source, DEST)
    if sha256(DEST) != EXPECTED:
        raise SystemExit("Copied model checksum mismatch")
    DEST.chmod(0o644)
    print(f"Prepared v2 model: {DEST.stat().st_size:,} bytes, SHA-256 {EXPECTED}")
    print("No upload or deployment performed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path,
                        default=ROOT / "training/colab/output/ellie-british-Q4_K_M.gguf")
    prepare(parser.parse_args().source)
