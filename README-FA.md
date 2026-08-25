# Railway Browser v5

این نسخه بر پایه نسخه سالم انتقال تصویر ساخته شده و سه قابلیت اصلی دارد:

1. توقف خودکار سایت‌های گیرکرده بدون قفل‌شدن مرورگر
2. آپلود فایل از دستگاه کاربر
3. انتخاب فایل از دانلودهای ذخیره‌شده روی Volume یا S3

## رفتار سایت‌های خراب یا کند

هر Navigation حداکثر تا مقدار `SITE_LOAD_TIMEOUT_MS` منتظر می‌ماند. پس از Timeout:

- `Page.stopLoading` اجرا می‌شود.
- `window.stop()` اجرا می‌شود.
- تب از حالت Loading خارج می‌شود.
- کاربر می‌تواند فوراً آدرس دیگری وارد کند یا تب جدید باز کند.
- تب‌ها و WebSocketهای دیگر تحت تأثیر قرار نمی‌گیرند.

دکمه Stop نیز همین عملیات را به‌صورت دستی انجام می‌دهد. اگر Renderer یک تب واقعاً Crash کند، همان تب بسته می‌شود و مرورگر به تب سالم بعدی می‌رود. اگر هیچ تبی باقی نماند، Home در یک تب تازه باز می‌شود.

## آپلود فایل از دستگاه

وقتی سایت `<input type=file>` باز کند، رابط انتخاب فایل نمایش داده می‌شود. فایل دستگاه به‌صورت موقت در `/data/uploads` قرار می‌گیرد، به File Chooser Chromium داده می‌شود و بعد پاک می‌شود.

حداکثر حجم:

```dotenv
UPLOAD_LIMIT_MB=32
```

محدوده قابل تنظیم 1 تا 128 مگابایت است. Base64 باعث مصرف RAM بیشتر می‌شود؛ برای Railway معمولاً 32MB مناسب است.

## انتخاب از دانلودهای قبلی

در همان پنجره File Chooser، فهرست دانلودهای ذخیره‌شده نمایش داده می‌شود:

- فایل Local مستقیماً از `/data/downloads` انتخاب می‌شود.
- فایل S3 ابتدا به مسیر موقت `/data/uploads` Stream می‌شود.
- فایل موقت S3 بعد از تحویل به Chromium پاک می‌شود.
- برای IDrive e2 از همان `GetObject` استاندارد S3 استفاده می‌شود.

## متغیر جدید

```dotenv
SITE_LOAD_TIMEOUT_MS=25000
UPLOAD_LIMIT_MB=32
```

`SITE_LOAD_TIMEOUT_MS` بین 3000 تا 120000 میلی‌ثانیه محدود می‌شود.

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

## تنظیمات اصلی Railway

```dotenv
ACCESS_TOKEN=YOUR_LONG_RANDOM_TOKEN
DATA_DIR=/data
PROFILE_DIR=/data/chromium-profile
HOME_URL=https://example.com
BROWSER_HEADLESS=true
IGNORE_HTTPS_ERRORS=true
MAX_TABS=8
SITE_LOAD_TIMEOUT_MS=25000
UPLOAD_LIMIT_MB=32
SCREEN_QUALITY=72
SECURE_COOKIE=true
```

Volume باید روی `/data` Mount شود و سرویس با یک Replica اجرا شود.
