/**
 * בדיקות אינטגרציה לדו"חות, לבנק השעות ולשירותים החודשיים מול Postgres אמיתי.
 *
 * מה שנבדק כאן הוא מה שאי אפשר לבדוק בפונקציה טהורה: שהשאילתות באמת מסננות
 * לפי החברה הפעילה. המסד נזרע בשתי חברות על אותם לקוחות (הלקוחות משותפים),
 * וכל מה ששייך לחברה השנייה מסומן SECRET — אם המילה מופיעה בדו"ח של הראשונה,
 * זו דליפה.
 *
 * הבדיקה רצה בסכמה פרטית שנמחקת בסוף, כדי לא לדרוך על מי שעובד על אותו מסד.
 * בלי מסד זמין היא מדלגת ולא נכשלת.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { register } from 'tsx/esm/api';
import type { Ctx } from '../context.ts';
import type { Db } from '../db.ts';
import type { Lang } from '../i18n.ts';
import type { CallListBlock, ChartBlock, PivotBlock, TableBlock } from './types.ts';

// הטסטים רצים ב-strip-types של node, שאינו תומך ב-parameter properties
// (errors.ts של הליבה משתמש באחד). המודולים שתלויים בו נטענים לכן דרך tsx,
// בייבוא דינמי — בדיוק כמו שהשרת עצמו רץ בפיתוח.
register();
let R: typeof import('./index.ts');
let P: typeof import('./pdf.ts');
let E: typeof import('../errors.ts');
let routes: {
  reports: typeof import('../routes/reports.ts');
  hoursbank: typeof import('../routes/hoursbank.ts');
  services: typeof import('../routes/services.ts');
};

pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

const DB_URL = process.env.DATABASE_URL ?? 'postgres://servcall:servcall@localhost:5433/servcall';
const SCHEMA = `rep_test_${process.pid}`;
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

let client: pg.Client | null = null;
let db: Db;
let kt = 0;
let other = 0;
const ids: Record<string, number> = {};

const ctxOf = (companyId: number, lang: Lang = 'he', role: Ctx['role'] = 'admin'): Ctx => ({
  db,
  companyId,
  role,
  lang,
  user: {
    id: ids.dana!,
    email: 'dana@example.test',
    firstName: 'דנה',
    lastName: 'כהן',
    lang,
    isSuperadmin: false,
    memberships: [],
  },
});

/** אפליקציה קטנה עם שלושת הראוטים ואותו מיפוי שגיאות כמו בשרת האמיתי. */
function appFor(ctx: Ctx): FastifyInstance {
  const app = Fastify();
  app.setErrorHandler((err: Error, _req, reply) =>
    err instanceof E.HttpError
      ? reply.code(err.status).send({ error: err.message })
      : reply.code(500).send({ error: String(err) }),
  );
  routes.reports.registerReportRoutes(app, ctx);
  routes.hoursbank.registerHoursBankRoutes(app, ctx);
  routes.services.registerServiceRoutes(app, ctx);
  return app;
}

const one = async (sql: string, params: unknown[] = []): Promise<number> =>
  (await db.query<{ id: number }>(sql, params)).rows[0]!.id;

before(async () => {
  [R, P, E] = await Promise.all([import('./index.ts'), import('./pdf.ts'), import('../errors.ts')]);
  routes = {
    reports: await import('../routes/reports.ts'),
    hoursbank: await import('../routes/hoursbank.ts'),
    services: await import('../routes/services.ts'),
  };
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
  } catch {
    return; // אין מסד — הבדיקות ידלגו
  }
  client = c;
  // חיבור אחד לכל הבדיקה (search_path הוא פר חיבור), ולכן השאילתות עוברות בתור
  let queue: Promise<unknown> = Promise.resolve();
  db = {
    query: (sql, params) => {
      const run = queue.then(() => c.query(sql, params as never[]));
      queue = run.catch(() => undefined);
      return run as never;
    },
    tx: (fn) => fn(db),
  };
  await c.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`SET search_path TO ${SCHEMA}, public`);
  for (const file of ['001_init.sql', '002_seed.sql', '040_reports.sql']) {
    await c.query(await readFile(new URL(file, MIGRATIONS), 'utf8'));
  }

  kt = await one("SELECT id FROM companies WHERE code = 'kt'");
  other = await one("SELECT id FROM companies WHERE code = 'sedcom'");
  const lk = async (kind: string, name: string) =>
    one('SELECT id FROM lookups WHERE kind = $1 AND name = $2', [kind, name]);
  const open = await lk('call_status', 'פתוחה');
  const closed = await lk('call_status', 'סגורה');
  const type = await one("SELECT id FROM lookups WHERE kind = 'call_type' ORDER BY sort, id LIMIT 1");
  const billable = await lk('hour_type', 'לחיוב');
  const nonBillable = await lk('hour_type', 'לא לחיוב');

  ids.dana = await one(
    "INSERT INTO users (email, first_name, last_name) VALUES ('dana@example.test','דנה','כהן') RETURNING id",
  );
  ids.yossi = await one(
    "INSERT INTO users (email, first_name, last_name) VALUES ('yossi@example.test','יוסי','לוי') RETURNING id",
  );
  const group = await one("INSERT INTO client_groups (name) VALUES ('קבוצת אלפא') RETURNING id");
  ids.a = await one(
    "INSERT INTO clients (name, group_id, city, street, house_no) VALUES ('לקוח א', $1, 'חיפה', 'הנמל', '4') RETURNING id",
    [group],
  );
  ids.d = await one("INSERT INTO clients (name, group_id) VALUES ('לקוח ד', $1) RETURNING id", [group]);
  ids.b = await one("INSERT INTO clients (name) VALUES ('לקוח ב') RETURNING id");
  ids.c = await one("INSERT INTO clients (name) VALUES ('SECRET לקוח של חברה אחרת') RETURNING id");

  const call = (
    company: number,
    number: number,
    clientId: number,
    status: number,
    typeId: number | null,
    subject: string,
    details: string,
  ) =>
    one(
      `INSERT INTO service_calls (company_id, number, client_id, owner_user_id, subject, details, type_id, status_id,
                                  open_at, open_by, closed_at, closed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2026-03-10 09:00+02',$4,$9,$10) RETURNING id`,
      [
        company,
        number,
        clientId,
        ids.dana,
        subject,
        details,
        typeId,
        status,
        status === closed ? '2026-03-11 12:00+02' : null,
        status === closed ? ids.yossi : null,
      ],
    );
  ids.call1 = await call(kt, 1, ids.a!, open, type, 'מדפסת', 'המדפסת לא מדפיסה');
  ids.call2 = await call(kt, 2, ids.a!, closed, type, 'רשת', 'אין רשת בקומה 2');
  await call(kt, 3, ids.b!, open, null, 'גיבוי', 'הגיבוי נכשל');
  await call(kt, 4, ids.d!, open, type, 'מסך', 'מסך מהבהב');
  // אותו לקוח, חברה אחרת: זה בדיוק המקרה שאסור שידלוף
  ids.secretCall = await call(other, 1, ids.a!, open, type, 'SECRET subject', 'SECRET details');
  await call(other, 2, ids.c!, open, type, 'SECRET subject 2', 'SECRET details 2');

  await db.query(
    "INSERT INTO call_events (call_id, body, created_by) VALUES ($1,'הוחלף תוף',$2), ($3,'SECRET event',$2)",
    [ids.call1, ids.dana, ids.secretCall],
  );

  ids.bank = await one(
    "INSERT INTO hours_banks (client_id, company_id, name, hours) VALUES ($1,$2,'בנק 2026',10) RETURNING id",
    [ids.a, kt],
  );
  const secretBank = await one(
    "INSERT INTO hours_banks (client_id, company_id, name, hours) VALUES ($1,$2,'SECRET bank',20) RETURNING id",
    [ids.a, other],
  );
  const hour = (
    company: number,
    callId: number,
    reporter: number,
    hours: number,
    typeId: number,
    bank: number,
    text: string,
  ) =>
    db.query(
      `INSERT INTO call_hours (call_id, company_id, work_date, reporter_id, hours, description, hour_type_id, hours_bank_id)
       VALUES ($1,$2,'2026-03-10',$3,$4,$5,$6,$7)`,
      [callId, company, reporter, hours, text, typeId, bank],
    );
  await hour(kt, ids.call1!, ids.dana!, 2.5, billable, ids.bank!, 'טיפול במדפסת');
  await hour(kt, ids.call1!, ids.dana!, 1, nonBillable, ids.bank!, 'נסיעה');
  await hour(kt, ids.call2!, ids.yossi!, 4, billable, ids.bank!, 'החלפת מתג');
  await hour(other, ids.secretCall!, ids.dana!, 7, billable, secretBank, 'SECRET hours');

  const retainer = (company: number) =>
    one("SELECT id FROM items WHERE company_id = $1 AND name = 'רטיינר חודשי'", [company]);
  ids.item = await retainer(kt);
  ids.otherItem = await retainer(other);
  // 0 = לפי הקטלוג (5000); 4000 דוחה את הקטלוג, פעמיים
  await db.query(
    'INSERT INTO client_items (client_id, company_id, item_id, cost, qty) VALUES ($1,$2,$3,0,1), ($4,$2,$3,4000,2)',
    [ids.a, kt, ids.item, ids.b],
  );
  await db.query(
    'INSERT INTO client_items (client_id, company_id, item_id, cost, qty) VALUES ($1,$2,$3,999,1)',
    [ids.a, other, ids.otherItem],
  );
});

after(async () => {
  if (!client) return;
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  await client.end();
});

const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, async (t) => {
    if (!client) return t.skip('no database on localhost:5433');
    await fn();
  });

const filtersFor = (id: string) =>
  id === 'client-history' ? { ...R.EMPTY_FILTERS, clientIds: [ids.a!] } : R.EMPTY_FILTERS;

dbTest('all eleven reports build, render to HTML and Excel, and never show another company', async () => {
  assert.equal(R.REPORTS.length, 11);
  for (const lang of ['he', 'en'] as const) {
    for (const def of R.REPORTS) {
      const result = await R.buildReport(ctxOf(kt, lang), def.id, filtersFor(def.id));
      assert.ok(result.blocks.length > 0, `${def.id} is empty`);
      assert.ok(!JSON.stringify(result).includes('SECRET'), `${def.id} leaks another company`);
      const html = R.reportToHtml(result);
      assert.ok(html.includes(`dir="${lang === 'he' ? 'rtl' : 'ltr'}"`));
      assert.ok(html.includes(result.head.reportName.replace(/"/g, '&quot;')));
      const xlsx = await R.reportToExcel(result);
      assert.equal(xlsx.subarray(0, 2).toString(), 'PK', `${def.id} excel`);
    }
  }
});

dbTest('the other company sees only its own calls', async () => {
  const result = await R.buildReport(ctxOf(other), 'calls', R.EMPTY_FILTERS);
  const list = result.blocks[0] as CallListBlock;
  assert.equal(list.count, 2);
  assert.ok(list.items.every((i) => i.description.startsWith('SECRET')));
});

dbTest('distribution: pivot totals add up and the fourth table is labelled by owner', async () => {
  const { blocks } = await R.buildReport(ctxOf(kt), 'distribution', R.EMPTY_FILTERS);
  assert.equal(blocks.length, 4);
  const pivot = blocks[0] as PivotBlock;
  assert.equal(pivot.grandTotal, 4);
  assert.equal(
    pivot.colTotals.reduce((s, v) => s + v, 0),
    4,
  );
  assert.equal(
    pivot.rows.reduce((s, r) => s + r.total, 0),
    4,
  );
  const byOwner = blocks[3] as TableBlock;
  assert.equal(byOwner.columns[0]!.label, 'גורם מטפל');
  assert.equal(byOwner.rows[0]![0]!.text, 'דנה כהן');
});

dbTest('by-clients: the group cell spans its clients, and the toggle drops the group column', async () => {
  const withGroup = (await R.buildReport(ctxOf(kt), 'by-clients', R.EMPTY_FILTERS)).blocks as PivotBlock[];
  assert.equal(withGroup.length, 3);
  const alpha = withGroup[0]!.rows.find((r) => r.keys[0] === 'קבוצת אלפא')!;
  assert.deepEqual(alpha.spans, [2, 1]);
  assert.equal(withGroup[0]!.grandTotal, 4);
  const without = (await R.buildReport(ctxOf(kt), 'by-clients', { ...R.EMPTY_FILTERS, showGroup: false }))
    .blocks as PivotBlock[];
  assert.equal(without[0]!.rowHeads.length, 1);
  assert.equal(without[0]!.rows.length, 3);
});

dbTest('calls: two lines per call and a total count; date filter applies', async () => {
  const list = (await R.buildReport(ctxOf(kt), 'calls', R.EMPTY_FILTERS)).blocks[0] as CallListBlock;
  assert.equal(list.count, 4);
  assert.equal(list.items[0]!.description, 'המדפסת לא מדפיסה');
  assert.equal(list.columns.length, 10);
  const none = (await R.buildReport(ctxOf(kt), 'calls', { ...R.EMPTY_FILTERS, from: '2026-04-01' }))
    .blocks[0] as CallListBlock;
  assert.equal(none.count, 0);
});

dbTest('charts: sorted bars, fixed status colours', async () => {
  const byClient = (await R.buildReport(ctxOf(kt), 'chart-clients', R.EMPTY_FILTERS)).blocks[0] as ChartBlock;
  assert.deepEqual(
    byClient.bars.map((b) => b.value),
    [2, 1, 1],
  );
  assert.equal(byClient.total, 4);
  const a = (await R.buildReport(ctxOf(kt), 'chart-status', R.EMPTY_FILTERS)).blocks[0] as ChartBlock;
  const b = (await R.buildReport(ctxOf(other), 'chart-status', R.EMPTY_FILTERS)).blocks[0] as ChartBlock;
  // אותו סטטוס, אותו צבע, בשתי חברות עם מותג שונה
  const colorOf = (chart: ChartBlock) => chart.bars.find((x) => x.label === 'פתוחה')!.color;
  assert.ok(colorOf(a));
  assert.equal(colorOf(a), colorOf(b));
});

dbTest('hours: billable and non-billable in separate columns, subtotals per reporter', async () => {
  const plain = (await R.buildReport(ctxOf(kt), 'hours', R.EMPTY_FILTERS)).blocks[0] as TableBlock;
  const bi = plain.columns.findIndex((c) => c.key === 'billable');
  const ni = plain.columns.findIndex((c) => c.key === 'nonBillable');
  assert.equal(plain.rows.length, 3);
  assert.equal(plain.total![bi]!.num, 6.5);
  assert.equal(plain.total![ni]!.num, 1);
  // כל שורה ממלאת בדיוק אחת משתי העמודות
  for (const row of plain.rows) {
    assert.equal(Number(row[bi]!.num !== undefined) + Number(row[ni]!.num !== undefined), 1);
  }
  const sub = (await R.buildReport(ctxOf(kt), 'hours', { ...R.EMPTY_FILTERS, subtotals: true }))
    .blocks[0] as TableBlock;
  assert.equal(sub.subtotalRows!.length, 2);
  assert.equal(sub.rows.length, 5);
});

dbTest('call detail: three blocks per call; client history lists events and needs one client', async () => {
  const detail = await R.buildReport(ctxOf(kt), 'call-detail', { ...R.EMPTY_FILTERS, callNumber: 1 });
  assert.deepEqual(
    detail.blocks.map((b) => b.kind),
    ['fields', 'fields', 'table'],
  );
  const history = (await R.buildReport(ctxOf(kt), 'client-history', filtersFor('client-history')))
    .blocks[0] as CallListBlock;
  assert.equal(history.count, 2);
  assert.equal(history.items[0]!.events![0]!.body, 'הוחלף תוף');
  await assert.rejects(R.buildReport(ctxOf(kt), 'client-history', R.EMPTY_FILTERS), E.HttpError);
});

dbTest('hours bank: the balance is computed from reported hours that count in the bank', async () => {
  const app = appFor(ctxOf(kt));
  const list = (await app.inject('/api/hours-banks')).json();
  assert.equal(list.banks.length, 1);
  // 10 נרכשו, 6.5 נספרות; השעה שאינה לחיוב לא גורעת
  const bank = list.banks[0];
  assert.deepEqual([bank.purchased, bank.used, bank.balance, bank.state], [10, 6.5, 3.5, 'ok']);
  const detail = (await app.inject(`/api/hours-banks/${ids.bank}`)).json();
  assert.equal(detail.entries.length, 3);
  assert.equal(detail.entries.filter((e: { countsInBank: boolean }) => !e.countsInBank).length, 1);
  // שינוי הרכישה משנה את היתרה מיד — אין עמודה שמורה שצריך לעדכן
  const patched = await app.inject({ method: 'PATCH', url: `/api/hours-banks/${ids.bank}`, payload: { hours: 6 } });
  assert.deepEqual([patched.json().balance, patched.json().state], [-0.5, 'negative']);
  await app.inject({ method: 'PATCH', url: `/api/hours-banks/${ids.bank}`, payload: { hours: 10 } });
  // בנק של חברה אחרת אינו נגיש, גם לא לפי מזהה
  const foreign = (await appFor(ctxOf(other)).inject('/api/hours-banks')).json().banks[0].id;
  assert.equal((await app.inject(`/api/hours-banks/${foreign}`)).statusCode, 404);
  const foreignPatch = await app.inject({ method: 'PATCH', url: `/api/hours-banks/${foreign}`, payload: { hours: 1 } });
  assert.equal(foreignPatch.statusCode, 404);
  // צופה אינו משנה בנק
  const viewer = appFor(ctxOf(kt, 'he', 'viewer'));
  const denied = await viewer.inject({ method: 'PATCH', url: `/api/hours-banks/${ids.bank}`, payload: { hours: 1 } });
  assert.equal(denied.statusCode, 403);
});

dbTest('monthly services: client price overrides the catalogue, revenue total, company scoping', async () => {
  const app = appFor(ctxOf(kt));
  const list = (await app.inject('/api/client-items')).json();
  assert.equal(list.totals.monthly, 13000);
  const byClient = Object.fromEntries(list.lines.map((l: { clientId: number }) => [l.clientId, l]));
  assert.deepEqual([byClient[ids.a!].price, byClient[ids.a!].overridesCatalog], [5000, false]);
  assert.deepEqual(
    [byClient[ids.b!].price, byClient[ids.b!].monthly, byClient[ids.b!].overridesCatalog],
    [4000, 8000, true],
  );
  // שירות מהקטלוג של חברה אחרת נדחה
  const bad = await app.inject({
    method: 'POST',
    url: '/api/client-items',
    payload: { clientId: ids.a, itemId: ids.otherItem },
  });
  assert.equal(bad.statusCode, 400);
  const created = await app.inject({
    method: 'POST',
    url: '/api/client-items',
    payload: { clientId: ids.d, itemId: ids.item, cost: 100, qty: 3 },
  });
  assert.equal(created.json().monthly, 300);
  // לשונית "פרטי עדכון": מי יצר ומתי
  const single = (await app.inject(`/api/client-items/${created.json().id}`)).json();
  assert.equal(single.audit.createdBy, 'דנה כהן');
  assert.equal((await app.inject('/api/client-items/summary')).json().monthly, 13300);
  await app.inject({ method: 'DELETE', url: `/api/client-items/${created.json().id}` });
  assert.equal((await app.inject('/api/client-items')).json().totals.monthly, 13000);
  assert.equal((await app.inject('/api/items')).json().length, 2);
});

dbTest('report routes: catalogue, JSON, Excel download, unknown report, role guard', async () => {
  const app = appFor(ctxOf(kt));
  assert.equal((await app.inject('/api/reports')).json().reports.length, 11);
  const calls = (await app.inject('/api/reports/calls?from=2026-03-01&to=2026-03-31')).json();
  assert.equal(calls.blocks[0].count, 4);
  const xlsx = await app.inject('/api/reports/hours/excel');
  assert.equal(xlsx.statusCode, 200);
  assert.match(String(xlsx.headers['content-disposition']), /attachment/);
  assert.equal((await app.inject('/api/reports/nope')).statusCode, 404);
  assert.equal((await app.inject('/api/reports/calls?from=bad')).statusCode, 400);
  assert.equal((await appFor(ctxOf(kt, 'he', 'viewer')).inject('/api/reports/hours')).statusCode, 403);
});

dbTest('PDF: chromium prints a report, one job at a time', async () => {
  if (!existsSync(P.chromiumPath())) return; // כרומיום מותקן בתמונת הדוקר; בלי זה אין מה לבדוק
  const results = await Promise.all(
    ['distribution', 'chart-clients'].map(async (id) =>
      R.reportToPdf(await R.buildReport(ctxOf(kt), id, R.EMPTY_FILTERS)),
    ),
  );
  for (const pdf of results) assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
