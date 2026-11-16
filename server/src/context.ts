import type { Db } from './db.ts';
import type { Lang } from './i18n.ts';

export type Role = 'admin' | 'agent' | 'opener' | 'viewer';

export interface Membership {
  companyId: number;
  companyCode: string;
  companyName: string;
  role: Role;
  extension: string | null;
}

export interface SessionUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string | null;
  lang: Lang;
  isSuperadmin: boolean;
  /** החברות שהנציג משויך אליהן. ההפרדה ביניהן מוחלטת. */
  memberships: Membership[];
}

/** ההקשר של בקשה אחת: מי מבקש ובאיזו חברה הוא פועל כרגע. */
export interface Ctx {
  db: Db;
  user: SessionUser;
  companyId: number;
  role: Role;
  lang: Lang;
}

export const can = (role: Role, need: Role): boolean => {
  const rank: Record<Role, number> = { viewer: 0, opener: 1, agent: 2, admin: 3 };
  return rank[role] >= rank[need];
};

/** רישום ביומן הפעולות. כל פעולה שמשנה נתונים עוברת כאן. */
export async function audit(
  ctx: Pick<Ctx, 'db' | 'user' | 'companyId'>,
  action: string,
  target?: string,
  detail?: unknown,
  ip?: string,
): Promise<void> {
  await ctx.db.query(
    'INSERT INTO audit_log (company_id, user_id, action, target, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [ctx.companyId, ctx.user.id, action, target ?? null, detail ? JSON.stringify(detail) : null, ip ?? null],
  );
}
