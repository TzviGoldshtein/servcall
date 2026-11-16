import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * כניסה חד-פעמית בין ווטסאפ צוות (wa-team) לכאן.
 *
 * שתי המערכות מחזיקות את אותו סוד (`WA_TEAM_TOKEN`) וחותמות בו אסימון קצר-מועד.
 * אין מה להחזיק מצב מרוכז: האסימון נושא את כל מה שצריך לדעת, חי שתי דקות, ונפסל
 * אחרי שימוש אחד. פורמט האסימון:
 *
 *   sc1.<payload>.<sig>
 *
 *   payload = base64url של JSON
 *   sig     = base64url של HMAC-SHA256 על המחרוזת "sc1.<payload>" עם הסוד המשותף
 *
 * ה-JSON:
 *   { v:1, aud:'wa-team'|'servcall', iat, exp, nonce, waAccountId?, waUserId?, next? }
 *
 *   aud          — לאן האסימון מיועד. מונע החזרה של אסימון יציאה בחזרה אלינו ככניסה.
 *   iat / exp    — שניות יוניקס. חלון של שתי דקות; שעון שסטה קדימה מקבל סבלנות קטנה.
 *   nonce        — מזהה חד-פעמי. נשרף אחרי אימות מוצלח, כדי שלינק שנשמר בהיסטוריה
 *                  של הדפדפן לא ייתן כניסה שנייה.
 *   waAccountId  — accounts.id אצל wa-team. יחד עם waUserId מזהה את האדם
 *   waUserId       בטבלה user_wa_identities, ומשם נגזרת גם החברה שהוא נכנס אליה.
 *   next         — נתיב פנימי לחזור אליו בסיום. נתיב בלבד, אחרת זה open redirect.
 *
 * הצד של wa-team אינו נבנה כאן; זהו החוזה שהוא מממש.
 */

export const WA_SSO_PREFIX = 'sc1';
/** חלון החיים של אסימון. קצר בכוונה — הוא עובר בשורת הכתובת. */
export const WA_SSO_TTL_SECONDS = 120;
/** סבלנות לשעונים שאינם מסונכרנים בין שני השרתים. */
const CLOCK_SKEW_SECONDS = 30;

export type WaAudience = 'wa-team' | 'servcall';

export interface WaSsoPayload {
  v: 1;
  aud: WaAudience;
  iat: number;
  exp: number;
  nonce: string;
  /** מזהה החשבון של wa-team. קיים באסימון שחוזר אלינו. */
  waAccountId?: number;
  waUserId?: number;
  /** נתיב פנימי להמשיך אליו אחרי הכניסה. */
  next?: string;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');
const sign = (secret: string, signed: string): string =>
  b64url(createHmac('sha256', secret).update(signed).digest());

export class WaSsoError extends Error {}

/** חותם אסימון יוצא. `now` נתון בחוץ כדי שהבדיקות לא יתלו בשעון. */
export function signWaToken(
  secret: string,
  payload: Omit<WaSsoPayload, 'v' | 'iat' | 'exp' | 'nonce'> & { nonce?: string },
  now: number = Date.now(),
): string {
  if (!secret) throw new WaSsoError('wa-team sso is not configured');
  const iat = Math.floor(now / 1000);
  const full: WaSsoPayload = {
    v: 1,
    ...payload,
    nonce: payload.nonce ?? randomBytes(12).toString('base64url'),
    iat,
    exp: iat + WA_SSO_TTL_SECONDS,
  };
  const body = WA_SSO_PREFIX + '.' + b64url(Buffer.from(JSON.stringify(full), 'utf8'));
  return body + '.' + sign(secret, body);
}

/**
 * מאמת אסימון נכנס ומחזיר את תוכנו. זורק WaSsoError על כל פגם — חתימה, תוקף, יעד
 * או מבנה. השוואת החתימה היא בזמן קבוע, ונעשית לפני שנוגעים בתוכן בכלל.
 */
export function verifyWaToken(
  secret: string,
  token: string,
  expect: { aud: WaAudience },
  now: number = Date.now(),
): WaSsoPayload {
  if (!secret) throw new WaSsoError('wa-team sso is not configured');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== WA_SSO_PREFIX) throw new WaSsoError('malformed token');
  const body = parts[0] + '.' + parts[1];
  const expected = Buffer.from(sign(secret, body), 'utf8');
  const actual = Buffer.from(parts[2]!, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new WaSsoError('bad signature');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  } catch {
    throw new WaSsoError('malformed payload');
  }
  if (!parsed || typeof parsed !== 'object') throw new WaSsoError('malformed payload');
  const p = parsed as Record<string, unknown>;
  if (p.v !== 1) throw new WaSsoError('unsupported version');
  if (p.aud !== expect.aud) throw new WaSsoError('wrong audience');
  if (typeof p.nonce !== 'string' || !p.nonce) throw new WaSsoError('missing nonce');
  if (typeof p.iat !== 'number' || typeof p.exp !== 'number') throw new WaSsoError('missing lifetime');

  const seconds = Math.floor(now / 1000);
  if (p.exp - p.iat > WA_SSO_TTL_SECONDS) throw new WaSsoError('lifetime too long');
  if (p.exp + CLOCK_SKEW_SECONDS < seconds) throw new WaSsoError('expired');
  if (p.iat - CLOCK_SKEW_SECONDS > seconds) throw new WaSsoError('issued in the future');

  const payload: WaSsoPayload = { v: 1, aud: p.aud, iat: p.iat, exp: p.exp, nonce: p.nonce };
  if (p.waAccountId !== undefined) {
    if (!Number.isInteger(p.waAccountId)) throw new WaSsoError('bad waAccountId');
    payload.waAccountId = p.waAccountId as number;
  }
  if (p.waUserId !== undefined) {
    if (!Number.isInteger(p.waUserId)) throw new WaSsoError('bad waUserId');
    payload.waUserId = p.waUserId as number;
  }
  if (p.next !== undefined) {
    // נתיב פנימי בלבד. "//host" נראה כנתיב אך הדפדפן ילך איתו לאתר אחר.
    if (typeof p.next !== 'string' || !p.next.startsWith('/') || p.next.startsWith('//')) {
      throw new WaSsoError('bad next path');
    }
    payload.next = p.next;
  }
  return payload;
}

/**
 * זוכר nonce-ים שנשרפו, כדי שאסימון לא ישמש פעמיים. הזיכרון מוגבל לאורך חיי
 * האסימון, ולכן נשאר קטן גם בלי תחזוקה.
 */
export class NonceJar {
  private readonly seen = new Map<string, number>();

  /** מחזיר false אם ה-nonce כבר נשרף. */
  use(nonce: string, now: number = Date.now()): boolean {
    for (const [key, at] of this.seen) {
      if (at < now - (WA_SSO_TTL_SECONDS + CLOCK_SKEW_SECONDS) * 1000) this.seen.delete(key);
    }
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}
