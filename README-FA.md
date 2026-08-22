# وب‌پروکسی شخصی روی Railway

این پروژه یک **Web Proxy تحت وب** شبیه CroxyProxy است؛ نه V2Ray و نه مرورگر مجازی. کاربر URL را در پنل وارد می‌کند و سرور Railway صفحه، منابع، فرم‌ها، Redirect، Cookie و WebSocket را از مقصد دریافت می‌کند.

## قابلیت‌ها

- رابط کاملاً تحت وب برای دسکتاپ و موبایل
- دریافت سایت‌ها با IP خروجی Railway
- بازنویسی لینک‌های HTML، CSS، فرم‌ها، iframe، srcset و Redirect
- Shim مرورگر برای `fetch`، XHR، WebSocket، EventSource و محتوای پویا
- عبور POST و Range برای فرم و رسانه
- Cookie Jar سمت سرور با ذخیره روی Railway Volume
- ورود محافظت‌شده با `ACCESS_TOKEN`
- جلوگیری از Open Proxy و مسدودسازی localhost و شبکه خصوصی
- نمایش IP خروجی جاری Railway

## Deploy روی Railway

1. فایل ZIP را باز و محتویات را در یک GitHub Repository قرار بده.
2. در Railway گزینه **Deploy from GitHub Repo** را انتخاب کن.
3. در Variables این Secret را اضافه کن:

```dotenv
ACCESS_TOKEN=یک-رمز-طولانی-و-تصادفی
```

4. یک Railway Volume روی مسیر زیر Mount کن:

```text
/data
```

5. در Networking یک Railway Domain یا Custom Domain ایجاد کن.
6. سرویس را با یک Replica اجرا کن؛ برای این نسخه 512MB RAM معمولاً کافی است.

## متغیرهای اختیاری

```dotenv
PORT=3000
DATA_DIR=/data
```

`ALLOW_PRIVATE_TEST=true` فقط برای تست محلی است و در Railway نباید فعال شود.

## IP خروجی

سایت مقصد IP خروجی سرویس Railway را می‌بیند. بدون Static Outbound IP ممکن است IP پس از Redeploy یا تغییر Region عوض شود. در پلن Pro می‌توان Static Outbound IPs را فعال و سرویس را Redeploy کرد. Railway ممکن است در حالت HA چند IP خروجی داشته باشد.

دکمه **Railway egress** در رابط، IP خروجی فعلی را نمایش می‌دهد.

## Cookie و Login

Cookieهای مقصد به مرورگر کاربر داده نمی‌شوند؛ داخل Cookie Jar سرور ذخیره شده و برای دامنه و مسیر صحیح به مقصد فرستاده می‌شوند. فایل Cookie Jar روی Volume قرار می‌گیرد:

```text
/data/proxy-cookie-jar.json
```

این فایل ممکن است شامل نشست ورود سایت‌ها باشد و باید خصوصی بماند.

## محدودیت‌های واقعی Web Proxy

این پروژه نسبت به یک Reverse Proxy ساده سازگاری بیشتری دارد، اما هیچ Web Proxy عمومی نمی‌تواند اجرای همه سایت‌ها را تضمین کند. موارد زیر ممکن است محدود یا خراب شوند:

- DRM و پخش محافظت‌شده
- Passkey و WebAuthn وابسته به Origin
- CAPTCHA و تشخیص دیتاسنتر
- برنامه‌هایی که JavaScript را بر اساس `location.origin` امضا می‌کنند
- Service Workerهای مقصد
- Loginهایی که دامنه Proxy را تشخیص می‌دهند

برای سایت‌های معمولی، فرم، Cookie، Redirect و Login سنتی پشتیبانی می‌شود. این پروژه کنترل‌های امنیتی یا ضدربات سایت مقصد را دور نمی‌زند.

## امنیت

- سرویس بدون `ACCESS_TOKEN` قابل استفاده نیست.
- مقصدهای خصوصی، localhost و دامنه‌های داخلی مسدودند.
- از انتشار عمومی توکن خودداری کن.
- پروژه برای استفاده شخصی و یک Cookie Jar مشترک طراحی شده است.
- فقط برای دسترسی قانونی و مطابق قوانین و شرایط سایت مقصد استفاده کن.

## اجرای محلی

```bash
npm install
ACCESS_TOKEN='یک-رمز-طولانی' DATA_DIR='./data' npm start
```

برای تست مقصد محلی فقط در محیط توسعه:

```bash
ALLOW_PRIVATE_TEST=true ACCESS_TOKEN='یک-رمز-طولانی' DATA_DIR='./data' npm start
```

## Health Check

```text
GET /healthz
```
