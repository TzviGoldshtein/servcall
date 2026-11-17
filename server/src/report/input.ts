/**
 * בדיקות קלט קטנות למסלולים של הדו"חות, בנק השעות והשירותים.
 *
 * הן יושבות כאן ולא ב-context.ts כדי לא לגעת בחוזה המשותף של השרת, ששייך
 * לקליפה. ההודעות בעברית ויוצאות למשתמש כמו שהן, בדיוק כמו ב-wa-team.
 */
import { badRequest, forbidden } from '../errors.ts';
import { can, type Ctx, type Role } from '../context.ts';

export function requireRole(ctx: Ctx, need: Role): void {
  if (!can(ctx.role, need)) throw forbidden('אין לך הרשאה לפעולה הזו');
}

export function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`חסר שדה: ${field}`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw badRequest(`השדה ${field} ארוך מדי`);
  return trimmed;
}

export function optionalText(value: unknown, field: string, max = 200): string | null {
  return value === undefined || value === null || value === '' ? null : text(value, field, max);
}

export function id(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`מזהה לא תקין: ${field}`);
  return n;
}

/** מספר עשרוני לא שלילי — שעות, כמות, מחיר. */
export function amount(value: unknown, field: string, max = 1_000_000): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`מספר לא תקין: ${field}`);
  if (n > max) throw badRequest(`המספר בשדה ${field} גדול מדי`);
  return Math.round(n * 100) / 100;
}

export function bool(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw badRequest(`ערך לא תקין: ${field}`);
}

export const isTrue = (value: unknown): boolean =>
  value === true || value === 'true' || value === '1' || value === 'on' || value === 'yes';

/** שם קובץ להורדה: ASCII לכותרת הרגילה ו-UTF-8 ל-filename*, כדי שעברית תעבוד. */
export function contentDisposition(name: string, fallback: string): string {
  const ascii = fallback.replace(/[^\w.\-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
