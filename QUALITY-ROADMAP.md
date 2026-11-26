# Yarsalam — Quality & End-to-End Test Roadmap

## هدف و محدوده

هدف، ارزیابی قابل اتکای سلامت و آمادگی انتشار کل سامانه یارسلام است؛ نه صرفاً سبز شدن تست‌ها. محدوده شامل سه مخزن زیر است:

- **Backend:** [yarsalam/mobApp](https://github.com/yarsalam/mobApp) — NestJS، سرویس‌های Python/AI، پایگاه‌داده‌ها، صف‌ها و زیرساخت مرتبط
- **Mobile:** [yarsalam/mobile](https://github.com/yarsalam/mobile) — اپلیکیشن React Native CLI
- **Admin:** [yarsalam/admin-panel](https://github.com/yarsalam/admin-panel) — پنل مدیریت Next.js و APIهای مدیریتی NestJS

## اصول و تصمیم‌های ثابت

1. ابتدا وضعیت واقعی کد، معماری، تست‌ها و قراردادهای موجود را کشف می‌کنیم؛ قبل از شناخت سیستم، تست یا ابزار جدید انبوه نمی‌سازیم.
2. تست‌های موجود و ابزارهای فعلی هر مخزن در اولویت‌اند. ابزار تازه فقط وقتی اضافه می‌شود که شکاف مشخصی را پوشش دهد.
3. ممیزی باید read-only باشد، مگر آنکه برای اصلاح یا تغییر مشخصی مجوز جداگانه داده شود.
4. مسیرها، متدها، وابستگی‌ها و پوشش تست را حدس نمی‌زنیم. هر یافته با یکی از وضعیت‌های **تأییدشده از کد**، **استنباط‌شده** یا **بررسی‌نشده** مشخص می‌شود.
5. سلامت یک سرویس به‌تنهایی اثبات‌کننده سلامت جریان انتها‌به‌انتهای کاربر نیست؛ هر دو سطح باید بررسی شوند.
6. ارزیابی AI باید علاوه بر بالا بودن سرویس، قرارداد ورودی/خروجی، خطاها، ایمنی و کیفیت خروجی را با معیار و نمونه‌های قابل تکرار بسنجد. ادعای آموزش یا کیفیت مدل بدون شواهد انجام نمی‌شود.
7. آزمون‌ها باید تا حد امکان روی محیط کنترل‌شده و دادهٔ غیرواقعی/غیرحساس اجرا شوند؛ عملیات مخرب یا پرداخت واقعی بدون مجوز و محیط مناسب انجام نمی‌شود.
8. در عیب‌یابی build و شبکه، دسترسی شبکه و مخازن وابستگی را زود بررسی می‌کنیم و از تغییر نسخه‌ها بدون شواهد پرهیز می‌کنیم.

## فازها و ترتیب اجرا

| فاز | شرح | وضعیت |
|---|---|---|
| 1. Discovery | نقشهٔ سه مخزن، ماژول‌ها، سرویس‌ها، تست‌ها و نقاط اتصال | انجام‌شدهٔ اولیه؛ نیازمند تکمیل |
| 2. API & Contract Mapping | استخراج دقیق routeها و متدها؛ تطبیق مصرف‌کننده‌های Mobile و Admin با Backend؛ ثبت شکاف‌ها | **در حال انجام** |
| 3. Infrastructure & Integration Health | بررسی تنظیمات محیط، اتصال DB/Redis/Qdrant، صف‌ها، شبکه و health/readiness | باقی‌مانده |
| 4. Backend Verification | اجرای تست‌های موجود و بررسی APIها، مجوزها، اعتبارسنجی و خطاها | باقی‌مانده |
| 5. Mobile & Admin Journeys | آزمون جریان‌های واقعی کاربر و مدیر از UI تا Backend | باقی‌مانده |
| 6. AI/ML Evaluation | بررسی سرویس‌ها و قراردادها، سنجش کیفیت/ایمنی و قابلیت تکرار نتایج | باقی‌مانده |
| 7. Regression & Release Readiness | رفع اشکال‌های اولویت‌دار، رگرسیون و گزارش آمادگی انتشار | باقی‌مانده |

## وضعیت فعلی و شواهد اولیه

- ساختار هر سه مخزن و دسته‌های اصلی ماژول‌ها/صفحات/سرویس‌ها در بررسی اولیه شناسایی شده است.
- در Backend، ماژول‌های اصلی NestJS و مجموعه‌ای از سرویس‌های Python/AI و تست‌های موجود شناسایی شده‌اند.
- در Mobile، گروه‌های API، صفحات اصلی و تست‌های موجود شناسایی شده‌اند.
- در Admin، گروه‌های API و صفحات مدیریتی و اتصال پیکربندی‌شده به Backend اصلی شناسایی شده‌اند.
- این شناسایی ساختاری به معنی اجرای موفق تست‌ها، سالم بودن endpointها یا تأیید اتصال runtime نیست.
- استخراج دقیق تمام decoratorهای route و تطبیق endpoint به endpoint هنوز تکمیل نشده است.
- هیچ تستی در این ممیزی به‌عنوان اجراشده یا موفق گزارش نمی‌شود، مگر پس از اجرای واقعی و ثبت خروجی.

## آخرین نقطهٔ توقف

ممیزی ساختاری اولیهٔ سه مخزن انجام شده است. مرحلهٔ بعد، استخراج routeهای واقعی از controllerهای Backend و سپس تطبیق آن‌ها با فراخوانی‌های API در Mobile و Admin است. در استخراج باید prefix سطح Controller و decoratorهای متد، پارامترها و guardها لحاظ شوند؛ مسیرها از نام فایل حدس زده نمی‌شوند.

## اقدام بعدی

1. خواندن دسته‌ای و هدفمند controllerهای Backend و ثبت Controller | Method | Route | Auth/Guard | Module | Dependencies | Test.
2. خواندن فایل‌های API موبایل و تطبیق مسیر/متد/پارامترها با routeهای تأییدشده.
3. تطبیق APIهای Admin با controllerهای مدیریتی و Backend اصلی.
4. ثبت موارد منطبق، ناسازگار و بررسی‌نشده؛ سپس به‌روزرسانی همین مانیفست با پیشرفت واقعی.

**مرجع اصلی ادامهٔ کار:** همین فایل در مخزن Backend. پس از هر مرحله، وضعیت و نقطهٔ توقف آن به‌روزرسانی می‌شود.

## یافته‌های مرحلهٔ جاری — API Mapping (نمونهٔ اولیه)

### Backend routeهای خوانده‌شده

- `AuthController` با prefix برابر `/auth`: ثبت‌نام مرحلهٔ اول، تکمیل پروفایل، login/logout، me، تغییر رمز، وضعیت ثبت‌نام موبایل، تکمیل verification و sim-login محیط توسعه/تست. Guardها متدبه‌متد اعمال شده‌اند؛ `completeProfile` از `TemporaryOnlyGuard` استفاده می‌کند.
- `WhatsAppController` با prefix `/auth/register/whatsapp`: مسیرهای `POST save-otp`، `POST webhook`، `POST verify` و `POST fallback-verify`.
- `TelegramController` با prefix `/telegram/webhook`: `POST /telegram/webhook` و `POST /telegram/webhook/verify`.
- `UsersController` با prefix `/users`: مسیرهای create، all، update، filter، filter/count، explore، recent-similar، profile/:id و suspend/resign (هم مسیرهای me و هم legacy id-based).
- `SuggestionController` با prefix `/suggestions` و Guard سطح Controller: `GET /suggestions` و `POST /suggestions/accept-suggestion`.
- `MessageController` با prefix `/messages` و Guard سطح Controller: ارسال، inbox/sent، read، حذف inbox/sent، grouped inbox/sent، conversation، edit، report، unread-count، delete all/single/conversation و read-all.
- `PaymentsController` با prefix `/payments`: wallet، deposit/card، deposit/crypto، buy/:bundleCode، proof و عملیات admin confirm/reject/grant-bundle. در این Controller مسیرهای کاربر JWT و مسیرهای مدیریتی AdminApiGuard دارند.

### تطبیق اولیه با Mobile

- **تأییدشده و منطبق در کد:** ثبت‌نام `/auth/register/step1`؛ ذخیره و تأیید WhatsApp؛ تکمیل verification؛ Telegram verify؛ login/me/logout و completeProfile؛ دریافت suggestions؛ پیام‌رسانی و عملیات خوانده‌شدهٔ messages؛ کیف پول و شارژ کارت/کریپتو و ارسال proof؛ دریافت پروفایل `/users/profile/:id`.
- `src/api/queries/messages.ts` از GET `/messages/conversation/:targetId` استفاده می‌کند و Backend همین GET را دارد. مسیرهای POST/PATCH/DELETE مشاهده‌شده نیز با decoratorهای Backend منطبق‌اند.
- `src/api/queries/payments.ts`، `src/api/queries/useWallet.ts` و Controller پرداخت از نظر مسیر و متدهای بررسی‌شده هم‌خوان هستند.
- این تطبیق فقط برای فایل‌ها و مسیرهای خوانده‌شده است؛ هنوز تطبیق کامل همهٔ APIهای Mobile انجام نشده و اجرای runtime انجام نشده است.

### تطبیق اولیه با Admin

- Admin پنل یک NestJS server جداگانه در `apps/server` دارد که به‌صورت پیش‌فرض روی پورت 4000 گوش می‌دهد؛ frontend API client نیز به‌صورت پیش‌فرض `http://localhost:4000` را target می‌کند، مگر `NEXT_PUBLIC_API_URL` تنظیم شده باشد.
- مسیرهای frontend برای tickets، reports و moderation با Controllerهای `SafetyModule` خوانده‌شده از نظر path/method منطبق‌اند.
- Controllerهای Admin از Guard داخلی JWT پنل استفاده می‌کنند؛ این مسیرها را نباید با `AdminApiGuard` موجود در Backend اصلی یکی فرض کرد.
- `SafetyModule`، `UserApiClientModule` را import می‌کند؛ جزئیات مقصد، احراز هویت و قرارداد ارتباط آن با Backend اصلی هنوز بررسی نشده است.

### موارد نیازمند بررسی بیشتر

- مسیرها و متدهای تمام Controllerهای Backend هنوز استخراج نشده‌اند.
- تمام فایل‌های API موبایل و همهٔ گروه‌های API پنل Admin هنوز تطبیق داده نشده‌اند.
- رفتار و تنظیمات `UserApiClientModule` و endpointهای Backend که Admin server به آن‌ها متصل می‌شود باید بررسی شوند.
- وابستگی‌های دقیق سرویس‌ها، queueها، guardها و تست متناظر هر route هنوز کامل نشده‌اند.
- هیچ‌یک از این یافته‌ها به معنی سالم بودن runtime یا موفقیت تست نیست.

## آخرین نقطهٔ توقف — به‌روزرسانی

شش Controller اصلی Backend به‌علاوهٔ WhatsApp و Telegram خوانده شدند؛ بخشی از APIهای Mobile و مسیرهای Safety در Admin نیز با آن‌ها تطبیق داده شدند. تطبیق اولیهٔ Auth، Messages، Suggestions و Payments در Mobile مثبت است. Admin دارای API server مستقل است و ارتباط Safety آن با Backend اصلی هنوز نیازمند بررسی است.

## اقدام بعدی — به‌روزرسانی

1. ادامهٔ استخراج Controllerهای باقی‌ماندهٔ Backend به‌صورت دسته‌های کوچک و ثبت guard/dependency/test.
2. بررسی `UserApiClientModule` در Admin و تطبیق endpointهای مورد استفاده با Backend اصلی.
3. ادامهٔ تطبیق APIهای Mobile و Admin، با تمرکز بر مسیرهای دارای اختلاف احتمالی.
4. پس از تکمیل inventory، ساخت ماتریس نهایی و سپس اجرای تست‌های موجود.