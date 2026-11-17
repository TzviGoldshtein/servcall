/**
 * מסכי התחזוקה ונתוני הבסיס. המעטפת (הראוטר והתפריט) מרכיבה אותם מכאן, כך
 * שאין צורך לדעת את שמות הקבצים הפנימיים.
 *
 * Branding.tsx אינו כאן — המיתוג (הצבעים והלוגו של כל חברה) נמצא באחריות
 * מודול אחר, והמסכים כאן לוקחים צבעים ממשתני ה-CSS שהוא מגדיר.
 */
export { default as Departments } from './Departments';
export { default as Users } from './Users';
export { default as UserForm } from './UserForm';
export { default as Clients } from './Clients';
export { default as ClientForm } from './ClientForm';
export { default as ClientGroups } from './ClientGroups';
export { default as Contacts } from './Contacts';
export { default as Lookups } from './Lookups';
export { default as Params } from './Params';
export { default as Importer } from './Importer';

export type { Department } from './Departments';
export type { Role, UserRow } from './UserForm';
export type { ClientRow } from './ClientForm';
export type { ClientGroup } from './Clients';
export type { Contact } from './Contacts';

/** פריטי התפריט של אזור התחזוקה, בשתי השפות. */
export const MAINTENANCE_PAGES = [
  { path: 'clients', he: 'לקוחות', en: 'Clients' },
  { path: 'client-groups', he: 'קבוצות לקוחות', en: 'Client groups' },
  { path: 'users', he: 'נציגים', en: 'Agents' },
  { path: 'departments', he: 'מחלקות', en: 'Departments' },
  { path: 'lookups', he: 'טבלאות קוד', en: 'Lookup tables' },
  { path: 'params', he: 'פרמטרים', en: 'Parameters' },
  { path: 'import', he: 'ייבוא מאקסל', en: 'Excel import' },
] as const;
