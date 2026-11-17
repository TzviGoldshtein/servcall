import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, Toggle, useAction, useLang, useLoad } from '../maintenance/shared';
import { can, download, num, useOptions, useRole } from './shared';

interface Bank {
  id: number;
  name: string;
  clientId: number;
  clientName: string;
  active: boolean;
  purchased: number;
  used: number;
  balance: number;
  usedPct: number;
  state: 'ok' | 'low' | 'empty' | 'negative';
}
interface BankList {
  banks: Bank[];
  totals: { purchased: number; used: number; balance: number; needAttention: number };
}
interface BankDetail {
  bank: Bank;
  entries: {
    id: number;
    workDateText: string;
    reporter: string | null;
    callNumber: number | null;
    subject: string | null;
    hours: number;
    hourType: string | null;
    countsInBank: boolean;
  }[];
}

/** המד: הרוחב הוא אחוז הניצול (נחתך ל-100), והצבע נקבע לפי מצב הבנק. */
export function Meter({ bank }: { bank: Pick<Bank, 'usedPct' | 'state'> }) {
  const pct = Math.max(0, Math.min(100, bank.usedPct));
  return (
    <div
      className="bank-meter"
      data-state={bank.state}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

export default function HoursBank() {
  const { lang, tx } = useLang();
  const role = useRole();
  const { clients } = useOptions();
  const [clientId, setClientId] = useState('');
  const [attention, setAttention] = useState(false);
  const [inactive, setInactive] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<Bank | 'new' | null>(null);

  const qs = new URLSearchParams();
  if (clientId) qs.set('clientId', clientId);
  if (attention) qs.set('attentionOnly', '1');
  if (inactive) qs.set('includeInactive', '1');
  const { data, error, loading, reload } = useLoad(
    () => api.get<BankList>(`/api/hours-banks?${qs.toString()}`),
    [clientId, attention, inactive],
  );

  const stateLabel = (st: Bank['state']) =>
    ({
      ok: tx('תקין', 'OK'),
      low: tx('יתרה נמוכה', 'Low'),
      empty: tx('אזלה', 'Used up'),
      negative: tx('חריגה', 'Overdrawn'),
    })[st];
  const exportUrl = (fmt: 'pdf' | 'excel') => `/api/hours-banks/export/${fmt}${clientId ? `?clientId=${clientId}` : ''}`;

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={{ ...s.title, flex: 1 }}>{tx('בנק שעות', 'Hours bank')}</h2>
        {can(role, 'agent') && (
          <>
            <button style={s.button} onClick={() => download(exportUrl('pdf'))}>
              PDF
            </button>
            <button style={s.button} onClick={() => download(exportUrl('excel'))}>
              Excel
            </button>
          </>
        )}
        {can(role, 'admin') && (
          <button style={s.primary} onClick={() => setEdit('new')}>
            {tx('בנק חדש', 'New bank')}
          </button>
        )}
      </div>
      <p style={s.hint}>
        {tx(
          'היתרה מחושבת: שעות שנרכשו פחות שעות שדווחו מסוגים הנספרים בבנק.',
          'The balance is computed: purchased hours minus reported hours of types that count in the bank.',
        )}
      </p>

      <div style={s.card}>
        <div style={s.row}>
          <Field label={tx('לקוח', 'Client')}>
            <select style={s.input} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{tx('כל הלקוחות', 'All clients')}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Toggle label={tx('רק בנקים שדורשים תשומת לב', 'Needing attention only')} checked={attention} onChange={setAttention} />
          <Toggle label={tx('כולל לא פעילים', 'Include inactive')} checked={inactive} onChange={setInactive} />
          <button
            style={s.button}
            onClick={() => {
              setClientId('');
              setAttention(false);
              setInactive(false);
            }}
          >
            {tx('נקה', 'Clear')}
          </button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>
      {data && (
        <div className="svc-kpis">
          <div className="svc-kpi">
            {tx('שעות שנרכשו', 'Purchased')}
            <b>{num(data.totals.purchased, lang)}</b>
          </div>
          <div className="svc-kpi">
            {tx('שעות שנוצלו', 'Used')}
            <b>{num(data.totals.used, lang)}</b>
          </div>
          <div className="svc-kpi">
            {tx('יתרה', 'Balance')}
            <b>{num(data.totals.balance, lang)}</b>
          </div>
          <div className="svc-kpi">
            {tx('דורשים תשומת לב', 'Need attention')}
            <b>{data.totals.needAttention}</b>
          </div>
        </div>
      )}

      <div className="svc-scroll">
        <table style={s.table}>
          <thead>
            <tr>
              {[
                tx('לקוח', 'Client'),
                tx('בנק', 'Bank'),
                tx('נרכשו', 'Purchased'),
                tx('נוצלו', 'Used'),
                tx('יתרה', 'Balance'),
                tx('ניצול', 'Usage'),
                tx('מצב', 'State'),
                '',
              ].map((h, i) => (
                <th key={i} style={{ ...s.th, cursor: 'default' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.banks.map((b) => (
              <tr key={b.id} style={b.active ? undefined : s.muted}>
                <td style={s.td}>{b.clientName}</td>
                <td style={s.td}>{b.name}</td>
                <td style={s.td} className="svc-num">
                  {num(b.purchased, lang)}
                </td>
                <td style={s.td} className="svc-num">
                  {num(b.used, lang)}
                </td>
                <td style={s.td} className="svc-num">
                  <b>{num(b.balance, lang)}</b>
                </td>
                <td style={{ ...s.td, minInlineSize: 140 }}>
                  <Meter bank={b} />
                </td>
                <td style={s.td}>
                  <span className="bank-pill" data-state={b.state}>
                    {stateLabel(b.state)}
                  </span>
                </td>
                <td style={s.td}>
                  <button style={s.button} onClick={() => setOpen(b.id)}>
                    {tx('תנועות', 'Entries')}
                  </button>{' '}
                  {can(role, 'admin') && (
                    <button style={s.button} onClick={() => setEdit(b)}>
                      {tx('עריכה', 'Edit')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data && !data.banks.length && (
              <tr>
                <td style={s.td} colSpan={8}>
                  {tx('אין בנקי שעות', 'No hours banks')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && !data && <p style={s.muted}>{tx('טוען…', 'Loading…')}</p>}
      </div>

      {open !== null && <BankEntries id={open} onClose={() => setOpen(null)} />}
      {edit !== null && (
        <BankForm
          bank={edit === 'new' ? null : edit}
          clients={clients}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function BankEntries({ id, onClose }: { id: number; onClose(): void }) {
  const { lang, tx } = useLang();
  const { data, error } = useLoad(() => api.get<BankDetail>(`/api/hours-banks/${id}`), [id]);
  return (
    <Modal title={data ? `${data.bank.clientName} — ${data.bank.name}` : tx('בנק שעות', 'Hours bank')} onClose={onClose}>
      <ErrorText>{error}</ErrorText>
      {data && (
        <>
          <Meter bank={data.bank} />
          <p style={s.hint}>
            {tx('יתרה', 'Balance')}: <b>{num(data.bank.balance, lang)}</b> / {num(data.bank.purchased, lang)}
          </p>
          <div className="svc-scroll">
            <table style={s.table}>
              <thead>
                <tr>
                  {[
                    tx('תאריך', 'Date'),
                    tx('מדווח', 'Reporter'),
                    tx('קריאה', 'Call'),
                    tx('סוג שעה', 'Hour type'),
                    tx('שעות', 'Hours'),
                    tx('נספר בבנק', 'Counts'),
                  ].map((h) => (
                    <th key={h} style={{ ...s.th, cursor: 'default' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} style={e.countsInBank ? undefined : s.muted}>
                    <td style={s.td}>{e.workDateText}</td>
                    <td style={s.td}>{e.reporter}</td>
                    <td style={s.td}>{e.callNumber ? `#${e.callNumber} ${e.subject ?? ''}` : ''}</td>
                    <td style={s.td}>{e.hourType}</td>
                    <td style={s.td} className="svc-num">
                      {num(e.hours, lang)}
                    </td>
                    <td style={s.td}>{e.countsInBank ? tx('כן', 'Yes') : tx('לא', 'No')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

function BankForm({
  bank,
  clients,
  onClose,
  onSaved,
}: {
  bank: Bank | null;
  clients: { id: number; name: string }[];
  onClose(): void;
  onSaved(): void;
}) {
  const { tx } = useLang();
  const { run, error, busy } = useAction();
  const [clientId, setClientId] = useState(bank ? String(bank.clientId) : '');
  const [name, setName] = useState(bank?.name ?? '');
  const [hours, setHours] = useState(String(bank?.purchased ?? 0));
  const [active, setActive] = useState(bank?.active ?? true);

  const save = () =>
    run(async () => {
      if (bank) await api.patch(`/api/hours-banks/${bank.id}`, { name, hours: Number(hours), active });
      else await api.post('/api/hours-banks', { clientId: Number(clientId), name, hours: Number(hours) });
      onSaved();
    });

  return (
    <Modal title={bank ? tx('עריכת בנק שעות', 'Edit hours bank') : tx('בנק שעות חדש', 'New hours bank')} onClose={onClose}>
      <div style={s.row}>
        <Field label={tx('לקוח', 'Client')}>
          <select style={s.input} value={clientId} disabled={!!bank} onChange={(e) => setClientId(e.target.value)}>
            <option value="">—</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tx('שם הבנק', 'Bank name')}>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tx('שעות שנרכשו', 'Purchased hours')}>
          <input style={s.input} type="number" min={0} step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
      </div>
      {bank && <Toggle label={tx('פעיל', 'Active')} checked={active} onChange={setActive} />}
      <ErrorText>{error}</ErrorText>
      <div style={s.row}>
        <button style={s.primary} disabled={busy || !name || (!bank && !clientId)} onClick={() => void save()}>
          {tx('שמור', 'Save')}
        </button>
        <button style={s.button} onClick={onClose}>
          {tx('ביטול', 'Cancel')}
        </button>
      </div>
    </Modal>
  );
}
