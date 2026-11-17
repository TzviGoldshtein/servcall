import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, Modal, s, Toggle, useAction, useLang, useLoad } from '../maintenance/shared';
import { can, num, useOptions, useRole } from './shared';

interface Line {
  id: number;
  clientId: number;
  clientName: string;
  groupName: string | null;
  itemId: number;
  itemName: string;
  catalogPrice: number;
  cost: number;
  price: number;
  overridesCatalog: boolean;
  qty: number;
  monthly: number;
  active: boolean;
  sinceText: string;
}
interface LineDetail extends Line {
  audit: {
    createdAt: string | null;
    createdBy: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
    removedAt: string | null;
    removedBy: string | null;
  };
}
interface Item {
  id: number;
  name: string;
  nameEn: string | null;
  displayName: string;
  price: number;
  active: boolean;
  clients: number;
}
interface Summary {
  monthly: number;
  yearly: number;
  clients: number;
  lines: number;
  perItem: { itemId: number; itemName: string; clients: number; monthly: number }[];
}

/** שורת שירות לפי הכלל: מחיר שונה מאפס על הלקוח דוחה את הקטלוג. */
const effective = (cost: number, catalog: number) => (cost !== 0 ? cost : catalog);

export default function Services() {
  const { tx } = useLang();
  const [tab, setTab] = useState<'client' | 'catalog'>('client');
  return (
    <div style={s.page}>
      <h2 style={s.title}>{tx('שירותים חודשיים', 'Monthly services')}</h2>
      <div className="svc-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'client'} onClick={() => setTab('client')}>
          {tx('שירותי לקוחות', 'Client services')}
        </button>
        <button role="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>
          {tx('קטלוג שירותים', 'Service catalogue')}
        </button>
      </div>
      {tab === 'client' ? <ClientLines /> : <Catalogue />}
    </div>
  );
}

function ClientLines() {
  const { lang, tx } = useLang();
  const role = useRole();
  const { clients } = useOptions();
  const [clientId, setClientId] = useState('');
  const [itemId, setItemId] = useState('');
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);
  const [edit, setEdit] = useState<number | 'new' | null>(null);

  const qs = new URLSearchParams();
  if (clientId) qs.set('clientId', clientId);
  if (itemId) qs.set('itemId', itemId);
  if (q) qs.set('q', q);
  if (inactive) qs.set('includeInactive', '1');
  const list = useLoad(
    () => api.get<{ lines: Line[]; totals: { monthly: number; lines: number; clients: number } }>(`/api/client-items?${qs.toString()}`),
    [clientId, itemId, q, inactive],
  );
  const items = useLoad(() => api.get<Item[]>('/api/items'), []);
  const summary = useLoad(
    () => (can(role, 'agent') ? api.get<Summary>('/api/client-items/summary') : Promise.resolve(null)),
    [role],
  );
  const refresh = () => {
    void list.reload();
    void summary.reload();
  };

  return (
    <>
      {summary.data && (
        <div className="svc-kpis">
          <div className="svc-kpi">
            {tx('הכנסה חודשית', 'Monthly revenue')}
            <b>{num(summary.data.monthly, lang)}</b>
          </div>
          <div className="svc-kpi">
            {tx('הכנסה שנתית (משוער)', 'Yearly (estimate)')}
            <b>{num(summary.data.yearly, lang)}</b>
          </div>
          <div className="svc-kpi">
            {tx('לקוחות משלמים', 'Paying clients')}
            <b>{summary.data.clients}</b>
          </div>
          <div className="svc-kpi">
            {tx('שורות חיוב', 'Billing lines')}
            <b>{summary.data.lines}</b>
          </div>
        </div>
      )}

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
          <Field label={tx('שירות', 'Service')}>
            <select style={s.input} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{tx('כל השירותים', 'All services')}</option>
              {items.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tx('חיפוש', 'Search')}>
            <input style={s.input} value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Toggle label={tx('כולל שהוסרו', 'Include removed')} checked={inactive} onChange={setInactive} />
          <button
            style={s.button}
            onClick={() => {
              setClientId('');
              setItemId('');
              setQ('');
              setInactive(false);
            }}
          >
            {tx('נקה', 'Clear')}
          </button>
          {can(role, 'agent') && (
            <button style={s.primary} onClick={() => setEdit('new')}>
              {tx('הוסף שירות ללקוח', 'Add service to client')}
            </button>
          )}
        </div>
      </div>

      <ErrorText>{list.error}</ErrorText>
      <div className="svc-scroll">
        <table style={s.table}>
          <thead>
            <tr>
              {[
                tx('קבוצה', 'Group'),
                tx('לקוח', 'Client'),
                tx('שירות', 'Service'),
                tx('מחיר קטלוג', 'Catalogue price'),
                tx('מחיר ללקוח', 'Client price'),
                tx('כמות', 'Qty'),
                tx('סה"כ לחודש', 'Monthly total'),
                '',
              ].map((h, i) => (
                <th key={i} style={{ ...s.th, cursor: 'default' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.data?.lines.map((l) => (
              <tr key={l.id} style={l.active ? undefined : s.muted}>
                <td style={s.td}>{l.groupName}</td>
                <td style={s.td}>{l.clientName}</td>
                <td style={s.td}>{l.itemName}</td>
                <td style={s.td} className="svc-num">
                  {num(l.catalogPrice, lang)}
                </td>
                <td style={s.td} className="svc-num">
                  {l.overridesCatalog ? (
                    <b>{num(l.cost, lang)}</b>
                  ) : (
                    <span style={s.muted}>{tx('לפי קטלוג', 'Catalogue')}</span>
                  )}
                </td>
                <td style={s.td} className="svc-num">
                  {num(l.qty, lang)}
                </td>
                <td style={s.td} className="svc-num">
                  <b>{num(l.monthly, lang)}</b>
                </td>
                <td style={s.td}>
                  <button style={s.button} onClick={() => setEdit(l.id)}>
                    {can(role, 'agent') ? tx('עריכה', 'Edit') : tx('פרטים', 'Details')}
                  </button>
                </td>
              </tr>
            ))}
            {list.data && !list.data.lines.length && (
              <tr>
                <td style={s.td} colSpan={8}>
                  {tx('אין שירותים', 'No services')}
                </td>
              </tr>
            )}
          </tbody>
          {list.data && (
            <tfoot>
              <tr>
                <td style={{ ...s.td, fontWeight: 700 }} colSpan={6}>
                  {tx('סה"כ הכנסה חודשית', 'Total monthly revenue')} ({list.data.totals.clients} {tx('לקוחות', 'clients')})
                </td>
                <td style={{ ...s.td, fontWeight: 700 }} className="svc-num">
                  {num(list.data.totals.monthly, lang)}
                </td>
                <td style={s.td} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {edit !== null && (
        <LineForm
          id={edit === 'new' ? null : edit}
          clients={clients}
          items={items.data ?? []}
          canEdit={can(role, 'agent')}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

/** הטופס: לשונית "כללי" ולשונית "פרטי עדכון" (מי הוסיף / עדכן / הסיר ומתי). */
function LineForm({
  id,
  clients,
  items,
  canEdit,
  onClose,
  onSaved,
}: {
  id: number | null;
  clients: { id: number; name: string }[];
  items: Item[];
  canEdit: boolean;
  onClose(): void;
  onSaved(): void;
}) {
  const { lang, tx } = useLang();
  const { run, error, busy } = useAction();
  const [tab, setTab] = useState<'general' | 'audit'>('general');
  const [clientId, setClientId] = useState('');
  const [itemId, setItemId] = useState('');
  const [cost, setCost] = useState('0');
  const [qty, setQty] = useState('1');
  const [active, setActive] = useState(true);
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const load = useLoad(async () => {
    if (id === null) return null;
    const d = await api.get<LineDetail>(`/api/client-items/${id}`);
    setDetail(d);
    setClientId(String(d.clientId));
    setItemId(String(d.itemId));
    setCost(String(d.cost));
    setQty(String(d.qty));
    setActive(d.active);
    return d;
  }, [id]);

  const catalog = items.find((i) => String(i.id) === itemId)?.price ?? detail?.catalogPrice ?? 0;
  const price = effective(Number(cost) || 0, catalog);
  const monthly = Math.round(price * (Number(qty) || 0) * 100) / 100;

  const save = () =>
    run(async () => {
      if (id === null) await api.post('/api/client-items', { clientId: Number(clientId), itemId: Number(itemId), cost: Number(cost), qty: Number(qty) });
      else await api.patch(`/api/client-items/${id}`, { cost: Number(cost), qty: Number(qty), active });
      onSaved();
    });
  const remove = () =>
    run(async () => {
      await api.del(`/api/client-items/${id}`);
      onSaved();
    });

  return (
    <Modal title={id === null ? tx('שירות חדש ללקוח', 'New client service') : tx('שירות של לקוח', 'Client service')} onClose={onClose}>
      {id !== null && (
        <div className="svc-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}>
            {tx('כללי', 'General')}
          </button>
          <button role="tab" aria-selected={tab === 'audit'} onClick={() => setTab('audit')}>
            {tx('פרטי עדכון', 'Update details')}
          </button>
        </div>
      )}
      <ErrorText>{load.error}</ErrorText>
      {tab === 'general' ? (
        <>
          <div style={s.row}>
            <Field label={tx('לקוח', 'Client')}>
              <select style={s.input} value={clientId} disabled={id !== null} onChange={(e) => setClientId(e.target.value)}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tx('שירות', 'Service')}>
              <select style={s.input} value={itemId} disabled={id !== null} onChange={(e) => setItemId(e.target.value)}>
                <option value="">—</option>
                {items
                  .filter((i) => i.active || String(i.id) === itemId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.displayName}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div style={s.row}>
            <Field label={tx('מחיר ללקוח (0 = לפי קטלוג)', 'Client price (0 = catalogue)')}>
              <input style={s.input} type="number" min={0} step="0.01" value={cost} disabled={!canEdit} onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field label={tx('כמות', 'Quantity')}>
              <input style={s.input} type="number" min={0} step="1" value={qty} disabled={!canEdit} onChange={(e) => setQty(e.target.value)} />
            </Field>
          </div>
          <p style={s.hint}>
            {tx('מחיר קטלוג', 'Catalogue price')}: {num(catalog, lang)} · {tx('מחיר קובע', 'Effective price')}: <b>{num(price, lang)}</b>{' '}
            {Number(cost) !== 0 && <span style={s.badge}>{tx('דוחה את הקטלוג', 'overrides catalogue')}</span>} ·{' '}
            {tx('סה"כ לחודש', 'Monthly total')}: <b>{num(monthly, lang)}</b>
          </p>
          {id !== null && canEdit && <Toggle label={tx('פעיל', 'Active')} checked={active} onChange={setActive} />}
        </>
      ) : (
        detail && (
          <table style={s.table}>
            <tbody>
              {(
                [
                  [tx('נוסף', 'Added'), detail.audit.createdAt, detail.audit.createdBy],
                  [tx('עודכן', 'Updated'), detail.audit.updatedAt, detail.audit.updatedBy],
                  [tx('הוסר', 'Removed'), detail.audit.removedAt, detail.audit.removedBy],
                ] as const
              ).map(([label, at, by]) => (
                <tr key={label}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{label}</td>
                  <td style={s.td}>{at ?? '—'}</td>
                  <td style={s.td}>{by ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
      <ErrorText>{error}</ErrorText>
      <div style={s.row}>
        {canEdit && (
          <button style={s.primary} disabled={busy || (id === null && (!clientId || !itemId))} onClick={() => void save()}>
            {tx('שמור', 'Save')}
          </button>
        )}
        {canEdit && id !== null && detail?.active && (
          <button style={s.danger} disabled={busy} onClick={() => void remove()}>
            {tx('הסר מהלקוח', 'Remove from client')}
          </button>
        )}
        <button style={s.button} onClick={onClose}>
          {tx('סגור', 'Close')}
        </button>
      </div>
    </Modal>
  );
}

function Catalogue() {
  const { lang, tx } = useLang();
  const role = useRole();
  const [inactive, setInactive] = useState(false);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const { data, error, reload } = useLoad(() => api.get<Item[]>(`/api/items${inactive ? '?includeInactive=1' : ''}`), [inactive]);
  return (
    <>
      <div style={s.row}>
        <Toggle label={tx('כולל לא פעילים', 'Include inactive')} checked={inactive} onChange={setInactive} />
        <span style={s.grow} />
        {can(role, 'admin') && (
          <button style={s.primary} onClick={() => setEdit('new')}>
            {tx('שירות חדש', 'New service')}
          </button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="svc-scroll">
        <table style={s.table}>
          <thead>
            <tr>
              {[tx('שירות', 'Service'), tx('מחיר', 'Price'), tx('לקוחות', 'Clients'), ''].map((h, i) => (
                <th key={i} style={{ ...s.th, cursor: 'default' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((i) => (
              <tr key={i.id} style={i.active ? undefined : s.muted}>
                <td style={s.td}>{i.displayName}</td>
                <td style={s.td} className="svc-num">
                  {num(i.price, lang)}
                </td>
                <td style={s.td} className="svc-num">
                  {i.clients}
                </td>
                <td style={s.td}>
                  {can(role, 'admin') && (
                    <button style={s.button} onClick={() => setEdit(i)}>
                      {tx('עריכה', 'Edit')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit !== null && (
        <ItemForm
          item={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

function ItemForm({ item, onClose, onSaved }: { item: Item | null; onClose(): void; onSaved(): void }) {
  const { tx } = useLang();
  const { run, error, busy } = useAction();
  const [name, setName] = useState(item?.name ?? '');
  const [nameEn, setNameEn] = useState(item?.nameEn ?? '');
  const [price, setPrice] = useState(String(item?.price ?? 0));
  const [active, setActive] = useState(item?.active ?? true);
  const save = () =>
    run(async () => {
      const body = { name, nameEn: nameEn || null, price: Number(price), active };
      if (item) await api.patch(`/api/items/${item.id}`, body);
      else await api.post('/api/items', body);
      onSaved();
    });
  return (
    <Modal title={item ? tx('עריכת שירות', 'Edit service') : tx('שירות חדש', 'New service')} onClose={onClose}>
      <div style={s.row}>
        <Field label={tx('שם', 'Name')}>
          <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tx('שם באנגלית', 'English name')}>
          <input style={s.input} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={tx('מחיר קטלוג', 'Catalogue price')}>
          <input style={s.input} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      {item && <Toggle label={tx('פעיל', 'Active')} checked={active} onChange={setActive} />}
      <ErrorText>{error}</ErrorText>
      <div style={s.row}>
        <button style={s.primary} disabled={busy || !name} onClick={() => void save()}>
          {tx('שמור', 'Save')}
        </button>
        <button style={s.button} onClick={onClose}>
          {tx('ביטול', 'Cancel')}
        </button>
      </div>
    </Modal>
  );
}
