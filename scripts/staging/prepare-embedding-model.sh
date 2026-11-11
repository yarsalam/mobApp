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

echo "Preparing pinned multilingual Embedding model in the persistent Docker volume."
echo "This first download is several hundred megabytes; later starts reuse the cache."

"${COMPOSE[@]}" --profile "$profile" run \
  --build --rm --no-deps \
  --entrypoint python embedded_ai -c '
import os
import numpy as np
from sentence_transformers import SentenceTransformer

name = os.environ["MODEL_NAME"]
revision = os.environ["MODEL_REVISION"]
print(f"Downloading/loading {name} at {revision}", flush=True)
model = SentenceTransformer(name, revision=revision)
vector = model.encode("سلام، این فقط یک آزمون فنی برای بارگذاری مدل فارسی است.")
if vector.shape != (384,):
    raise SystemExit(f"Expected a 384-dimensional vector, got {vector.shape}")
if not np.isfinite(vector).all():
    raise SystemExit("Embedding output contains non-finite values")
print(
    f"MODEL_READY name={name} revision={revision} "
    f"dimension={vector.shape[0]} cache={os.environ.get(chr(72)+chr(70)+chr(95)+chr(72)+chr(79)+chr(77)+chr(69))}",
    flush=True,
)
'
