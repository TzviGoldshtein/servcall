import { pino } from 'pino';
import { config } from './config.ts';
import { db, pool } from './db.ts';
import { buildHttpServer } from './http.ts';
import { migrate } from './migrate.ts';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// המיגרציות רצות בעלייה. שרת שעלה על סכמה חלקית מסוכן יותר משרת שלא עלה.
try {
  await migrate(db, (m) => logger.info(m));
} catch (err) {
  logger.fatal({ err }, 'cannot reach the database - is it running? (docker compose up -d)');
  process.exit(1);
}

const app = await buildHttpServer(logger);
await app.listen({ host: '0.0.0.0', port: config.port });
logger.info(`listening on http://0.0.0.0:${config.port}`);

// סשנים שפגו נשארים בטבלה עד שמישהו ינסה להשתמש בהם; ניקוי בעלייה מספיק
await db.query('DELETE FROM sessions WHERE expires_at < now()');

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  // סדר חשוב: קודם לא מקבלים בקשות חדשות, ורק אחר כך סוגרים את מסד הנתונים
  await app.close().catch((err) => logger.error({ err }, 'http close failed'));
  await pool.end().catch((err) => logger.error({ err }, 'db close failed'));
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
