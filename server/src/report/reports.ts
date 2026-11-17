/**
 * אחד-עשר הדו"חות של המערכת הקודמת, כפי שהצוות מכיר אותם — אותם שמות, אותן
 * עמודות, אותם סכומים. מה ששונה: אין עוגות תלת-ממד, ההתפלגויות הן עמודות
 * אופקיות ממוינות; ו"קטגוריה" בטבלת ההתפלגות הרביעית מקבלת את השם הנכון שלה,
 * "גורם מטפל" — העמודה הזו תמיד הציגה את המטפל ולא קטגוריה.
 *
 * כל דו"ח מחזיר בלוקים מהמודל הגנרי (types.ts), ומשם יוצא למסך, ל-PDF ול-Excel.
 */
import { badRequest } from '../errors.ts';
import type { Ctx } from '../context.ts';
import { localName, type Lang } from '../i18n.ts';
import { splitByReporter, splitHours, effectivePrice, lineTotal, monthlyRevenue, round2, bankBalance } from './calc.ts';
import {
  fetchCallEvents,
  fetchCallFacts,
  fetchCallHourTotals,
  fetchCallRows,
  fetchClientItems,
  fetchClients,
  fetchHourRows,
  fetchHoursBanks,
  fetchItems,
  fetchLookups,
  lookupOrder,
  type CallFact,
  type CallRow,
} from './data.ts';
import { filterText, type ReportFilters } from './filters.ts';
import { addressText, dateText, dateTimeText, hoursText, intText, moneyText, pctText, timeText } from './fmt.ts';
import { buildPivot, tally, type PivotFact } from './pivot.ts';
import { statusColor } from './status.ts';
import { texts, type Texts } from './texts.ts';
import { topBars } from './chart.ts';
import type { Block, Cell, Column } from './types.ts';

/** שדות הסינון שמסך הסינון של הדו"ח מציג. */
export type FilterField =
  | 'dates'
  | 'clients'
  | 'clientOne'
  | 'groups'
  | 'owners'
  | 'statuses'
  | 'types'
  | 'durations'
  | 'billing'
  | 'reporters'
  | 'hourTypes'
  | 'banks'
  | 'items'
  | 'callNumber'
  | 'text'
  | 'openOnly'
  | 'showGroup'
  | 'subtotals'
  | 'activeOnly';

export interface ReportDef {
  id: string;
  /** מפתח השם ב-texts.ts. */
  nameKey: keyof Texts;
  orientation: 'portrait' | 'landscape';
  fields: FilterField[];
  build(ctx: Ctx, f: ReportFilters): Promise<Block[]>;
}

// ------------------------------------------------------------- עזרי תאים

const txt = (text: string | null | undefined, tone?: Cell['tone']): Cell => ({
  text: text ?? '',
  ...(tone ? { tone } : {}),
});
const num = (n: number | null | undefined, text?: string): Cell =>
  n === null || n === undefined ? { text: '' } : { text: text ?? String(n), num: n };

const pick = (lang: Lang, name: string | null, nameEn: string | null): string =>
  name === null ? '' : localName({ name, name_en: nameEn }, lang);

const EMPTY = '—';

const statusOf = (c: CallFact, lang: Lang) => pick(lang, c.status_name, c.status_name_en) || EMPTY;
const typeOf = (c: CallFact, lang: Lang) => pick(lang, c.type_name, c.type_name_en) || EMPTY;
const durationOf = (c: CallFact, lang: Lang) => pick(lang, c.duration_name, c.duration_name_en) || EMPTY;
const billingOf = (c: CallFact, lang: Lang) => pick(lang, c.billing_name, c.billing_name_en) || EMPTY;
const ownerOf = (c: CallFact) => c.owner_name || EMPTY;
const groupOf = (c: { group_name: string | null }) => c.group_name || EMPTY;

/** טבלת סיכום חד-ממדית: תווית, כמות, אחוז וסכום. */
function tallyTable(
  t: Texts,
  title: string,
  label: string,
  facts: { label: string; value?: number }[],
): Block {
  const { rows, total } = tally(facts, EMPTY);
  const columns: Column[] = [
    { key: 'label', label, width: 28 },
    { key: 'count', label: t.count, numeric: true, width: 10 },
    { key: 'share', label: t.share, numeric: true, width: 10 },
  ];
  return {
    kind: 'table',
    title,
    columns,
    rows: rows.map((r) => [txt(r.label), num(r.value, intText(r.value)), num(r.share, pctText(r.share))]),
    total: [txt(t.total, 'strong'), num(total, intText(total)), txt(total ? '100.0%' : '')],
  };
}

// ======================================================= 1. התפלגות מסכם

async function buildDistribution(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  const [facts, lookups] = await Promise.all([
    fetchCallFacts(ctx, f),
    fetchLookups(ctx, ['call_status', 'call_type', 'duration']),
  ]);

  // (1) הפיבוט: סוג קריאה מול סטטוס, עם סכומי שורה, עמודה וסכום-על
  const pivotFacts: PivotFact[] = facts.map((c) => ({
    rowKeys: [typeOf(c, ctx.lang)],
    col: statusOf(c, ctx.lang),
  }));
  const pivot = buildPivot(pivotFacts, {
    rowHeads: [t.colType],
    cols: lookupOrder(lookups, 'call_status', ctx.lang),
    totalLabel: t.total,
    sumLabel: t.grandTotal,
    title: t.tblTypeByStatus,
    emptyLabel: EMPTY,
  });

  return [
    pivot,
    tallyTable(t, t.tblByType, t.colType, facts.map((c) => ({ label: typeOf(c, ctx.lang) }))),
    tallyTable(t, t.tblByDuration, t.colDuration, facts.map((c) => ({ label: durationOf(c, ctx.lang) }))),
    // במערכת הקודמת העמודה הזו נקראה "קטגוריה" בטעות; היא תמיד הציגה את המטפל
    tallyTable(t, t.tblByOwner, t.colOwner, facts.map((c) => ({ label: ownerOf(c) }))),
  ];
}

// =================================================== 2. מסכם לפי לקוחות

async function buildByClients(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  const [facts, lookups] = await Promise.all([
    fetchCallFacts(ctx, f),
    fetchLookups(ctx, ['call_status', 'call_type', 'duration']),
  ]);

  // מפתחות השורה: קבוצה ואז לקוח. כיבוי "הצג קבוצה" משאיר רק את הלקוח,
  // והבונה מאחד אוטומטית את השורות של אותו לקוח.
  const rowKeys = (c: CallFact): string[] =>
    f.showGroup ? [groupOf(c), c.client_name] : [c.client_name];
  const rowHeads = f.showGroup ? [t.colGroup, t.colClient] : [t.colClient];

  const make = (title: string, kind: 'call_status' | 'call_type' | 'duration', col: (c: CallFact) => string): Block =>
    buildPivot(
      facts.map((c) => ({ rowKeys: rowKeys(c), col: col(c) })),
      {
        rowHeads,
        cols: lookupOrder(lookups, kind, ctx.lang),
        totalLabel: t.total,
        sumLabel: t.grandTotal,
        title,
        emptyLabel: EMPTY,
      },
    );

  return [
    make(t.tblClientsByStatus, 'call_status', (c) => statusOf(c, ctx.lang)),
    make(t.tblClientsByType, 'call_type', (c) => typeOf(c, ctx.lang)),
    make(t.tblClientsByDuration, 'duration', (c) => durationOf(c, ctx.lang)),
  ];
}

// ======================================================= 3. איתור קריאות

const callListColumns = (t: Texts): Column[] => [
  { key: 'number', label: t.colNumber, numeric: true, width: 9 },
  { key: 'group', label: t.colGroup, width: 16 },
  { key: 'client', label: t.colClient, width: 22 },
  { key: 'owner', label: t.colOwner, width: 16 },
  { key: 'contact', label: t.colContact, width: 16 },
  { key: 'subject', label: t.colSubject, width: 26 },
  { key: 'type', label: t.colType, width: 14 },
  { key: 'address', label: t.colAddress, width: 20 },
  { key: 'openAt', label: t.colOpenAt, width: 16 },
  { key: 'closedAt', label: t.colClosedAt, width: 16 },
];

const callListCells = (c: CallRow, lang: Lang): Cell[] => [
  num(c.number, intText(c.number)),
  txt(groupOf(c)),
  txt(c.client_name),
  txt(ownerOf(c)),
  txt(c.contact_name || ''),
  txt(c.subject),
  txt(typeOf(c, lang)),
  txt(addressText(c)),
  txt(dateTimeText(c.open_at, lang)),
  txt(c.closed_at ? dateTimeText(c.closed_at, lang) : ''),
];

async function buildCalls(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  const rows = await fetchCallRows(ctx, f, 2000);
  return [
    {
      kind: 'callList',
      columns: callListColumns(t),
      // השורה השנייה של כל קריאה היא התיאור, באדום
      items: rows.map((c) => ({ cells: callListCells(c, ctx.lang), description: c.details ?? '' })),
      count: rows.length,
      countLabel: t.callsCount,
    },
  ];
}

// ============================================== 4–6. גרפי ההתפלגות

type ChartKind = 'client' | 'status' | 'type';

function buildChart(kind: ChartKind) {
  return async (ctx: Ctx, f: ReportFilters): Promise<Block[]> => {
    const t = texts(ctx.lang);
    const facts = await fetchCallFacts(ctx, f);
    const title =
      kind === 'client' ? t.rep_chartClients : kind === 'status' ? t.rep_chartStatus : t.rep_chartTypes;

    const slices = new Map<string, { value: number; color?: string }>();
    for (const c of facts) {
      const label =
        kind === 'client' ? c.client_name || EMPTY : kind === 'status' ? statusOf(c, ctx.lang) : typeOf(c, ctx.lang);
      const hit = slices.get(label);
      if (hit) hit.value += 1;
      else {
        // צבעי הסטטוס קבועים לכל החברות; שאר הגרפים משתמשים בצבע המשני
        const color = kind === 'status' ? statusColor({ name: c.status_name, is_closing: c.is_closing }) : undefined;
        slices.set(label, { value: 1, ...(color ? { color } : {}) });
      }
    }

    const { bars, total, foldedCount } = topBars(
      [...slices.entries()].map(([label, s]) => ({ label, value: s.value, ...(s.color ? { color: s.color } : {}) })),
      { max: kind === 'status' ? 15 : 12, otherLabel: t.others },
    );
    // טווח התאריכים נכנס לכותרת הגרף, כמו בדו"ח המקורי
    const range = filterText(f, ctx.lang);
    const folded = foldedCount ? `${foldedCount} ${t.foldedNote}` : '';
    const subtitle = [range, folded].filter(Boolean).join(' · ');

    return [
      {
        kind: 'chart',
        title,
        ...(subtitle ? { subtitle } : {}),
        bars,
        total,
        valueLabel: t.callsCount,
      },
    ];
  };
}

// ======================================================== 7. דיווח שעות

async function buildHours(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  const rows = await fetchHourRows(ctx, f);
  const columns: Column[] = [
    { key: 'date', label: t.colWorkDate, width: 12 },
    { key: 'reporter', label: t.colReporter, width: 16 },
    { key: 'client', label: t.colClient, width: 22 },
    { key: 'call', label: t.colNumber, numeric: true, width: 9 },
    { key: 'subject', label: t.colSubject, width: 24 },
    { key: 'description', label: t.colWorkDescription, width: 34 },
    { key: 'from', label: t.colFromTime, width: 8 },
    { key: 'to', label: t.colToTime, width: 8 },
    // שתי עמודות נפרדות: לחיוב ולא לחיוב. במערכת הקודמת זו הייתה עמודה אחת
    // עם סימון, ואי אפשר היה לסכם אותה.
    { key: 'billable', label: t.colBillable, numeric: true, width: 12 },
    { key: 'nonBillable', label: t.colNonBillable, numeric: true, width: 14 },
  ];

  const entry = (r: (typeof rows)[number]): Cell[] => {
    const billable = r.counts_in_bank === true;
    return [
      txt(dateText(r.work_date, ctx.lang)),
      txt(r.reporter_name || EMPTY),
      txt(r.client_name),
      num(r.call_number, intText(r.call_number)),
      txt(r.subject),
      txt(r.description),
      txt(timeText(r.from_time)),
      txt(timeText(r.to_time)),
      billable ? num(r.hours, hoursText(r.hours)) : txt(''),
      billable ? txt('') : num(r.hours, hoursText(r.hours)),
    ];
  };

  const subtotalRow = (label: string, b: number, nb: number): Cell[] => [
    txt(label, 'strong'),
    txt(''),
    txt(''),
    txt(''),
    txt(''),
    txt(''),
    txt(''),
    txt(''),
    num(b, hoursText(b)),
    num(nb, hoursText(nb)),
  ];

  const out: Cell[][] = [];
  const subtotalRows: number[] = [];
  if (f.subtotals) {
    // סכום ביניים לכל עובד מדווח, בסדר שבו splitByReporter מחזיר
    const { groups } = splitByReporter(
      rows.map((r) => ({ reporter: r.reporter_name ?? '', hours: r.hours, countsInBank: r.counts_in_bank })),
    );
    for (const g of groups) {
      for (const r of rows) if ((r.reporter_name || '—') === g.reporter) out.push(entry(r));
      out.push(subtotalRow(`${t.subtotal} — ${g.reporter}`, g.billable, g.nonBillable));
      subtotalRows.push(out.length - 1);
    }
  } else {
    for (const r of rows) out.push(entry(r));
  }

  const grand = splitHours(
    rows.map((r) => ({ reporter: r.reporter_name ?? '', hours: r.hours, countsInBank: r.counts_in_bank })),
  );

  return [
    {
      kind: 'table',
      columns,
      rows: out,
      ...(subtotalRows.length ? { subtotalRows } : {}),
      total: subtotalRow(`${t.grandTotal} (${t.colHours}: ${hoursText(grand.total)})`, grand.billable, grand.nonBillable),
    },
  ];
}

// ===================================================== 8. רשימת לקוחות

async function buildClientList(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  const rows = await fetchClients(ctx, f);
  const columns: Column[] = [
    { key: 'group', label: t.colGroup, width: 18 },
    { key: 'client', label: t.colClient, width: 26 },
    { key: 'vat', label: t.colVatId, width: 12 },
    { key: 'phone', label: t.colPhone, width: 14 },
    { key: 'mobile', label: t.colMobile, width: 14 },
    { key: 'address', label: t.colAddress, width: 24 },
    { key: 'hourCost', label: t.colHourCost, numeric: true, width: 10 },
    { key: 'openCalls', label: t.colOpenCalls, numeric: true, width: 10 },
    { key: 'calls', label: t.colCalls, numeric: true, width: 10 },
    { key: 'active', label: t.colActive, width: 8 },
  ];
  const openTotal = rows.reduce((s, r) => s + r.open_calls, 0);
  const callsTotal = rows.reduce((s, r) => s + r.total_calls, 0);
  return [
    {
      kind: 'table',
      columns,
      rows: rows.map((r) => [
        txt(r.group_name || EMPTY),
        txt(r.name),
        txt(r.vat_id || ''),
        txt(r.phone || ''),
        txt(r.mobile || ''),
        txt(addressText(r)),
        r.hour_cost === null ? txt('') : num(r.hour_cost, moneyText(r.hour_cost, ctx.lang)),
        num(r.open_calls, intText(r.open_calls)),
        num(r.total_calls, intText(r.total_calls)),
        txt(r.active ? t.yes : t.no, r.active ? 'plain' : 'muted'),
      ]),
      total: [
        txt(`${t.total} (${rows.length})`, 'strong'),
        txt(''),
        txt(''),
        txt(''),
        txt(''),
        txt(''),
        txt(''),
        num(openTotal, intText(openTotal)),
        num(callsTotal, intText(callsTotal)),
        txt(''),
      ],
    },
  ];
}

// ==================================================== 9. רשימת שירותים

async function buildServiceList(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  const [rows, items] = await Promise.all([fetchClientItems(ctx, f), fetchItems(ctx, f.activeOnly)]);
  const columns: Column[] = [
    { key: 'group', label: t.colGroup, width: 18 },
    { key: 'client', label: t.colClient, width: 26 },
    { key: 'item', label: t.colItem, width: 24 },
    { key: 'catalog', label: t.colCatalogPrice, numeric: true, width: 12 },
    { key: 'client_price', label: t.colClientPrice, numeric: true, width: 12 },
    { key: 'qty', label: t.colQty, numeric: true, width: 8 },
    { key: 'month', label: t.colLineTotal, numeric: true, width: 12 },
    { key: 'since', label: t.colSince, width: 12 },
  ];
  const revenue = monthlyRevenue(rows.map((r) => ({ cost: r.cost, price: r.catalog_price, qty: r.qty })));

  const services: Block = {
    kind: 'table',
    title: t.rep_services,
    columns,
    rows: rows.map((r) => {
      const price = effectivePrice(r.cost, r.catalog_price);
      const month = lineTotal({ cost: r.cost, price: r.catalog_price, qty: r.qty });
      return [
        txt(r.group_name || EMPTY),
        txt(r.client_name),
        txt(pick(ctx.lang, r.item_name, r.item_name_en)),
        num(r.catalog_price, moneyText(r.catalog_price, ctx.lang)),
        // מחיר ללקוח ששונה מאפס דוחה את הקטלוג; אפס מוצג כמחיר הקטלוג בסוגריים
        r.cost === 0
          ? txt(`(${moneyText(price, ctx.lang)})`, 'muted')
          : num(r.cost, moneyText(r.cost, ctx.lang)),
        num(r.qty, String(r.qty)),
        num(month, moneyText(month, ctx.lang)),
        txt(dateText(r.created_at, ctx.lang)),
      ];
    }),
    total: [
      txt(`${t.monthlyRevenue} (${rows.length})`, 'strong'),
      txt(''),
      txt(''),
      txt(''),
      txt(''),
      txt(''),
      num(revenue, moneyText(revenue, ctx.lang)),
      txt(''),
    ],
  };

  const catalogue: Block = {
    kind: 'table',
    title: `${t.rep_services} — ${t.colCatalogPrice}`,
    columns: [
      { key: 'item', label: t.colItem, width: 28 },
      { key: 'price', label: t.colCatalogPrice, numeric: true, width: 12 },
      { key: 'clients', label: t.colClient, numeric: true, width: 10 },
      { key: 'active', label: t.colActive, width: 8 },
    ],
    rows: items.map((it) => [
      txt(pick(ctx.lang, it.name, it.name_en)),
      num(it.price, moneyText(it.price, ctx.lang)),
      num(it.clients, intText(it.clients)),
      txt(it.active ? t.yes : t.no, it.active ? 'plain' : 'muted'),
    ]),
  };

  return [services, catalogue];
}

// ===================================================== 10. דו"ח מפורט

const DETAIL_CAP = 100;

async function buildCallDetail(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  const calls = await fetchCallRows(ctx, f, DETAIL_CAP);
  if (!calls.length) return [];
  const ids = calls.map((c) => c.id);
  const [events, hourTotals] = await Promise.all([fetchCallEvents(ctx, ids), fetchCallHourTotals(ctx, ids)]);
  const byCall = new Map<number, typeof events>();
  for (const e of events) {
    const list = byCall.get(e.call_id);
    if (list) list.push(e);
    else byCall.set(e.call_id, [e]);
  }

  const blocks: Block[] = [];
  calls.forEach((c, i) => {
    const hours = hourTotals.get(c.id) ?? { billable: 0, nonBillable: 0 };
    const stamp = (at: string | null, who: string | null, missing: string): string =>
      at ? `${dateTimeText(at, ctx.lang)} ${t.byUser} ${who || EMPTY}` : missing;

    // בלוק ראשון: כרטיס הקריאה
    blocks.push({
      kind: 'fields',
      title: `${t.tblCallCard} ${c.number} — ${c.client_name}`,
      fields: [
        { label: t.colNumber, value: String(c.number) },
        { label: t.colStatus, value: statusOf(c, ctx.lang) },
        { label: t.colGroup, value: groupOf(c) },
        { label: t.colClient, value: c.client_name },
        { label: t.colContact, value: [c.contact_name, c.contact_mobile].filter(Boolean).join(' · ') || EMPTY },
        { label: t.colOwner, value: ownerOf(c) },
        { label: t.colType, value: typeOf(c, ctx.lang) },
        { label: t.colAddress, value: addressText(c) || EMPTY },
        { label: t.colSubject, value: c.subject },
        { label: t.colSource, value: c.source },
        { label: t.colDescription, value: c.details || EMPTY, tone: 'red' },
      ],
    });

    // בלוק שני: פרטים נוספים — משך, חיוב ושלוש החתימות של הזמן
    blocks.push({
      kind: 'fields',
      title: t.tblMoreDetails,
      fields: [
        { label: t.colDuration, value: durationOf(c, ctx.lang) },
        { label: t.colBilling, value: billingOf(c, ctx.lang) },
        { label: t.colBillable, value: hoursText(hours.billable) },
        { label: t.colNonBillable, value: hoursText(hours.nonBillable) },
        { label: t.fldOpened, value: stamp(c.open_at, c.open_by_name, EMPTY) },
        { label: t.fldUpdated, value: stamp(c.updated_at, c.updated_by_name, t.notUpdated) },
        { label: t.fldClosed, value: stamp(c.closed_at, c.closed_by_name, t.notClosed) },
      ],
    });

    // בלוק שלישי: האירועים
    const list = byCall.get(c.id) ?? [];
    blocks.push({
      kind: 'table',
      title: t.tblEvents,
      columns: [
        { key: 'when', label: t.eventWhen, width: 16 },
        { key: 'who', label: t.eventWho, width: 16 },
        { key: 'body', label: t.eventBody, width: 60 },
      ],
      rows: list.map((e) => [
        txt(dateTimeText(e.created_at, ctx.lang)),
        txt(e.author_name || EMPTY),
        txt(e.body || ''),
      ]),
    });

    // עמוד לכל קריאה — הדו"ח נבנה להדפסה ולשליחה ללקוח
    if (i < calls.length - 1) blocks.push({ kind: 'break' });
  });

  // הדו"ח הזה הוא עמוד לכל קריאה; בלי תקרה סינון רחב היה מפיק מאות עמודים
  if (calls.length >= DETAIL_CAP) {
    blocks.unshift({
      kind: 'fields',
      title: t.filters,
      fields: [{ label: t.cappedNote, value: String(DETAIL_CAP), tone: 'muted' }],
    });
  }
  return blocks;
}

// ============================================== 11. היסטוריית לקוח

async function buildClientHistory(ctx: Ctx, f: ReportFilters): Promise<Block[]> {
  const t = texts(ctx.lang);
  if (f.clientIds.length !== 1) throw badRequest('יש לבחור לקוח אחד לדו"ח היסטוריית לקוח');
  const rows = await fetchCallRows(ctx, f, 2000);
  const events = await fetchCallEvents(ctx, rows.map((c) => c.id));
  const byCall = new Map<number, typeof events>();
  for (const e of events) {
    const list = byCall.get(e.call_id);
    if (list) list.push(e);
    else byCall.set(e.call_id, [e]);
  }
  return [
    {
      kind: 'callList',
      title: rows[0]?.client_name ?? '',
      columns: callListColumns(t),
      // כמו איתור קריאות, ומתחת לשורה האדומה גם האירועים של הקריאה
      items: rows.map((c) => ({
        cells: callListCells(c, ctx.lang),
        description: c.details ?? '',
        events: (byCall.get(c.id) ?? []).map((e) => ({
          when: dateTimeText(e.created_at, ctx.lang),
          who: e.author_name || EMPTY,
          body: e.body || '',
        })),
      })),
      count: rows.length,
      countLabel: t.callsCount,
    },
  ];
}

// ================================================= בנק שעות (נספח)

/** טבלת בנק השעות — משמשת גם את מסך בנק השעות וגם כנספח לדו"ח לקוח. */
export async function bankTable(ctx: Ctx, clientIds: number[]): Promise<Block> {
  const t = texts(ctx.lang);
  const banks = await fetchHoursBanks(ctx, { clientIds, activeOnly: true });
  const rows = banks.map((b) => {
    const balance = bankBalance(b.purchased, [{ hours: b.used_hours, countsInBank: true }]);
    return [
      txt(b.client_name),
      txt(b.name),
      num(balance.purchased, hoursText(balance.purchased)),
      num(balance.used, hoursText(balance.used)),
      num(balance.balance, hoursText(balance.balance)),
      txt(pctText(balance.usedPct), balance.state === 'ok' ? 'plain' : 'red'),
    ];
  });
  const purchased = round2(banks.reduce((s, b) => s + b.purchased, 0));
  const used = round2(banks.reduce((s, b) => s + b.used_hours, 0));
  return {
    kind: 'table',
    title: t.colBank,
    columns: [
      { key: 'client', label: t.colClient, width: 24 },
      { key: 'bank', label: t.colBankName, width: 20 },
      { key: 'purchased', label: t.colPurchased, numeric: true, width: 12 },
      { key: 'used', label: t.colUsed, numeric: true, width: 12 },
      { key: 'balance', label: t.colBalance, numeric: true, width: 12 },
      { key: 'pct', label: t.share, numeric: true, width: 10 },
    ],
    rows,
    total: [
      txt(t.total, 'strong'),
      txt(''),
      num(purchased, hoursText(purchased)),
      num(used, hoursText(used)),
      num(round2(purchased - used), hoursText(round2(purchased - used))),
      txt(''),
    ],
  };
}

// ---------------------------------------------------------- המאגר

export const REPORTS: ReportDef[] = [
  {
    id: 'distribution',
    nameKey: 'rep_distribution',
    orientation: 'landscape',
    fields: ['dates', 'clients', 'groups', 'owners', 'statuses', 'types', 'durations', 'billing', 'openOnly'],
    build: buildDistribution,
  },
  {
    id: 'by-clients',
    nameKey: 'rep_byClients',
    orientation: 'landscape',
    fields: ['dates', 'clients', 'groups', 'owners', 'statuses', 'types', 'openOnly', 'showGroup'],
    build: buildByClients,
  },
  {
    id: 'calls',
    nameKey: 'rep_calls',
    orientation: 'landscape',
    fields: [
      'dates',
      'clients',
      'groups',
      'owners',
      'statuses',
      'types',
      'durations',
      'billing',
      'callNumber',
      'text',
      'openOnly',
    ],
    build: buildCalls,
  },
  {
    id: 'chart-clients',
    nameKey: 'rep_chartClients',
    orientation: 'portrait',
    fields: ['dates', 'groups', 'clients', 'statuses', 'types', 'openOnly'],
    build: buildChart('client'),
  },
  {
    id: 'chart-status',
    nameKey: 'rep_chartStatus',
    orientation: 'portrait',
    fields: ['dates', 'groups', 'clients', 'types', 'openOnly'],
    build: buildChart('status'),
  },
  {
    id: 'chart-types',
    nameKey: 'rep_chartTypes',
    orientation: 'portrait',
    fields: ['dates', 'groups', 'clients', 'statuses', 'openOnly'],
    build: buildChart('type'),
  },
  {
    id: 'hours',
    nameKey: 'rep_hours',
    orientation: 'landscape',
    fields: ['dates', 'clients', 'groups', 'reporters', 'owners', 'hourTypes', 'banks', 'text', 'subtotals'],
    build: buildHours,
  },
  {
    id: 'clients',
    nameKey: 'rep_clients',
    orientation: 'landscape',
    fields: ['groups', 'clients', 'text', 'activeOnly'],
    build: buildClientList,
  },
  {
    id: 'services',
    nameKey: 'rep_services',
    orientation: 'landscape',
    fields: ['groups', 'clients', 'items', 'text', 'activeOnly'],
    build: buildServiceList,
  },
  {
    id: 'call-detail',
    nameKey: 'rep_callDetail',
    orientation: 'portrait',
    fields: ['dates', 'clients', 'callNumber', 'statuses', 'owners', 'openOnly'],
    build: buildCallDetail,
  },
  {
    id: 'client-history',
    nameKey: 'rep_clientHistory',
    orientation: 'landscape',
    fields: ['clientOne', 'dates', 'statuses', 'types', 'openOnly'],
    build: buildClientHistory,
  },
];

export const findReport = (id: string): ReportDef | undefined => REPORTS.find((r) => r.id === id);
