import { badRequest } from './errors.ts';

/** שדה חובה. חוסר ואורך חריג נתפסים כאן, ולא בשאילתה. */
export function text(value: unknown, field: string, max = 10_000): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`חסר שדה: ${field}`);
  if (value.length > max) throw badRequest(`השדה ${field} ארוך מדי`);
  return value.trim();
}

export const optionalText = (value: unknown, field: string, max = 10_000): string | null =>
  value === undefined || value === null || value === '' ? null : text(value, field, max);

export function intOf(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(n)) throw badRequest(`${field} אינו מזהה תקין`);
  return n;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** צבע מותג. שש ספרות הקס בלבד — גזירת הערכה עובדת על hex ולא על שמות צבעים. */
export function hexColor(value: unknown, field: string): string {
  const raw = text(value, field, 7).toUpperCase();
  if (!COLOR_RE.test(raw)) throw badRequest(`${field} אינו צבע תקין (למשל #1B68B3)`);
  return raw;
}

/** נתיב פנימי להפניה. "//host" נראה כנתיב אך מוציא את המשתמש מהאתר. */
export const internalPath = (value: unknown): string | null =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && value.length < 500
    ? value
    : null;
