#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env.staging"
[[ -s "$ENV_FILE" ]] || { echo "Missing .env.staging; run scripts/staging/bootstrap.sh"; exit 2; }
COMPOSE=(docker compose --env-file "$ENV_FILE" -p yarsalam-staging
  -f docker-compose.yml
  -f docker-compose.production.yml
  -f docker-compose.staging.yml)
command="${1:-}"
service="${2:-}"
profile_for() {
  case "$1" in
    ai_ops) echo ai-ops ;;
    ai_feedback) echo ai-feedback ;;
    ai_seo) echo ai-seo ;;
    ai_monetization) echo ai-monetization ;;
    ai_revenue) echo ai-revenue ;;
    ai_assistant) echo ai-assistant ;;
    ai_moderation) echo ai-moderation ;;
    ai_verification) echo ai-verification ;;
    embedded_ai) echo ai-embedding ;;
    ml_service) echo ai-matching ;;
    ai_uplift) echo ai-uplift ;;
    ai_backlink_quality) echo ai-backlink-quality ;;
    ai_seo_recommender) echo ai-seo-recommender ;;
    personality) echo ai-personality ;;
    ai_image) echo ai-image ;;
    ai_support) echo ai-support ;;
    aeo_tracker) echo ai-aeo ;;
    *) echo "Unknown AI service: $1" >&2; return 2 ;;
  esac
}
case "$command" in
  validate)
    docker compose version
    "${COMPOSE[@]}" config --quiet
    echo "Staging Compose config is valid."
    ;;
  base-up)
    "${COMPOSE[@]}" up -d --build redis user-mysql qdrant backend
    "${COMPOSE[@]}" ps redis user-mysql qdrant backend
    ;;
  base-stop)
    "${COMPOSE[@]}" stop backend qdrant user-mysql redis
    ;;
  ai-up)
    [[ -n "$service" ]] || { echo "Usage: $0 ai-up <service>"; exit 2; }
    profile="$(profile_for "$service")"
    bash scripts/staging/build-ai-base.sh "$service"
    "${COMPOSE[@]}" --profile "$profile" up -d --build "$service"
    "${COMPOSE[@]}" --profile "$profile" ps "$service"
    ;;
  ai-stop)
    [[ -n "$service" ]] || { echo "Usage: $0 ai-stop <service>"; exit 2; }
    profile="$(profile_for "$service")"
    "${COMPOSE[@]}" --profile "$profile" stop "$service"
    ;;
  ai-restart)
    [[ -n "$service" ]] || { echo "Usage: $0 ai-restart <service>"; exit 2; }
    profile="$(profile_for "$service")"
    "${COMPOSE[@]}" --profile "$profile" restart "$service"
    ;;
  ai-logs)
    [[ -n "$service" ]] || { echo "Usage: $0 ai-logs <service>"; exit 2; }
    profile="$(profile_for "$service")"
    "${COMPOSE[@]}" --profile "$profile" logs --tail=100 -f "$service"
    ;;
  ai-status)
    [[ -n "$service" ]] || { echo "Usage: $0 ai-status <service>"; exit 2; }
    profile="$(profile_for "$service")"
    "${COMPOSE[@]}" --profile "$profile" ps "$service"
    ;;
  status)
    "${COMPOSE[@]}" ps -a
    ;;
  *)
    cat <<'USAGE'
Usage:
  scripts/staging/ai-service.sh validate
  scripts/staging/ai-service.sh base-up
  scripts/staging/ai-service.sh base-stop
  scripts/staging/ai-service.sh ai-up <service>
  scripts/staging/ai-service.sh ai-stop <service>
  scripts/staging/ai-service.sh ai-restart <service>
  scripts/staging/ai-service.sh ai-logs <service>
  scripts/staging/ai-service.sh ai-status <service>
  scripts/staging/ai-service.sh status
USAGE
    exit 2
    ;;
esac
