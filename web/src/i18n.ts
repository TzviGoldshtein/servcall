import type { Lang } from './api';

/**
 * עברית היא שפת העבודה, ואנגלית חייבת לעבוד באותה מידה: כל טקסט עובר מכאן, וכיוון
 * הדף נקבע מהשפה ולא מונח בקוד. אין ב-CSS הנחה על כיוון (ראה styles.css), כך
 * שהמעבר ל-LTR הוא החלפת מילון בלבד.
 *
 * טקסט שנשמר במסד — שמות חברות, לקוחות, נושאי קריאות — אינו מתורגם. שם חברה
 * באנגלית מגיע מהשרת בשדה נפרד (nameEn) ונבחר ב-companyLabel.
 */

const he = {
  loading: 'טוען…',
  signIn: 'כניסה',
  signInTitle: 'כניסה למערכת',
  loginField: 'שם משתמש או מייל',
  password: 'סיסמה',
  signInWithWa: 'כניסה דרך ווטסאפ צוות',
  signOut: 'יציאה',
  ssoFailed: 'הכניסה דרך ווטסאפ צוות נכשלה. נסה להתחבר בסיסמה',
  ssoUsed: 'קישור הכניסה כבר נוצל. התחבר מחדש',
  ssoUnknown: 'חשבון הווטסאפ הזה אינו מקושר למשתמש במערכת',

  pickCompany: 'בחר חברה',
  pickCompanyHint: 'אתה משויך לכמה חברות. הקריאות, השעות והחיוב נפרדים בכל אחת.',
  switchCompany: 'החלפת חברה',
  activeCompany: 'חברה פעילה',
  myRole: 'הרשאה',
  myExtension: 'שלוחה',
  noCompany: 'אין לך שיוך לחברה פעילה',

  roleAdmin: 'מנהל',
  roleAgent: 'נציג',
  roleOpener: 'פותח קריאות',
  roleViewer: 'צפייה',

  tabCalls: 'קריאות',
  tabClients: 'לקוחות',
  tabHours: 'שעות',
  tabBilling: 'חיוב',
  tabReports: 'דוחות',
  tabSettings: 'הגדרות',

  menu: 'תפריט',
  userMenu: 'תפריט משתמש',
  appearance: 'מראה',
  modeSystem: 'לפי המערכת',
  modeLight: 'בהיר',
  modeDark: 'כהה',
  language: 'שפה',
  langHe: 'עברית',
  langEn: 'English',
  sections: 'מקטעים',
  sectionsEmpty: 'אין כאן מקטעים עדיין',
  comingSoon: 'המקטע הזה ייבנה בהמשך',

  idleWarnTitle: 'עוד רגע תתבצע נעילה',
  idleWarnBody: 'לא זוהתה פעילות. המסך יינעל בעוד {n} שניות.',
  stayConnected: 'אני כאן',
  lockNow: 'נעילה עכשיו',
  lockedTitle: 'המסך נעול',
  lockedBody: 'ננעל בגלל חוסר פעילות. העבודה הפתוחה נשמרה — הזן סיסמה כדי להמשיך.',
  unlock: 'המשך',
  signInAsSomeoneElse: 'כניסה כמשתמש אחר',
} as const;

export type MessageKey = keyof typeof he;

const en: Record<MessageKey, string> = {
  loading: 'Loading…',
  signIn: 'Sign in',
  signInTitle: 'Sign in',
  loginField: 'Username or email',
  password: 'Password',
  signInWithWa: 'Sign in with WhatsApp Team',
  signOut: 'Sign out',
  ssoFailed: 'Signing in through WhatsApp Team failed. Try your password',
  ssoUsed: 'That sign-in link was already used. Please sign in again',
  ssoUnknown: 'This WhatsApp account is not linked to a user here',

  pickCompany: 'Choose a company',
  pickCompanyHint: 'You belong to several companies. Calls, hours and billing are separate in each.',
  switchCompany: 'Switch company',
  activeCompany: 'Active company',
  myRole: 'Role',
  myExtension: 'Extension',
  noCompany: 'You are not assigned to an active company',

  roleAdmin: 'Admin',
  roleAgent: 'Agent',
  roleOpener: 'Call opener',
  roleViewer: 'Viewer',

  tabCalls: 'Calls',
  tabClients: 'Clients',
  tabHours: 'Hours',
  tabBilling: 'Billing',
  tabReports: 'Reports',
  tabSettings: 'Settings',

  menu: 'Menu',
  userMenu: 'User menu',
  appearance: 'Appearance',
  modeSystem: 'System',
  modeLight: 'Light',
  modeDark: 'Dark',
  language: 'Language',
  langHe: 'עברית',
  langEn: 'English',
  sections: 'Sections',
  sectionsEmpty: 'No sections here yet',
  comingSoon: 'This section will be built later',

  idleWarnTitle: 'About to lock',
  idleWarnBody: 'No activity detected. The screen locks in {n} seconds.',
  stayConnected: "I'm here",
  lockNow: 'Lock now',
  lockedTitle: 'Screen locked',
  lockedBody: 'Locked after inactivity. Your open work is kept — enter your password to carry on.',
  unlock: 'Continue',
  signInAsSomeoneElse: 'Sign in as someone else',
};

const DICTS: Record<Lang, Record<MessageKey, string>> = { he, en };

export const LANG_KEY = 'servcall.lang';

export function t(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTS[lang][key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m)) : text;
}

export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'he' ? 'rtl' : 'ltr');

/** מעדכן את התכונות שהדפדפן נשען עליהן לכיוון, לניקוד ולהגהה. */
export function applyLang(lang: Lang): void {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = dirOf(lang);
}

/** העדפת שפה בדפדפן הזה, אם נבחרה. ברירת המחדל באה מהמשתמש בשרת. */
export function loadLang(): Lang | null {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === 'he' || saved === 'en' ? saved : null;
  } catch {
    return null;
  }
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // חלון פרטי
  }
}

export const roleLabel = (lang: Lang, role: string): string =>
  t(
    lang,
    role === 'admin'
      ? 'roleAdmin'
      : role === 'agent'
        ? 'roleAgent'
        : role === 'opener'
          ? 'roleOpener'
          : 'roleViewer',
  );
