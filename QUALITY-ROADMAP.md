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
## یافته‌های بررسی ارتباط Admin Server ↔ Backend اصلی

### معماری و پیکربندی — تأییدشده از کد

- `UserApiClientModule` ثبت و export می‌کند `UserApiClientService` را؛ این سرویس در زمان ساخت، `USER_API_BASE_URL` و `USER_API_KEY` را با `getOrThrow` می‌خواند. نبود هرکدام باعث خطای startup در هر ماژولی می‌شود که این سرویس را inject کند.
- `docker-compose.yml` پنل، `USER_API_BASE_URL=http://backend:5000` و `USER_API_KEY=your-super-secret-key` را تنظیم می‌کند.
- شبکهٔ Compose پنل external با نام `yarsalam_network` است؛ شبکهٔ Compose Backend نیز با نام واقعی `yarsalam_network` ساخته می‌شود. نام DNS سرویس Backend در شبکه `backend` است؛ بنابراین URL تنظیم‌شده از نظر نام سرویس/پورت با Compose Backend سازگار است، مشروط به اینکه هر دو stack به همان شبکه متصل باشند.
- کلاینت هدر `x-api-key` را می‌فرستد. `AdminApiGuard` در Backend مقدار این هدر را با `process.env.INTERNAL_API_KEY` مقایسه می‌کند. پس مقدار `USER_API_KEY` در Admin باید دقیقاً با `INTERNAL_API_KEY` در محیط Backend برابر باشد. فایل `.env` واقعی Backend در این ممیزی خوانده نشده و برابری مقدار runtime هنوز تأیید نشده است.

### تطبیق endpointهای Safety — تأییدشده از کد

| جریان Admin | مسیر upstream ارسال‌شده | مسیر Backend | نتیجهٔ بررسی کد |
|---|---|---|---|
| اطلاعات پایه/تصاویر/فعالیت/مالی/گزارش‌ها/لاگ moderation/AI advice کاربر | `/admin-api/safety/users/:id/...` | همین prefix و routeها در `SafetyUsersController` | منطبق برای مسیرهای خوانده‌شده |
| Trust/devices/phones/personality/badges/metrics/notifications/relations/images actions | `/admin-api/safety/users/:id/...` | همین prefix و routeها در `SafetyUserDetailController` | منطبق برای مسیرهای خوانده‌شده |
| فهرست/جزئیات/تحلیل/resolve تیکت | `/admin-api/safety/tickets...` | `SafetyTicketsController` | منطبق |
| افزودن پیام تیکت | `/admin-api/safety/tickets/:id/messages` | `POST :id/messages` | منطبق |
| تحلیل مجدد تیکت | همان `/messages` از Admin service | Backend همچنین `POST :id/re-analyze` دارد؛ هر دو در Backend به `TicketService.addMessage` ختم می‌شوند | مسیر مستقیم متفاوت است، ولی عملیات فعلی از endpoint پیام پشتیبانی استفاده می‌کند؛ نیازمند تست معنایی |
| عملیات moderation flagged/approve/reject | `/admin-api/safety/moderation/...` | `SafetyModerationController` | منطبق برای مسیرهای خوانده‌شده |
| گزارش‌ها: list/confirm/reject/block/unblock | `/reports...` | `SafetyReportsController` فقط زیر `/admin-api/safety/reports...` route دارد؛ جست‌وجوی کد برای `@Controller('reports')` نتیجه‌ای نداد | **ناسازگاری قطعی مسیر در source** |

### اشکال‌های مهم و ریسک‌ها

1. **ناسازگاری مسیر گزارش‌ها (High):** `apps/server/src/safety/services/reports.service.ts` درخواست‌ها را به `/reports` و `/reports/:id/...` می‌فرستد، اما Backend مسیرها را زیر `/admin-api/safety/reports` ثبت کرده است. در نتیجه فهرست گزارش‌ها در Admin به‌دلیل `.catch(() => [])` احتمالاً به‌صورت فهرست خالی نمایش داده می‌شود و عملیات confirm/reject/block/unblock احتمالاً خطای upstream می‌گیرند. این مورد از روی source تأیید شده؛ هنوز با اجرای runtime بازتولید نشده است.
2. **خطای upstream پنهان می‌شود (High):** چند متد خواندنی در `UsersService`، `TicketsService`، `ReportsService` و `UserDetailService` خطا را به `null` یا `[]` تبدیل می‌کنند. بنابراین قطعی شبکه، 401 ناشی از API key و 404 مسیر می‌تواند در UI شبیه «داده‌ای وجود ندارد» دیده شود. endpoint تجمیعی `get360` نیز با `Promise.allSettled` خطاهای هر بخش را به null تبدیل می‌کند.
3. **کلید داخلی باید هماهنگ باشد (High):** Compose Admin مقدار نمونهٔ `your-super-secret-key` دارد، درحالی‌که Backend از `INTERNAL_API_KEY` در `.env` استفاده می‌کند. مقدار واقعی `.env` قابل مشاهده نیست؛ باید برابری دقیق دو مقدار در محیط اجرا بررسی شود و کلید نمونه هرگز برای production استفاده نشود.
4. **Verification از مسیر متفاوت عبور می‌کند:** Admin `UsersService.verifyFace` مستقیماً به `AI_VERIFICATION_URL` (پیش‌فرض `http://ai_verification:8017`) درخواست می‌زند؛ endpoint متناظر Backend در `SafetyUsersController` فعلاً placeholder با پاسخ ثابت `verified:false` است. پس جریان فعلی Admin متکی به دسترسی مستقیم Admin container به سرویس Python است، نه آن endpoint Backend. این دو مسیر نباید با هم اشتباه گرفته شوند.
5. **گزارش‌گیری moderation دو منبع دارد:** `ModerationService.getModerationStats` مستقیماً `/stats` سرویس Python را می‌خواند، درحالی‌که Backend نیز endpoint `/admin-api/safety/moderation/stats` برای شمارش تصاویر دارد. لازم است مشخص شود UI دقیقاً کدام قرارداد/معنای آماری را انتظار دارد؛ فعلاً این را اختلاف قطعی نمی‌نامیم.

### نتیجهٔ این مرحله

- ارتباط شبکه‌ای و URL پایه در Compose از نظر نام شبکه، نام سرویس و پورت با تعریف دو Compose سازگار است؛ اما اتصال واقعی runtime آزمایش نشده است.
- قرارداد هدر API key در کد روشن است، اما برابری مقدار secrets در محیط واقعی بررسی نشده است.
- اکثر endpointهای Safety که خوانده شدند در مسیر Admin-to-Backend منطبق‌اند.
- یک ناسازگاری قطعی مسیر در Reports شناسایی شد و باید پیش از اعلام سلامت کامل Admin اصلاح و با تست integration پوشش داده شود.
- هیچ فایلی در کد اجرایی تغییر نکرده و هیچ تست runtime اجرا نشده است.

## آخرین نقطهٔ توقف — پس از بررسی UserApiClient

بررسی `UserApiClientService`، ماژول Safety، سرویس‌های Admin، Controllerهای Admin و Controllerهای متناظر Backend انجام شد. مهم‌ترین یافته، route mismatch در Reports است؛ ریسک دوم، پنهان‌سازی خطاهای upstream به‌صورت آرایه/مقدار خالی است. هماهنگی secret و اتصال واقعی Docker هنوز نیازمند بررسی محیط اجراست.

## اقدام بعدی

1. ابتدا ناسازگاری مسیر Reports را در سطح طراحی ثبت و با یک تست contract/integration قابل بازتولید کنیم؛ قبل از تغییر کد، دامنهٔ اثر همهٔ consumerهای `/reports` را بررسی کنیم.
2. مسیرهای frontend و Admin façade برای گزارش‌ها را کامل بررسی کنیم و سپس اصلاح هماهنگ دو طرف را فقط با مجوز کاربر انجام دهیم.
3. در محیط اجرا، بدون افشای مقدار secret، فقط وجود و برابری `USER_API_KEY` و `INTERNAL_API_KEY` و دسترسی DNS/HTTP از Admin container به Backend را بررسی کنیم.
4. برای خطاهای upstream، قرارداد پاسخ خطا/observability تعریف کنیم تا خطای اتصال با دادهٔ خالی اشتباه نشود.

## پیگیری اصلاح Reports — 2026-11-26

### اصلاح پیشنهادی اعمال‌شده در شاخهٔ Admin

- در مخزن Admin شاخهٔ `fix/safety-reports-api-contract` ساخته شد.
- `ReportsService` در این شاخه به prefix واقعی Backend یعنی `/admin-api/safety/reports` تغییر کرد؛ مسیرهای list/confirm/reject/block/unblock همگی از یک ثابت مشترک استفاده می‌کنند.
- fallback پنهان‌کنندهٔ خطا `.catch(() => [])` از دریافت گزارش‌ها حذف شد تا خطای upstream به لایهٔ بالاتر برسد و به «فهرست خالی» تبدیل نشود.
- تست واحد contract در `apps/server/src/safety/services/reports.service.spec.ts` اضافه شد: مسیر list با/بدون status، propagation خطا، و چهار عملیات تغییر وضعیت/مسدودسازی را پوشش می‌دهد.
- Commitهای شاخه: `f85e20a1` (اصلاح سرویس)، `8ea27560` (تست contract).

### وضعیت اعتبارسنجی

- **Source review:** اصلاح مسیر با Controller واقعی Backend تطبیق داده شده است؛ Backend prefix برابر `/admin-api/safety/reports` و متدهای list/confirm/reject/block/unblock را دارد.
- **تست خودکار:** تست به مخزن اضافه شده، اما در این مرحله امکان اجرای Jest/build از طریق GitHub connector وجود نداشت؛ بنابراین هنوز ادعای pass نمی‌کنیم. اجرای CI پس از ایجاد PR باید بررسی شود.
- **Runtime/integration:** هنوز انجام نشده؛ دسترسی شبکه، API key واقعی و رفتار UI پس از propagation خطا باید در محیط اجرا آزموده شود.
- **دامنهٔ تغییر:** فقط Admin server تغییر کرده؛ Backend و Mobile دست‌نخورده‌اند. هنوز ادغام با main انجام نشده است.

### اقدام بعدی

1. بازبینی diff و ایجاد PR از شاخهٔ اصلاح به `main)، سپس بررسی نتیجهٔ واقعی CI.
2. اجرای تست integration در محیط کنترل‌شده برای پنج route و بررسی نمایش خطا در UI.
3. بررسی مصرف‌کنندگان دیگر و سیاست error handling سایر سرویس‌های Safety؛ اصلاح آن‌ها جداگانه و با تست انجام شود.
4. بررسی secret و connectivity در runtime بدون چاپ یا افشای مقدار کلید.
