import { AsyncLocalStorage } from 'node:async_hooks';
import type { Ctx, Role, SessionUser } from './context.ts';
import type { Db } from './db.ts';
import { HttpError } from './errors.ts';
import { msg, type Lang } from './i18n.ts';

/**
 * ההקשר של הבקשה הנוכחית. ה-hook של האימות ממלא אותו, והראוטים קוראים אותו דרך
 * `requestContext()` — כך חתימת הראוטים נשארת `registerXRoutes(app, ctx)` ואף ראוט
 * לא מקבל את מזהה החברה כפרמטר שאפשר לשכוח להעביר או להחליף.
 */
export interface RequestState {
  user?: SessionUser;
  /** החברה הפעילה. null = מחובר אך טרם בחר חברה (מסך בחירת החברה). */
  companyId?: number | null;
  sessionId?: string;
}

const current = new AsyncLocalStorage<RequestState>();

export const runRequest = (next: () => void): void => current.run({}, next);

export function setRequestUser(user: SessionUser, companyId: number | null, sessionId: string): void {
  const state = current.getStore();
  if (!state) return;
  state.user = user;
  state.companyId = companyId;
  state.sessionId = sessionId;
}

/** מה שידוע על הבקשה, כולל המצב "מחובר בלי חברה". לראוטים של ההתחברות בלבד. */
export const requestState = (): RequestState => current.getStore() ?? {};

export const requestLang = (): Lang => current.getStore()?.user?.lang ?? 'he';

/**
 * החברה הפעילה של הבקשה. שיוך שבוטל מפיל את החברה שנשמרה בסשן — אחרת נציג שהוצא
 * מחברה היה ממשיך לראות אותה עד שיתנתק. חברה אחת = אין מה לבחור.
 */
export function resolveCompany(
  user: Pick<SessionUser, 'memberships' | 'isSuperadmin'>,
  wanted: number | null,
): number | null {
  const allowed =
    wanted !== null && (user.isSuperadmin || user.memberships.some((m) => m.companyId === wanted));
  if (allowed) return wanted;
  return user.memberships.length === 1 ? user.memberships[0]!.companyId : null;
}

/** ההרשאה של המשתמש באותה חברה. סופר-אדמין נכנס כמנהל גם לחברה שאינו משויך אליה. */
export function roleIn(user: SessionUser, companyId: number): Role {
  const membership = user.memberships.find((m) => m.companyId === companyId);
  if (membership) return membership.role;
  if (user.isSuperadmin) return 'admin';
  throw new HttpError(403, msg('forbidden', user.lang));
}

/**
 * Ctx שחלקיו התלויים במשתמש נקראים מהבקשה הרצה. הגישה ל-`companyId` נכשלת כשאין
 * חברה פעילה ואינה נופלת לחברה כלשהי — כך אין דרך לכתוב שאילתה שתדלוף בין חברות
 * בגלל שכחה של התנאי.
 */
export function requestContext(db: Db): Ctx {
  const userOf = (): SessionUser => {
    const user = current.getStore()?.user;
    if (!user) throw new HttpError(401, msg('authRequired'));
    return user;
  };
  const companyOf = (): number => {
    const user = userOf();
    const companyId = current.getStore()?.companyId;
    if (companyId == null) throw new HttpError(403, msg('noCompany', user.lang));
    return companyId;
  };
  return {
    get db() {
      return db;
    },
    get user() {
      return userOf();
    },
    get companyId() {
      return companyOf();
    },
    get role() {
      return roleIn(userOf(), companyOf());
    },
    get lang() {
      return userOf().lang;
    },
  };
}
