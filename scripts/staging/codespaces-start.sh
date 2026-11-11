#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -s .env.staging ]]; then
  bash scripts/staging/bootstrap.sh
fi

bash scripts/staging/ai-service.sh validate
bash scripts/staging/ai-service.sh base-up
bash scripts/staging/ai-service.sh ai-up ai_ops

for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:18025/health >/dev/null; then
    echo "Yarsalam staging API and AI Ops are ready."
    exit 0
  fi
  sleep 2
done

echo "AI Ops health check failed. Diagnostic commands:" >&2
echo "  bash scripts/staging/ai-service.sh status" >&2
echo "  bash scripts/staging/ai-service.sh ai-logs ai_ops" >&2
exit 1
