/**
 * צבעי סטטוס הקריאה. אלה **אינם** נגזרים מצבע החברה ואינם מתחלפים בין
 * החברות: נציג שעובד גם בקי טלקום וגם בסדקום חייב לראות "סגורה" באותו צבע
 * בשתיהן, אחרת הוא קורא את הרשימה לא נכון. ראו גם את ההערה ב-theme.ts.
 *
 * הערכים נבחרו כך שיעברו AA מול לבן, כי הם מופיעים גם כטקסט וגם כעמודה בגרף.
 */
import type { Lang } from '../i18n.ts';

export type StatusTone = 'open' | 'progress' | 'followup' | 'waiting' | 'closed' | 'cancelled';

export const STATUS_COLORS: Record<StatusTone, string> = {
  open: '#C2410C',
  progress: '#1D4ED8',
  followup: '#7C3AED',
  waiting: '#A16207',
  closed: '#15803D',
  cancelled: '#4B5563',
};

/** שמות משתני ה-CSS — אותם שמות שהדפדפן מצפה להם ב-styles.css. */
export const statusVar = (tone: StatusTone): string => `--status-${tone}`;

export const statusCssVars = (): Record<string, string> =>
  Object.fromEntries(
    (Object.keys(STATUS_COLORS) as StatusTone[]).map((tone) => [statusVar(tone), STATUS_COLORS[tone]]),
  );

/**
 * הגוון של שורת סטטוס מטבלת הקוד. הזיהוי לפי השם, עם נפילה ל-is_closing —
 * כך סטטוס שיוסיפו בעתיד יקבל צבע סביר ולא יישאר בלי.
 */
export function statusTone(row: { name: string; is_closing?: boolean | null }): StatusTone {
  const name = (row.name ?? '').trim();
  if (name.includes('קיימת קריאה דומה') || name.includes('חוסר מענה')) return 'cancelled';
  if (name.includes('מעקב')) return 'followup';
  if (name.includes('ממתין')) return 'waiting';
  if (name.includes('בטיפול')) return 'progress';
  if (name.includes('פתוחה')) return 'open';
  if (name.includes('סגורה') || name.includes('היסתדר')) return 'closed';
  return row.is_closing ? 'closed' : 'open';
}

export const statusColor = (row: { name: string; is_closing?: boolean | null }): string =>
  STATUS_COLORS[statusTone(row)];

/** תווית הגוון, לתוויות גרף ולמקרא. */
export const toneLabel = (tone: StatusTone, lang: Lang): string =>
  lang === 'en'
    ? { open: 'Open', progress: 'In progress', followup: 'Follow-up', waiting: 'Waiting', closed: 'Closed', cancelled: 'Cancelled' }[tone]
    : { open: 'פתוחה', progress: 'בטיפול', followup: 'למעקב', waiting: 'ממתין', closed: 'סגורה', cancelled: 'בוטלה' }[tone];
