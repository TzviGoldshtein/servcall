import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db.ts';
import { config } from './config.ts';
import type { SessionUser, Membership } from './context.ts';
import { isLang } from './i18n.ts';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'servcall_session';

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 64);
  return 'scrypt$' + salt.toString('base64') + '$' + key.toString('base64');
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  const scheme = parts[0], saltB64 = parts[1], keyB64 = parts[2];
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * מחזיר את המשתמש של הסשן, ומאריך אותו. סשן שלא נגעו בו יותר מזמן הניתוק
 * בחוסר פעילות נחשב פג, גם אם תאריך התפוגה הכולל עוד רחוק.
 */
export async function findSessionUser(
  db: Db,
  sid: string | undefined,
): Promise<{ user: SessionUser; companyId: number | null } | null> {
  if (!sid) return null;
  const idleSql =
    "COALESCE((SELECT (value->>'idleLogoutMinutes')::int FROM settings WHERE company_id = s.company_id AND key = 'params'), $2)";
  const { rows } = await db.query<{
    user_id: number; company_id: number | null; email: string; first_name: string;
    last_name: string | null; lang: string; is_superadmin: boolean; stale: boolean;
  }>(
    'SELECT s.user_id, s.company_id, u.email, u.first_name, u.last_name, u.lang, u.is_superadmin, ' +
      '(s.last_seen_at < now() - make_interval(mins => ' + idleSql + ')) AS stale ' +
      'FROM sessions s JOIN users u ON u.id = s.user_id ' +
      'WHERE s.id = $1 AND s.expires_at > now() AND u.active',
    [sid, config.idleLogoutMinutes],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.stale) {
    await db.query('DELETE FROM sessions WHERE id = $1', [sid]);
    return null;
  }
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sid]);

  const mem = await db.query<Membership>(
    'SELECT uc.company_id AS "companyId", c.code AS "companyCode", c.name AS "companyName", ' +
      'uc.role, uc.extension ' +
      'FROM user_companies uc JOIN companies c ON c.id = uc.company_id ' +
      'WHERE uc.user_id = $1 AND uc.active AND c.active ORDER BY c.id',
    [row.user_id],
  );
  return {
    user: {
      id: row.user_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      lang: isLang(row.lang) ? row.lang : 'he',
      isSuperadmin: row.is_superadmin,
      memberships: mem.rows,
    },
    companyId: row.company_id,
  };
}

export async function createSession(
  db: Db, userId: number, companyId: number | null, ip?: string, ua?: string,
): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await db.query(
    'INSERT INTO sessions (id, user_id, company_id, expires_at, ip, user_agent) ' +
      'VALUES ($1,$2,$3, now() + make_interval(days => $4), $5, $6)',
    [id, userId, companyId, config.sessionDays, ip ?? null, ua ?? null],
  );
  return id;
}

export const destroySession = (db: Db, sid: string) =>
  db.query('DELETE FROM sessions WHERE id = $1', [sid]);
