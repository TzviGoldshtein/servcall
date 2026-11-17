import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, Toggle, useAction, useLang, useLoad, yesNo } from './shared';

/**
 * אנשי הקשר של לקוח. מוצגים בתוך כרטיס הלקוח, כי הם לא ישות שעומדת בפני עצמה.
 *
 * שני כללים שהמסך מקפיד עליהם:
 * 1. השם שמוצג לאיש הקשר הוא google_name כשהוא קיים (מגיע מאנשי הקשר של גוגל),
 *    ואילו שם הלקוח הוא תמיד clients.name. לכן הכותרת כאן אומרת את שם הלקוח,
 *    והשורות אומרות את שם האדם.
 * 2. הנייד נשמר גם בצורה מנורמלת (E.164) והיא זו שמופיעה לצד השדה. בלעדיה
 *    הודעת ווטסאפ נכנסת לא תזוהה כלקוח, ולכן השרת מחשב אותה בעצמו.
 */

export interface Contact {
  id: number;
  clientId: number;
  firstName: string;
  lastName: string | null;
  googleName: string | null;
  displayName: string | null;
  nationalId: string | null;
  mobile: string | null;
  mobileE164: string | null;
  phone: string | null;
  phone2: string | null;
  fax: string | null;
  email: string | null;
  position: string | null;
  username: string | null;
  hasPassword: boolean;
  readOnly: boolean;
  externalId: string | null;
  active: boolean;
}

export default function Contacts({ clientId, clientName }: { clientId: number; clientName: string }) {
  const { lang, tx } = useLang();
  const [withInactive, setWithInactive] = useState(false);
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const list = useLoad(
    () => api.get<Contact[]>(`/api/clients/${clientId}/contacts${withInactive ? '?all=1' : ''}`),
    [clientId, withInactive],
  );
  const { run, error, busy } = useAction();

  async function deactivate(contact: Contact) {
    const name = contact.displayName ?? contact.firstName;
    if (!confirm(tx(`להשבית את איש הקשר "${name}"?`, `Deactivate the contact "${name}"?`))) return;
    if (await run(() => api.del(`/api/contacts/${contact.id}`))) await list.reload();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={s.head}>
        <strong style={{ flex: 1 }}>
          {tx('אנשי קשר של', 'Contacts of')} {clientName}
        </strong>
        <label style={{ ...s.row, gap: 6 }}>
          <input type="checkbox" checked={withInactive} onChange={(e) => setWithInactive(e.target.checked)} />
          {tx('כולל מושבתים', 'Include inactive')}
        </label>
        <button type="button" style={s.primary} onClick={() => setEditing(null)}>
          {tx('איש קשר חדש', 'New contact')}
        </button>
      </div>
      <ErrorText>{error || list.error || ''}</ErrorText>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{tx('שם איש הקשר', 'Contact')}</th>
            <th style={s.th}>{tx('תפקיד', 'Position')}</th>
            <th style={s.th}>{tx('נייד', 'Mobile')}</th>
            <th style={s.th}>{tx('מנורמל לווטסאפ', 'Normalised for WhatsApp')}</th>
            <th style={s.th}>{tx('מייל', 'E-mail')}</th>
            <th style={s.th}>{tx('פורטל', 'Portal')}</th>
            <th style={s.th}>{tx('פעיל', 'Active')}</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((contact) => (
            <tr key={contact.id} style={contact.active ? undefined : s.muted}>
              <td style={s.td}>
                {contact.displayName ?? contact.firstName}
                {contact.googleName && (
                  <span style={{ ...s.badge, marginInlineStart: 6 }} title={tx('השם מאנשי הקשר של גוגל', 'Name from Google Contacts')}>
                    Google
                  </span>
                )}
              </td>
              <td style={s.td}>{contact.position ?? '—'}</td>
              <td style={s.td} dir="ltr">
                {contact.mobile ?? '—'}
              </td>
              <td style={s.td} dir="ltr">
                {contact.mobileE164 ?? '—'}
              </td>
              <td style={s.td} dir="ltr">
                {contact.email ?? '—'}
              </td>
              <td style={s.td}>
                {contact.username ? (contact.hasPassword ? tx('פעיל', 'Enabled') : tx('בלי סיסמה', 'No password')) : '—'}
              </td>
              <td style={s.td}>{yesNo(contact.active, lang)}</td>
              <td style={s.td}>
                <div style={s.row}>
                  <button type="button" style={s.button} onClick={() => setEditing(contact)} disabled={busy}>
                    {tx('עריכה', 'Edit')}
                  </button>
                  {contact.active && (
                    <button type="button" style={s.danger} onClick={() => void deactivate(contact)} disabled={busy}>
                      {tx('השבתה', 'Deactivate')}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!(list.data ?? []).length && !list.loading && (
            <tr>
              <td style={s.td} colSpan={8}>
                {tx('ללקוח הזה אין עדיין אנשי קשר.', 'This client has no contacts yet.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== undefined && (
        <ContactForm
          clientId={clientId}
          contact={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => void list.reload()}
        />
      )}
    </div>
  );
}

/** טופס איש קשר. google_name מוצג לקריאה בלבד — הוא מתעדכן מגוגל, לא מכאן. */
export function ContactForm({
  clientId,
  contact,
  onClose,
  onSaved,
}: {
  clientId: number;
  contact: Contact | null;
  onClose(): void;
  onSaved(): void;
}) {
  const { tx } = useLang();
  const [form, setForm] = useState<Partial<Contact>>(contact ?? { active: true, readOnly: false });
  const [password, setPassword] = useState('');
  const { run, error, busy } = useAction();
  const set = (patch: Partial<Contact>) => setForm({ ...form, ...patch });

  async function save(event: FormEvent) {
    event.preventDefault();
    const body = {
      firstName: form.firstName ?? '',
      lastName: form.lastName ?? null,
      nationalId: form.nationalId ?? null,
      mobile: form.mobile ?? null,
      phone: form.phone ?? null,
      phone2: form.phone2 ?? null,
      fax: form.fax ?? null,
      email: form.email ?? null,
      position: form.position ?? null,
      username: form.username ?? null,
      readOnly: form.readOnly === true,
      externalId: form.externalId ?? null,
      ...(contact ? { active: form.active !== false } : null),
    };
    const saved = await run(() =>
      contact ? api.patch<Contact>(`/api/contacts/${contact.id}`, body) : api.post<Contact>(`/api/clients/${clientId}/contacts`, body),
    );
    if (!saved) return;
    if (password) {
      // הסיסמה עוברת בנתיב נפרד, אחרי שיש לאיש הקשר שם משתמש
      if (!(await run(() => api.post(`/api/contacts/${saved.id}/password`, { password })))) return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal title={contact ? tx('עריכת איש קשר', 'Edit contact') : tx('איש קשר חדש', 'New contact')} onClose={onClose}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={save}>
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
            <input style={s.input} value={form.lastName ?? ''} onChange={(e) => set({ lastName: e.target.value })} maxLength={60} />
          </Field>
          <Field label={tx('תפקיד', 'Position')}>
            <input style={s.input} value={form.position ?? ''} onChange={(e) => set({ position: e.target.value })} maxLength={80} />
          </Field>
        </div>
        {form.googleName && (
          <Field label={tx('השם באנשי הקשר של גוגל (מתעדכן משם)', 'Name in Google Contacts (updated from there)')}>
            <input style={{ ...s.input, ...s.muted }} value={form.googleName} readOnly />
          </Field>
        )}
        <div style={s.row}>
          <Field label={tx('נייד', 'Mobile')}>
            <input style={s.input} dir="ltr" value={form.mobile ?? ''} onChange={(e) => set({ mobile: e.target.value })} maxLength={40} />
          </Field>
          <Field label={tx('מנורמל לווטסאפ', 'Normalised for WhatsApp')}>
            <input
              style={{ ...s.input, ...s.muted }}
              dir="ltr"
              value={form.mobileE164 ?? ''}
              readOnly
              placeholder={tx('מחושב בשמירה', 'Computed on save')}
            />
          </Field>
          <Field label={tx('טלפון', 'Phone')}>
            <input style={s.input} dir="ltr" value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} maxLength={40} />
          </Field>
        </div>
        <div style={s.row}>
          <Field label={tx('מייל', 'E-mail')}>
            <input
              style={s.input}
              type="email"
              dir="ltr"
              value={form.email ?? ''}
              onChange={(e) => set({ email: e.target.value })}
              maxLength={200}
            />
          </Field>
          <Field label={tx('ת.ז.', 'National id')}>
            <input
              style={s.input}
              dir="ltr"
              value={form.nationalId ?? ''}
              onChange={(e) => set({ nationalId: e.target.value })}
              maxLength={20}
            />
          </Field>
          <Field label={tx('מזהה חיצוני', 'External id')}>
            <input
              style={s.input}
              dir="ltr"
              value={form.externalId ?? ''}
              onChange={(e) => set({ externalId: e.target.value })}
              maxLength={60}
            />
          </Field>
        </div>
        <div style={s.row}>
          <Field label={tx('שם משתמש לפורטל', 'Portal username')}>
            <input
              style={s.input}
              dir="ltr"
              value={form.username ?? ''}
              onChange={(e) => set({ username: e.target.value })}
              maxLength={60}
            />
          </Field>
          <Field label={tx('סיסמה לפורטל (ריק = בלי שינוי)', 'Portal password (blank = unchanged)')}>
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
        </div>
        <Toggle
          label={tx('צפייה בלבד בפורטל', 'Read-only in the portal')}
          help={tx('רואה את הקריאות של הלקוח אבל לא פותח ולא מעדכן.', 'Sees the client’s calls but cannot open or update them.')}
          checked={form.readOnly === true}
          onChange={(readOnly) => set({ readOnly })}
        />
        {contact && (
          <Toggle
            label={tx('איש קשר פעיל', 'Active contact')}
            help={tx('מושבת יוצא מהבוחרים; הקריאות שהוא פתח נשארות.', 'A deactivated contact leaves the pickers; their calls stay.')}
            checked={form.active !== false}
            onChange={(active) => set({ active })}
          />
        )}
        <ErrorText>{error}</ErrorText>
        <div style={s.row}>
          <button type="submit" style={s.primary} disabled={busy || !(form.firstName ?? '').trim()}>
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
