import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, Toggle, useAction, useLang, useLoad } from './shared';
import type { Department } from './Departments';

/**
 * טופס נציג. שני חצאים, וההפרדה ביניהם היא כל הרעיון:
 *   למעלה — האדם: שם, מייל, שם משתמש ושפה. משותף לכל החברות שהוא עובד בהן.
 *   למטה  — השיוך לחברה שאני עובד בה כרגע: הרשאה, שלוחה, טלפונים, מחלקה
 *            ומזהה הנהלת חשבונות. לאותו אדם יכולים להיות פרטים אחרים לגמרי
 *            בחברה אחרת, והטופס הזה לא רואה ולא נוגע בהם.
 */

export type Role = 'admin' | 'agent' | 'opener' | 'viewer';

export interface UserRow {
  id: number;
  email: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  lang: 'he' | 'en';
  isSuperadmin: boolean;
  active: boolean;
  hasPassword: boolean;
  role: Role;
  extension: string | null;
  phone: string | null;
  mobile: string | null;
  companyEmail: string | null;
  recipientsEmail: string | null;
  departmentId: number | null;
  departmentName: string | null;
  externalId: string | null;
  notifyWhenOwner: boolean;
  membershipActive: boolean;
  inOtherCompanies: boolean;
}

export const ROLE_LABELS: Record<Role, { he: string; en: string }> = {
  admin: { he: 'מנהל', en: 'Admin' },
  agent: { he: 'נציג', en: 'Agent' },
  opener: { he: 'פותח קריאות', en: 'Opener' },
  viewer: { he: 'צפייה בלבד', en: 'Viewer' },
};

export default function UserForm({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  onClose(): void;
  onSaved(): void;
}) {
  const { lang, tx } = useLang();
  const [form, setForm] = useState<Partial<UserRow>>(
    user ?? { lang, role: 'agent', membershipActive: true, notifyWhenOwner: false },
  );
  const [password, setPassword] = useState('');
  const departments = useLoad(() => api.get<Department[]>('/api/departments'), []);
  const { run, error, busy } = useAction();
  const set = (patch: Partial<UserRow>) => setForm({ ...form, ...patch });

  async function save(event: FormEvent) {
    event.preventDefault();
    const body = {
      firstName: form.firstName ?? '',
      lastName: form.lastName ?? null,
      email: form.email ?? '',
      username: form.username ?? null,
      lang: form.lang ?? 'he',
      role: form.role ?? 'agent',
      extension: form.extension ?? null,
      phone: form.phone ?? null,
      mobile: form.mobile ?? null,
      companyEmail: form.companyEmail ?? null,
      recipientsEmail: form.recipientsEmail ?? null,
      departmentId: form.departmentId ?? null,
      externalId: form.externalId ?? null,
      notifyWhenOwner: form.notifyWhenOwner === true,
      membershipActive: form.membershipActive !== false,
      ...(user ? null : { password: password || undefined }),
    };
    const done = await run(() => (user ? api.patch(`/api/users/${user.id}`, body) : api.post('/api/users', body)));
    if (!done) return;
    if (user && password) {
      // סיסמה נשמרת בנתיב נפרד, כדי שלא תעבור בטעות בעדכון רגיל של פרטים
      if (!(await run(() => api.post(`/api/users/${user.id}/password`, { password })))) return;
    }
    onSaved();
    onClose();
  }

  async function clearPassword() {
    if (!user) return;
    if (!confirm(tx('לבטל את הסיסמה של הנציג?', "Clear this agent's password?"))) return;
    if (await run(() => api.post(`/api/users/${user.id}/password`, { clear: true }))) onSaved();
  }

  return (
    <Modal title={user ? tx('עריכת נציג', 'Edit agent') : tx('נציג חדש', 'New agent')} onClose={onClose}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={save}>
        <section style={s.card}>
          <strong>{tx('האדם — משותף לכל החברות', 'The person — shared by all companies')}</strong>
          <p style={s.hint}>
            {tx(
              'השם, המייל והסיסמה זהים בכל חברה שהוא עובד בה.',
              'Name, e-mail and password are the same in every company they work for.',
            )}
          </p>
          <div style={s.row}>
            <Field label={tx('שם פרטי', 'First name')}>
              <input
                style={s.input}
                value={form.firstName ?? ''}
                onChange={(e) => set({ firstName: e.target.value })}
                maxLength={60}
                required
                autoFocus
              />
            </Field>
            <Field label={tx('שם משפחה', 'Last name')}>
              <input
                style={s.input}
                value={form.lastName ?? ''}
                onChange={(e) => set({ lastName: e.target.value })}
                maxLength={60}
              />
            </Field>
          </div>
          <div style={s.row}>
            <Field label={tx('מייל (כניסה למערכת)', 'E-mail (sign-in)')}>
              <input
                style={s.input}
                type="email"
                dir="ltr"
                value={form.email ?? ''}
                onChange={(e) => set({ email: e.target.value })}
                maxLength={200}
                required
              />
            </Field>
            <Field label={tx('שם משתמש', 'Username')}>
              <input
                style={s.input}
                dir="ltr"
                value={form.username ?? ''}
                onChange={(e) => set({ username: e.target.value })}
                maxLength={50}
              />
            </Field>
            <Field label={tx('שפת הממשק', 'Interface language')}>
              <select style={s.input} value={form.lang ?? 'he'} onChange={(e) => set({ lang: e.target.value as 'he' | 'en' })}>
                <option value="he">{tx('עברית', 'Hebrew')}</option>
                <option value="en">{tx('אנגלית', 'English')}</option>
              </select>
            </Field>
          </div>
          <div style={s.row}>
            <Field label={user ? tx('סיסמה חדשה (ריק = בלי שינוי)', 'New password (blank = unchanged)') : tx('סיסמה', 'Password')}>
              <input
                style={s.input}
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                maxLength={200}
                autoComplete="new-password"
              />
            </Field>
            {user && user.hasPassword && (
              <button type="button" style={s.button} onClick={() => void clearPassword()} disabled={busy}>
                {tx('ביטול הסיסמה', 'Clear password')}
              </button>
            )}
          </div>
          {user?.inOtherCompanies && (
            <p style={s.hint}>
              {tx(
                'הנציג עובד גם בחברה אחרת. שינוי השם או המייל נראה שם גם כן; השלוחה וההרשאה לא.',
                'This agent also works for another company. Name and e-mail changes show there too; extension and role do not.',
              )}
            </p>
          )}
        </section>

        <section style={s.card}>
          <strong>{tx('השיוך לחברה הפעילה', 'Membership in the current company')}</strong>
          <p style={s.hint}>
            {tx(
              'כל השדות כאן שייכים לחברה שאתה עובד בה כרגע בלבד.',
              'Every field here belongs only to the company you are working in.',
            )}
          </p>
          <div style={s.row}>
            <Field label={tx('הרשאה', 'Role')}>
              <select style={s.input} value={form.role ?? 'agent'} onChange={(e) => set({ role: e.target.value as Role })}>
                {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                  <option key={role} value={role}>
                    {lang === 'en' ? ROLE_LABELS[role].en : ROLE_LABELS[role].he}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tx('שלוחה', 'Extension')}>
              <input
                style={s.input}
                dir="ltr"
                value={form.extension ?? ''}
                onChange={(e) => set({ extension: e.target.value })}
                maxLength={20}
              />
            </Field>
            <Field label={tx('מחלקה', 'Department')}>
              <select
                style={s.input}
                value={form.departmentId ?? ''}
                onChange={(e) => set({ departmentId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{tx('ללא', 'None')}</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={s.row}>
            <Field label={tx('טלפון', 'Phone')}>
              <input style={s.input} dir="ltr" value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} maxLength={40} />
            </Field>
            <Field label={tx('נייד', 'Mobile')}>
              <input style={s.input} dir="ltr" value={form.mobile ?? ''} onChange={(e) => set({ mobile: e.target.value })} maxLength={40} />
            </Field>
            <Field label={tx('מייל בחברה', 'E-mail in this company')}>
              <input
                style={s.input}
                type="email"
                dir="ltr"
                value={form.companyEmail ?? ''}
                onChange={(e) => set({ companyEmail: e.target.value })}
                maxLength={200}
              />
            </Field>
          </div>
          <div style={s.row}>
            <Field label={tx('נמענים נוספים להתראות', 'Extra notification recipients')} wide>
              <input
                style={s.input}
                dir="ltr"
                placeholder="a@b.co, c@d.co"
                value={form.recipientsEmail ?? ''}
                onChange={(e) => set({ recipientsEmail: e.target.value })}
                maxLength={1000}
              />
            </Field>
            <Field label={tx('מזהה בהנהלת חשבונות', 'Accounting id')}>
              <input
                style={s.input}
                dir="ltr"
                value={form.externalId ?? ''}
                onChange={(e) => set({ externalId: e.target.value })}
                maxLength={60}
              />
            </Field>
          </div>
          <Toggle
            label={tx('התראה כשאני האחראי על הקריאה', 'Notify me when I own the call')}
            help={tx('מייל כשנפתחת או מתעדכנת קריאה שאני האחראי עליה.', 'An e-mail when a call I own is opened or updated.')}
            checked={form.notifyWhenOwner === true}
            onChange={(notifyWhenOwner) => set({ notifyWhenOwner })}
          />
          {user && (
            <Toggle
              label={tx('שיוך פעיל בחברה הזו', 'Active in this company')}
              help={tx(
                'כיבוי מוציא את הנציג מהחברה הזו בלבד; בחברות האחרות הוא ממשיך לעבוד.',
                'Turning it off removes the agent from this company only; other companies keep working.',
              )}
              checked={form.membershipActive !== false}
              onChange={(membershipActive) => set({ membershipActive })}
            />
          )}
        </section>

        <ErrorText>{error}</ErrorText>
        <div style={s.row}>
          <button type="submit" style={s.primary} disabled={busy || !(form.firstName ?? '').trim() || !(form.email ?? '').trim()}>
            {tx('שמירה', 'Save')}
          </button>
          <button type="button" style={s.button} onClick={onClose}>
            {tx('ביטול', 'Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
