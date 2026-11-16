# ServCall

מערכת ניהול קריאות שירות לקבוצת K-Telecom. מחליפה את Loren ServCall.

ארבע חברות שירות — קי טלקום, קוריץ מערכות, סדקום והראל מחשוב — כל אחת עם מספר
ווטסאפ, קריאות, שעות וחיוב משלה, מעל **מאגר לקוחות ואנשי קשר אחד משותף**.

| תיקייה | תוכן |
|---|---|
| `server/` | Fastify + PostgreSQL + WebSocket (Node 20, TypeScript) |
| `web/` | React + Vite, עברית RTL ואנגלית LTR |
| `server/migrations/` | מיגרציות SQL ממוספרות, רצות בעלייה |
| `scripts/backup.sh` | גיבוי יומי של מסד הנתונים והקבצים |

## הרצה מקומית

```bash
docker compose up -d
pnpm install:all
pnpm --dir server dev
pnpm --dir web dev
```

## העלאה לשרת

```bash
cp .env.production.example .env.production   # למלא DOMAIN ו-POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## חיבור לדומיין

האפליקציה מאזינה על `127.0.0.1:3001` בלבד ואינה תופסת את 80 ו-443, כי על שרת
שכבר מריץ reverse proxy אחר שני השירותים היו מתנגשים.

**אם כבר יש reverse proxy על המכונה** (זה המצב בשרת של K-Telecom, שבו Caddy של
`waha-ktelecom` מחזיק את הפורטים) — מוסיפים לו route לדומיין. ב-Caddyfile שלו:

```
crm.k-telecom.co.il {
	reverse_proxy host.docker.internal:3001
}
```

וב-`docker-compose` של אותו Caddy צריך `extra_hosts: ["host.docker.internal:host-gateway"]`
כדי שהקונטיינר יגיע למארח. לחלופין, מחברים את שני הקונטיינרים לרשת דוקר משותפת
ומפנים ל-`servcall-app-1:3000` לפי שם.

**אם אין reverse proxy** — מרימים את Caddy שבקומפוז:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile edge up -d
```

בשני המקרים התעודה מונפקת אוטומטית, וצריך רשומת A של הדומיין שמצביעה לשרת.

## מה משותף ומה פר חברה

**משותף:** לקוחות, אנשי קשר, קבוצות לקוחות, טבלאות קוד, מחלקות, משתמשים, הערות.
**פר חברה:** קריאות, ארועים, שעות, בנק שעות, שירותים חודשיים, דו"חות, מיתוג.

נציג יכול להיות משויך לכמה חברות; השיוך (`user_companies`) נושא שלוחה, טלפון,
הרשאה ומזהה הנהלת חשבונות נפרדים לכל חברה. כל פעולה נרשמת על החברה הפעילה.
