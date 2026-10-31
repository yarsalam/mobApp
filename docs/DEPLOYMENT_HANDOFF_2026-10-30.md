# Yarsalam deployment handoff — 2026-10-30

## دو مسئلهٔ اصلی پروژه — اولویت ادامهٔ کار

در چت بعدی اول همین دو مورد را دنبال کن و از کاربر نخواه دوباره شرحشان دهد:

1. **دکمهٔ ورود پنل مدیریت کار نمی‌کند.** علت مشخص شد: `CustomButton` به `type="button"` تغییر کرده بود و فرم Login submit نمی‌شد. اصلاح login/register/set-password در admin-panel PR #30 با commit `734ef06b72bdd37899570defe339b4406efc40dc` ادغام شده؛ اما هنوز Image اصلاح‌شده روی VPS مستقر نشده است. admin-panel PR #31 برای Image standalone/runtime-only آماده شده و CI run #4 با شناسهٔ `41120657283` موفق بوده (Build، HTTP 200 برای `/login` و بررسی حذف Git metadata/docs از Image). تا انتشار Image و تعویض محدود `admin-web` و تست ورود واقعی Production، این مشکل باز است.
2. **سرویس `ai_assistant` در Matching خطا می‌دهد.** Image قبلی به‌دلیل `ModuleNotFoundError: No module named 'pandas'` از کار می‌افتاد. ai-packs PR #4 با pin کردن `pandas==2.2.3` اصلاح شده؛ CI run #83 با شناسهٔ `41119988887` موفق است و فقط Image `ai_assistant` را build/import-test کرده است. Image هنوز در GHCR منتشر و روی VPS مستقر نشده است. اقدام بعدی فقط انتشار و جایگزینی Image همین سرویس است. SEO، Safety، Revenue و چهار سرویس سالم دیگر Matching نباید دوباره Build یا تعویض شوند.

## سه تصمیم قطعی معماری

1. سورس، تست‌ها، مستندات و فایل‌های توسعه فقط در GitHub می‌مانند.
2. VPS فقط Imageهای Runtime نهایی، فایل‌های ضروری اجرای Production مانند Compose و تنظیمات، Secrets خصوصی و داده‌های پایدار/volumeهای لازم را نگه می‌دارد.
3. هیچ Build سورسی روی VPS انجام نمی‌شود؛ Build در GitHub Actions یا محیط مستقل خارج از VPS انجام می‌شود و فقط Image نهایی منتقل یا از Registry دریافت می‌شود.

این سه تصمیم ثابت‌اند؛ دستور یا پیشنهادی که آن‌ها را نقض کند اجرا نشود.

## Absolute deployment rule
Source, tests, docs, Dockerfiles, build scripts, Git checkout and build contexts remain in GitHub/CI. VPS receives only immutable runtime images, minimal runtime Compose, private env/secrets, persistent user data and model volumes. No build or source checkout on VPS.

## Four standalone AI Packs
Repository: https://github.com/yarsalam/ai-packs
Current packaging branch: feat/safety-ghcr-deployment
Repair branch: fix/matching-ai-assistant-runtime-image
- User confirmed all four pack builds were positive except ai_assistant.
- Previous assistant image sha-9f114ff40fa4d628c8c0a8fa0f62032b09276d8e failed with ModuleNotFoundError: No module named 'pandas' in core/behavior.py.
- Builder now pins pandas==2.2.3 for assistant.
- PR #4 https://github.com/yarsalam/ai-packs/pull/4, base feat/safety-ghcr-deployment: isolated assistant image build/tests/publisher, one-service Compose override and runtime filtering. Open/ready for review, not merged.
- PR #5 https://github.com/yarsalam/ai-packs/pull/5: merged in main at 52dcab1f9a876bba5e2dd060917a79296251ffea; harmless manual workflow registration stub only.
- Workflow run #77 ID 41118292374 SUCCESS: generated Matching distribution and Compose validation, built only assistant image; pandas, app, and analyze_behavior imports passed. All four Gateway licensing contract jobs passed.
- Workflow run #59 ID 41119988888 SUCCESS: all four standalone distributions, API contract checks, structure/Compose validation and Gateway images passed. GitHub Release attachment step skipped (not a failure).
- هیچ Image جدیدی به GHCR Push نشده و هیچ سرویس/volume روی VPS تغییر نکرده است. رفع ai_assistant هنوز در Production اعمال نشده است.
- Once approved/merged, run the manual publisher from branch fix/matching-ai-assistant-runtime-image. It builds/pushes only assistant with an immutable combined ai-packs/MobApp SHA tag. Then use deploy/compose/matching-ai-assistant-override.yaml and AI_ASSISTANT_IMAGE to update only assistant with --no-deps. Do not rebuild other Matching services or Packs.

## Admin panel
Repository: https://github.com/yarsalam/admin-panel
- Login fix PR #30 در `feat/production-deployment-memory` با commit `734ef06b72bdd37899570defe339b4406efc40dc` ادغام شده؛ login/register/set-password صریحاً `type=submit` دارند. این اصلاح هنوز روی VPS Deploy نشده است.
- Earlier TypeScript/lint/Turbopack errors came from testing wrong branch PR #29; do not attribute them to merged PR #30.
- Runtime-only PR #31 https://github.com/yarsalam/admin-panel/pull/31، شاخهٔ `feat/admin-runtime-only-image`، باز و نیازمند review/merge. Next standalone، multi-stage image، `next build --webpack`، Docker context filtering و Compose فقط Image؛ CI run #4 (ID `41120657283`) موفق شده: Build، اجرای کانتینر، GET /login با HTTP 200 و نبود Git metadata/docs.
- Registration PR #32 https://github.com/yarsalam/admin-panel/pull/32 merged into main at 38d59f2c77630768a3b13849e8fadea39a11790b; it only registers harmless workflow-dispatch stubs.
- CI اعتبارسنجی PR #31 موفق است، اما Image هنوز Push/Deploy نشده است. مشکل ورود Production تا جایگزینی admin-web باز می‌ماند.
- Existing admin project yarsalam-admin-prod-20261026; current admin web host binding 127.0.0.1:3000. Runtime Compose defines admin-web only. Do not recreate backend, MySQL, Redis, Nginx/proxy or user app.
- Publisher input requires the exact current production NEXT_PUBLIC_API_URL; read private env, do not guess.

## NestJS backend
Repository: https://github.com/yarsalam/mobApp
- Existing backend image workflow branch feat/ci-runtime-backend-image; PR #4 in mobApp uses multi-stage Node build, .dockerignore, Trivy scan, and publishes immutable ghcr.io/yarsalam/yarsalam-backend:sha-<commit> on main. It also pushes latest for convenience; production must use SHA.
- شاخهٔ `feat/backend-runtime-only-compose` فایل `docker-compose.runtime.yml` را با فقط Image سرویس backend، network خارجی موجود `yarsalam_network`، پورت loopback 5001 و bind mount موجود public-assets از طریق `PUBLIC_ASSETS_DIR` اضافه کرده است. DB، Redis، Qdrant یا Python service را تعریف/بازسازی نمی‌کند. اعتبارسنجی Compose در run #4 (ID `41120765566`) پس از اصلاح env-file موفق شده؛ Trivy همچنان مانع انتشار Image است.
- New docs/BACKEND_RUNTIME_DEPLOYMENT.md requires checking running container Compose labels and mounts before deploy; never guess project name or public-assets path.
- Actual VPS backend container is named backend and bound to 127.0.0.1:5001; user_mysql, redis_cache and yarsalam_network exist in saved server output. Exact Compose project label and public bind source must be read from live docker inspect before replacement.

## mobApp production Compose warning
Current main docker-compose.production.yml still extends development Compose and inherits multiple build: definitions for Node/Python services. Do not use up --build on VPS. Use standalone Pack Compose files and backend-only runtime Compose. Never run down -v, docker volume prune, or docker system prune --volumes.

## Next steps
1. Review/merge AI Packs PR #4 and registration PR #5 after CI/source review; manually run isolated publisher with pinned MobApp SHA, then publish only assistant. Request explicit approval before replacing that one VPS container.
2. After the latest RiskPanel client-boundary commit is validated, review/merge admin PR #31. Confirm GET /login HTTP 200; only then manual immutable image publisher. Exact production API URL must come from private env. Deploy only admin-web after explicit approval.
3. Review mobApp backend runtime Compose PR and existing image workflow PR; inspect live Compose labels/mounts and confirm public-data source before backend-only replacement.
4. Update handoff with merged commit SHAs, CI run IDs, immutable image tags/digests and actual VPS status before moving to a new chat.

## Safety / not yet done
No manual publish workflow triggered, no new GHCR image confirmed published, no deployment run, no live VPS container/persistent volume changed, no existing source checkout deleted. ai-packs PR #4, admin-panel PR #31 and mobApp PR #8 remain open; ai-packs PR #5 and admin-panel PR #32 are merged. All live deploy actions require separate explicit confirmation.