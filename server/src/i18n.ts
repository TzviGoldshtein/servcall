/**
 * עברית היא שפת העבודה, אבל שום דבר לא מניח RTL. השרת מחזיר מפתחות; הדפדפן
 * בוחר את המילון. טקסט שנשמר במסד (שמות לקוחות, נושאי קריאות) אינו מתורגם;
 * טבלאות הקוד נושאות name ו-name_en ונבחרות לפי שפת המשתמש.
 */
export const LANGS = ['he', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);
export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'he' ? 'rtl' : 'ltr');

/** השם המוצג של רשומת lookup לפי שפה, עם נפילה לעברית. */
export const localName = (row: { name: string; name_en?: string | null }, lang: Lang): string =>
  lang === 'en' && row.name_en ? row.name_en : row.name;

/** הודעות השרת. הדפדפן מתרגם את השאר. */
export const SERVER_MESSAGES = {
  he: {
    authRequired: 'נדרשת התחברות',
    forbidden: 'אין לך הרשאה לפעולה הזו',
    noCompany: 'לא נבחרה חברה',
    notFound: 'לא נמצא',
    badOrigin: 'בקשה ממקור לא מורשה',
    serverError: 'שגיאה בשרת',
    idleTimeout: 'ההתחברות פגה עקב חוסר פעילות',
  },
  en: {
    authRequired: 'Sign-in required',
    forbidden: 'You do not have permission for this action',
    noCompany: 'No company selected',
    notFound: 'Not found',
    badOrigin: 'Request from an unauthorised origin',
    serverError: 'Server error',
    idleTimeout: 'Session expired after inactivity',
  },
} as const;

export type MessageKey = keyof (typeof SERVER_MESSAGES)['he'];
export const msg = (key: MessageKey, lang: Lang = 'he'): string => SERVER_MESSAGES[lang][key];
