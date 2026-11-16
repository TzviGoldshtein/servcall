import type { CompanyBrand, ThemeVars } from './api';

/**
 * הנחת הערכה של החברה על :root.
 *
 * הגזירה כולה נעשית בשרת (server/src/theme.ts) ונשלחת כזוג סטים, בהיר וכהה. כאן
 * רק בוחרים סט ומניחים אותו — אין בקוד הזה אף צבע מותג, ולכן חברה חמישית או שינוי
 * צבע במסך ההגדרות אינם נוגעים בדפדפן בכלל.
 *
 * הערכה נשמרת מקומית כדי שהטעינה הבאה תיצבע לפני שהשרת עונה; אחרת כל רענון
 * מהבהב בצבעי ברירת המחדל.
 */

export type Mode = 'system' | 'light' | 'dark';

const MODE_KEY = 'servcall.mode';
const THEME_KEY = 'servcall.theme.v1';

interface CachedTheme {
  light: ThemeVars;
  dark: ThemeVars;
  name: string;
  logoUrl: string | null;
}

export function loadMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // חלון פרטי: אין מה לזכור
  }
  return 'system';
}

export function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // חלון פרטי
  }
}

export const systemPrefersDark = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export const resolveMode = (mode: Mode): 'light' | 'dark' =>
  mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;

/** מניח את המשתנים של הסט הנבחר, ומסמן ל-CSS באיזה מצב אנחנו. */
export function applyTheme(theme: CachedTheme | null, mode: Mode): void {
  const resolved = resolveMode(mode);
  const root = document.documentElement;
  // data-theme מכריע על מצב המערכת; ראה styles.css
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  if (!theme) return;
  const vars = resolved === 'dark' ? theme.dark : theme.light;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  // צבע סרגל הכתובת בנייד עוקב אחרי הכרום של החברה
  const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (bar && vars['--primary']) bar.content = vars['--primary'];
}

export const themeOf = (company: CompanyBrand): CachedTheme => ({
  light: company.theme.light,
  dark: company.theme.dark,
  name: company.name,
  logoUrl: company.logoUrl,
});

export function cacheTheme(company: CompanyBrand | null): void {
  try {
    if (company) localStorage.setItem(THEME_KEY, JSON.stringify(themeOf(company)));
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // חלון פרטי
  }
}

export function cachedTheme(): CachedTheme | null {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null') as CachedTheme | null;
    return saved?.light && saved.dark ? saved : null;
  } catch {
    return null;
  }
}

/** מדווח על שינוי מצב המערכת, כדי ש-'system' יתחלף בזמן אמת. */
export function watchSystemMode(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
