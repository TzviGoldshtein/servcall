/**
 * גזירת ערכת הצבעים של חברה מצבע בסיס אחד (ואופציונלית צבע משני).
 *
 * זהו פורט מדויק של האלגוריתם שאושר בקנבס העיצוב. העבודה נעשית ב-HSL עם לולאה
 * שמתאימה את הבהירות עד שהניגודיות עוברת את היעד — כך ש-AA נבדק ולא מונח.
 *
 * מה נגזר מהצבע הראשי: הכרום — באנר, סרגל, רקע, כותרות טבלה, פס ההקשר.
 * מה נגזר מהמשני: כפתורים, חיצים ומפרידים.
 * מה לא נגזר לעולם: הצבעים הסמנטיים וצבעי סטטוס הקריאה — אלה זהים בכל החברות,
 * אחרת נציג שעובד בשתי חברות יראה את אותו סטטוס בשני צבעים.
 */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const f = (v: number) => {
    const x = Math.round(Math.max(0, Math.min(255, v)));
    return (x < 16 ? '0' : '') + x.toString(16);
  };
  return ('#' + f(r) + f(g) + f(b)).toUpperCase();
}

/** בהירות יחסית לפי WCAG. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** יחס ניגודיות בין שני צבעים, 1..21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r0, g0, b0] = hexToRgb(hex);
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const li = Math.max(0, Math.min(1, l));
  if (s === 0) return rgbToHex(li * 255, li * 255, li * 255);
  const q = li < 0.5 ? li * (1 + s) : li + s - li * s;
  const p = 2 * li - q;
  const f = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** מזיז את הבהירות עד שהניגודיות מול הרקע עוברת את היעד. */
function fitLightness(h: number, s: number, l: number, bg: string, target: number, dir: 1 | -1): number {
  let x = l;
  for (let i = 0; i < 200; i++) {
    if (contrast(hslToHex(h, s, x), bg) >= target) return x;
    x += dir * 0.004;
    if (x < 0 || x > 1) break;
  }
  return Math.max(0, Math.min(1, x));
}

export interface BrandInput {
  /** צבע הבסיס של החברה, כמו בלוגו. */
  primary: string;
  /** הצבע המשני. חסר = החברה מונוכרומטית והכפתורים משתמשים בצבע הבסיס. */
  accent?: string | null;
  /** יעד ניגודיות לגזירת צבע הכרום. גבוה יותר = כרום כהה יותר. */
  primaryTarget?: number;
}

export interface Theme {
  brand: string;
  primary: string;
  primaryHover: string;
  primaryActive: string;
  primarySubtle: string;
  onPrimary: string;
  onSubtle: string;
  /** מתאר דק סביב הצבע הגולמי כשהוא כמעט בלתי נראה על המשטח. */
  brandEdge: string;
  accent: string;
  button: string;
  onButton: string;
  arrow: string;
  divider: string;
  /** קישורים מקבלים קו תחתון קבוע כשהצבע כמעט זהה לצבע הטקסט. */
  underlineLinks: boolean;
  notes: ThemeNote[];
  contrastRatios: Record<string, number>;
}

export type ThemeNote = 'noHue' | 'adjusted' | 'bigShift' | 'nearText';

const LIGHT = { bg: '#FFFFFF', text: '#1B1F24', black: '#111418' };
const DARK = { bg: '#161A1F', text: '#E8EBEF', black: '#0E1116' };

export function deriveTheme(input: BrandInput, dark = false): Theme {
  const M = dark ? DARK : LIGHT;
  const dir: 1 | -1 = dark ? 1 : -1;
  const target = input.primaryTarget ?? 4.6;
  const notes: ThemeNote[] = [];

  const [h, s, l0] = hexToHsl(input.primary);
  if (s < 0.1) notes.push('noHue');

  let l = l0;
  if (contrast(hslToHex(h, s, l), M.bg) < target - 0.02) {
    l = fitLightness(h, s, l, M.bg, target, dir);
    notes.push(Math.abs(l - l0) > 0.22 ? 'bigShift' : 'adjusted');
  }
  const primary = hslToHex(h, s, l);

  const nearText = contrast(primary, M.text) < 1.8;
  if (nearText) notes.push('nearText');
  const step = nearText ? -dir : dir;

  const primaryHover = hslToHex(h, s, l + step * 0.07);
  const primaryActive = hslToHex(h, s, l + step * 0.13);
  const onPrimary = contrast(M.bg === '#FFFFFF' ? '#FFFFFF' : M.black, primary) >= 4.5
    ? (dark ? M.black : '#FFFFFF')
    : (dark ? '#FFFFFF' : M.black);
  const primarySubtle = dark ? mix(primary, M.bg, 0.8) : mix(primary, '#FFFFFF', 0.9);
  const [sh, ss, sl] = hexToHsl(primary);
  const onSubtle = hslToHex(sh, ss, fitLightness(sh, ss, sl, primarySubtle, 4.6, dir));
  const brandEdge = contrast(input.primary, M.bg) < 1.6 ? (dark ? '#46505B' : '#B4BCC6') : 'transparent';

  // חברה מונוכרומטית: הכפתורים משתמשים בצבע הבסיס הגולמי, לא בכרום הכהה
  const accent = input.accent || input.primary;
  const onButton = contrast(accent, M.black) >= 4.5 ? M.black : '#FFFFFF';
  const [ah, as, al] = hexToHsl(accent);
  const arrow = hslToHex(ah, as, fitLightness(ah, as, al, M.bg, 3.0, dir));
  const divider = dark ? mix(accent, M.bg, 0.55) : mix(accent, '#FFFFFF', 0.55);

  return {
    brand: input.primary, primary, primaryHover, primaryActive, primarySubtle,
    onPrimary, onSubtle, brandEdge,
    accent, button: accent, onButton, arrow, divider,
    underlineLinks: nearText, notes,
    contrastRatios: {
      primaryOnBg: contrast(primary, M.bg),
      onPrimaryOnPrimary: contrast(onPrimary, primary),
      onButtonOnButton: contrast(onButton, accent),
      onSubtleOnSubtle: contrast(onSubtle, primarySubtle),
      arrowOnBg: contrast(arrow, M.bg),
    },
  };
}

/** משתני ה-CSS שהדפדפן מקבל. אלה הטוקנים היחידים שמתחלפים בין חברות. */
export function themeToCssVars(t: Theme): Record<string, string> {
  return {
    '--brand': t.brand,
    '--brand-edge': t.brandEdge,
    '--primary': t.primary,
    '--primary-hover': t.primaryHover,
    '--primary-active': t.primaryActive,
    '--primary-subtle': t.primarySubtle,
    '--primary-contrast': t.onPrimary,
    '--primary-on-subtle': t.onSubtle,
    '--accent': t.accent,
    '--accent-contrast': t.onButton,
    '--accent-arrow': t.arrow,
    '--accent-divider': t.divider,
    '--link-decoration': t.underlineLinks ? 'underline' : 'none',
  };
}
