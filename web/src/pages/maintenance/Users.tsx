import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, useAction, useLang, useLoad, yesNo } from './shared';
import type { Department } from './Departments';
import UserForm, { ROLE_LABELS, type Role, type UserRow } from './UserForm';

/**
 * רשימת הנציגים של החברה שאני עובד בה כרגע. אדם שעובד גם בחברה אחרת מסומן,
 * אבל הפרטים שלו שם לא מוצגים כאן ולא נערכים מכאן.
 *
 * "צירוף נציג קיים" הוא המסלול למי שכבר עובד בחברה אחרת בקבוצה: פותחים לו
 * שיוך לחברה הזו במקום זהות שנייה, כך שהסיסמה והמייל נשארים אחד.
 */

interface Available {
  id: number;
  email: string;
  firstName: string;
  lastName: string | null;
}

export default function Users() {
  const { lang, tx } = useLang();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [withInactive, setWithInactive] = useState(false);
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  const [attaching, setAttaching] = useState(false);
  const { run, error, busy } = useAction();

  const query = new URLSearchParams();
  if (search.trim()) query.set('q', search.trim());
  if (role) query.set('role', role);
  if (departmentId) query.set('departmentId', departmentId);
  if (withInactive) query.set('all', '1');
  const list = useLoad(() => api.get<UserRow[]>(`/api/users?${query.toString()}`), [
    search,
    role,
    departmentId,
    withInactive,
  ]);
  const departments = useLoad(() => api.get<Department[]>('/api/departments'), []);

  async function removeMembership(user: UserRow) {
    const ok = confirm(
      tx(
        `להוציא את ${user.firstName} מהחברה הזו? בחברות האחרות הוא ימשיך לעבוד.`,
        `Remove ${user.firstName} from this company? Their other companies are untouched.`,
      ),
    );
    if (!ok) return;
    if (await run(() => api.del(`/api/users/${user.id}/membership`))) await list.reload();
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={{ ...s.title, flex: 1 }}>{tx('נציגים', 'Agents')}</h2>
        <button type="button" style={s.button} onClick={() => setAttaching(true)}>
          {tx('צירוף נציג קיים', 'Attach an existing agent')}
        </button>
        <button type="button" style={s.primary} onClick={() => setEditing(null)}>
          {tx('נציג חדש', 'New agent')}
        </button>
      </div>

      <div style={s.row}>
        <Field label={tx('חיפוש', 'Search')}>
          <input
            style={s.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tx('שם, מייל או שלוחה', 'Name, e-mail or extension')}
          />
        </Field>
        <Field label={tx('הרשאה', 'Role')}>
          <select style={s.input} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{tx('הכול', 'All')}</option>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {lang === 'en' ? ROLE_LABELS[r].en : ROLE_LABELS[r].he}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tx('מחלקה', 'Department')}>
          <select style={s.input} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{tx('הכול', 'All')}</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <label style={{ ...s.row, gap: 6 }}>
          <input type="checkbox" checked={withInactive} onChange={(e) => setWithInactive(e.target.checked)} />
          {tx('כולל מושבתים', 'Include inactive')}
        </label>
      </div>

      <ErrorText>{error || list.error || ''}</ErrorText>

      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{tx('שם', 'Name')}</th>
            <th style={s.th}>{tx('מייל', 'E-mail')}</th>
            <th style={s.th}>{tx('הרשאה', 'Role')}</th>
            <th style={s.th}>{tx('שלוחה', 'Extension')}</th>
            <th style={s.th}>{tx('מחלקה', 'Department')}</th>
            <th style={s.th}>{tx('מזהה הנה"ח', 'Accounting id')}</th>
            <th style={s.th}>{tx('סיסמה', 'Password')}</th>
            <th style={s.th}>{tx('פעיל כאן', 'Active here')}</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((user) => (
            <tr key={user.id} style={user.membershipActive && user.active ? undefined : s.muted}>
              <td style={s.td}>
                {user.firstName} {user.lastName ?? ''}
                {user.inOtherCompanies && (
                  <span style={{ ...s.badge, marginInlineStart: 6 }} title={tx('עובד גם בחברה אחרת בקבוצה', 'Also works for another company in the group')}>
                    {tx('גם בחברה אחרת', 'Multi-company')}
                  </span>
                )}
              </td>
              <td style={s.td} dir="ltr">
                {user.email}
              </td>
              <td style={s.td}>{lang === 'en' ? ROLE_LABELS[user.role].en : ROLE_LABELS[user.role].he}</td>
              <td style={s.td} dir="ltr">
                {user.extension ?? '—'}
              </td>
              <td style={s.td}>{user.departmentName ?? '—'}</td>
              <td style={s.td} dir="ltr">
                {user.externalId ?? '—'}
              </td>
              <td style={s.td}>{user.hasPassword ? yesNo(true, lang) : tx('אין', 'None')}</td>
              <td style={s.td}>{yesNo(user.membershipActive && user.active, lang)}</td>
              <td style={s.td}>
                <div style={s.row}>
                  <button type="button" style={s.button} onClick={() => setEditing(user)} disabled={busy}>
                    {tx('עריכה', 'Edit')}
                  </button>
                  {user.membershipActive && (
                    <button type="button" style={s.danger} onClick={() => void removeMembership(user)} disabled={busy}>
                      {tx('הוצאה מהחברה', 'Remove from company')}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!(list.data ?? []).length && !list.loading && (
            <tr>
              <td style={s.td} colSpan={9}>
                {tx('לא נמצאו נציגים.', 'No agents found.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== undefined && (
        <UserForm user={editing} onClose={() => setEditing(undefined)} onSaved={() => void list.reload()} />
      )}
      {attaching && (
        <AttachExisting
          onClose={() => setAttaching(false)}
          onAttached={() => {
            setAttaching(false);
            void list.reload();
          }}
        />
      )}
    </div>
  );
}

/** צירוף אדם שקיים במערכת ואינו משויך לחברה הזו. מוצגים שם ומייל בלבד. */
function AttachExisting({ onClose, onAttached }: { onClose(): void; onAttached(): void }) {
  const { lang, tx } = useLang();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [extension, setExtension] = useState('');
  const [picked, setPicked] = useState<Available | null>(null);
  const people = useLoad(() => api.get<Available[]>(`/api/users/available?q=${encodeURIComponent(search)}`), [search]);
  const { run, error, busy } = useAction();

  async function attach() {
    if (!picked) return;
    const done = await run(() =>
      api.put(`/api/users/${picked.id}/membership`, { role, extension: extension || null, membershipActive: true }),
    );
    if (done) onAttached();
  }

  return (
    <Modal title={tx('צירוף נציג קיים לחברה', 'Attach an existing agent')} onClose={onClose}>
      <p style={s.hint}>
        {tx(
          'אדם שעובד בחברה אחרת בקבוצה מקבל כאן שיוך לחברה הזו, עם הרשאה ושלוחה משלה. הסיסמה והמייל נשארים שלו.',
          'A person who works for another company in the group gets a membership here, with its own role and extension. Their password and e-mail stay as they are.',
        )}
      </p>
      <Field label={tx('חיפוש לפי שם או מייל', 'Search by name or e-mail')}>
        <input style={s.input} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      </Field>
      <table style={s.table}>
        <tbody>
          {(people.data ?? []).map((person) => (
            <tr key={person.id} style={picked?.id === person.id ? { background: 'var(--primary-subtle)' } : undefined}>
              <td style={s.td}>
                {person.firstName} {person.lastName ?? ''}
              </td>
              <td style={s.td} dir="ltr">
                {person.email}
              </td>
              <td style={s.td}>
                <button type="button" style={s.button} onClick={() => setPicked(person)}>
                  {tx('בחירה', 'Pick')}
                </button>
              </td>
            </tr>
          ))}
          {!(people.data ?? []).length && !people.loading && (
            <tr>
              <td style={s.td}>{tx('לא נמצא אדם שאינו משויך לחברה הזו.', 'No person outside this company was found.')}</td>
            </tr>
          )}
        </tbody>
      </table>
      {picked && (
        <div style={s.row}>
          <Field label={tx('הרשאה בחברה הזו', 'Role in this company')}>
            <select style={s.input} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {lang === 'en' ? ROLE_LABELS[r].en : ROLE_LABELS[r].he}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tx('שלוחה בחברה הזו', 'Extension in this company')}>
            <input style={s.input} dir="ltr" value={extension} onChange={(e) => setExtension(e.target.value)} maxLength={20} />
          </Field>
        </div>
      )}
      <ErrorText>{error || people.error || ''}</ErrorText>
      <div style={s.row}>
        <button type="button" style={s.primary} onClick={() => void attach()} disabled={busy || !picked}>
          {tx('צירוף', 'Attach')}
        </button>
        <button type="button" style={s.button} onClick={onClose}>
          {tx('ביטול', 'Cancel')}
        </button>
      </div>
    </Modal>
  );
}
