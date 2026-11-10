#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env.staging"
if [[ -e "$ENV_FILE" ]]; then
  echo "Refusing to overwrite existing .env.staging. Preserve the database credentials."
  exit 2
fi
command -v openssl >/dev/null || { echo "openssl is required"; exit 2; }
umask 077
JWT_SECRET="$(openssl rand -hex 32)"
INTERNAL_API_KEY="$(openssl rand -hex 32)"
DEVICE_SECRET="$(openssl rand -hex 32)"
MYSQL_ROOT_PASSWORD="$(openssl rand -hex 24)"
MYSQL_PASSWORD="$(openssl rand -hex 24)"
cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=5000
JWT_SECRET=$JWT_SECRET
INTERNAL_API_KEY=$INTERNAL_API_KEY
DEVICE_SECRET=$DEVICE_SECRET
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
MYSQL_DATABASE=yarsalam_staging
MYSQL_USER=appuser
MYSQL_PASSWORD=$MYSQL_PASSWORD
DB_SYNC=false
DB_POOL_SIZE=10
REDIS_HOST=redis
REDIS_PORT=6379
CORS_ORIGINS=http://localhost:3000
FRONTEND_URL=http://localhost:3000
APP_URL=http://localhost:5001
AI_ASSISTANT_URL=http://ai_assistant:8022
AI_MODERATION_URL=http://ai_moderation:8018
AI_SUPPORT_URL=http://ai_support:8016
AEO_TRACKER_URL=http://aeo_tracker:8030
PERSONALITY_AI_URL=http://personality:8100
FACE_VERIFICATION_URL=http://ai_verification:8017
PYTHON_AI_URL=http://ml_service:8000
EMBEDDING_SERVICE_URL=http://embedded_ai:8100
CARD_TRANSFER_NUMBER=
CARD_TRANSFER_HOLDER=STAGING ONLY
CRYPTO_WALLET_TRC20=
CMS_API_URL=
RECAPTCHA_SECRET_KEY=
TELEGRAM_BOT_TOKEN=
GOOGLE_API_KEY=
SERPAPI_KEY=
MOZ_ACCESS_ID=
MOZ_SECRET_KEY=
BACKLINK_API_KEY=
SEMRUSH_API_KEY=
ENV
chmod 600 "$ENV_FILE"
echo "Created private staging secrets. No production credentials or user data were copied."
echo "Next: bash scripts/staging/ai-service.sh base-up"
