# ארכיטקטורה

```
 PWA (לקוח)                         Cloudflare
 ─────────────                      ─────────────────────────────
 index.html + JS                    Worker (HTTP API)
 manifest.webmanifest   ── HTTPS ─▶  /api/subscribe, /api/alarms, ...
 service worker (push)              Cron Trigger (כל דקה)
        ▲                           KV: מנויים, שעונים, מצב צלצול
        │  Web Push (VAPID)                │
        └──────────────────────────────────┘
                 Push service של Apple / Google / Mozilla
```

## לקוח (PWA)
- דפים סטטיים, JS מודולרי, ללא build בשלב הראשון (כמו האתר הקיים) או Vite אם יידרש.
- `manifest.webmanifest`: שם, אייקונים (192, 512, maskable), `display: standalone`, `dir: rtl`, `lang: he`.
- Service Worker:
  - מאזין ל-`push`, מציג התראה (`showNotification`) עם `requireInteraction: true`, `tag` קבוע לשעון כדי שלא יצטברו, ו-`renotify: true`.
  - מאזין ל-`notificationclick`: פותח או ממקד את האפליקציה במסך הצלצול (`/ring?alarm=ID`).
  - מטמון של קבצי האפליקציה לעבודה בלי רשת.
- מסך צלצול: צליל בלולאה, כפתור משימה, חסימת יציאה עד סיום (לפי מה שהדפדפן מאפשר).
- התקנה: מסך הסבר ל"הוסף למסך הבית" ב-iOS (Safari, שיתוף, הוסף למסך הבית).
- הרשאות: התראות (רק אחרי לחיצה של המשתמש), מצלמה, מיקרופון.
- Wake Lock: `navigator.wakeLock.request('screen')` כשמצב לילה פעיל.

## שרת (Cloudflare Workers)
- Worker יחיד עם `fetch` (API) ו-`scheduled` (Cron).
- Cron: `* * * * *` (כל דקה). בכל הרצה:
  1. טוען שעונים פעילים (אינדקס לפי דקה בשבוע, ראו מודל נתונים).
  2. לכל שעון שהגיע זמנו ולא כובה, שולח פוש.
  3. לשעון שכבר מצלצל: שולח פוש חוזר (הסלמה) לפי הטבלה.
- ספריית Web Push: ספרייה שרצה ב-Workers (למשל `@block65/webcrypto-web-push` או `web-push` עם תאימות nodejs_compat). יש לאמת בפועל בתחילת הפיתוח איזו עובדת ב-Workers.
- מפתחות VAPID: זוג מפתחות נוצר פעם אחת. הפרטי נשמר כ-Secret של Worker (`wrangler secret put VAPID_PRIVATE_KEY`), הציבורי בקוד הלקוח. נושא (`sub`) הוא `mailto:` של הבעלים.
- אין לשמור סודות בריפו.

## מודל נתונים (KV)
| מפתח | ערך |
|---|---|
| `dev:{deviceId}` | `{ subscription, tz, createdAt, lastSeen }` |
| `alarm:{deviceId}:{alarmId}` | `{ time:"06:30", days:[0..6], tasks:[...], label, snooze, enabled, tz }` |
| `idx:{dow}:{HHMM}` | רשימת `deviceId:alarmId` שמגיעים באותה דקה (מאפשר Cron בלי סריקה מלאה) |
| `ring:{deviceId}:{alarmId}` | `{ startedAt, pushCount, lastPushAt }`, עם TTL של 2 שעות |
| `stat:{deviceId}:{YYYY-MM-DD}` | `{ ringAt, dismissedAt, task, success }` |

הערה: KV הוא eventually consistent. לשינויים בשעון זה מקובל. אם יתגלו בעיות, מעבר ל-D1 (SQLite) עם טבלאות alarms, devices, stats.

## API
כל הבקשות עם `Authorization: Bearer <deviceToken>` (אקראי, נוצר בהרשמה, נשמר ב-localStorage).

| שיטה ונתיב | פעולה |
|---|---|
| `POST /api/register` | שמירת מנוי push, מחזיר deviceId ו-deviceToken |
| `GET /api/alarms` | רשימת שעונים |
| `PUT /api/alarms/:id` | יצירה או עדכון |
| `DELETE /api/alarms/:id` | מחיקה |
| `POST /api/ring/:id/dismiss` | כיבוי אחרי משימה. עוצר הסלמה, רושם סטטיסטיקה |
| `POST /api/ring/:id/snooze` | נודניק |
| `GET /api/stats?from=&to=` | סטטיסטיקות |
| `POST /api/test-push` | פוש בדיקה |

## אבטחה ופרטיות
- אין אימות משתמש. הטוקן הוא סוד המכשיר. אפשרות עתידית לחיבור חשבון.
- וידאו ואודיו מעובדים במכשיר בלבד ואינם נשלחים לשרת.
- ל-API יש הגבלת קצב לפי מכשיר.
- מנויי push שחוזרים 404 או 410 נמחקים אוטומטית.
- CORS מוגבל לדומיין האפליקציה.

## פריסה
- לקוח: GitHub Pages או Cloudflare Pages. Pages של Cloudflare עדיף כדי להיות באותו דומיין עם ה-Worker.
- שרת: `wrangler deploy`. משתנים: `VAPID_PUBLIC_KEY`, Secret: `VAPID_PRIVATE_KEY`.
- מכסות free: כ-100 אלף בקשות ביום, מספר Crons מוגבל (5), KV חינם בהיקף אישי. יש לוודא מחדש מול התמחור העדכני לפני פריסה.
