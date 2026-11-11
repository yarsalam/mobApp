#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
SERVICE="${1:-}"
[[ -n "$SERVICE" ]] || { echo "Usage: $0 <AI service name>"; exit 2; }

build_base() {
  local image="$1" dockerfile="$2" base_image="${3:-}"
  if docker image inspect "$image:latest" >/dev/null 2>&1; then return; fi
  echo "Building staging base image $image"
  local -a args=(docker build --pull -f "python-ai/staging-base-images/$dockerfile" -t "$image:latest")
  if [[ -n "$base_image" ]]; then
    args+=(--build-context "$base_image=docker-image://$base_image:latest")
  fi
  args+=(.)
  "${args[@]}"
}
build_core() { build_base python-ai-core Dockerfile.core; }
build_ml_lite() { build_core; build_base python-ai-ml-lite Dockerfile.ml-lite python-ai-core; }
build_nlp() { build_core; build_base python-ai-nlp Dockerfile.nlp python-ai-core; }
build_transformers() { build_core; build_base python-ai-transformers Dockerfile.transformers python-ai-core; }
build_tf() { build_core; build_base python-ai-tf Dockerfile.tf python-ai-core; }

case "$SERVICE" in
  ai_ops|ai_feedback|ai_monetization|ai_uplift|ai_seo_recommender|ai_aeo_tracker)
    build_ml_lite ;;
  ai_seo)
    build_ml_lite
    build_base python-ai-ml-prophet Dockerfile.ml-prophet python-ai-ml-lite ;;
  ai_assistant|personality)
    build_transformers ;;
  ai_backlink_quality|ai_moderation|ai_support|embedded_ai)
    build_nlp ;;
  ml_service)
    build_ml_lite
    build_base python-ai-ml-http Dockerfile.ml-http python-ai-ml-lite ;;
  ai_revenue)
    build_tf
    build_base python-ai-tf-panda Dockerfile.tf-panda python-ai-tf ;;
  ai_image|ai_verification)
    build_tf
    build_base python-ai-tf-pillow Dockerfile.tf-pillow python-ai-tf ;;
  *)
    echo "Unknown AI service: $SERVICE"; exit 2 ;;
esac
