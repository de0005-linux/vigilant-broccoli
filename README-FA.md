# مرورگر Railway با چند تب و S3

این پروژه نسخه توسعه‌یافته مرورگر راه‌دور Railway است. Chromium واقعی روی Railway اجرا می‌شود، تصویر تب فعال با CDP Screencast به رابط وب فرستاده می‌شود و ورودی موس و صفحه‌کلید از مرورگر کاربر به Chromium منتقل می‌شود.

## قابلیت‌های جدید

- مدیریت چند تب: ایجاد، فعال‌سازی، بستن و نگهداری وضعیت هر تب
- Popupهای سایت به‌صورت تب جدید
- نوار تب واکنش‌گرا برای دسکتاپ و موبایل
- دریافت فایل توسط Chromium
- انتقال خودکار فایل دانلودشده به هر Bucket سازگار با S3
- فهرست دانلودها، دریافت با Signed URL و حذف Object از Bucket
- نگهداری موقت محلی روی Railway Volume در صورت تنظیم‌نبودن S3

## Deploy روی Railway

1. محتویات ZIP را در GitHub Repository قرار بده.
2. در Railway گزینه **Deploy from GitHub Repo** را انتخاب کن.
3. این Variable اجباری را اضافه کن:

```dotenv
ACCESS_TOKEN=یک-رمز-طولانی-و-تصادفی
```

4. یک Railway Volume روی مسیر زیر Mount کن:

```text
/data
```

5. در Networking یک Railway Domain یا Custom Domain ایجاد کن.
6. سرویس را با **یک Replica** اجرا کن؛ تب‌ها و پروفایل Chromium برای یک نشست مشترک طراحی شده‌اند.

## تنظیم S3-compatible Bucket

متغیرهای زیر را در Railway اضافه کن:

```dotenv
S3_ENDPOINT=https://YOUR-S3-ENDPOINT
S3_REGION=auto
S3_BUCKET=browser-downloads
S3_ACCESS_KEY_ID=YOUR_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
S3_FORCE_PATH_STYLE=true
S3_PREFIX=browser-downloads
S3_SIGNED_URL_TTL=900
```

### Cloudflare R2

```dotenv
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

### AWS S3

برای AWS اصلی می‌توانی `S3_ENDPOINT` را حذف کنی و Region واقعی را قرار بدهی:

```dotenv
S3_REGION=eu-central-1
S3_FORCE_PATH_STYLE=false
```

همین تنظیمات با سرویس‌هایی مثل MinIO، Backblaze B2 S3 API، Wasabi و DigitalOcean Spaces نیز قابل استفاده است.

## جریان دانلود

1. Chromium فایل را در مسیر موقت `/data/downloads` دریافت می‌کند.
2. فایل با اندازه و Content-Type صحیح داخل Bucket آپلود می‌شود.
3. بعد از آپلود موفق، نسخه محلی حذف می‌شود.
4. اطلاعات دانلود در `/data/download-index.json` نگهداری می‌شود.
5. دکمه دریافت یک Signed URL موقت تولید می‌کند.
6. حذف فایل، Object را از Bucket هم حذف می‌کند.

اگر S3 تنظیم نشده باشد، فایل روی Railway Volume باقی می‌ماند و از همان پنل قابل دریافت است.

## سایر متغیرها

```dotenv
PORT=3000
PROFILE_DIR=/data/chromium-profile
DATA_DIR=/data
HOME_URL=https://example.com
BROWSER_LOCALE=fa-IR
BROWSER_TIMEZONE=Asia/Tehran
SCREEN_QUALITY=72
S3_SIGNED_URL_TTL=900
```

برای تست محلی روی HTTP:

```dotenv
SECURE_COOKIE=false
CHROMIUM_PATH=/usr/bin/chromium
```

در Railway مقدار پیش‌فرض `SECURE_COOKIE=true` را تغییر نده. متغیر `ALLOW_PRIVATE_TEST=true` فقط در تست خودکار با یک سایت محلی استفاده می‌شود و نباید روی Railway فعال شود.

## IP خروجی

سایت‌ها IP خروجی خود Railway را مشاهده می‌کنند. در صورت نیاز به IP پایدارتر، Static Outbound IPs را در Railway فعال و سرویس را Redeploy کن.

## امنیت

- سرویس بدون `ACCESS_TOKEN` قابل استفاده نیست.
- کلیدهای S3 فقط در Railway Variables قرار می‌گیرند و به مرورگر کاربر ارسال نمی‌شوند.
- دریافت فایل با Signed URL موقت انجام می‌شود.
- دسترسی مستقیم به localhost، شبکه خصوصی و Metadata endpointهای شناخته‌شده مسدود است.
- فایل `download-index.json` شامل کلید Object است اما شامل Secretهای S3 نیست.
- Bucket را Private نگه دار.

## محدودیت‌ها

- این نسخه برای یک کاربر یا یک نشست مشترک و یک Replica ساخته شده است.
- CAPTCHA، Passkey/WebAuthn، DRM و تشخیص دیتاسنتر ممکن است محدودیت داشته باشند.
- در حالت HA یا چند Replica باید State تب‌ها، دانلودها و Profile بین Replicaها هماهنگ شود.

## اجرای محلی

```bash
npm install
ACCESS_TOKEN='test-token-long-enough' \
SECURE_COOKIE=false \
CHROMIUM_PATH=/usr/bin/chromium \
PROFILE_DIR=./data/profile \
DATA_DIR=./data \
npm start
```

## Health Check

```text
GET /healthz
```
