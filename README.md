# MyMaps AI

מפות אישיות בסגנון Google My Maps — עם שכבות, מסלולי טיול לפי ימים, ייבוא/ייצוא KML, שמירה ושיתוף ב-Google Drive, ועוזר AI. עובד בטלפון ובמחשב, ומותקן כאפליקציה (PWA).

**האפליקציה:** https://alon24.github.io/mymaps-ai/

- מסמך מוצר: [`docs/PRD.md`](docs/PRD.md) · עיצוב: [`docs/DESIGN.md`](docs/DESIGN.md) · הנחיות לפיתוח עם Claude: [`CLAUDE.md`](CLAUDE.md)

## מה יש בפנים
- מפה (רחובות / לוויין / שטח), חיפוש מקום או קואורדינטות, מיקום חי
- שכבות: הצגה/הסתרה, צבע לכל פריט / צבע אחיד / **מספרים לפי הסדר**, מסלול בין המקומות
- נקודות, קווים ואזורים: ציור, גרירה, עריכה, סמלים, מדידת מרחק ושטח, בטל/בצע שוב
- גרירה לסידור מחדש (גם במגע) ובין שכבות
- ימי טיול: עצירות ממוספרות, מרחקים, פתיחת היום ב-Google Maps, וייצוא **מסלול HTML** לטיול (עובד בלי אינטרנט, עם ניווט וחיפוש לכל עצירה)
- ייבוא KML/KMZ/GeoJSON/CSV/GPX וקישור של My Maps · ייצוא KML/KMZ/GeoJSON/CSV
- Google Drive: שמירה אוטומטית, קישור צפייה, הזמנת עורכים
- עוזר AI (OpenRouter, ברירת מחדל `gpt-4o-mini`): שאלות על המפה, חלוקה לימים, הצעת מקומות — כל שינוי מוצג לאישור

## הפעלה (פעם אחת)
האפליקציה עובדת מיד בלי שום הגדרה (מפות נשמרות במכשיר). שני חלקים אופציונליים:

### 1. עוזר AI — Cloudflare Worker
1. ב-[dash.cloudflare.com](https://dash.cloudflare.com) → **My Profile → API Tokens → Create Token** → תבנית **Edit Cloudflare Workers** → Create. העתק את הטוקן.
2. ב-GitHub: **Settings → Secrets and variables → Actions → New repository secret** → שם `CLOUDFLARE_API_TOKEN`, ערך הטוקן.
3. הרץ שוב את ה-workflow (**Actions → Test and deploy → Run workflow**). ה-Worker נפרס אוטומטית.
4. ב-Cloudflare → Workers → `mymaps-ai-worker` → **Settings → Variables and Secrets** → הוסף שני סודות (Secret):
   - `OPENROUTER_API_KEY` — מ-[openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
   - `APP_TOKEN` — סיסמה ארוכה שאתה ממציא
5. משתמשים לא צריכים להזין שום מפתח: מי שמחובר עם Google משתמש ב-AI על חשבון ה-OpenRouter שלך. ה-Worker מוודא מול Google שההתחברות שייכת לאפליקציה הזו (דורש את חלק 2 — Google Drive).
   - כל עוד אפליקציית ה-OAuth במצב Testing, רק מי שברשימת Test users יכול להתחבר.
   - כדי להגביל לאנשים מסוימים גם אחרי פרסום: ב-Cloudflare → ה-Worker → Settings → Variables → משתנה `ALLOWED_EMAILS` (מיילים מופרדים בפסיק).
   - `APP_TOKEN` נשאר כמפתח מנהל (אופציונלי): תפריט → הגדרות.
   - מומלץ להגדיר תקרת הוצאה ב-OpenRouter.

### 2. Google Drive ושיתוף
1. [console.cloud.google.com](https://console.cloud.google.com) → צור פרויקט.
2. **APIs & Services → Library** → הפעל **Google Drive API** ו-**Google Picker API**.
3. **OAuth consent screen** → External → מלא שם אפליקציה ומייל → Scopes: הוסף `.../auth/drive.file` → Test users: הוסף את המייל שלך (ושל מי שתשתף איתו), או Publish.
4. **Credentials → Create credentials → OAuth client ID** → Web application → Authorized JavaScript origins: `https://alon24.github.io` (ולפיתוח: `http://localhost:5173`). העתק את ה-Client ID.
5. **Credentials → Create credentials → API key** → Restrict key: HTTP referrers `https://alon24.github.io/*`, APIs: Drive + Picker. העתק.
6. ב-GitHub: **Settings → Secrets and variables → Actions → Variables** → הוסף `VITE_GOOGLE_CLIENT_ID` ו-`VITE_GOOGLE_API_KEY` → הרץ שוב את ה-workflow.

## פיתוח
```bash
npm install
npm run dev          # http://localhost:5173
npm test             # בדיקות יחידה
npm run test:e2e     # בדיקות Playwright (מחשב + טלפון)
npm run build
cd worker && npm install && npm test
```
העתק `.env.example` ל-`.env.local` כדי להגדיר משתנים מקומית. כל push ל-`main` מריץ בדיקות ופורס ל-GitHub Pages.
