/**
 * פורמט תאריכים, שעות ומספרים לדו"חות. אזור הזמן קבוע — ישראל — כי דו"ח
 * שמודפס ונשלח ללקוח חייב להראות את השעה שבה העבודה נעשתה, לא את השעה של
 * השרת או של הדפדפן שהדפיס אותו.
 */
import type { Lang } from '../i18n.ts';

export const TZ = 'Asia/Jerusalem';

const locale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'he-IL');

const dateFmt = new Map<string, Intl.DateTimeFormat>();
const fmt = (key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat => {
  const hit = dateFmt.get(key);
  if (hit) return hit;
  const made = make();
  dateFmt.set(key, made);
  return made;
};

const asDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 16/11/2026 */
export const dateText = (v: unknown, lang: Lang = 'he'): string => {
  const d = asDate(v);
  if (!d) return '';
  return fmt(`d:${lang}`, () =>
    new Intl.DateTimeFormat(locale(lang), { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }),
  ).format(d);
};

/** 16/11/2026 14:35 */
export const dateTimeText = (v: unknown, lang: Lang = 'he'): string => {
  const d = asDate(v);
  if (!d) return '';
  return fmt(`dt:${lang}`, () =>
    new Intl.DateTimeFormat(locale(lang), {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  ).format(d);
};

/** עמודת time של פוסטגרס חוזרת כ-"14:35:00"; בדו"ח מציגים דקות בלבד. */
export const timeText = (v: unknown): string => {
  if (!v) return '';
  const s = String(v);
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : s;
};

/** 7.5 שעות — תמיד שתי ספרות אחרי הנקודה בדו"ח שעות, כדי שהעמודה תתיישר. */
export const hoursText = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : (Math.round(n * 100) / 100).toFixed(2);

export const intText = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : String(Math.round(n));

export const moneyText = (n: number | null | undefined, lang: Lang = 'he'): string =>
  n === null || n === undefined
    ? ''
    : new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export const pctText = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : `${(Math.round(n * 10) / 10).toFixed(1)}%`;

/** כתובת הלקוח בשורה אחת, בלי מפרידים מיותרים כשחסרים שדות. */
export const addressText = (c: {
  street?: string | null;
  house_no?: string | null;
  apartment?: string | null;
  city?: string | null;
}): string => {
  const street = [c.street, c.house_no].filter(Boolean).join(' ').trim();
  const withApt = c.apartment ? `${street}/${c.apartment}` : street;
  return [withApt, c.city].filter((p) => p && String(p).trim()).join(', ');
};

export const personName = (first?: string | null, last?: string | null): string =>
  [first, last].filter((p) => p && String(p).trim()).join(' ');
