import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, Toggle, useAction, useLang, useLoad, yesNo } from './shared';
import type { Department } from './Departments';

/**
 * מסך אחד לכל ששת סוגי טבלאות הקוד. במקום שישה מסכים כמעט זהים, המסך מקבל
 * מהשרת את תיאור הסוגים (/api/lookups/kinds) ומצייר לכל סוג את העמודות
 * הנוספות שלו: "סוגר קריאה" לסטטוס, "דקות" למשך טיפול, "נספר בבנק שעות"
 * לסוג שעות, "מחלקה מטפלת" לסוג שירות וכן הלאה.
 *
 * ערך מסומן "משותף" הוא ערך של כל ארבע החברות — כך הגיעו כל ערכי הבסיס —
 * ושינוי בו נראה לכולן. ערך שנוצר כ"לחברה הזו בלבד" לא קיים אצל האחרות.
 * השבתה ולא מחיקה: קריאה שנסגרה בסטטוס מסוים חייבת להמשיך להציג אותו.
 */

type ExtraType = 'bool' | 'int' | 'money' | 'hours' | 'department';

interface KindInfo {
  kind: string;
  label: string;
  extras: { key: string; type: ExtraType; label: string }[];
}

interface Lookup {
  id: number;
  kind: string;
  companyId: number | null;
  name: string;
  nameEn: string | null;
  label: string;
  sort: number;
  active: boolean;
  shared: boolean;
  isClosing: boolean | null;
  minutes: number | null;
  departmentId: number | null;
  departmentName: string | null;
  countsInBank: boolean | null;
  stdHours: number | null;
  price: number | null;
  [key: string]: unknown;
}

export default function Lookups() {
  const { lang, tx } = useLang();
  const kinds = useLoad(() => api.get<KindInfo[]>('/api/lookups/kinds'), []);
  const [kind, setKind] = useState('call_status');
  const [editing, setEditing] = useState<Partial<Lookup> | null>(null);
  const list = useLoad(() => api.get<Lookup[]>(`/api/lookups?kind=${kind}&all=1`), [kind]);
  const departments = useLoad(() => api.get<Department[]>('/api/departments'), []);
  const { run, error, busy } = useAction();
  const info = (kinds.data ?? []).find((k) => k.kind === kind);

  const extraValue = (row: Lookup, key: string): string => {
    const value = row[key];
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return yesNo(value, lang);
    if (key === 'departmentId') return row.departmentName ?? '—';
    return String(value);
  };

  async function save(values: Partial<Lookup>) {
    const body: Record<string, unknown> = {
      kind,
      name: values.name ?? '',
      nameEn: values.nameEn ?? null,
      sort: values.sort ?? null,
      ...(values.id ? { active: values.active !== false } : { companyOnly: values.shared === false }),
    };
    for (const extra of info?.extras ?? []) body[extra.key] = values[extra.key] ?? null;
    const done = await run(() => (values.id ? api.patch(`/api/lookups/${values.id}`, body) : api.post('/api/lookups', body)));
    if (done) {
      setEditing(null);
      await list.reload();
    }
  }

  async function deactivate(row: Lookup) {
    const warn = row.shared
      ? tx(
          `"${row.label}" הוא ערך משותף לכל ארבע החברות. להשבית אותו לכולן?`,
          `"${row.label}" is shared by all four companies. Deactivate it for all of them?`,
        )
      : tx(`להשבית את "${row.label}"?`, `Deactivate "${row.label}"?`);
    if (!confirm(warn)) return;
    if (await run(() => api.del(`/api/lookups/${row.id}`))) await list.reload();
  }

  /** הזזת ערך בסדר ההצגה. השרת מקבל את כל הרשימה לפי הסדר החדש. */
  async function move(row: Lookup, delta: number) {
    const rows = [...(list.data ?? [])];
    const from = rows.findIndex((r) => r.id === row.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= rows.length) return;
    const moved = rows[from]!;
    rows.splice(from, 1);
    rows.splice(to, 0, moved);
    if (await run(() => api.post('/api/lookups/reorder', { kind, ids: rows.map((r) => r.id) }))) await list.reload();
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={{ ...s.title, flex: 1 }}>{tx('טבלאות קוד', 'Lookup tables')}</h2>
        <Field label={tx('סוג', 'Kind')}>
          <select style={s.input} value={kind} onChange={(e) => setKind(e.target.value)}>
            {(kinds.data ?? []).map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" style={s.primary} onClick={() => setEditing({ active: true, shared: true })}>
          {tx('ערך חדש', 'New value')}
        </button>
      </div>
      <p style={s.hint}>
        {tx(
          'רק ערך פעיל מופיע בבוחרים של טופס הקריאה. ערך משותף שייך לכל ארבע החברות.',
          'Only active values appear in the call form pickers. A shared value belongs to all four companies.',
        )}
      </p>
      <ErrorText>{error || list.error || kinds.error || ''}</ErrorText>

      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{tx('סדר', 'Order')}</th>
            <th style={s.th}>{tx('שם', 'Name')}</th>
            <th style={s.th}>{tx('שם באנגלית', 'Name (English)')}</th>
            {(info?.extras ?? []).map((extra) => (
              <th key={extra.key} style={s.th}>
                {extra.label}
              </th>
            ))}
            <th style={s.th}>{tx('טווח', 'Scope')}</th>
            <th style={s.th}>{tx('פעיל', 'Active')}</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((row, index) => (
            <tr key={row.id} style={row.active ? undefined : s.muted}>
              <td style={s.td}>
                <div style={s.row}>
                  <button
                    type="button"
                    style={s.button}
                    aria-label={tx('העלה', 'Move up')}
                    disabled={busy || index === 0}
                    onClick={() => void move(row, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    style={s.button}
                    aria-label={tx('הורד', 'Move down')}
                    disabled={busy || index === (list.data ?? []).length - 1}
                    onClick={() => void move(row, 1)}
                  >
                    ↓
                  </button>
                </div>
              </td>
              <td style={s.td}>{row.name}</td>
              <td style={s.td} dir="ltr">
                {row.nameEn ?? '—'}
              </td>
              {(info?.extras ?? []).map((extra) => (
                <td key={extra.key} style={s.td}>
                  {extraValue(row, extra.key)}
                </td>
              ))}
              <td style={s.td}>
                <span style={s.badge}>{row.shared ? tx('כל החברות', 'All companies') : tx('החברה הזו', 'This company')}</span>
              </td>
              <td style={s.td}>{yesNo(row.active, lang)}</td>
              <td style={s.td}>
                <div style={s.row}>
                  <button type="button" style={s.button} onClick={() => setEditing(row)} disabled={busy}>
                    {tx('עריכה', 'Edit')}
                  </button>
                  {row.active && (
                    <button type="button" style={s.danger} onClick={() => void deactivate(row)} disabled={busy}>
                      {tx('השבתה', 'Deactivate')}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!(list.data ?? []).length && !list.loading && (
            <tr>
              <td style={s.td} colSpan={6 + (info?.extras.length ?? 0)}>
                {tx('אין ערכים בסוג הזה.', 'No values of this kind.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && (
        <Modal
          title={`${editing.id ? tx('עריכת ערך', 'Edit value') : tx('ערך חדש', 'New value')} · ${info?.label ?? ''}`}
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
              <Field label={tx('שם', 'Name')}>
                <input
                  style={s.input}
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  maxLength={120}
                  required
                  autoFocus
                />
              </Field>
              <Field label={tx('שם באנגלית', 'Name in English')}>
                <input
                  style={s.input}
                  dir="ltr"
                  value={editing.nameEn ?? ''}
                  onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                  maxLength={120}
                />
              </Field>
            </div>

            {(info?.extras ?? []).map((extra) =>
              extra.type === 'bool' ? (
                <Toggle
                  key={extra.key}
                  label={extra.label}
                  checked={editing[extra.key] === true}
                  onChange={(value) => setEditing({ ...editing, [extra.key]: value })}
                />
              ) : extra.type === 'department' ? (
                <Field key={extra.key} label={extra.label}>
                  <select
                    style={s.input}
                    value={(editing[extra.key] as number | null) ?? ''}
                    onChange={(e) => setEditing({ ...editing, [extra.key]: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">{tx('ללא', 'None')}</option>
                    {(departments.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field key={extra.key} label={extra.label}>
                  <input
                    style={s.input}
                    type="number"
                    dir="ltr"
                    min={0}
                    step={extra.type === 'int' ? 1 : '0.01'}
                    value={(editing[extra.key] as number | null) ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, [extra.key]: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  />
                </Field>
              ),
            )}

            {!editing.id && (
              <Toggle
                label={tx('ערך משותף לכל ארבע החברות', 'Shared by all four companies')}
                help={tx(
                  'כיבוי יוצר את הערך לחברה שאתה עובד בה כרגע בלבד.',
                  'Turning it off creates the value for the company you are working in only.',
                )}
                checked={editing.shared !== false}
                onChange={(shared) => setEditing({ ...editing, shared })}
              />
            )}
            {editing.id && (
              <Toggle
                label={tx('ערך פעיל', 'Active value')}
                help={tx(
                  'ערך מושבת יוצא מהבוחרים, וקריאות שכבר נושאות אותו ממשיכות להציג אותו.',
                  'A deactivated value leaves the pickers; calls that already carry it keep showing it.',
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
