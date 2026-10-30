# Yarsalam deployment handoff — 2026-10-30

## Absolute deployment rule
Source, tests, docs, Dockerfiles, build scripts, Git checkout and build contexts remain in GitHub/CI. VPS receives only immutable runtime images, minimal runtime Compose, private env/secrets, persistent user data and model volumes. No build or source checkout on VPS.

## Four standalone AI Packs
Repository: https://github.com/yarsalam/ai-packs
Current packaging branch: feat/safety-ghcr-deployment
Repair branch: fix/matching-ai-assistant-runtime-image
- User confirmed all four pack builds were positive except ai_assistant.
- Previous assistant image sha-9f114ff40fa4d628c8c0a8fa0f62032b09276d8e failed with ModuleNotFoundError: No module named 'pandas' in core/behavior.py.
- Builder now pins pandas==2.2.3 for assistant.
- PR #4 https://github.com/yarsalam/ai-packs/pull/4, base feat/safety-ghcr-deployment: isolated assistant image build/tests/publisher, one-service Compose override, Python runtime filtering and handoff. Draft/open.
- PR #5 https://github.com/yarsalam/ai-packs/pull/5, base main: harmless manual workflow registration stub. Draft/open.
- Workflow run #77 ID 41118292374 SUCCESS: generated Matching distribution and Compose validation, built only assistant image; pandas, app, and analyze_behavior imports passed. All four Gateway licensing contract jobs passed.
- Workflow run #53 ID 41118292186 SUCCESS: all four standalone distributions, API contract checks, structure/Compose validation and Gateway images passed. GitHub Release attachment step skipped (not a failure).
- No image was pushed to GHCR and no VPS service/volume changed.
- Once approved/merged, run the manual publisher from branch fix/matching-ai-assistant-runtime-image. It builds/pushes only assistant with an immutable combined ai-packs/MobApp SHA tag. Then use deploy/compose/matching-ai-assistant-override.yaml and AI_ASSISTANT_IMAGE to update only assistant with --no-deps. Do not rebuild other Matching services or Packs.

## Admin panel
Repository: https://github.com/yarsalam/admin-panel
- Login fix PR #30 merged on feat/production-deployment-memory at 734ef06b72bdd37899570defe339b4406efc40dc; explicit type=submit on login/register/set-password.
- Earlier TypeScript/lint/Turbopack errors came from testing wrong branch PR #29; do not attribute them to merged PR #30.
- Runtime-only PR #31 https://github.com/yarsalam/admin-panel/pull/31, branch feat/admin-runtime-only-image, base feat/production-deployment-memory, draft/open. Enables Next standalone, multi-stage image, next build --webpack, Docker context filtering, image-only runtime Compose project yarsalam-admin-prod-20261026 on loopback port 3000, validation and publisher workflows.
- Registration PR #32 https://github.com/yarsalam/admin-panel/pull/32, branch chore/register-admin-web-publisher, base main, draft/open. Contains harmless workflow-dispatch stubs for validation and publishing.
- No admin runtime-image CI run, GHCR publish, or VPS deployment yet. After PR #32 is merged, manually run validation from branch feat/admin-runtime-only-image.
- Existing admin project yarsalam-admin-prod-20261026; current admin web host binding 127.0.0.1:3000. Runtime Compose defines admin-web only. Do not recreate backend, MySQL, Redis, Nginx/proxy or user app.
- Publisher input requires the exact current production NEXT_PUBLIC_API_URL; read private env, do not guess.

## NestJS backend
Repository: https://github.com/yarsalam/mobApp
- Existing backend image workflow branch feat/ci-runtime-backend-image; PR #4 in mobApp uses multi-stage Node build, .dockerignore, Trivy scan, and publishes immutable ghcr.io/yarsalam/yarsalam-backend:sha-<commit> on main. It also pushes latest for convenience; production must use SHA.
- New branch feat/backend-runtime-only-compose adds docker-compose.runtime.yml with only the backend Image, external existing yarsalam_network, loopback port 5001 and existing public-assets bind mount via explicit PUBLIC_ASSETS_DIR. It does not define/recreate DB, Redis, Qdrant or Python services.
- New docs/BACKEND_RUNTIME_DEPLOYMENT.md requires checking running container Compose labels and mounts before deploy; never guess project name or public-assets path.
- Actual VPS backend container is named backend and bound to 127.0.0.1:5001; user_mysql, redis_cache and yarsalam_network exist in saved server output. Exact Compose project label and public bind source must be read from live docker inspect before replacement.

## mobApp production Compose warning
Current main docker-compose.production.yml still extends development Compose and inherits multiple build: definitions for Node/Python services. Do not use up --build on VPS. Use standalone Pack Compose files and backend-only runtime Compose. Never run down -v, docker volume prune, or docker system prune --volumes.

## Next steps
1. Review/merge AI Packs PR #4 and registration PR #5 after CI/source review; manually run isolated publisher with pinned MobApp SHA, then publish only assistant. Request explicit approval before replacing that one VPS container.
2. Validate admin PR #31 on Actions branch feat/admin-runtime-only-image after PR #32 registration is merged. Confirm GET /login HTTP 200; only then manual immutable image publisher. Exact production API URL must come from private env. Deploy only admin-web after explicit approval.
3. Review mobApp backend runtime Compose PR and existing image workflow PR; inspect live Compose labels/mounts and confirm public-data source before backend-only replacement.
4. Update handoff with merged commit SHAs, CI run IDs, immutable image tags/digests and actual VPS status before moving to a new chat.

## Safety / not yet done
No manual publish workflow triggered, no new GHCR image confirmed published, no deployment run, no live VPS container/persistent volume changed, no existing source checkout deleted. Draft PRs remain unmerged. All live deploy actions require separate explicit confirmation.