# Optional v2 model for the comparison build

`python3 deploy/cloudrun/prepare_comparison.py` puts the verified v2 GGUF here locally.
It remains git-ignored. Cloud Build's upload exception allows only this exact filename.
No v3 weights, training data or corpus files belong here.

`Dockerfile.comparison` checks the SHA-256, copies the base model's chat template and
licence, and imports v2 into Ollama. A temporary build bind mount avoids keeping a
second raw GGUF copy in the final image. See
[Docker's build guidance](https://docs.docker.com/build/building/best-practices/#add-or-copy).
