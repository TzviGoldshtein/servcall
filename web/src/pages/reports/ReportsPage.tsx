import { useMemo, useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, s, Toggle, useLang, useLoad } from '../maintenance/shared';
import './reports.css';

type FilterField =
  | 'dates' | 'clients' | 'clientOne' | 'groups' | 'owners' | 'statuses' | 'types' | 'durations'
  | 'billing' | 'reporters' | 'hourTypes' | 'banks' | 'items' | 'callNumber' | 'text'
  | 'openOnly' | 'showGroup' | 'subtotals' | 'activeOnly';

interface ReportMeta {
  id: string;
  name: string;
  orientation: 'portrait' | 'landscape';
  fields: FilterField[];
}
interface Opt {
  id: number;
  name: string;
}
interface Lookup {
  id: number;
  kind: string;
  name: string;
  name_en: string | null;
}
interface Options {
  clients: Opt[];
  groups: Opt[];
  owners: Opt[];
  reporters: Opt[];
  items: Opt[];
  banks: Opt[];
  lookups: Lookup[];
}

/** מצב הסינון: מערכי מזהים לבחירה מרובה, ומחרוזות/דגלים לשאר. */
interface Filters {
  from: string;
  to: string;
  clientId: string[];
  groupId: string[];
  ownerId: string[];
  statusId: string[];
  typeId: string[];
  durationId: string[];
  billingId: string[];
  reporterId: string[];
  hourTypeId: string[];
  bankId: string[];
  itemId: string[];
  clientOne: string;
  callNumber: string;
  q: string;
  openOnly: boolean;
  showGroup: boolean;
  subtotals: boolean;
  activeOnly: boolean;
}

const EMPTY: Filters = {
  from: '', to: '', clientId: [], groupId: [], ownerId: [], statusId: [], typeId: [], durationId: [],
  billingId: [], reporterId: [], hourTypeId: [], bankId: [], itemId: [], clientOne: '', callNumber: '', q: '',
  openOnly: false, showGroup: true, subtotals: false, activeOnly: true,
};

/** שדות הסינון שמקבלים רשימה מרובה, ומאיפה היא באה (אופציות השרת או טבלת קוד). */
const MULTI: { field: FilterField; key: keyof Filters; he: string; en: string; from: keyof Options | string }[] = [
  { field: 'clients', key: 'clientId', he: 'לקוחות', en: 'Clients', from: 'clients' },
  { field: 'groups', key: 'groupId', he: 'קבוצות', en: 'Groups', from: 'groups' },
  { field: 'owners', key: 'ownerId', he: 'גורם מטפל', en: 'Owner', from: 'owners' },
  { field: 'reporters', key: 'reporterId', he: 'עובד מדווח', en: 'Reporter', from: 'reporters' },
  { field: 'statuses', key: 'statusId', he: 'סטטוס', en: 'Status', from: 'call_status' },
  { field: 'types', key: 'typeId', he: 'סוג קריאה', en: 'Call type', from: 'call_type' },
  { field: 'durations', key: 'durationId', he: 'משך טיפול', en: 'Duration', from: 'duration' },
  { field: 'billing', key: 'billingId', he: 'סטטוס חיוב', en: 'Billing status', from: 'billing_status' },
  { field: 'hourTypes', key: 'hourTypeId', he: 'סוג שעה', en: 'Hour type', from: 'hour_type' },
  { field: 'banks', key: 'bankId', he: 'בנק שעות', en: 'Hours bank', from: 'banks' },
  { field: 'items', key: 'itemId', he: 'שירות', en: 'Service', from: 'items' },
];

/** מחרוזת השאילתה: רק מה שמולא. החברה אינה חלק ממנה — השרת לוקח אותה מההקשר. */
export function toQuery(f: Filters, fields: FilterField[]): string {
  const qs = new URLSearchParams();
  const has = (x: FilterField) => fields.includes(x);
  if (has('dates')) {
    if (f.from) qs.set('from', f.from);
    if (f.to) qs.set('to', f.to);
  }
  for (const m of MULTI) {
    const v = f[m.key] as string[];
    if (has(m.field) && v.length) qs.set(m.key as string, v.join(','));
  }
  if (has('clientOne') && f.clientOne) qs.set('clientId', f.clientOne);
  if (has('callNumber') && f.callNumber) qs.set('callNumber', f.callNumber);
  if (has('text') && f.q) qs.set('q', f.q);
  if (has('openOnly') && f.openOnly) qs.set('openOnly', '1');
  if (has('showGroup')) qs.set('showGroup', f.showGroup ? '1' : '0');
  if (has('subtotals') && f.subtotals) qs.set('subtotals', '1');
  if (has('activeOnly')) qs.set('activeOnly', f.activeOnly ? '1' : '0');
  return qs.toString();
}

export default function ReportsPage() {
  const { lang, tx } = useLang();
  const catalogue = useLoad(() => api.get<{ reports: ReportMeta[] }>('/api/reports'), []);
  const options = useLoad(() => api.get<Options>('/api/reports/options'), []);
  const [current, setCurrent] = useState<string | null>(() => location.pathname.split('/')[2] || null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  /** השאילתה שהופעלה ב"המשך" — התצוגה לא מתרעננת בכל הקשה. */
  const [applied, setApplied] = useState<string | null>(null);

  const meta = catalogue.data?.reports.find((r) => r.id === current) ?? null;

  const choose = (id: string) => {
    history.pushState(null, '', `/reports/${id}`);
    setCurrent(id);
    setFilters(EMPTY);
    setApplied(null);
  };

  const lookupOpts = (kind: string): Opt[] =>
    (options.data?.lookups ?? [])
      .filter((l) => l.kind === kind)
      .map((l) => ({ id: l.id, name: lang === 'en' && l.name_en ? l.name_en : l.name }));
  const optsFor = (from: string): Opt[] =>
    from in (options.data ?? {}) && from !== 'lookups' ? ((options.data as unknown as Record<string, Opt[]>)[from] ?? []) : lookupOpts(from);

  const query = useMemo(() => (meta ? toQuery(filters, meta.fields) : ''), [filters, meta]);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const has = (f: FilterField) => meta?.fields.includes(f) ?? false;
  const url = (suffix: string) => `/api/reports/${current}${suffix}?${applied ?? query}`;

  return (
    <div style={s.page}>
      <h2 style={s.title}>{tx('דוחות', 'Reports')}</h2>
      <ErrorText>{catalogue.error}</ErrorText>
      <div className="rep-layout">
        <nav className="rep-menu" aria-label={tx('דוחות', 'Reports')}>
          {catalogue.data?.reports.map((r) => (
            <button key={r.id} aria-current={r.id === current ? 'page' : undefined} onClick={() => choose(r.id)}>
              {r.name}
            </button>
          ))}
        </nav>

        <section className="rep-main">
          {!meta && <p style={s.hint}>{tx('בחרו דו"ח מהרשימה.', 'Choose a report from the list.')}</p>}
          {meta && (
            <>
              <form
                style={s.card}
                onSubmit={(e) => {
                  e.preventDefault();
                  setApplied(query);
                }}
              >
                <h3 style={{ ...s.title, fontSize: 16 }}>{meta.name}</h3>
                <div style={s.row}>
                  {has('dates') && (
                    <>
                      <Field label={tx('מתאריך', 'From')}>
                        <input style={s.input} type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
                      </Field>
                      <Field label={tx('עד תאריך', 'To')}>
                        <input style={s.input} type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
                      </Field>
                    </>
                  )}
                  {has('clientOne') && (
                    <Field label={tx('לקוח', 'Client')}>
                      <select style={s.input} required value={filters.clientOne} onChange={(e) => set('clientOne', e.target.value)}>
                        <option value="">—</option>
                        {(options.data?.clients ?? []).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {has('callNumber') && (
                    <Field label={tx('מספר קריאה', 'Call number')}>
                      <input style={s.input} type="number" min={1} value={filters.callNumber} onChange={(e) => set('callNumber', e.target.value)} />
                    </Field>
                  )}
                  {has('text') && (
                    <Field label={tx('חיפוש חופשי', 'Free text')}>
                      <input style={s.input} value={filters.q} onChange={(e) => set('q', e.target.value)} />
                    </Field>
                  )}
                </div>
                <div style={s.row}>
                  {MULTI.filter((m) => has(m.field)).map((m) => (
                    <Field key={m.key} label={lang === 'en' ? m.en : m.he}>
                      <select
                        multiple
                        size={4}
                        style={s.input}
                        value={filters[m.key] as string[]}
                        onChange={(e) => set(m.key, [...e.target.selectedOptions].map((o) => o.value) as never)}
                      >
                        {optsFor(m.from as string).map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
                <div style={s.row}>
                  {has('openOnly') && <Toggle label={tx('קריאות פתוחות בלבד', 'Open calls only')} checked={filters.openOnly} onChange={(v) => set('openOnly', v)} />}
                  {has('showGroup') && <Toggle label={tx('הצג קבוצה', 'Show group')} checked={filters.showGroup} onChange={(v) => set('showGroup', v)} />}
                  {has('subtotals') && <Toggle label={tx('סכומי ביניים לעובד', 'Subtotals per employee')} checked={filters.subtotals} onChange={(v) => set('subtotals', v)} />}
                  {has('activeOnly') && <Toggle label={tx('פעילים בלבד', 'Active only')} checked={filters.activeOnly} onChange={(v) => set('activeOnly', v)} />}
                </div>
                <div style={s.row}>
                  <button type="submit" style={s.primary}>{tx('המשך', 'Continue')}</button>
                  <button
                    type="button"
                    style={s.button}
                    onClick={() => {
                      setFilters(EMPTY);
                      setApplied(null);
                    }}
                  >
                    {tx('נקה', 'Clear')}
                  </button>
                  <span style={s.grow} />
                  <button type="button" style={s.button} disabled={applied === null} onClick={() => (window.location.href = url('/pdf'))}>
                    PDF
                  </button>
                  <button type="button" style={s.button} disabled={applied === null} onClick={() => (window.location.href = url('/excel'))}>
                    Excel
                  </button>
                </div>
              </form>
              {applied !== null && (
                <iframe
                  key={`${current}?${applied}`}
                  className="rep-frame"
                  title={meta.name}
                  src={url('/html')}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
