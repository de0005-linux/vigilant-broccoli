# Railway Browser v4 — اصلاح صفحه سفید

این نسخه مشکل صفحه سفید را برطرف می‌کند.

## علت اصلی

رابط قبلی برای تبدیل فریم Base64 به تصویر از این الگو استفاده می‌کرد:

```js
fetch('data:image/jpeg;base64,...')
```

اما Content Security Policy اتصال `data:` را در `connect-src` مجاز نمی‌کرد. در نتیجه فریم به سرور می‌رسید ولی مرورگر رابط اجازه Decode آن را نمی‌داد و Canvas سفید باقی می‌ماند.

نسخه جدید مستقیماً از Data URL به‌عنوان منبع Image استفاده می‌کند، Snapshot اجباری بعد از Navigation می‌فرستد و اگر بیش از ۶ ثانیه فریمی دریافت نشود به‌صورت خودکار Snapshot جدید درخواست می‌کند.

## اصلاحات

- Decode مستقیم JPEG بدون `fetch(data:)`
- Snapshot بعد از اتصال، Navigation، Reload، تغییر تب و Load
- بازیابی خودکار تصویر در صورت توقف Screencast
- تست واقعی محتوای پیکسلی فریم، نه فقط دریافت پیام WebSocket
- S3 Fail-safe: خطای تنظیمات یا SDK دیگر سرویس را Crash نمی‌کند
- افزودن خودکار `https://` به Endpointهایی مثل IDrive e2
- اگر آپلود S3 شکست بخورد، فایل روی Railway Volume باقی می‌ماند
- مدیریت چند تب و دانلودها حفظ شده است

## تنظیمات IDrive e2

```dotenv
S3_ENDPOINT=https://s3.us-west-2.idrivee2.com
S3_REGION=us-west-2
S3_BUCKET=bt2
S3_ACCESS_KEY_ID=YOUR_REAL_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_REAL_SECRET_KEY
S3_FORCE_PATH_STYLE=true
S3_PREFIX=browser-downloads
S3_SIGNED_URL_TTL=900
```

حتی اگر Endpoint را بدون `https://` وارد کنی، نسخه جدید آن را اصلاح می‌کند؛ بااین‌حال URL کامل توصیه می‌شود.

## متغیرهای اصلی Railway

```dotenv
ACCESS_TOKEN=YOUR_LONG_RANDOM_TOKEN
DATA_DIR=/data
PROFILE_DIR=/data/chromium-profile
HOME_URL=https://example.com
BROWSER_HEADLESS=true
IGNORE_HTTPS_ERRORS=true
MAX_TABS=8
NAVIGATION_TIMEOUT_MS=45000
SCREEN_QUALITY=72
SECURE_COOKIE=true
```

یک Railway Volume روی `/data` Mount کن و سرویس را با یک Replica اجرا کن.

## S3 Fail-safe

اگر S3 ناقص یا غیرقابل دسترس باشد:

1. HTTP Server و Chromium همچنان بالا می‌آیند.
2. Health Check موفق می‌ماند.
3. پنل وضعیت خطای S3 را نشان می‌دهد.
4. دانلودها روی `/data/downloads` ذخیره می‌شوند.
5. بعد از اصلاح S3 و Redeploy، آپلود ابری دوباره فعال می‌شود.

## محدودیت‌ها

CAPTCHA، DRM، Passkey و تشخیص IP دیتاسنتر همچنان ممکن است توسط سایت مقصد محدود شوند؛ اما این موارد نباید باعث سفیدماندن تمام Canvas شوند.
