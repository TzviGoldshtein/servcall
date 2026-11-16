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

Caddy מנפיק HTTPS לבד. בחומת האש צריך 80 ו-443 בלבד.

## מה משותף ומה פר חברה

**משותף:** לקוחות, אנשי קשר, קבוצות לקוחות, טבלאות קוד, מחלקות, משתמשים, הערות.
**פר חברה:** קריאות, ארועים, שעות, בנק שעות, שירותים חודשיים, דו"חות, מיתוג.

נציג יכול להיות משויך לכמה חברות; השיוך (`user_companies`) נושא שלוחה, טלפון,
הרשאה ומזהה הנהלת חשבונות נפרדים לכל חברה. כל פעולה נרשמת על החברה הפעילה.
