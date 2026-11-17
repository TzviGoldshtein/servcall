import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, createSession, destroySession, verifyPassword } from '../auth.ts';
import { brandOfCompany, type CompanyBrand } from '../branding.ts';
import { config } from '../config.ts';
import type { Ctx, Role } from '../context.ts';
import type { Db } from '../db.ts';
import { HttpError, badRequest, forbidden } from '../errors.ts';
import type { Hub } from '../http.ts';
import { IDLE_WARN_SECONDS, idleMinutesOf } from '../idle.ts';
import { dirOf, isLang, msg, type Lang } from '../i18n.ts';
import { requestState, resolveCompany } from '../requestContext.ts';
import { intOf, internalPath, text } from '../validate.ts';
import { NonceJar, WaSsoError, signWaToken, verifyWaToken, type WaSsoPayload } from '../waSso.ts';

const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;

/** השיוך כפי שהדפדפן רואה אותו: שלוחה, טלפון והרשאה נפרדים בכל חברה. */
interface MeMembership {
  companyId: number;
  companyCode: string;
  companyName: string;
  companyNameEn: string | null;
  role: Role;
  extension: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  departmentName: string | null;
}

export interface Me {
  user: {
    id: number;
    email: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
    isSuperadmin: boolean;
  };
  memberships: MeMembership[];
  /** null = מחובר אך טרם נבחרה חברה; הדפדפן מציג את מסך בחירת החברה. */
  companyId: number | null;
  company: CompanyBrand | null;
  lang: Lang;
  dir: 'rtl' | 'ltr';
  /** פרמטרי הניתוק בחוסר פעילות של החברה הפעילה; ראה idle.ts. */
  idle: { logoutMinutes: number; warnSeconds: number };
}

interface UserRow {
  id: number;
  email: string;
  username: string | null;
  first_name: string;
  last_name: string | null;
  lang: string;
  is_superadmin: boolean;
  last_company_id: number | null;
}

async function membershipsOf(db: Db, userId: number): Promise<MeMembership[]> {
  const { rows } = await db.query<MeMembership>(
    `SELECT uc.company_id AS "companyId", c.code AS "companyCode", c.name AS "companyName",
            c.name_en AS "companyNameEn", uc.role, uc.extension, uc.phone, uc.mobile, uc.email,
            d.name AS "departmentName"
     FROM user_companies uc
     JOIN companies c ON c.id = uc.company_id
     LEFT JOIN departments d ON d.id = uc.department_id
     WHERE uc.user_id = $1 AND uc.active AND c.active
     ORDER BY c.id`,
    [userId],
  );
  return rows;
}

/**
 * התמונה שהדפדפן מקבל על עצמו. אותה תמונה חוזרת מהתחברות, מ-/me ומהחלפת חברה,
 * כדי שהצד-לקוח לא יצטרך לתפור מצב משני מקורות.
 */
export async function buildMe(db: Db, userId: number, wanted: number | null): Promise<Me> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, email, username, first_name, last_name, lang, is_superadmin, last_company_id
     FROM users WHERE id = $1 AND active`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(401, msg('authRequired'));
  const memberships = await membershipsOf(db, userId);
  const lang: Lang = isLang(row.lang) ? row.lang : 'he';
  const companyId = resolveCompany({ memberships, isSuperadmin: row.is_superadmin }, wanted);
  const company = companyId === null ? null : (await brandOfCompany(db, companyId)) ?? null;

  const params = companyId === null
    ? null
    : (
        await db.query<{ value: unknown }>(
          "SELECT value FROM settings WHERE company_id = $1 AND key = 'params'",
          [companyId],
        )
      ).rows[0]?.value ?? null;

  return {
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      isSuperadmin: row.is_superadmin,
    },
    memberships,
    companyId,
    company,
    lang,
    dir: dirOf(lang),
    idle: {
      logoutMinutes: idleMinutesOf(params, config.idleLogoutMinutes),
      warnSeconds: IDLE_WARN_SECONDS,
    },
  };
}

/**
 * רישום ישיר ביומן, ולא דרך `audit()`, כי בהתחברות ייתכן שעוד לא נבחרה חברה
 * והעמודה company_id אמורה להישאר ריקה במקרה הזה.
 */
const logAuth = (db: Db, userId: number, companyId: number | null, action: string, detail: unknown, ip: string) =>
  db.query(
    'INSERT INTO audit_log (company_id, user_id, action, detail, ip) VALUES ($1,$2,$3,$4,$5)',
    [companyId, userId, action, detail === undefined ? null : JSON.stringify(detail), ip],
  );

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx, hub: Hub): void {
  const { db } = ctx;
  // ניסיונות כניסה כושלים, בזיכרון התהליך. נועד לעצור ניחוש סיסמאות, לא תקיפה מבוזרת.
  const failures = new Map<string, number[]>();
  const nonces = new NonceJar();

  const startSession = async (
    req: FastifyRequest,
    reply: FastifyReply,
    userId: number,
    companyId: number | null,
  ) => {
    const sid = await createSession(db, userId, companyId, req.ip, req.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, sid, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: config.sessionDays * 24 * 60 * 60,
    });
    // החברה האחרונה נזכרת כדי שהכניסה הבאה תיפתח במקום שבו הנציג עבד
    if (companyId !== null) {
      await db.query('UPDATE users SET last_company_id = $2 WHERE id = $1', [userId, companyId]);
    }
  };

  // ---- ציבורי ----

  /**
   * כניסה מקומית. `login` הוא מייל או שם משתמש — שניהם ייחודיים בכל המערכת, ולכן
   * אין שדה חברה בטופס: החברה נבחרת אחרי הכניסה, או נקבעת לבד למי שיש לו אחת.
   * אותה בקשה משמשת גם לפתיחת מסך הנעילה אחרי חוסר פעילות (ראה idle.ts).
   */
  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const login = text(body.login, 'שם משתמש או מייל', 200).toLowerCase();
    const key = `${req.ip}|${login}`;
    const recent = (failures.get(key) ?? []).filter((at) => at > Date.now() - LOGIN_WINDOW_MS);
    if (recent.length >= MAX_FAILED_LOGINS) {
      throw new HttpError(429, 'יותר מדי ניסיונות כניסה. נסה שוב בעוד רבע שעה');
    }

    const { rows } = await db.query<UserRow & { password_hash: string | null }>(
      `SELECT id, email, username, first_name, last_name, password_hash, lang, is_superadmin, last_company_id
       FROM users
       WHERE active AND (lower(email) = $1 OR lower(username) = $1)
       ORDER BY (lower(email) = $1) DESC
       LIMIT 1`,
      [login],
    );
    const user = rows[0];
    const ok = !!user && (await verifyPassword(String(body.password ?? ''), user.password_hash));
    if (!ok || !user) {
      failures.set(key, [...recent, Date.now()]);
      throw new HttpError(401, 'שם משתמש או סיסמה שגויים');
    }
    failures.delete(key);

    const memberships = await membershipsOf(db, user.id);
    if (!memberships.length && !user.is_superadmin) {
      throw forbidden('אין לך שיוך לחברה פעילה. פנה למנהל המערכת');
    }
    // חברה מבוקשת מהטופס, אחרת זו שעבד בה לאחרונה, אחרת היחידה שיש לו
    const wanted = body.companyId === undefined || body.companyId === null
      ? user.last_company_id
      : intOf(body.companyId, 'חברה');
    const companyId = resolveCompany({ memberships, isSuperadmin: user.is_superadmin }, wanted);

    await startSession(req, reply, user.id, companyId);
    await logAuth(db, user.id, companyId, 'login', { method: 'password' }, req.ip);
    return buildMe(db, user.id, companyId);
  });

  /**
   * התחלת כניסה דרך ווטסאפ צוות. אנחנו חותמים אסימון קצר-מועד כדי ש-wa-team ידע
   * שהבקשה באה מכאן, ומוסיפים את כתובת החזרה המדויקת. ראה waSso.ts לפורמט.
   */
  app.get('/api/auth/wa/start', async (req, reply) => {
    if (!config.waTeamUrl || !config.waTeamToken) {
      throw new HttpError(503, 'כניסה דרך ווטסאפ צוות אינה מוגדרת בשרת');
    }
    const next = internalPath((req.query as { next?: unknown }).next);
    const base = `${req.protocol}://${req.headers.host}`;
    const token = signWaToken(config.waTeamToken, next ? { aud: 'wa-team', next } : { aud: 'wa-team' });
    const target = new URL('/sso/servcall', config.waTeamUrl);
    target.searchParams.set('token', token);
    target.searchParams.set('return', `${base}/api/auth/wa/callback`);
    return reply.redirect(target.toString());
  });

  /**
   * החזרה מ-wa-team. האסימון מזהה חשבון ומשתמש ווטסאפ; מהם נגזרת גם החברה, כי
   * מספר הווטסאפ שייך לחברה אחת. הסשן נפתח ישר בחברה ההיא ולא במסך בחירה.
   * כשל מחזיר לדף הבית עם סימון, כי זו ניווט של דפדפן ולא קריאת API.
   */
  app.get('/api/auth/wa/callback', async (req, reply) => {
    if (!config.waTeamToken) throw new HttpError(503, 'כניסה דרך ווטסאפ צוות אינה מוגדרת בשרת');
    const raw = (req.query as { token?: unknown }).token;
    let payload: WaSsoPayload;
    try {
      payload = verifyWaToken(config.waTeamToken, text(raw, 'אסימון', 4000), { aud: 'servcall' });
    } catch (err) {
      if (!(err instanceof WaSsoError)) throw err;
      req.log.warn({ err: err.message }, 'wa sso token rejected');
      return reply.redirect('/?sso=failed');
    }
    if (!nonces.use(payload.nonce)) return reply.redirect('/?sso=used');
    if (payload.waAccountId === undefined || payload.waUserId === undefined) {
      return reply.redirect('/?sso=failed');
    }

    const { rows } = await db.query<{ user_id: number; company_id: number }>(
      `SELECT i.user_id, i.company_id
       FROM user_wa_identities i
       JOIN users u ON u.id = i.user_id AND u.active
       JOIN companies c ON c.id = i.company_id AND c.active
       WHERE i.wa_account_id = $1 AND i.wa_user_id = $2`,
      [payload.waAccountId, payload.waUserId],
    );
    const identity = rows[0];
    if (!identity) return reply.redirect('/?sso=unknown');

    const memberships = await membershipsOf(db, identity.user_id);
    if (!memberships.some((m) => m.companyId === identity.company_id)) {
      // הזהות קיימת אך השיוך לאותה חברה בוטל — לא פותחים סשן בחברה שאינו חבר בה
      return reply.redirect('/?sso=unknown');
    }
    await startSession(req, reply, identity.user_id, identity.company_id);
    await logAuth(db, identity.user_id, identity.company_id, 'login', { method: 'wa-sso' }, req.ip);
    return reply.redirect(payload.next ?? '/');
  });

  // ---- מחובר ----

  app.get('/api/auth/me', async () => buildMe(db, ctx.user.id, requestState().companyId ?? null));

  app.post('/api/auth/logout', async (_req, reply) => {
    const { sessionId } = requestState();
    if (sessionId) await destroySession(db, sessionId);
    hub.dropUser(ctx.user.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /**
   * החלפת החברה הפעילה. נשמר על הסשן ולא על הדפדפן, כדי ששתי לשוניות לא יוכלו
   * לדווח שעות לחברות שונות באותו רגע בלי שהמשתמש יראה זאת.
   */
  app.post('/api/auth/company', async (req) => {
    const user = ctx.user;
    const companyId = intOf((req.body as { companyId?: unknown } | null)?.companyId, 'חברה');
    const memberships = await membershipsOf(db, user.id);
    const allowed = memberships.some((m) => m.companyId === companyId) ||
      (user.isSuperadmin &&
        !!(await db.query('SELECT 1 FROM companies WHERE id = $1 AND active', [companyId])).rowCount);
    if (!allowed) throw badRequest('אינך משויך לחברה הזו');

    await db.query('UPDATE sessions SET company_id = $2 WHERE id = $1', [
      requestState().sessionId,
      companyId,
    ]);
    await db.query('UPDATE users SET last_company_id = $2 WHERE id = $1', [user.id, companyId]);
    await logAuth(db, user.id, companyId, 'company.switch', null, req.ip);
    return buildMe(db, user.id, companyId);
  });
}
