import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, Toggle, useAction, useLang } from './shared';
import Contacts from './Contacts';
import type { ClientGroup } from './Clients';

/**
 * כרטיס הלקוח. הטופס מחולק לשני חלקים, וזה לא עיצוב — זה המודל:
 *   "פרטי הלקוח" — clients: משותף לכל ארבע החברות. שינוי בכתובת או בטלפון
 *   נראה מיד גם לקוריץ, לסדקום ולהראל.
 *   "ההגדרות של החברה הזו" — client_company_settings: ההערה האדומה שתופיע על
 *   כל קריאה, האחראי המוגדר, עלות השעה והדגל "לא מקבל הודעות". שייך לחברה
 *   שאני עובד בה כרגע בלבד.
 */

export interface ClientRow {
  id: number;
  name: string;
  vatId: string | null;
  phone: string | null;
  phone2: string | null;
  mobile: string | null;
  fax: string | null;
  city: string | null;
  street: string | null;
  houseNo: string | null;
  apartment: string | null;
  zip: string | null;
  poBox: string | null;
  linkUrl: string | null;
  groupId: number | null;
  groupName: string | null;
  externalId: string | null;
  active: boolean;
  callRemarks: string | null;
  defaultOwnerId: number | null;
  ownerName: string | null;
  hourCost: number | null;
  offline: boolean;
  inCompany: boolean;
  companyActive: boolean;
  contacts: number;
}

interface UserOption {
  id: number;
  name: string;
}

export default function ClientForm({
  client,
  groups,
  owners,
  onClose,
  onSaved,
}: {
  client: ClientRow | null;
  groups: ClientGroup[];
  owners: UserOption[];
  onClose(): void;
  onSaved(): void;
}) {
  const { tx } = useLang();
  const [form, setForm] = useState<Partial<ClientRow>>(client ?? { active: true, companyActive: true, offline: false });
  const [id, setId] = useState<number | null>(client?.id ?? null);
  const { run, error, busy } = useAction();
  const set = (patch: Partial<ClientRow>) => setForm({ ...form, ...patch });

  async function save(event: FormEvent) {
    event.preventDefault();
    const body = {
      name: form.name ?? '',
      groupId: form.groupId ?? null,
      vatId: form.vatId ?? null,
      phone: form.phone ?? null,
      phone2: form.phone2 ?? null,
      mobile: form.mobile ?? null,
      fax: form.fax ?? null,
      city: form.city ?? null,
      street: form.street ?? null,
      houseNo: form.houseNo ?? null,
      apartment: form.apartment ?? null,
      zip: form.zip ?? null,
      poBox: form.poBox ?? null,
      linkUrl: form.linkUrl ?? null,
      externalId: form.externalId ?? null,
      // שדות החברה הפעילה
      callRemarks: form.callRemarks ?? null,
      defaultOwnerId: form.defaultOwnerId ?? null,
      hourCost: form.hourCost ?? null,
      offline: form.offline === true,
      companyActive: form.companyActive !== false,
      ...(id ? { active: form.active !== false } : null),
    };
    const saved = await run(() =>
      id ? api.patch<ClientRow>(`/api/clients/${id}`, body) : api.post<ClientRow>('/api/clients', body),
    );
    if (!saved) return;
    setId(saved.id);
    setForm(saved);
    onSaved();
    // לקוח חדש נשאר פתוח, כדי שיהיה אפשר להוסיף לו מיד אנשי קשר
    if (id) onClose();
  }

  return (
    <Modal title={id ? tx('כרטיס לקוח', 'Client card') : tx('לקוח חדש', 'New client')} onClose={onClose}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={save}>
        <section style={s.card}>
          <strong>{tx('פרטי הלקוח — משותפים לכל החברות', 'Client details — shared by all companies')}</strong>
          <div style={s.row}>
            <Field label={tx('שם הלקוח', 'Client name')}>
              <input
                style={s.input}
                value={form.name ?? ''}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={200}
                required
                autoFocus
              />
            </Field>
            <Field label={tx('ח.פ. / עוסק', 'VAT id')}>
              <input style={s.input} dir="ltr" value={form.vatId ?? ''} onChange={(e) => set({ vatId: e.target.value })} maxLength={20} />
            </Field>
            <Field label={tx('קבוצת לקוחות', 'Client group')}>
              <select
                style={s.input}
                value={form.groupId ?? ''}
                onChange={(e) => set({ groupId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{tx('ללא', 'None')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={s.row}>
            <Field label={tx('טלפון', 'Phone')}>
              <input style={s.input} dir="ltr" value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} maxLength={40} />
            </Field>
            <Field label={tx('טלפון 2', 'Phone 2')}>
              <input style={s.input} dir="ltr" value={form.phone2 ?? ''} onChange={(e) => set({ phone2: e.target.value })} maxLength={40} />
            </Field>
            <Field label={tx('נייד', 'Mobile')}>
              <input style={s.input} dir="ltr" value={form.mobile ?? ''} onChange={(e) => set({ mobile: e.target.value })} maxLength={40} />
            </Field>
            <Field label={tx('פקס', 'Fax')}>
              <input style={s.input} dir="ltr" value={form.fax ?? ''} onChange={(e) => set({ fax: e.target.value })} maxLength={40} />
            </Field>
          </div>
          <div style={s.row}>
            <Field label={tx('עיר', 'City')}>
              <input style={s.input} value={form.city ?? ''} onChange={(e) => set({ city: e.target.value })} maxLength={80} />
            </Field>
            <Field label={tx('רחוב', 'Street')}>
              <input style={s.input} value={form.street ?? ''} onChange={(e) => set({ street: e.target.value })} maxLength={120} />
            </Field>
            <Field label={tx('מספר', 'No.')}>
              <input style={s.input} value={form.houseNo ?? ''} onChange={(e) => set({ houseNo: e.target.value })} maxLength={20} />
            </Field>
            <Field label={tx('דירה', 'Apartment')}>
              <input style={s.input} value={form.apartment ?? ''} onChange={(e) => set({ apartment: e.target.value })} maxLength={20} />
            </Field>
            <Field label={tx('מיקוד', 'ZIP')}>
              <input style={s.input} dir="ltr" value={form.zip ?? ''} onChange={(e) => set({ zip: e.target.value })} maxLength={20} />
            </Field>
            <Field label={tx('תא דואר', 'PO box')}>
              <input style={s.input} dir="ltr" value={form.poBox ?? ''} onChange={(e) => set({ poBox: e.target.value })} maxLength={20} />
            </Field>
          </div>
          <div style={s.row}>
            <Field label={tx('קישור (אתר, תיקייה)', 'Link (site, folder)')}>
              <input style={s.input} dir="ltr" value={form.linkUrl ?? ''} onChange={(e) => set({ linkUrl: e.target.value })} maxLength={500} />
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
          {id && (
            <Toggle
              label={tx('לקוח פעיל (בכל החברות)', 'Active client (in all companies)')}
              help={tx(
                'כיבוי כאן משפיע על כל ארבע החברות, ולכן מותר לסופר-אדמין בלבד.',
                'Turning this off affects all four companies, so only a superadmin may do it.',
              )}
              checked={form.active !== false}
              onChange={(active) => set({ active })}
            />
          )}
        </section>

        <section style={s.card}>
          <strong>{tx('ההגדרות של החברה הזו', 'Settings for this company')}</strong>
          <p style={s.hint}>
            {tx(
              'מה שכאן שייך לחברה שאתה עובד בה כרגע. באותו לקוח, חברה אחרת רואה הערה, אחראי ומחיר אחרים.',
              'What is here belongs to the company you are working in. For the same client, another company sees different remarks, owner and price.',
            )}
          </p>
          <Field label={tx('הערות לקריאה (מוצגות באדום על כל קריאה)', 'Call remarks (shown in red on every call)')} wide>
            <textarea
              style={{ ...s.input, minHeight: 70, ...s.remarks }}
              value={form.callRemarks ?? ''}
              onChange={(e) => set({ callRemarks: e.target.value })}
              maxLength={2000}
            />
          </Field>
          <div style={s.row}>
            <Field label={tx('אחראי מוגדר', 'Default owner')}>
              <select
                style={s.input}
                value={form.defaultOwnerId ?? ''}
                onChange={(e) => set({ defaultOwnerId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{tx('ללא', 'None')}</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tx('עלות שעה', 'Hour cost')}>
              <input
                style={s.input}
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={form.hourCost ?? ''}
                onChange={(e) => set({ hourCost: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          </div>
          <Toggle
            label={tx('לא מקבל מיילים והודעות ווטסאפ', 'Does not receive e-mail or WhatsApp')}
            help={tx(
              'הלקוח ממשיך להופיע ולעבוד, אבל אף הודעה אוטומטית לא יוצאת אליו מהחברה הזו.',
              'The client keeps working, but no automatic message leaves this company to them.',
            )}
            checked={form.offline === true}
            onChange={(offline) => set({ offline })}
          />
          <Toggle
            label={tx('פעיל בחברה הזו', 'Active in this company')}
            help={tx(
              'כיבוי מוציא אותו מהרשימות של החברה הזו בלבד.',
              'Turning it off removes the client from this company’s lists only.',
            )}
            checked={form.companyActive !== false}
            onChange={(companyActive) => set({ companyActive })}
          />
        </section>

        <ErrorText>{error}</ErrorText>
        <div style={s.row}>
          <button type="submit" style={s.primary} disabled={busy || !(form.name ?? '').trim()}>
            {tx('שמירה', 'Save')}
          </button>
          <button type="button" style={s.button} onClick={onClose}>
            {tx('סגירה', 'Close')}
          </button>
        </div>
      </form>

      {id ? (
        <section style={s.card}>
          <Contacts clientId={id} clientName={form.name ?? ''} />
        </section>
      ) : (
        <p style={s.hint}>{tx('אנשי קשר מתווספים אחרי שמירת הלקוח.', 'Contacts can be added once the client is saved.')}</p>
      )}
    </Modal>
  );
}
