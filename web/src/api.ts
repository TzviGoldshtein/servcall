// הטיפוסים כאן משקפים את מודלי הקריאה של השרת (server/src/routes/*.ts).

export type Lang = 'he' | 'en';
export type Role = 'admin' | 'agent' | 'opener' | 'viewer';

/** דירוג ההרשאות, זהה ל-`can` שבשרת. כאן זה רק להסתרת כפתורים — הבדיקה האמיתית בשרת. */
const RANK: Record<Role, number> = { viewer: 0, opener: 1, agent: 2, admin: 3 };
export const can = (role: Role, need: Role): boolean => RANK[role] >= RANK[need];

/**
 * משתני ה-CSS של חברה, כפי שהשרת גזר אותם. אפליקציית הווב אינה מכירה אף צבע מותג
 * ואינה גוזרת כלום בעצמה — היא רק מניחה את מה שהגיע על :root.
 */
export type ThemeVars = Record<string, string>;

export interface CompanyBrand {
  id: number;
  code: string;
  name: string;
  nameEn: string | null;
  brandPrimary: string;
  brandAccent: string | null;
  primaryTarget: number;
  logoUrl: string | null;
  logoMarkUrl: string | null;
  theme: { light: ThemeVars; dark: ThemeVars; notes: string[] };
}

/** החברות שבהן אפשר לעבוד, מ-GET /api/companies. */
export interface CompanyOption extends CompanyBrand {
  role: Role;
  extension: string | null;
  member: boolean;
}

/** שיוך לחברה: הרשאה, שלוחה וטלפון נפרדים בכל אחת. */
export interface Membership {
  companyId: number;
  companyCode: string;
  companyName: string;
  companyNameEn: string | null;
  role: Role;
  extension: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  departmentName: string | null;
}

export interface Me {
  user: {
    id: number;
    email: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
    isSuperadmin: boolean;
  };
  memberships: Membership[];
  /** null = מחובר אך טרם נבחרה חברה. */
  companyId: number | null;
  company: CompanyBrand | null;
  lang: Lang;
  dir: 'rtl' | 'ltr';
  idle: { logoutMinutes: number; warnSeconds: number };
}

export const fullName = (user: Me['user']): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ');

export const companyLabel = (c: { name: string; nameEn: string | null }, lang: Lang): string =>
  lang === 'en' && c.nameEn ? c.nameEn : c.name;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  // הודעות השגיאה מגיעות מהשרת בשפת המשתמש; אין כאן ניסוח מקומי מעליהן
  if (!response.ok) throw new ApiError(response.status, data?.error ?? 'שגיאה בתקשורת עם השרת');
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};
