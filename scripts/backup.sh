#!/bin/sh
# גיבוי מסד הנתונים והקבצים של ServCall אל ./backups (14 הימים האחרונים).
# מה-cron, פעם בלילה:  0 3 * * * cd /opt/servcall && sh scripts/backup.sh >> backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
# הסכמה והנתונים בפורמט custom, כדי שאפשר יהיה לשחזר טבלה אחת ולא רק את הכול
$COMPOSE exec -T db pg_dump -U servcall -d servcall --format=custom > "backups/db-$STAMP.dump"
# קבצי הקריאות, החתימות והלוגואים של החברות — אין להם מקור אחר
$COMPOSE exec -T app tar -czf - -C /data files > "backups/files-$STAMP.tar.gz"
# הגיבוי מכיל גם סיסמאות מגובבות וגם יומן פעולות; לא לקריאה לכל מי שעל השרת
chmod 600 backups/db-*.dump backups/files-*.tar.gz
find backups -name 'db-*.dump' -mtime +14 -delete
find backups -name 'files-*.tar.gz' -mtime +14 -delete
echo "$STAMP backup done"
