import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, Toggle, useAction, useLang, useLoad, yesNo } from './shared';
import type { ClientGroup } from './Clients';

/**
 * קבוצות לקוחות (AVAYA, קבוצת רפק, קוריץ מערכות…). משותפות לכל החברות, בדיוק
 * כמו הלקוחות עצמם, ומשמשות לסינון הרשימה ולדו"חות. השבתה אינה מוחקת שיוך:
 * לקוחות שמשויכים לקבוצה נשארים משויכים, והקבוצה רק יוצאת מהבוחרים.
 */

export default function ClientGroups() {
  const { lang, tx } = useLang();
  const [editing, setEditing] = useState<Partial<ClientGroup> | null>(null);
  const list = useLoad(() => api.get<ClientGroup[]>('/api/client-groups?all=1'), []);
  const { run, error, busy } = useAction();

  async function save(values: Partial<ClientGroup>) {
    const body = {
      name: values.name ?? '',
      manager: values.manager ?? null,
      ...(values.id ? { active: values.active !== false } : null),
    };
    const done = await run(() =>
      values.id ? api.patch(`/api/client-groups/${values.id}`, body) : api.post('/api/client-groups', body),
    );
    if (done) {
      setEditing(null);
      await list.reload();
    }
  }

  async function deactivate(group: ClientGroup) {
    const message = group.clients
      ? tx(
          `לקבוצה "${group.name}" משויכים ${group.clients} לקוחות. להשבית אותה? השיוך יישמר.`,
          `${group.clients} clients belong to "${group.name}". Deactivate it? Their membership is kept.`,
        )
      : tx(`להשבית את הקבוצה "${group.name}"?`, `Deactivate the group "${group.name}"?`);
    if (!confirm(message)) return;
    if (await run(() => api.del(`/api/client-groups/${group.id}`))) await list.reload();
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={{ ...s.title, flex: 1 }}>{tx('קבוצות לקוחות', 'Client groups')}</h2>
        <button type="button" style={s.primary} onClick={() => setEditing({ active: true })}>
          {tx('קבוצה חדשה', 'New group')}
        </button>
      </div>
      <p style={s.hint}>
        {tx(
          'הקבוצות משותפות לכל ארבע החברות ומשמשות לסינון רשימת הלקוחות ולדו"חות.',
          'Groups are shared by all four companies and are used for filtering the client list and for reports.',
        )}
      </p>
      <ErrorText>{error || list.error || ''}</ErrorText>

      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{tx('שם הקבוצה', 'Group')}</th>
            <th style={s.th}>{tx('מנהל', 'Manager')}</th>
            <th style={s.th}>{tx('לקוחות', 'Clients')}</th>
            <th style={s.th}>{tx('פעילה', 'Active')}</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((group) => (
            <tr key={group.id} style={group.active ? undefined : s.muted}>
              <td style={s.td}>{group.name}</td>
              <td style={s.td}>{group.manager ?? '—'}</td>
              <td style={s.td}>{group.clients}</td>
              <td style={s.td}>{yesNo(group.active, lang)}</td>
              <td style={s.td}>
                <div style={s.row}>
                  <button type="button" style={s.button} onClick={() => setEditing(group)} disabled={busy}>
                    {tx('עריכה', 'Edit')}
                  </button>
                  {group.active && (
                    <button type="button" style={s.danger} onClick={() => void deactivate(group)} disabled={busy}>
                      {tx('השבתה', 'Deactivate')}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!(list.data ?? []).length && !list.loading && (
            <tr>
              <td style={s.td} colSpan={5}>
                {tx('אין עדיין קבוצות.', 'No groups yet.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && (
        <Modal
          title={editing.id ? tx('עריכת קבוצה', 'Edit group') : tx('קבוצה חדשה', 'New group')}
          onClose={() => setEditing(null)}
        >
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void save(editing);
            }}
          >
            <Field label={tx('שם הקבוצה', 'Group name')}>
              <input
                style={s.input}
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                maxLength={120}
                required
                autoFocus
              />
            </Field>
            <Field label={tx('מנהל הקבוצה', 'Group manager')}>
              <input
                style={s.input}
                value={editing.manager ?? ''}
                onChange={(e) => setEditing({ ...editing, manager: e.target.value })}
                maxLength={120}
              />
            </Field>
            {editing.id && (
              <Toggle
                label={tx('קבוצה פעילה', 'Active group')}
                help={tx('קבוצה מושבתת יוצאת מהבוחרים; שיוך הלקוחות נשמר.', 'A deactivated group leaves the pickers; client membership is kept.')}
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
