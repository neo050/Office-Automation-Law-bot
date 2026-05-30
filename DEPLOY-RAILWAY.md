# 🚀 העלאה ל-Railway — מדריך הפעלה (always-on, כתובת HTTPS קבועה)

מדריך מלא להעלאת **Office-Automation-Law-bot** לאוויר על Railway: שלושה שירותים
(`webhook`, `poller`, `Redis`) מאותו repo, עם כתובת `https://<app>.up.railway.app`
קבועה ו-HTTPS אוטומטי. עלות ~5$/חודש (Hobby plan).

> הקוד כבר הותאם לענן: קרדנציאלס של Google נטענים מ-env (`GOOGLE_CLIENT_SECRET_JSON`,
> `GOOGLE_TOKEN_JSON`) ולא מקובץ, ו-Redis תומך ב-`REDIS_URL`. אין צורך ב-ngrok בענן.

---

## ארכיטקטורת הפריסה ב-Railway

```
Railway Project: law-bot
├── webhook  (service)  RUN_ROLE=webhook  →  https://law-bot.up.railway.app   ← הכתובת הציבורית
├── poller   (service)  RUN_ROLE=poller   →  (worker, ללא דומיין)
└── Redis    (database) →  מזריק REDIS_URL לשני השירותים
```

---

## שלב 0 — דרישות מוקדמות (פעם אחת)

1. חשבון ב-https://railway.app (התחברות עם GitHub היא הכי נוחה).
2. תוכנית **Hobby** (5$/חודש) — דרושה ל-always-on. נוסיף אמצעי תשלום בדשבורד.
3. Railway CLI:
   ```bash
   npm i -g @railway/cli
   railway --version
   ```
4. התחברות:
   ```bash
   railway login            # פותח דפדפן לאישור
   # אם אין דפדפן זמין: railway login --browserless
   ```

---

## שלב 1 — דחיפת הקוד ל-GitHub

Railway בונה מה-repo ב-GitHub ומפרסם מחדש בכל `git push`. הסודות **לא** נכנסים ל-git
(הם מוזרקים כ-Variables ב-Railway). `token.json` / `client_secret.json` / `.env` מוגנים
ע"י `.gitignore`.

```bash
git add .
git commit -m "feat: cloud-ready deploy (Railway) — env-injected creds, REDIS_URL"
git push origin main
```

---

## שלב 2 — יצירת הפרויקט + שירות ה-webhook

**בדשבורד (מומלץ למרובה-שירותים):**
1. New Project → **Deploy from GitHub repo** → בחר `Office-Automation-Law-bot`.
2. Railway מזהה את ה-`Dockerfile` (דרך `railway.json`) ובונה. השירות הראשון = ה-webhook.
3. שנה את שם השירות ל-`webhook` (Settings → Service Name).

**או דרך CLI (חלופה):**
```bash
railway init                 # יוצר פרויקט
railway up                   # בונה ומעלה את התיקייה הנוכחית
```

---

## שלב 3 — הוספת Redis

בדשבורד: **New → Database → Add Redis**.
(או ב-CLI: `railway add --database redis`)

Railway יוצר שירות `Redis` וחושף משתנה `REDIS_URL`.

---

## שלב 4 — משתני סביבה (Variables) לשירות ה-webhook

בדשבורד: שירות `webhook` → לשונית **Variables** → הדבק (Raw Editor נוח):

```
RUN_ROLE=webhook

# WhatsApp
PERMANENT_WABA_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_NUMBER=...
WHATSAPP_VERIFY_TOKEN=...            # בחר מחרוזת סוד; תזין אותה גם ב-Meta
WHATSAPP_APP_SECRET=...
GRAPH_VERSION=v23.0

# OpenAI
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
SUMMARY_MODEL=gpt-4o-mini

# Google (הדבק את התוכן של הקבצים — JSON בשורה אחת או base64)
GOOGLE_CLIENT_SECRET_JSON=...
GOOGLE_TOKEN_JSON=...
SHEETS_ID=...
SHEET_NAME=Clients
DRIVE_ROOT_ID=...
DRIVE_MODE=

# Redis — חיבור reference לשירות ה-Redis (בדשבורד: Add Reference → Redis → REDIS_URL)
REDIS_URL=${{Redis.REDIS_URL}}
REDIS_NS=prod

# App / Dashboard
ADMIN_USER=admin
ADMIN_PASS=<בחר-סיסמה-חזקה>          # חובה בפרודקשן! מגן על /admin
DEBUG_LEVEL=2
LOG_TZ=Asia/Jerusalem
```

> ⚠️ **אל תגדיר `PORT`** — Railway מזריק אותו אוטומטית והאפליקציה קוראת אותו.
> ⚠️ `REDIS_URL=${{Redis.REDIS_URL}}` הוא reference variable — הכי קל להוסיף דרך כפתור
> **Add Reference** בדשבורד (בחר את שירות ה-Redis ואת `REDIS_URL`).

**הכנת ערכי ה-Google** (במחשב שלך, מהתיקייה עם הקבצים):
```bash
# base64 בשורה אחת — הכי בטוח להדבקה:
node -e "console.log(require('fs').readFileSync('client_secret.json').toString('base64'))"
node -e "console.log(require('fs').readFileSync('token.json').toString('base64'))"
```
העתק כל פלט אל המשתנה המתאים. (האפליקציה מזהה גם JSON גולמי וגם base64.)

---

## שלב 5 — כתובת ציבורית (Domain)

שירות `webhook` → Settings → Networking → **Generate Domain**.
מתקבל: `https://<app>.up.railway.app`. **זאת הכתובת הנגישה.**

בדיקת חיים מהירה (אמור להחזיר 403 = השרת חי ומאובטח):
```bash
curl -i "https://<app>.up.railway.app/webhook"
```
הדשבורד: פתח `https://<app>.up.railway.app/admin` (יבקש משתמש/סיסמה שהגדרת).

---

## שלב 6 — שירות ה-poller (worker רקע)

בדשבורד: **New → GitHub Repo → אותו repo** (`Office-Automation-Law-bot`).
1. שם השירות: `poller`.
2. Variables: **אותם משתנים** כמו ה-webhook, אבל `RUN_ROLE=poller`.
   (טיפ: ב-Raw Editor העתק את כל הבלוק מה-webhook ושנה רק את `RUN_ROLE`.)
3. **אל** תייצר Domain ל-poller — זה worker בלבד.

---

## שלב 7 — חיבור Meta WhatsApp ל-webhook

ב-Meta for Developers → האפליקציה שלך → WhatsApp → Configuration → Webhook:
- **Callback URL:** `https://<app>.up.railway.app/webhook`
- **Verify Token:** בדיוק הערך של `WHATSAPP_VERIFY_TOKEN` שהגדרת בשלב 4.
- לחץ **Verify and Save** → Meta שולח `GET /webhook` והשרת מחזיר את ה-challenge.
- Subscribe לשדה **messages**.

שלח הודעת WhatsApp למספר העסקי → אמורה להופיע בדשבורד `/admin`.

---

## שלב 8 — אימות "הכל עובד"

1. דשבורד `/admin/settings.html` → פאנל ה-Health: כל הנורות (Redis / WhatsApp /
   OpenAI / Google) צריכות להיות ירוקות.
2. לוגים ב-Railway: שירות `webhook` → Deploy Logs → `✅ Webhook + dashboard listening on ...`.
3. שלח הודעה אמיתית ובדוק שנוצרת תיקיית לקוח ב-Drive ושורה ב-Sheet.

---

## עדכונים שוטפים

```bash
git push origin main      # Railway בונה ומפרסם מחדש את שני השירותים אוטומטית
```

## פתרון תקלות מהיר

| תופעה | סיבה נפוצה | פתרון |
|---|---|---|
| Crash בעליה, `gAuth` error | `GOOGLE_*_JSON` חסר/פגום | ודא הדבקת base64 מלא של שני הקבצים |
| Redis `ECONNREFUSED` / timeout | `REDIS_URL` לא מקושר | הוסף Reference ל-`Redis.REDIS_URL`; הקוד כבר עם `family:0` ל-IPv6 פנימי |
| Meta "verify token mismatch" | חוסר התאמה | `WHATSAPP_VERIFY_TOKEN` ב-Railway = Verify Token ב-Meta |
| `/admin` פתוח לכולם | `ADMIN_PASS` לא הוגדר | הגדר `ADMIN_USER`+`ADMIN_PASS` |
| השרת לא מאזין | הוגדר `PORT` ידנית | מחק את `PORT` — Railway מזריק אותו |
