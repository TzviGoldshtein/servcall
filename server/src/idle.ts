/**
 * כלל הניתוק בחוסר פעילות, במקום אחד.
 *
 * הדפדפן הוא זה שמודד חוסר פעילות אמיתי — הקלדה, עכבר, מגע — כי בקשות רקע
 * מחדשות את `last_seen_at` בשרת ולכן אינן עדות לכך שמישהו יושב מול המסך.
 * השרת מחזיק את אותו כלל כרשת ביטחון (`findSessionUser`), והדפדפן מקבל ממנו את
 * הפרמטרים ב-`/api/auth/me` ומיישם בדיוק את הפונקציות שכאן.
 *
 * דקה לפני הנעילה מוצגת אזהרה, ולא נעילה מיד: נציג שעומד לדבר עם לקוח מקבל
 * הזדמנות להישאר. אחרי הנעילה העבודה הפתוחה נשארת בזיכרון הדף, והחזרה היא
 * בסיסמה בלבד — בלי רענון שימחק טופס קריאה שמולא למחצה.
 */

/** כמה זמן לפני הנעילה מוצגת האזהרה. */
export const IDLE_WARN_SECONDS = 60;

export type IdlePhase = 'active' | 'warning' | 'locked';

/** 0 ומטה = הניתוק האוטומטי כבוי בחברה הזו. */
export const idleDisabled = (idleMinutes: number): boolean => !(idleMinutes > 0);

/**
 * באיזה שלב נמצא מי שלא נגע בכלום `idleMs` אלפיות שנייה.
 * חברה עם חלון קצר מהאזהרה עצמה תציג אזהרה מהרגע הראשון ולא תאבד אותה.
 */
export function idlePhase(
  idleMs: number,
  idleMinutes: number,
  warnSeconds: number = IDLE_WARN_SECONDS,
): IdlePhase {
  if (idleDisabled(idleMinutes)) return 'active';
  const lockAt = idleMinutes * 60_000;
  if (idleMs >= lockAt) return 'locked';
  return idleMs >= lockAt - warnSeconds * 1000 ? 'warning' : 'active';
}

/** שניות שנותרו עד הנעילה, לספירה לאחור באזהרה. Infinity כשהניתוק כבוי. */
export function secondsUntilLock(idleMs: number, idleMinutes: number): number {
  if (idleDisabled(idleMinutes)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.ceil((idleMinutes * 60_000 - idleMs) / 1000));
}

/** קורא את `idleLogoutMinutes` מפרמטרי החברה; ערך שאינו מספר שפוי נופל לברירת המחדל. */
export function idleMinutesOf(params: unknown, fallback: number): number {
  const raw = (params as { idleLogoutMinutes?: unknown } | null)?.idleLogoutMinutes;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}
