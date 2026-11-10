#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
SERVICE="${1:-}"
[[ -n "$SERVICE" ]] || { echo "Usage: $0 <AI service name>"; exit 2; }

build_base() {
  local image="$1" dockerfile="$2"
  if docker image inspect "$image:latest" >/dev/null 2>&1; then return; fi
  echo "Building staging base image $image"
  docker build --pull -f "python-ai/staging-base-images/$dockerfile" -t "$image:latest" .
}
build_core() { build_base python-ai-core Dockerfile.core; }
build_ml_lite() { build_core; build_base python-ai-ml-lite Dockerfile.ml-lite; }
build_nlp() { build_core; build_base python-ai-nlp Dockerfile.nlp; }
build_transformers() { build_core; build_base python-ai-transformers Dockerfile.transformers; }
build_tf() { build_core; build_base python-ai-tf Dockerfile.tf; }

case "$SERVICE" in
  ai_ops|ai_feedback|ai_monetization|ai_uplift|ai_seo_recommender|ai_aeo_tracker)
    build_ml_lite ;;
  ai_seo)
    build_ml_lite
    build_base python-ai-ml-prophet Dockerfile.ml-prophet ;;
  ai_assistant|personality)
    build_transformers ;;
  ai_backlink_quality|ai_moderation|ai_support|embedded_ai)
    build_nlp ;;
  ml_service)
    build_ml_lite
    build_base python-ai-ml-http Dockerfile.ml-http ;;
  ai_revenue)
    build_tf
    build_base python-ai-tf-panda Dockerfile.tf-panda ;;
  ai_image|ai_verification)
    build_tf
    build_base python-ai-tf-pillow Dockerfile.tf-pillow ;;
  *)
    echo "Unknown AI service: $SERVICE"; exit 2 ;;
esac
