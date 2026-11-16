import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db.ts';

const DIR = new URL('../migrations', import.meta.url).pathname;

/** מריץ את המיגרציות שטרם רצו, לפי סדר השמות, כל אחת בטרנזקציה. */
export async function migrate(db: Db, log: (m: string) => void): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(DIR, file), 'utf8');
    await db.tx(async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`migration applied: ${file}`);
  }
}
