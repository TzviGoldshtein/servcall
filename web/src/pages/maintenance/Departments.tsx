import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, SortHeader, Toggle, useAction, useLang, useLoad, yesNo } from './shared';

/**
 * מחלקות. נתון משותף לכל ארבע החברות, ולכן המסך אומר את זה במפורש: שינוי כאן
 * נראה גם לקוריץ וגם לסדקום. העמודה "נציגים" היא פר חברה — כמה נציגים של
 * החברה שאני עובד בה כרגע משויכים למחלקה.
 */

export interface Department {
  id: number;
  name: string;
  nameEn: string | null;
  managerId: number | null;
  managerName: string | null;
  active: boolean;
  members: number;
}

interface UserOption {
  id: number;
  name: string;
}

export default function Departments() {
  const { lang, tx } = useLang();
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<Partial<Department> | null>(null);
  const list = useLoad(() => api.get<Department[]>('/api/departments?all=1'), []);
  const users = useLoad(() => api.get<UserOption[]>('/api/users/options'), []);
  const { run, error, busy } = useAction();

  const rows = [...(list.data ?? [])].sort((a, b) => {
    const pick = (d: Department) =>
      sort === 'members' ? d.members : sort === 'manager' ? (d.managerName ?? '') : d.name;
    const x = pick(a);
    const y = pick(b);
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), lang);
    return dir === 'asc' ? cmp : -cmp;
  });

  const onSort = (column: string) => {
    if (column === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(column);
      setDir('asc');
    }
  };

  async function save(values: Partial<Department>) {
    const body = {
      name: values.name ?? '',
      nameEn: values.nameEn ?? null,
      managerId: values.managerId ?? null,
      ...(values.id ? { active: values.active !== false } : null),
    };
    const done = await run(() =>
      values.id ? api.patch(`/api/departments/${values.id}`, body) : api.post('/api/departments', body),
    );
    if (done) {
      setEditing(null);
      await list.reload();
    }
  }

  async function deactivate(dept: Department) {
    const warn = dept.members
      ? tx(
          `למחלקה משויכים ${dept.members} נציגים בחברה הזו. להשבית אותה?`,
          `${dept.members} agents in this company belong to this department. Deactivate it?`,
        )
      : tx(`להשבית את המחלקה "${dept.name}"?`, `Deactivate the department "${dept.name}"?`);
    if (!confirm(warn)) return;
    if (await run(() => api.del(`/api/departments/${dept.id}`))) await list.reload();
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={{ ...s.title, flex: 1 }}>{tx('מחלקות', 'Departments')}</h2>
        <button type="button" style={s.primary} onClick={() => setEditing({ active: true })}>
          {tx('מחלקה חדשה', 'New department')}
        </button>
      </div>
      <p style={s.hint}>
        {tx(
          'המחלקות משותפות לכל ארבע החברות. מנהל מחלקה נבחר מתוך נציגי החברה שאתה עובד בה כרגע.',
          'Departments are shared by all four companies. A manager is picked from the agents of the company you are working in.',
        )}
      </p>
      <ErrorText>{error || list.error || ''}</ErrorText>

      <table style={s.table}>
        <thead>
          <tr>
            <SortHeader column="name" label={tx('שם', 'Name')} sort={sort} dir={dir} onSort={onSort} />
            <th style={s.th}>{tx('שם באנגלית', 'Name (English)')}</th>
            <SortHeader column="manager" label={tx('מנהל', 'Manager')} sort={sort} dir={dir} onSort={onSort} />
            <SortHeader column="members" label={tx('נציגים בחברה', 'Agents here')} sort={sort} dir={dir} onSort={onSort} />
            <th style={s.th}>{tx('פעילה', 'Active')}</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((dept) => (
            <tr key={dept.id} style={dept.active ? undefined : s.muted}>
              <td style={s.td}>{dept.name}</td>
              <td style={s.td}>{dept.nameEn ?? '—'}</td>
              <td style={s.td}>{dept.managerName ?? '—'}</td>
              <td style={s.td}>{dept.members}</td>
              <td style={s.td}>{yesNo(dept.active, lang)}</td>
              <td style={s.td}>
                <div style={s.row}>
                  <button type="button" style={s.button} onClick={() => setEditing(dept)} disabled={busy}>
                    {tx('עריכה', 'Edit')}
                  </button>
                  {dept.active && (
                    <button type="button" style={s.danger} onClick={() => void deactivate(dept)} disabled={busy}>
                      {tx('השבתה', 'Deactivate')}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && !list.loading && (
            <tr>
              <td style={s.td} colSpan={6}>
                {tx('אין עדיין מחלקות.', 'No departments yet.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && (
        <Modal
          title={editing.id ? tx('עריכת מחלקה', 'Edit department') : tx('מחלקה חדשה', 'New department')}
          onClose={() => setEditing(null)}
        >
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void save(editing);
            }}
          >
            <div style={s.row}>
              <Field label={tx('שם המחלקה', 'Department name')}>
                <input
                  style={s.input}
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  maxLength={80}
                  required
                  autoFocus
                />
              </Field>
              <Field label={tx('שם באנגלית', 'Name in English')}>
                <input
                  style={s.input}
                  value={editing.nameEn ?? ''}
                  onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                  maxLength={80}
                  dir="ltr"
                />
              </Field>
            </div>
            <Field label={tx('מנהל המחלקה', 'Department manager')}>
              <select
                style={s.input}
                value={editing.managerId ?? ''}
                onChange={(e) => setEditing({ ...editing, managerId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{tx('ללא', 'None')}</option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            {editing.id && (
              <Toggle
                label={tx('מחלקה פעילה', 'Active department')}
                help={tx(
                  'מחלקה מושבתת לא מופיעה בבוחרים, והשיוכים ההיסטוריים נשמרים.',
                  'A deactivated department leaves the pickers; past assignments are kept.',
                )}
                checked={editing.active !== false}
                onChange={(active) => setEditing({ ...editing, active })}
              />
            )}
            <ErrorText>{error}</ErrorText>
            <div style={s.row}>
              <button type="submit" style={s.primary} disabled={busy || !(editing.name ?? '').trim()}>
                {tx('שמירה', 'Save')}
              </button>
              <button type="button" style={s.button} onClick={() => setEditing(null)}>
                {tx('ביטול', 'Cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
