# פריסה

## לקוח (GitHub Pages)
האתר מוגש מהענף `main`, מהשורש. כתובת: https://idanatwork.github.io/boker-web/
אין שלב build. הקבצים: `index.html`, `app.js`, `style.css`, `sw.js`, `config.js`, `manifest.webmanifest`, `icons/`.
`config.js` מכיל את כתובת ה-Worker (`API_BASE`) ואת מפתח ה-VAPID הציבורי.

## שרת (Cloudflare Workers)
```
cd worker
npm install
npx wrangler kv namespace create KV      # מעתיקים את ה-id ל-wrangler.toml
echo '<VAPID private JWK>' | npx wrangler secret put VAPID_PRIVATE_JWK
npx wrangler deploy
```
- `VAPID_PUBLIC` ב-`wrangler.toml` חייב להתאים למפתח בלקוח (`config.js`).
- המפתח הפרטי לא נשמר בריפו. אם הוא אובד, יוצרים זוג חדש ומעדכנים בשני המקומות, וכל המכשירים נרשמים מחדש.
- אחרי הפריסה מעדכנים `API_BASE` ב-`config.js` לכתובת ה-Worker (`https://boker-web.<subdomain>.workers.dev`).

## בדיקות
```
cd worker
node test/webpush.test.mjs            # הצפנה, VAPID ותזמון
npx wrangler dev --test-scheduled     # בטרמינל אחד
node test/e2e.mjs                     # בטרמינל שני: מקצה לקצה מול שירות פוש מזויף
```
(ל-e2e צריך `.dev.vars` עם `VAPID_PRIVATE_JWK`, ו-`id = "local"` ב-KV.)

## בדיקה באייפון
1. פותחים את כתובת האתר ב-Safari.
2. שיתוף, "הוסף למסך הבית", ופותחים מהאייקון.
3. "הפעל התראות", מאשרים, ואז "שלח התראת בדיקה".
4. יוצרים שעון לעוד 2 דקות, נועלים את המסך, ומחכים.
5. לוחצים על ההתראה, פותרים את המשימה, ובודקים שהפוש נפסק.
