/*
 * רשימת הקריאות.
 *
 * סינון פר עמודה בשורה שמתחת לכותרות, מיון בלחיצה על כותרת, דפדוף של 15 שורות,
 * וייצוא לאקסל של *אותו* סינון. "פתוחות בלבד" הוא ברירת המחדל מהפרמטרים של
 * החברה, וניתן לכבות אותו. קריאה שעברה את זמן הסימון או את תקן השעות של סוג
 * הקריאה מסומנת.
 *
 * צבעי הסטטוס הם חמישה טוקנים קבועים לכל החברות — ראה calls.css.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  byKind,
  callsApi,
  dateText,
  hoursText,
  ltr,
  overdueTitle,
  rowTone,
  statusTone,
  t,
  type CallList as CallListDto,
  type CallListRow,
  type CallMeta,
} from './callsApi';
import './calls.css';

/** העמודות, לפי הסדר שבו הן מוצגות. `sort` הוא המפתח שהשרת מכיר. */
const COLUMNS: { key: string; he: string; en: string; sort?: string; filter?: 'text' | 'number' | 'date' | 'lookup' }[] =
  [
    { key: 'number', he: 'מספר', en: 'No.', sort: 'number', filter: 'number' },
    { key: 'openAt', he: 'נפתחה', en: 'Opened', sort: 'openAt', filter: 'date' },
    { key: 'clientName', he: 'לקוח', en: 'Client', sort: 'client', filter: 'text' },
    { key: 'contactName', he: 'איש קשר', en: 'Contact' },
    { key: 'subject', he: 'נושא', en: 'Subject', sort: 'subject', filter: 'text' },
    { key: 'typeName', he: 'סוג', en: 'Type', sort: 'type', filter: 'lookup' },
    { key: 'statusName', he: 'סטטוס', en: 'Status', sort: 'status', filter: 'lookup' },
    { key: 'billingStatusName', he: 'חיוב', en: 'Billing', sort: 'billing', filter: 'lookup' },
    { key: 'ownerName', he: 'גורם מטפל', en: 'Owner', sort: 'owner', filter: 'lookup' },
    { key: 'hoursTotal', he: 'שעות', en: 'Hours', sort: 'hours' },
    { key: 'closedAt', he: 'נסגרה', en: 'Closed', sort: 'closedAt' },
  ];

type Filters = Record<string, string>;

/** הסינון לשאילתה. ריק = לא מסננים לפי העמודה הזו. */
function toQuery(filters: Filters, sort: string, dir: string, page: number, openOnly: boolean | null): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (sort) params.set('sort', sort);
  if (dir) params.set('dir', dir);
  if (page > 1) params.set('page', String(page));
  if (openOnly !== null) params.set('open', String(openOnly));
  return params.toString();
}

export function CallList({
  onOpen,
  onNew,
}: {
  /** נקבע על ידי מעטפת האפליקציה; בלעדיו נופלים לניווט ב-hash */
  onOpen?(id: number): void;
  onNew?(): void;
}) {
  const [meta, setMeta] = useState<CallMeta | null>(null);
  const [data, setData] = useState<CallListDto | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [sort, setSort] = useState('');
  const [dir, setDir] = useState('');
  const [page, setPage] = useState(1);
  const [openOnly, setOpenOnly] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const query = useMemo(() => toQuery(filters, sort, dir, page, openOnly), [filters, sort, dir, page, openOnly]);

  const load = useCallback(
    (q: string) => {
      setBusy(true);
      callsApi
        .list(q)
        .then((list) => {
          setData(list);
          // הפעם הראשונה: ברירת המחדל של "פתוחות בלבד" מגיעה מהפרמטרים
          setOpenOnly((current) => (current === null ? list.openOnly : current));
          setError('');
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')))
        .finally(() => setBusy(false));
    },
    [],
  );

  useEffect(() => {
    callsApi.meta().then(setMeta).catch(() => {});
  }, []);

  // הקלדה בשדה סינון לא שולחת בקשה בכל תו
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(query), 250);
    return () => clearTimeout(timer.current);
  }, [query, load]);

  const setFilter = (key: string, value: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const open = (id: number) => (onOpen ? onOpen(id) : (location.hash = `#/calls/${id}`));

  const sortBy = (key: string) => {
    setPage(1);
    if (sort !== key) {
      setSort(key);
      setDir('asc');
      return;
    }
    setDir(dir === 'asc' ? 'desc' : 'asc');
  };

  const lookups = meta?.lookups ?? [];
  const pageSize = data?.pageSize ?? meta?.pageSize ?? 15;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <section className="calls-page" aria-label={t('קריאות שירות', 'Service calls')}>
      <div className="calls-toolbar">
        <button onClick={() => (onNew ? onNew() : (location.hash = '#/calls/new'))}>
          {t('קריאה חדשה', 'New call')}
        </button>
        <label>
          <input
            type="checkbox"
            checked={openOnly ?? true}
            onChange={(e) => {
              setPage(1);
              setOpenOnly(e.target.checked);
            }}
          />{' '}
          {t('פתוחות בלבד', 'Open only')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.overdue === 'true'}
            onChange={(e) => setFilter('overdue', e.target.checked ? 'true' : '')}
          />{' '}
          {t('חריגות בלבד', 'Flagged only')}
        </label>
        <input
          className="grow"
          placeholder={t('חיפוש: מספר, נושא, תאור או לקוח', 'Search: number, subject, details or client')}
          value={filters.q ?? ''}
          onChange={(e) => setFilter('q', e.target.value)}
          aria-label={t('חיפוש', 'Search')}
        />
        {/* הייצוא מקבל בדיוק את אותו סינון */}
        <a href={callsApi.exportUrl(query)} download>
          <button type="button">{t('ייצוא לאקסל', 'Export to Excel')}</button>
        </a>
        <span className="muted">
          {data ? `${data.total} ${t('קריאות', 'calls')}` : ''} {busy ? '…' : ''}
        </span>
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="calls-table-wrap">
        <table className="calls-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {c.sort ? (
                    <button onClick={() => sortBy(c.sort!)}>
                      {t(c.he, c.en)}
                      {sort === c.sort ? <span className="arrow" aria-hidden>{dir === 'asc' ? '▲' : '▼'}</span> : null}
                    </button>
                  ) : (
                    t(c.he, c.en)
                  )}
                </th>
              ))}
            </tr>
            <tr className="calls-filters">
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col">
                  {c.key === 'number' ? (
                    <input
                      value={filters.number ?? ''}
                      onChange={(e) => setFilter('number', e.target.value.replace(/\D/g, ''))}
                      aria-label={t('סינון לפי מספר', 'Filter by number')}
                      inputMode="numeric"
                    />
                  ) : c.key === 'openAt' ? (
                    <input
                      type="date"
                      value={filters.from ?? ''}
                      onChange={(e) => setFilter('from', e.target.value)}
                      aria-label={t('מתאריך', 'From date')}
                    />
                  ) : c.key === 'clientName' ? (
                    <input
                      value={filters.client ?? ''}
                      onChange={(e) => setFilter('client', e.target.value)}
                      aria-label={t('סינון לפי לקוח', 'Filter by client')}
                    />
                  ) : c.key === 'subject' ? (
                    <input
                      value={filters.subject ?? ''}
                      onChange={(e) => setFilter('subject', e.target.value)}
                      aria-label={t('סינון לפי נושא', 'Filter by subject')}
                    />
                  ) : c.key === 'typeName' ? (
                    <LookupFilter
                      value={filters.typeId ?? ''}
                      onChange={(v) => setFilter('typeId', v)}
                      options={byKind(lookups, 'call_type')}
                      label={t('סוג', 'Type')}
                    />
                  ) : c.key === 'statusName' ? (
                    <LookupFilter
                      value={filters.statusId ?? ''}
                      onChange={(v) => setFilter('statusId', v)}
                      options={byKind(lookups, 'call_status')}
                      label={t('סטטוס', 'Status')}
                    />
                  ) : c.key === 'billingStatusName' ? (
                    <LookupFilter
                      value={filters.billingStatusId ?? ''}
                      onChange={(v) => setFilter('billingStatusId', v)}
                      options={byKind(lookups, 'billing_status')}
                      label={t('חיוב', 'Billing')}
                    />
                  ) : c.key === 'ownerName' ? (
                    <select
                      value={filters.ownerUserId ?? ''}
                      onChange={(e) => setFilter('ownerUserId', e.target.value)}
                      aria-label={t('סינון לפי גורם מטפל', 'Filter by owner')}
                    >
                      <option value="">{t('הכל', 'All')}</option>
                      <option value="none">{t('ללא', 'Unassigned')}</option>
                      {(meta?.agents ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name ?? a.id}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <Row key={row.id} row={row} showTime={meta?.params.listShowTime ?? true} onOpen={open} />
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="muted">
                  {t('אין קריאות שמתאימות לסינון', 'No calls match the filter')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="calls-paging">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t('הקודם', 'Previous')}
        </button>
        <span>
          {t('עמוד', 'Page')} {ltr(`${page} / ${pages}`)}
        </span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          {t('הבא', 'Next')}
        </button>
      </div>
    </section>
  );
}

function LookupFilter({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange(value: string): void;
  options: { id: number; name: string }[];
  label: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{t('הכל', 'All')}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function Row({ row, showTime, onOpen }: { row: CallListRow; showTime: boolean; onOpen(id: number): void }) {
  const flagged = row.delayed || row.overStd;
  return (
    <tr
      className={flagged ? 'overdue' : undefined}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(row.id)}
      tabIndex={0}
      title={flagged ? overdueTitle(row) : undefined}
    >
      <td>
        {ltr(String(row.number))}
        {row.shared ? <span title={t('קריאה משותפת עם חברה אחרת', 'Shared with another company')}> ⇄</span> : null}
        {row.linked && !row.shared ? <span title={t('קריאה מקושרת', 'Linked call')}> ↔</span> : null}
      </td>
      <td>{dateText(row.openAt, showTime)}</td>
      <td>{row.clientName}</td>
      <td>{row.contactName}</td>
      <td>{row.subject}</td>
      <td>{row.typeName}</td>
      <td>
        <span className={`status-pill tone-${statusTone(row)}`}>{row.statusName}</span>
        {flagged ? (
          <span className={`status-pill tone-${rowTone(row)}`} title={overdueTitle(row)}>
            {row.overStd ? t('חריגת תקן', 'Over standard') : t('באיחור', 'Late')}
          </span>
        ) : null}
      </td>
      <td>{row.billingStatusName}</td>
      <td>{row.ownerName}</td>
      <td>{hoursText(row.hoursTotal)}</td>
      <td>{dateText(row.closedAt, showTime)}</td>
    </tr>
  );
}
