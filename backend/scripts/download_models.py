"""Download the Kokoro voice model (checksummed) and the Whisper model for voice input.

Used by the Dockerfile; on a laptop, scripts/download_voices.sh does Kokoro and Whisper downloads
itself on first use. Needs only the Python standard library plus faster-whisper.

    python scripts/download_models.py [--voices-dir voices]
"""

import argparse
import hashlib
import urllib.request
from pathlib import Path

KOKORO = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {
    "kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voices-dir", default="voices")
    ap.add_argument("--whisper", default="base.en")
    ap.add_argument("--kokoro", action="store_true", help="also download Kokoro (optional engine)")
    a = ap.parse_args()

    out = Path(a.voices_dir) / "kokoro"
    for name, digest in FILES.items() if a.kokoro else []:
        out.mkdir(parents=True, exist_ok=True)
        path = out / name
        if not path.exists() or sha256(path) != digest:
            print(f"Downloading Kokoro {name} ...", flush=True)
            urllib.request.urlretrieve(KOKORO + name, path)
        if sha256(path) != digest:
            raise SystemExit(f"Checksum mismatch for {name}")
        print(f"{name}: OK")

    from faster_whisper import download_model

    print(f"Whisper {a.whisper}: {download_model(a.whisper)}")


if __name__ == "__main__":
    main()
