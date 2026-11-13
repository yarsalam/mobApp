#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env.staging"
[[ -s "$ENV_FILE" ]] || {
  echo "Missing .env.staging; run scripts/staging/bootstrap.sh first." >&2
  exit 2
}

profile="${1:-}"
case "$profile" in
  ai-embedding|ai-matching|ai-moderation) ;;
  *)
    echo "Usage: $0 <ai-embedding|ai-matching|ai-moderation>" >&2
    exit 2
    ;;
esac

COMPOSE=(docker compose --env-file "$ENV_FILE" -p yarsalam-staging
  -f docker-compose.yml
  -f docker-compose.production.yml
  -f docker-compose.staging.yml)

echo "Fetching only the required PyTorch/Sentence-Transformers model files."
echo "The duplicate TensorFlow, ONNX and OpenVINO exports are intentionally skipped."

"${COMPOSE[@]}" --profile "$profile" run \
  --build --rm --no-deps \
  --entrypoint python embedded_ai -c '
import os
from pathlib import Path

import numpy as np
from huggingface_hub import snapshot_download
from sentence_transformers import SentenceTransformer

repo_id = os.environ["MODEL_REPO_ID"]
revision = os.environ["MODEL_REVISION"]
model_path = Path(os.environ["MODEL_PATH"])
model_path.mkdir(parents=True, exist_ok=True)

required_files = [
    "README.md",
    "config.json",
    "config_sentence_transformers.json",
    "modules.json",
    "model.safetensors",
    "sentence_bert_config.json",
    "1_Pooling/config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "sentencepiece.bpe.model",
    "unigram.json",
]
print(f"Downloading {repo_id}@{revision} into {model_path}", flush=True)
snapshot_download(
    repo_id=repo_id,
    revision=revision,
    local_dir=str(model_path),
    allow_patterns=required_files,
)

missing = [name for name in required_files if not (model_path / name).is_file()]
if missing:
    raise SystemExit(f"Model snapshot is incomplete; missing files: {missing}")

model = SentenceTransformer(str(model_path), local_files_only=True)
vector = model.encode("سلام، این فقط یک آزمون فنی برای بارگذاری مدل فارسی است.")
if vector.shape != (384,):
    raise SystemExit(f"Expected a 384-dimensional vector, got {vector.shape}")
if not np.isfinite(vector).all():
    raise SystemExit("Embedding output contains non-finite values")

weight_bytes = (model_path / "model.safetensors").stat().st_size
cache_path = os.environ.get("HF_HOME")
print(
    f"MODEL_READY repo={repo_id} revision={revision} "
    f"dimension={vector.shape[0]} safetensors_bytes={weight_bytes} "
    f"cache={cache_path}",
    flush=True,
)
'
