/*
 * טופס הקריאה, בחמישה טאבים: פרטים, אירועים, שעות, מסמכים וחתימה.
 *
 * מה שחשוב להבין כאן:
 *  - שדות החובה מגיעים מהפרמטרים של החברה (`params.require*`), ולא מהקוד;
 *    לקוח, נושא וסטטוס הם חובה תמיד.
 *  - ההערה האדומה של הלקוח (`call_remarks`) מוצגת כבאנר על כל קריאה שלו.
 *  - בחירת משך טיפול יוצרת בשרת שורת שעות אוטומטית; שינוי מחליף אותה ולא
 *    נוגע בשורות שדווחו ביד. לכן השורה האוטומטית אינה נערכת בטאב השעות.
 *  - שינוי גורם מטפל, ותאור הפתיחה, נרשמים כאירועי מערכת בכתיבת השרת —
 *    ולכן הם נראים אחרת מהערה של נציג.
 *  - "שמור אירוע וסגור קריאה" הוא שמירת האירוע עם סגירה באותה פעולה.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  byKind,
  callsApi,
  dateText,
  hoursText,
  ltr,
  overdueTitle,
  statusTone,
  t,
  type Call,
  type CallEvent,
  type CallFile,
  type CallHour,
  type CallMeta,
  type CallSignature,
  type HoursBank,
} from './callsApi';
import { LinkedBanner } from './LinkedBanner';
import { StickyNotes } from './StickyNotes';
import { TransferDialog } from './TransferDialog';
import './calls.css';

type Tab = 'details' | 'events' | 'hours' | 'documents' | 'signature';

const TABS: { key: Tab; he: string; en: string }[] = [
  { key: 'details', he: 'פרטים', en: 'Details' },
  { key: 'events', he: 'אירועים', en: 'Events' },
  { key: 'hours', he: 'שעות', en: 'Hours' },
  { key: 'documents', he: 'מסמכים', en: 'Documents' },
  { key: 'signature', he: 'חתימה', en: 'Signature' },
];

interface Draft {
  clientId: string;
  contactId: string;
  ownerUserId: string;
  subject: string;
  details: string;
  typeId: string;
  statusId: string;
  billingStatusId: string;
  durationId: string;
}

const emptyDraft: Draft = {
  clientId: '',
  contactId: '',
  ownerUserId: '',
  subject: '',
  details: '',
  typeId: '',
  statusId: '',
  billingStatusId: '',
  durationId: '',
};

const draftOf = (call: Call): Draft => ({
  clientId: String(call.clientId),
  contactId: call.contactId ? String(call.contactId) : '',
  ownerUserId: call.ownerUserId ? String(call.ownerUserId) : '',
  subject: call.subject,
  details: call.details ?? '',
  typeId: call.typeId ? String(call.typeId) : '',
  statusId: String(call.statusId),
  billingStatusId: call.billingStatusId ? String(call.billingStatusId) : '',
  durationId: call.durationId ? String(call.durationId) : '',
});

const idOrNull = (value: string) => (value ? Number(value) : null);

export function CallForm({
  callId,
  clientId,
  onClose,
  onOpenCall,
}: {
  /** undefined = קריאה חדשה */
  callId?: number;
  /** לקוח שנבחר מראש בקריאה חדשה */
  clientId?: number;
  onClose?(): void;
  onOpenCall?(id: number): void;
}) {
  const [meta, setMeta] = useState<CallMeta | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, clientId: clientId ? String(clientId) : '' });
  const [tab, setTab] = useState<Tab>('details');
  const [transfer, setTransfer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const reload = useCallback(() => {
    if (!callId) return;
    callsApi
      .get(callId)
      .then((row) => {
        setCall(row);
        setDraft(draftOf(row));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')));
  }, [callId]);

  useEffect(() => {
    callsApi.meta().then(setMeta).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  // קריאה חדשה: הסטטוס מתחיל בברירת המחדל של החברה
  useEffect(() => {
    if (!callId && meta?.params.defaultStatusNew) {
      setDraft((d) => (d.statusId ? d : { ...d, statusId: String(meta.params.defaultStatusNew) }));
    }
  }, [callId, meta]);

  const params = call?.params ?? meta?.params;
  const lookups = meta?.lookups ?? [];
  const body = {
    clientId: idOrNull(draft.clientId),
    contactId: idOrNull(draft.contactId),
    ownerUserId: idOrNull(draft.ownerUserId),
    subject: draft.subject,
    details: draft.details || null,
    typeId: idOrNull(draft.typeId),
    statusId: idOrNull(draft.statusId),
    billingStatusId: idOrNull(draft.billingStatusId),
    durationId: idOrNull(draft.durationId),
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      if (callId) {
        await callsApi.update(callId, body);
        reload();
        setSaved(t('נשמר', 'Saved'));
      } else {
        const created = await callsApi.create(body);
        setSaved(`${t('נפתחה קריאה', 'Call opened')} ${created.number}`);
        onOpenCall?.(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שגיאה', 'Error'));
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const flagged = call !== null && (call.delayed || call.overStd);

  return (
    <section className="call-form" aria-label={t('קריאת שירות', 'Service call')}>
      <header className="calls-toolbar">
        <h2>
          {call
            ? `${t('קריאה', 'Call')} ${ltr(String(call.number))} · ${call.clientName}`
            : t('קריאה חדשה', 'New call')}
        </h2>
        {call ? (
          <span className={`status-pill tone-${statusTone(call)}`}>{call.statusName}</span>
        ) : null}
        {call && flagged ? (
          <span className="status-pill tone-overdue" title={overdueTitle(call)}>
            {call.overStd ? t('חריגת תקן שעות', 'Over standard hours') : t('באיחור', 'Late')}
          </span>
        ) : null}
        {call?.shared ? <span className="muted">{t('קריאה משותפת', 'Shared call')}</span> : null}
        <span className="grow" />
        {call ? (
          <button type="button" onClick={() => setTransfer(true)}>
            {t('שליחת עבודה לחברה אחרת', 'Send work to another company')}
          </button>
        ) : null}
        {onClose ? (
          <button type="button" onClick={onClose}>
            {t('סגירת הטופס', 'Close')}
          </button>
        ) : null}
      </header>

      {/* ההערה של הלקוח — באנר אדום על כל קריאה שלו */}
      {call?.clientRemarks ? (
        <p className="client-remarks" role="note">
          {call.clientRemarks}
        </p>
      ) : null}

      {call ? <LinkedBanner callId={call.id} onChanged={reload} /> : null}

      <nav className="call-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            disabled={!callId && item.key !== 'details'}
            title={!callId && item.key !== 'details' ? t('זמין אחרי פתיחת הקריאה', 'Available once the call is opened') : undefined}
            onClick={() => setTab(item.key)}
          >
            {t(item.he, item.en)}
            {item.key === 'hours' && call ? ` (${hoursText(call.hoursTotal)})` : ''}
            {item.key === 'documents' && call ? ` (${call.filesCount})` : ''}
          </button>
        ))}
      </nav>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved ? <p className="muted" role="status">{saved}</p> : null}

      {tab === 'details' ? (
        <>
          <div className="call-fields">
            <label className="required">
              {t('לקוח', 'Client')}
              {/* בחירת הלקוח עצמה היא של מודול הלקוחות; כאן נשמר המזהה */}
              <input
                inputMode="numeric"
                value={draft.clientId}
                onChange={(e) => set('clientId')(e.target.value.replace(/\D/g, ''))}
                aria-label={t('מזהה לקוח', 'Client id')}
              />
            </label>
            <label>
              {t('איש קשר', 'Contact')}
              <input
                inputMode="numeric"
                value={draft.contactId}
                onChange={(e) => set('contactId')(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="wide required">
              {t('נושא', 'Subject')}
              <input value={draft.subject} onChange={(e) => set('subject')(e.target.value)} maxLength={500} />
            </label>
            <label className={params?.requireDetails ? 'wide required' : 'wide'}>
              {t('תאור', 'Details')}
              <textarea rows={4} value={draft.details} onChange={(e) => set('details')(e.target.value)} />
              {!callId ? (
                <span className="muted">
                  {t('תאור הפתיחה יירשם כאירוע הראשון של הקריאה', 'The opening details become the first event')}
                </span>
              ) : null}
            </label>
            <label className={params?.requireCallType ? 'required' : undefined}>
              {t('סוג קריאה', 'Call type')}
              <select value={draft.typeId} onChange={(e) => set('typeId')(e.target.value)}>
                <option value="">{t('ללא', 'None')}</option>
                {byKind(lookups, 'call_type').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.stdHours ? ` (${t('תקן', 'std')} ${hoursText(l.stdHours)})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="required">
              {t('סטטוס', 'Status')}
              <select value={draft.statusId} onChange={(e) => set('statusId')(e.target.value)}>
                {byKind(lookups, 'call_status').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.isClosing ? ` · ${t('סוגר', 'closing')}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className={params?.requireBillingStatus ? 'required' : undefined}>
              {t('סטטוס חיוב', 'Billing status')}
              <select value={draft.billingStatusId} onChange={(e) => set('billingStatusId')(e.target.value)}>
                <option value="">{t('ללא', 'None')}</option>
                {byKind(lookups, 'billing_status').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={params?.requireDuration ? 'required' : undefined}>
              {t('משך טיפול', 'Duration')}
              <select value={draft.durationId} onChange={(e) => set('durationId')(e.target.value)}>
                <option value="">{t('ללא', 'None')}</option>
                {byKind(lookups, 'duration').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <span className="muted">
                {t('בחירת משך יוצרת שורת שעות אוטומטית', 'Choosing a duration creates an hours row')}
              </span>
            </label>
            <label>
              {t('גורם מטפל', 'Owner')}
              <select value={draft.ownerUserId} onChange={(e) => set('ownerUserId')(e.target.value)}>
                <option value="">{t('ללא', 'Unassigned')}</option>
                {(meta?.agents ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.id}
                  </option>
                ))}
              </select>
              <span className="muted">
                {t('שינוי גורם מטפל נרשם ביומן האירועים', 'An owner change is written to the event log')}
              </span>
            </label>
          </div>

          {call ? (
            <p className="muted">
              {t('נפתחה', 'Opened')} {dateText(call.openAt, true)}
              {call.openByName ? ` · ${call.openByName}` : ''}
              {call.closedAt ? ` · ${t('נסגרה', 'closed')} ${dateText(call.closedAt, true)}` : ''}
              {call.closedByName ? ` · ${call.closedByName}` : ''}
            </p>
          ) : null}

          <div className="call-actions">
            <button type="button" disabled={busy} onClick={() => void save()}>
              {callId ? t('שמירה', 'Save') : t('פתיחת הקריאה', 'Open the call')}
            </button>
          </div>

          {call ? <StickyNotes scope={{ callId: call.id, clientId: call.clientId }} agents={meta?.agents ?? []} /> : null}
        </>
      ) : null}

      {tab === 'events' && callId ? <EventsTab callId={callId} onChanged={reload} /> : null}
      {tab === 'hours' && callId ? <HoursTab callId={callId} meta={meta} onChanged={reload} /> : null}
      {tab === 'documents' && callId ? <DocumentsTab callId={callId} onChanged={reload} /> : null}
      {tab === 'signature' && callId ? <SignatureTab callId={callId} onChanged={reload} /> : null}

      {transfer && call ? (
        <TransferDialog
          callId={call.id}
          onClose={() => setTransfer(false)}
          onDone={() => reload()}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- אירועים

function EventsTab({ callId, onChanged }: { callId: number; onChanged(): void }) {
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    callsApi.events(callId).then(setEvents).catch(() => {});
  }, [callId]);
  useEffect(reload, [reload]);

  const add = (close: boolean) => {
    setBusy(true);
    setError('');
    callsApi
      .addEvent(callId, draft, close)
      .then(() => {
        setDraft('');
        reload();
        onChanged();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      {events.map((event) => (
        // אירוע מערכת נראה אחרת מהערה של נציג — ראה calls.css
        <article key={event.id} className={event.kind === 'system' ? 'event system' : 'event'}>
          <div className="who">
            {dateText(event.createdAt, true)} ·{' '}
            {event.kind === 'system' ? t('מערכת', 'System') : (event.createdByName ?? '')}
            {event.kind === 'email' ? ` · ${t('מייל', 'Email')}` : ''}
            {event.kind === 'whatsapp' ? ` · ${t('ווטסאפ', 'WhatsApp')}` : ''}
            {event.emailedTo ? ` · ${event.emailedTo}` : ''}
          </div>
          {event.body}
        </article>
      ))}
      {events.length === 0 ? <p className="muted">{t('אין אירועים', 'No events')}</p> : null}

      <label className="wide">
        {t('אירוע חדש', 'New event')}
        <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <div className="call-actions">
        <button type="button" disabled={busy || !draft.trim()} onClick={() => add(false)}>
          {t('שמירת אירוע', 'Save event')}
        </button>
        <button type="button" disabled={busy || !draft.trim()} onClick={() => add(true)}>
          {t('שמור אירוע וסגור קריאה', 'Save event and close call')}
        </button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- שעות

function HoursTab({ callId, meta, onChanged }: { callId: number; meta: CallMeta | null; onChanged(): void }) {
  const [rows, setRows] = useState<CallHour[]>([]);
  const [total, setTotal] = useState(0);
  const [banks, setBanks] = useState<HoursBank[]>([]);
  const [form, setForm] = useState({
    workDate: new Date().toISOString().slice(0, 10),
    fromTime: '',
    toTime: '',
    hours: '',
    description: '',
    hourTypeId: '',
    hoursBankId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    callsApi
      .hours(callId)
      .then((data) => {
        setRows(data.rows);
        setTotal(data.hoursTotal);
      })
      .catch(() => {});
    callsApi.banks(callId).then(setBanks).catch(() => {});
  }, [callId]);
  useEffect(reload, [reload]);

  const add = () => {
    setBusy(true);
    setError('');
    callsApi
      .addHour(callId, {
        workDate: form.workDate,
        fromTime: form.fromTime || null,
        toTime: form.toTime || null,
        hours: Number(form.hours),
        description: form.description || null,
        hourTypeId: form.hourTypeId ? Number(form.hourTypeId) : null,
        hoursBankId: form.hoursBankId ? Number(form.hoursBankId) : null,
      })
      .then(() => {
        setForm({ ...form, hours: '', description: '', fromTime: '', toTime: '' });
        reload();
        onChanged();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')))
      .finally(() => setBusy(false));
  };

  const remove = (hourId: number) => {
    if (!confirm(t('למחוק את שורת השעות?', 'Delete this hours row?'))) return;
    setBusy(true);
    callsApi
      .removeHour(callId, hourId)
      .then(() => {
        reload();
        onChanged();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <table className="calls-table">
        <thead>
          <tr>
            <th>{t('תאריך', 'Date')}</th>
            <th>{t('שעות', 'Hours')}</th>
            <th>{t('תאור', 'Description')}</th>
            <th>{t('סוג', 'Type')}</th>
            <th>{t('מדווח', 'Reporter')}</th>
            <th>{t('חברה', 'Company')}</th>
            <th>{t('בנק שעות', 'Hours bank')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.auto ? 'hours-auto' : undefined}>
              <td>{dateText(row.workDate)}</td>
              <td>{hoursText(row.hours)}</td>
              <td>
                {row.description}
                {/* השורה האוטומטית נשלטת משדה משך הטיפול, ולכן אינה נערכת כאן */}
                {row.auto ? ` · ${t('ממשך הטיפול', 'from the duration')}` : ''}
              </td>
              <td>{row.hourTypeName}</td>
              <td>{row.reporterName}</td>
              <td>{row.companyName}</td>
              <td>{row.hoursBankName}</td>
              <td>
                {row.auto ? (
                  <span className="muted">{t('משדה המשך', 'duration field')}</span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => remove(row.id)}>
                    {t('מחיקה', 'Delete')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>{t('סך הכל', 'Total')}</th>
            <th>{hoursText(total)}</th>
            <th colSpan={6} />
          </tr>
        </tfoot>
      </table>

      {banks.length > 0 ? (
        <p className="muted">
          {t('בנק שעות', 'Hours bank')}:{' '}
          {banks.map((b) => `${b.name} ${hoursText(b.balance)}/${hoursText(b.hours)}`).join(' · ')}
        </p>
      ) : null}

      <div className="call-fields">
        <label>
          {t('תאריך', 'Date')}
          <input type="date" value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} />
        </label>
        <label>
          {t('משעה', 'From')}
          <input type="time" value={form.fromTime} onChange={(e) => setForm({ ...form, fromTime: e.target.value })} />
        </label>
        <label>
          {t('עד שעה', 'To')}
          <input type="time" value={form.toTime} onChange={(e) => setForm({ ...form, toTime: e.target.value })} />
        </label>
        <label>
          {t('שעות', 'Hours')}
          <input
            inputMode="decimal"
            value={form.hours}
            onChange={(e) => setForm({ ...form, hours: e.target.value.replace(/[^\d.]/g, '') })}
          />
        </label>
        <label className="wide">
          {t('תאור', 'Description')}
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label>
          {t('סוג שעה', 'Hour type')}
          <select value={form.hourTypeId} onChange={(e) => setForm({ ...form, hourTypeId: e.target.value })}>
            <option value="">{t('ללא', 'None')}</option>
            {byKind(meta?.lookups ?? [], 'hour_type').map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('בנק שעות', 'Hours bank')}
          <select value={form.hoursBankId} onChange={(e) => setForm({ ...form, hoursBankId: e.target.value })}>
            <option value="">{t('ללא', 'None')}</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <div className="call-actions">
          <button type="button" disabled={busy || !form.hours} onClick={add}>
            {t('דיווח שעות', 'Report hours')}
          </button>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- מסמכים

function DocumentsTab({ callId, onChanged }: { callId: number; onChanged(): void }) {
  const [files, setFiles] = useState<CallFile[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    callsApi.files(callId).then(setFiles).catch(() => {});
  }, [callId]);
  useEffect(reload, [reload]);

  const upload = async () => {
    const file = input.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      if (description) form.append('description', description);
      form.append('file', file);
      // ההעלאה היא multipart ולכן נשלחת ישירות, בלי עטיפת JSON
      const response = await fetch(`/api/calls/${callId}/files`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? t('שגיאה בהעלאה', 'Upload failed'));
      setDescription('');
      if (input.current) input.current.value = '';
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שגיאה', 'Error'));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = (fileId: number) => {
    // מחיקה אינה הדרך: ברירת המחדל היא כיבוי המסמך
    if (!confirm(t('להוציא את המסמך מהרשימה?', 'Remove the document from the list?'))) return;
    setBusy(true);
    callsApi
      .removeFile(callId, fileId)
      .then(() => {
        reload();
        onChanged();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <table className="calls-table">
        <thead>
          <tr>
            <th>{t('שם הקובץ', 'File')}</th>
            <th>{t('תאור', 'Description')}</th>
            <th>{t('הועלה', 'Uploaded')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id} className={file.active ? undefined : 'muted'}>
              <td>
                <a href={callsApi.fileUrl(callId, file.id)} download>
                  {file.fileName ?? `#${file.id}`}
                </a>
              </td>
              <td>{file.description}</td>
              <td>
                {dateText(file.createdAt, true)}
                {file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
              </td>
              <td>
                {file.active ? (
                  <button type="button" disabled={busy} onClick={() => deactivate(file.id)}>
                    {t('הוצאה מהרשימה', 'Deactivate')}
                  </button>
                ) : (
                  <span>{t('לא פעיל', 'Inactive')}</span>
                )}
              </td>
            </tr>
          ))}
          {files.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                {t('אין מסמכים', 'No documents')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="call-fields">
        <label>
          {t('תאור המסמך', 'Document description')}
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          {t('קובץ', 'File')}
          <input type="file" ref={input} />
        </label>
        <div className="call-actions">
          <button type="button" disabled={busy} onClick={() => void upload()}>
            {t('העלאה', 'Upload')}
          </button>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- חתימה

/**
 * קנבס חתימה במידה של טאבלט: רוחב מלא ביחס 2:1, עם pointer events כך שאצבע,
 * עט וגם עכבר עובדים. הציור נשלח כ-PNG.
 */
function SignatureTab({ callId, onChanged }: { callId: number; onChanged(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [rows, setRows] = useState<CallSignature[]>([]);
  const [signerName, setSignerName] = useState('');
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    callsApi
      .signatures(callId)
      .then((data) => {
        setRows(data.rows);
        setDescription((current) => current || data.defaultText);
      })
      .catch(() => {});
  }, [callId]);
  useEffect(reload, [reload]);

  // גודל הציור נקבע מהגודל על המסך, כדי שהקו לא ייצא מרוח
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = element.getBoundingClientRect();
    element.width = Math.max(600, Math.round(rect.width * ratio));
    element.height = Math.round((element.width / 2));
    const context = element.getContext('2d');
    if (!context) return;
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, element.width, element.height);
    context.strokeStyle = '#111418';
    context.lineWidth = Math.max(2, 3 * ratio);
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }, []);

  const pointAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * element.width,
      y: ((event.clientY - rect.top) / rect.height) * element.height,
    };
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    dirty.current = true;
    const point = pointAt(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointAt(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, element.width, element.height);
    dirty.current = false;
  };

  const submit = async () => {
    if (!canvas.current || !dirty.current) {
      setError(t('אין חתימה על הלוח', 'Nothing has been signed yet'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await callsApi.sign(callId, {
        signerName,
        description,
        remarks: remarks || null,
        image: canvas.current.toDataURL('image/png'),
      });
      clear();
      setSignerName('');
      setRemarks('');
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שגיאה', 'Error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="signature-list">
        {rows.map((row) => (
          <article key={row.id} className="event">
            <div className="who">
              {dateText(row.signedAt, true)} · {row.signerName}
            </div>
            {row.description}
            {row.remarks ? <p>{row.remarks}</p> : null}
            <img src={callsApi.signatureUrl(callId, row.id)} alt={t('חתימת הלקוח', 'Customer signature')} />
          </article>
        ))}
      </div>

      <div className="call-fields">
        <label className="required">
          {t('שם החותם', 'Signer name')}
          <input value={signerName} onChange={(e) => setSignerName(e.target.value)} maxLength={200} />
        </label>
        <label className="wide">
          {t('נוסח האישור', 'Confirmation text')}
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="wide">
          {t('הערות', 'Remarks')}
          <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>

      <canvas
        ref={canvas}
        className="signature-pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label={t('לוח החתימה', 'Signature pad')}
      />

      <div className="call-actions">
        <button type="button" disabled={busy || !signerName.trim()} onClick={() => void submit()}>
          {t('שמירת החתימה', 'Save the signature')}
        </button>
        <button type="button" onClick={clear}>
          {t('ניקוי הלוח', 'Clear the pad')}
        </button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
