# استقرار مرحله‌ای یارسلام روی VPS هشت‌گیگابایتی

## چرا استقرار مرحله‌ای؟

فایل Compose توسعه بیش از ۲۰ سرویس دارد. چند سرویس AI به‌تنهایی محدودیت حافظهٔ ۱ تا ۲ گیگابایت دارند و تعدادی از سرویس‌ها محدودیت حافظه نداشتند. اجرای همهٔ آن‌ها هم‌زمان روی VPS با ۸GB RAM خطر فشار حافظه، کندی و OOM دارد.

در overlay تولیدی، سرویس‌های اختیاری AI و WhatsApp به profileهای جداگانه منتقل شده‌اند. بنابراین اجرای عادی فقط سرویس‌های بدون profile را بالا می‌آورد؛ API، MySQL و Redis ابتدا تست می‌شوند و هر سرویس AI بعداً جداگانه فعال می‌شود. قابلیت‌های وابسته به سرویس خاموش، تا زمان فعال‌سازی آن سرویس در دسترس نخواهند بود.

## ۱. پیش از اولین اجرا

- از فایل .env.production.example یک فایل محلی .env.production بسازید و همهٔ مقادیر REPLACE_ را با مقادیر تازه جایگزین کنید.
- فایل .env.production را commit نکنید؛ باید در .gitignore بماند.
- مطمئن شوید DNS و TLS برای api.yarsalam.top به مقصد صحیح اشاره می‌کنند؛ تا آن زمان API را عمومی اعلام نکنید.
- اگر volume یا دیتابیس قبلی وجود دارد، قبل از هر تغییر از آن backup بگیرید.
- Compose نسخهٔ 2.24.4 یا جدیدتر لازم است.

## ۲. اعتبارسنجی و راه‌اندازی هسته

از مسیر مخزن mobApp اجرا کنید:

    cp .env.production.example .env.production
    chmod 600 .env.production
    # ابتدا فایل را به‌صورت محلی ویرایش کنید و همه placeholderها را جایگزین کنید.
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml config --quiet
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml up -d --build redis user-mysql backend
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml ps
    curl -i http://127.0.0.1:5001/
    docker stats --no-stream
    free -h
    df -h

ممکن است مسیر ریشهٔ API پاسخ 404 بدهد؛ در این صورت از health endpoint واقعی پروژه استفاده کنید. مهم است که کانتینر سالم باشد و اتصال API به MySQL و Redis بررسی شود.

## ۳. راه‌اندازی پنل ادمین

پس از اینکه شبکهٔ Docker با نام yarsalam_network و سرویس backend ایجاد شدند، از مخزن admin-panel:

- یک فایل .env محلی بسازید و مقادیر را فقط در همان فایل وارد کنید.
- ADMIN_WEB_ORIGINS=https://novertex.ir
- NEXT_PUBLIC_API_URL=https://novertex.ir/api
- USER_API_BASE_URL=http://backend:5000
- مقدار USER_API_KEY باید با INTERNAL_API_KEY در .env.production بک‌اند برابر باشد؛ هر دو را به‌صورت امن و محلی تنظیم کنید، نه در Git.
- ADMIN_DB_ROOT_PASSWORD، ADMIN_DB_PASSWORD، JWT_SECRET و رمز اولیهٔ مدیر باید یکتا باشند.

سپس اعتبارسنجی کنید:

    docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml config --quiet
    docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml up -d --build admin-mysql admin-redis admin-backend admin-web
    docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml ps

Nginx روی host باید مسیر / را به 127.0.0.1:3000 و مسیر /api/ را به 127.0.0.1:4000/ بفرستد و پیشوند /api/ را حذف کند. فقط پورت‌های 80/443 و SSH محدودشده باید از بیرون قابل دسترسی باشند.

## ۴. فعال‌سازی یک سرویس AI در هر نوبت

ابتدا حافظهٔ هسته و پنل را اندازه بگیرید. سپس فقط یک profile را فعال کنید؛ مثال:

    docker compose --profile ai-assistant --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml up -d --build ai_assistant
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml ps
    docker stats --no-stream
    docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml logs --tail=100 ai_assistant

برای سرویس‌های دیگر نام profile از روی نام سرویس مشخص است: ai-moderation، ai-verification، ai-image، ai-personality، ml-service، ai-vector، ai-seo و مانند آن. profileها را یکی‌یکی فعال کنید؛ همه را هم‌زمان فعال نکنید مگر پس از اندازه‌گیری واقعی RAM و CPU. بعضی قابلیت‌ها ممکن است به سرویس‌های دیگر نیز وابسته باشند؛ وابستگی هر سرویس را از log و کد آن بررسی کنید.

## ۵. معیارهای پذیرش اولیه

- docker compose ps نشان دهد سرویس‌های هسته سالم‌اند.
- API از طریق loopback پاسخ دهد و ثبت‌نام/ورود آزمایشی در اپ کار کند.
- دیتابیس پس از recreate کانتینر داده‌اش را حفظ کند.
- هیچ پورت MySQL، Redis، Qdrant، phpMyAdmin یا AI به اینترنت عمومی منتشر نشده باشد.
- بعد از هر سرویس اختیاری، مصرف حافظه و لاگ‌ها ثبت شوند؛ در صورت فشار حافظه، سرویس آخر را متوقف کنید و مرحله‌ای جلو بروید.
- قبل از اتصال کاربران واقعی، backup مستقل و آزمایش restore انجام شود.

این راهنما برنامهٔ استقرار مرحله‌ای است، نه گواهی موفقیت؛ تا زمانی که Compose روی VPS واقعی اجرا و smoke test انجام نشده، استقرار تأییدشده محسوب نمی‌شود.
