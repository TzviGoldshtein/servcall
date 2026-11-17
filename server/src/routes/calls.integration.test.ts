/**
 * בדיקות אינטגרציה של מודול הקריאות — מול PostgreSQL אמיתי ודרך ה-HTTP.
 *
 * calls.test.ts בודק את הכללים מול מסד מדומה; כאן אותם כללים רצים על הסכמה
 * האמיתית, עם נעילות אמיתיות: 30 קריאות נפתחות במקביל ואף מספר לא נכפל.
 *
 * כל הרצה יוצרת מסד נתונים זמני משלה (servcall_test_*) ומוחקת אותו בסוף, כך
 * שהמסד של הפיתוח לא נפגע. בלי Postgres על localhost:5433 הבדיקות מדולגות,
 * אלא אם REQUIRE_DB=1 — ואז הן נכשלות, כדי ש-CI לא יעבור בשקט בלי מסד.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://servcall:servcall@localhost:5433/postgres';
const DB_NAME = 'servcall_test_' + randomBytes(5).toString('hex');

let app: FastifyInstance;
let closeAll: () => Promise<void> = async () => {};
let available = false;

/** המזהים של עולם הבדיקה. */
const world = {
  kt: 0,
  harel: 0,
  dana: 0, // נציגה בקי טלקום
  moshe: 0, // נציג בקי טלקום
  yossi: 0, // נציג בהראל
  viewer: 0, // צפייה בלבד בקי טלקום
  client: 0,
  contact: 0,
  otherContact: 0,
  typeFault: 0,
  statusOpen: 0,
  statusClosed: 0,
  statusProgress: 0,
  dur90: 0,
  dur30: 0,
  durNotStarted: 0,
  billable: 0,
  billingAgreement: 0,
  sessions: {} as Record<string, string>,
};

interface Reply<T = Record<string, any>> {
  status: number;
  body: T;
  raw: Buffer;
  headers: Record<string, unknown>;
}

/** בקשה בשם משתמש: העוגייה היא סשן אמיתי בטבלת sessions. */
async function call<T = Record<string, any>>(
  who: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<Reply<T>> {
  const res = await app.inject({
    method,
    url,
    cookies: { servcall_session: world.sessions[who]! },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    /* קובץ ולא JSON */
  }
  return { status: res.statusCode, body: parsed as T, raw: res.rawPayload, headers: res.headers };
}

const ok = async <T = Record<string, any>>(...args: Parameters<typeof call>): Promise<T> => {
  const res = await call<T>(...args);
  assert.equal(res.status, 200, `${args[1]} ${args[2]} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

const newCall = (extra: Record<string, unknown> = {}) => ({
  clientId: world.client,
  contactId: world.contact,
  subject: 'אין חיוג החוצה',
  details: 'הלקוח מדווח שאין קו מהבוקר',
  typeId: world.typeFault,
  durationId: world.dur90,
  ...extra,
});

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  try {
    await admin.connect();
  } catch (err) {
    if (process.env.REQUIRE_DB === '1') throw err;
    return; // אין מסד: הבדיקות ידולגו
  }
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = '/' + DB_NAME;
  process.env.DATABASE_URL = url.toString();
  const mediaDir = await mkdtemp(join(tmpdir(), 'servcall-test-'));
  process.env.MEDIA_DIR = mediaDir;
  process.env.WEB_DIR = join(mediaDir, 'no-web');

  // הייבוא אחרי קביעת הסביבה: config.ts קורא אותה בטעינה
  const { db, pool } = await import('../db.ts');
  const { migrate } = await import('../migrate.ts');
  const { buildHttpServer } = await import('../http.ts');
  const { createSession } = await import('../auth.ts');
  const { pino } = await import('pino');

  await migrate(db, () => {});
  app = await buildHttpServer(pino({ level: 'silent' }));
  await app.ready();

  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]!.id as number;
  const lookup = (kind: string, name: string) =>
    one('SELECT id FROM lookups WHERE kind = $1 AND name = $2', [kind, name]);

  world.kt = await one("SELECT id FROM companies WHERE code = 'kt'");
  world.harel = await one("SELECT id FROM companies WHERE code = 'harel'");
  const user = (first: string, last: string, email: string) =>
    one('INSERT INTO users (email, first_name, last_name) VALUES ($1,$2,$3) RETURNING id', [email, first, last]);
  world.dana = await user('דנה', 'כהן', 'dana@example.com');
  world.moshe = await user('משה', 'לוי', 'moshe@example.com');
  world.yossi = await user('יוסי', 'הראל', 'yossi@example.com');
  world.viewer = await user('רות', 'צופה', 'ruth@example.com');
  const member = (userId: number, companyId: number, role: string) =>
    db.query('INSERT INTO user_companies (user_id, company_id, role) VALUES ($1,$2,$3)', [userId, companyId, role]);
  await member(world.dana, world.kt, 'admin');
  await member(world.moshe, world.kt, 'agent');
  await member(world.yossi, world.harel, 'agent');
  await member(world.viewer, world.kt, 'viewer');

  world.client = await one("INSERT INTO clients (name, phone) VALUES ('מאפיית השחר', '03-5551234') RETURNING id");
  world.contact = await one(
    "INSERT INTO contacts (client_id, first_name, last_name, email) VALUES ($1, 'אבי', 'שחר', 'avi@example.com') RETURNING id",
    [world.client],
  );
  const otherClient = await one("INSERT INTO clients (name) VALUES ('לקוח אחר') RETURNING id");
  world.otherContact = await one("INSERT INTO contacts (client_id, first_name) VALUES ($1, 'זר') RETURNING id", [
    otherClient,
  ]);
  await db.query(
    "INSERT INTO client_company_settings (client_id, company_id, call_remarks, hour_cost) VALUES ($1,$2,'לא לצאת לשטח בלי אישור בעלים',250)",
    [world.client, world.kt],
  );

  world.typeFault = await lookup('call_type', 'דיווח תקלה');
  world.statusOpen = await lookup('call_status', 'פתוחה');
  world.statusClosed = await lookup('call_status', 'סגורה');
  world.statusProgress = await lookup('call_status', 'בטיפול');
  world.dur90 = await lookup('duration', '90 דקות');
  world.dur30 = await lookup('duration', '30 דקות');
  world.durNotStarted = await lookup('duration', 'טרם התחיל');
  world.billable = await lookup('hour_type', 'לחיוב');
  world.billingAgreement = await lookup('billing_status', 'הסכם שירות');

  world.sessions.dana = await createSession(db, world.dana, world.kt);
  world.sessions.moshe = await createSession(db, world.moshe, world.kt);
  world.sessions.yossi = await createSession(db, world.yossi, world.harel);
  world.sessions.viewer = await createSession(db, world.viewer, world.kt);

  available = true;
  closeAll = async () => {
    await app.close();
    await pool.end();
    await rm(mediaDir, { recursive: true, force: true });
    const cleaner = new pg.Client({ connectionString: ADMIN_URL });
    await cleaner.connect();
    await cleaner.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await cleaner.end();
  };
});

after(() => closeAll());

/** בדיקה שרצה רק כשיש מסד. */
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, async (t) => {
    if (!available) return t.skip('אין PostgreSQL על localhost:5433');
    await fn();
  });

// ------------------------------------------------------------ 1. מספור במקביל

dbTest('30 קריאות שנפתחות במקביל מקבלות 30 מספרים רצופים, והראל ממשיך מ-17601', async () => {
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      call('yossi', 'POST', '/api/calls', newCall({ subject: `קריאה במקביל ${i}`, contactId: null })),
    ),
  );
  for (const res of results) assert.equal(res.status, 200, JSON.stringify(res.body));
  const numbers = results.map((r) => r.body.number as number).sort((a, b) => a - b);
  assert.deepEqual(
    numbers,
    Array.from({ length: 30 }, (_, i) => 17601 + i),
    'רצף מלא בלי כפילות ובלי חור',
  );

  // הרצף של קי טלקום נפרד לגמרי ומתחיל מ-1
  const first = await ok('dana', 'POST', '/api/calls', newCall());
  assert.equal(first.number, 1);

  // קריאה שנדחתה באימות לא שורפת מספר: ההקצאה והכנסת הקריאה באותה טרנזקציה
  const bad = await call('dana', 'POST', '/api/calls', newCall({ contactId: world.otherContact }));
  assert.equal(bad.status, 400);
  const second = await ok('dana', 'POST', '/api/calls', newCall());
  assert.equal(second.number, 2);
});

// ------------------------------------------------------------ 2. משך טיפול ושעות

dbTest('משך טיפול יוצר שורת שעות אוטומטית; שינוי מחליף אותה ולא נוגע בידניות', async () => {
  const created = await ok('dana', 'POST', '/api/calls', newCall());
  const hoursOf = async () => (await ok('dana', 'GET', `/api/calls/${created.id}/hours`)).rows as any[];

  let rows = await hoursOf();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].auto, true);
  assert.equal(rows[0].hours, 1.5, '90 דקות חלקי 60');
  assert.equal(rows[0].description, 'משך טיפול');
  assert.equal(rows[0].hourTypeId, world.billable, 'לחיוב');
  assert.equal(rows[0].companyId, world.kt);
  assert.equal(rows[0].hourPrice, 250, 'מחיר השעה של הלקוח בחברה הזו');

  // דיווח ידני
  const manual = await ok('dana', 'POST', `/api/calls/${created.id}/hours`, {
    workDate: '2026-11-10',
    hours: 3,
    description: 'עבודה באתר הלקוח',
    hourTypeId: world.billable,
  });

  await ok('dana', 'PATCH', `/api/calls/${created.id}`, { durationId: world.dur30 });
  rows = await hoursOf();
  assert.equal(rows.filter((r) => r.auto).length, 1, 'שורה אוטומטית אחת בלבד');
  assert.equal(rows.find((r) => r.auto).hours, 0.5);
  const kept = rows.find((r) => r.id === manual.id);
  assert.equal(kept.hours, 3);
  assert.equal(kept.description, 'עבודה באתר הלקוח');

  // השורה האוטומטית נשלטת משדה המשך בלבד
  const autoId = rows.find((r) => r.auto).id;
  assert.equal((await call('dana', 'PATCH', `/api/calls/${created.id}/hours/${autoId}`, { hours: 9 })).status, 403);
  assert.equal((await call('dana', 'DELETE', `/api/calls/${created.id}/hours/${autoId}`)).status, 403);

  // עדכון שלא נוגע במשך לא מחליף את השורה
  await ok('dana', 'PATCH', `/api/calls/${created.id}`, { subject: 'נושא מעודכן' });
  assert.equal((await hoursOf()).find((r) => r.auto).id, autoId);

  // "טרם התחיל" = 0 דקות: אין שורה אוטומטית, והידנית נשארת
  await ok('dana', 'PATCH', `/api/calls/${created.id}`, { durationId: world.durNotStarted });
  rows = await hoursOf();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, manual.id);
});

// ------------------------------------------------------------ 3. שדות חובה

dbTest('שדות החובה נקבעים מפרמטרי החברה, וקריאה חדשה מקבלת את סטטוס ברירת המחדל', async () => {
  const { db } = await import('../db.ts');
  const setParam = (key: string, value: boolean) =>
    db.query(
      "UPDATE settings SET value = jsonb_set(value, ARRAY[$2], to_jsonb($3::boolean)) WHERE company_id = $1 AND key = 'params'",
      [world.kt, key, value],
    );

  // ברירת המחדל מהזריעה: סוג ומשך חובה, תאור וסטטוס חיוב לא
  const noDuration = await call('dana', 'POST', '/api/calls', newCall({ durationId: null }));
  assert.equal(noDuration.status, 400);
  assert.match(noDuration.body.error, /משך טיפול/);
  const noType = await call('dana', 'POST', '/api/calls', newCall({ typeId: null }));
  assert.match(noType.body.error, /סוג קריאה/);
  // לקוח ונושא חובה תמיד
  assert.match((await call('dana', 'POST', '/api/calls', newCall({ subject: '' }))).body.error, /נושא/);
  assert.match((await call('dana', 'POST', '/api/calls', newCall({ clientId: null }))).body.error, /לקוח/);

  const created = await ok('dana', 'POST', '/api/calls', newCall({ details: null }));
  assert.equal(created.statusId, world.statusOpen, 'defaultStatusNew');

  try {
    await setParam('requireBillingStatus', true);
    await setParam('requireDetails', true);
    await setParam('requireDuration', false);
    const strict = await call('dana', 'POST', '/api/calls', newCall({ details: null, durationId: null }));
    assert.equal(strict.status, 400);
    assert.match(strict.body.error, /תאור/);
    assert.match(strict.body.error, /סטטוס חיוב/);
    assert.doesNotMatch(strict.body.error, /משך טיפול/);
    await ok('dana', 'POST', '/api/calls', newCall({ durationId: null, billingStatusId: world.billingAgreement }));

    // גם עדכון נבדק: אי אפשר לנקות שדה חובה
    const cleared = await call('dana', 'PATCH', `/api/calls/${created.id}`, { subject: null });
    assert.equal(cleared.status, 400);

    // הפרמטרים של חברה אחת לא חלים על האחרת
    const harel = await call('yossi', 'POST', '/api/calls', newCall({ contactId: null }));
    assert.equal(harel.status, 200);
  } finally {
    await setParam('requireBillingStatus', false);
    await setParam('requireDetails', false);
    await setParam('requireDuration', true);
  }
});

// ------------------------------------------------------------ 4. העברה בין חברות

dbTest('קריאת בת נפתחת בחברה המקבלת עם מספר מהרצף שלה, והאב נשאר פתוח ומקושר', async () => {
  const { db } = await import('../db.ts');
  const parent = await ok('dana', 'POST', '/api/calls', newCall({ subject: 'תקלת תקשורת באתר' }));
  const before = (
    await db.query<{ n: number }>('SELECT call_seq_next AS n FROM companies WHERE id = $1', [world.harel])
  ).rows[0]!.n;
  const ktBefore = (
    await db.query<{ n: number }>('SELECT call_seq_next AS n FROM companies WHERE id = $1', [world.kt])
  ).rows[0]!.n;

  const link = await ok('dana', 'POST', `/api/calls/${parent.id}/links`, {
    toCompanyId: world.harel,
    reason: 'השרת בטיפול הראל',
    relayAllowed: true,
    typeId: world.typeFault,
    durationId: world.durNotStarted,
  });
  assert.equal(link.kind, 'child', 'ברירת המחדל היא קריאת בת');
  assert.equal(link.childNumber, before, 'המספר הבא ברצף של הראל');
  assert.ok(link.childNumber >= 17601);

  const seq = await db.query<{ id: number; n: number }>('SELECT id, call_seq_next AS n FROM companies WHERE id IN ($1,$2)', [
    world.harel,
    world.kt,
  ]);
  assert.equal(seq.rows.find((r) => r.id === world.harel)!.n, before + 1);
  assert.equal(seq.rows.find((r) => r.id === world.kt)!.n, ktBefore, 'הרצף של השולחת לא זז');

  // הבת שייכת להראל; קי טלקום לא רואה אותה, והראל לא רואה את האב
  const child = await ok('yossi', 'GET', `/api/calls/${link.childCallId}`);
  assert.equal(child.companyId, world.harel);
  assert.equal(child.number, before);
  assert.equal(child.clientId, world.client);
  assert.equal(child.closedAt, null);
  assert.equal((await call('dana', 'GET', `/api/calls/${link.childCallId}`)).status, 404);
  assert.equal((await call('yossi', 'GET', `/api/calls/${parent.id}`)).status, 404);

  // האב נשאר פתוח ומקושר
  const parentNow = await ok('dana', 'GET', `/api/calls/${parent.id}`);
  assert.equal(parentNow.closedAt, null);
  const links = await ok<any[]>('dana', 'GET', `/api/calls/${parent.id}/links`);
  assert.equal(links.length, 1);
  assert.equal(links[0].childCallId, link.childCallId);
  assert.equal(links[0].outgoing, true);

  // הבאנר של הצד המקבל: מי שלח, למה, ואירועי האב לקריאה בלבד
  const origin = await ok('yossi', 'GET', `/api/calls/${link.childCallId}/origin`);
  assert.equal(origin.fromCompanyName, 'קי טלקום');
  assert.equal(origin.reason, 'השרת בטיפול הראל');
  assert.equal(origin.parentNumber, parent.number);
  assert.ok(origin.parentEvents.some((e: any) => e.body === 'הלקוח מדווח שאין קו מהבוקר'));

  // שעות הבת נרשמות על הראל — כל חברה מחייבת את שלה
  await ok('yossi', 'PATCH', `/api/calls/${link.childCallId}`, { durationId: world.dur30 });
  const childHours = (await ok('yossi', 'GET', `/api/calls/${link.childCallId}/hours`)).rows as any[];
  assert.equal(childHours.length, 1);
  assert.equal(childHours[0].companyId, world.harel);
  const parentHours = (await ok('dana', 'GET', `/api/calls/${parent.id}/hours`)).rows as any[];
  assert.ok(parentHours.every((r) => r.companyId === world.kt));

  // בקשת העברת הודעה ללקוח: ממתינה לאישור, ושום דבר לא יוצא מעצמו
  const relay = await ok('yossi', 'POST', `/api/calls/${link.childCallId}/relay-requests`, {
    linkId: link.id,
    body: 'הטכנאי יגיע מחר ב-9:00',
  });
  assert.equal(relay.status, 'pending');
  const outboxBefore = await db.query('SELECT id FROM outbox');
  assert.equal(outboxBefore.rows.length, 0, 'בקשה לבדה לא שולחת כלום');
  // הצד המקבל אינו יכול לאשר לעצמו
  assert.equal((await call('yossi', 'POST', `/api/relay-requests/${relay.id}/approve`, {})).status, 403);
  const pending = await ok<any[]>('dana', 'GET', '/api/relay-requests/pending');
  assert.ok(pending.some((r) => r.id === relay.id));
  const approved = await ok('dana', 'POST', `/api/relay-requests/${relay.id}/approve`, {});
  assert.equal(approved.queued, true);
  // ההתראות ללקוח כבויות כברירת מחדל: השורה נרשמת כחסומה ולא נשלחת
  assert.equal(approved.blocked, true);
  const outbox = await db.query<{ status: string; company_id: number; to_address: string }>(
    'SELECT status, company_id, to_address FROM outbox',
  );
  assert.equal(outbox.rows.length, 1);
  assert.equal(outbox.rows[0]!.status, 'blocked');
  assert.equal(outbox.rows[0]!.company_id, world.kt, 'ההודעה יוצאת מהחברה המקורית');
  assert.equal(outbox.rows[0]!.to_address, 'avi@example.com');
});

dbTest('transfer סוגר את האב; shared היא קריאה אחת ששתי החברות רואות', async () => {
  // transfer = בת + סגירת האב
  const parent = await ok('dana', 'POST', '/api/calls', newCall());
  const moved = await ok('dana', 'POST', `/api/calls/${parent.id}/links`, {
    kind: 'transfer',
    toCompanyId: world.harel,
    typeId: world.typeFault,
    durationId: world.durNotStarted,
  });
  assert.ok(moved.childCallId);
  const closed = await ok('dana', 'GET', `/api/calls/${parent.id}`);
  assert.equal(closed.statusId, world.statusClosed, 'defaultStatusClose');
  assert.ok(closed.closedAt);
  assert.equal(closed.closedByName, 'דנה כהן');

  // shared: אין קריאה שנייה ואין מספר חדש
  const { db } = await import('../db.ts');
  const shared = await ok('dana', 'POST', '/api/calls', newCall({ subject: 'פרויקט משותף' }));
  const seqBefore = (await db.query<{ n: number }>('SELECT call_seq_next AS n FROM companies WHERE id = $1', [world.harel]))
    .rows[0]!.n;
  assert.equal((await call('yossi', 'GET', `/api/calls/${shared.id}`)).status, 404, 'לפני השיתוף הראל לא רואה');
  const link = await ok('dana', 'POST', `/api/calls/${shared.id}/links`, {
    kind: 'shared',
    toCompanyId: world.harel,
    reason: 'עבודה משותפת',
  });
  assert.equal(link.childCallId, null);
  const seqAfter = (await db.query<{ n: number }>('SELECT call_seq_next AS n FROM companies WHERE id = $1', [world.harel]))
    .rows[0]!.n;
  assert.equal(seqAfter, seqBefore);

  const seen = await ok('yossi', 'GET', `/api/calls/${shared.id}`);
  assert.equal(seen.shared, true);
  assert.equal(seen.number, shared.number);
  const list = await ok('yossi', 'GET', `/api/calls?subject=${encodeURIComponent('פרויקט משותף')}`);
  assert.equal(list.rows.length, 1);
  const origin = await ok('yossi', 'GET', `/api/calls/${shared.id}/origin`);
  assert.equal(origin.kind, 'shared');
  assert.equal(origin.fromCompanyName, 'קי טלקום');

  // שני הצדדים מעדכנים; השעות מתויגות בחברה המדווחת
  await ok('yossi', 'POST', `/api/calls/${shared.id}/events`, { body: 'הראל: הוחלף כרטיס רשת' });
  const hour = await ok('yossi', 'POST', `/api/calls/${shared.id}/hours`, { workDate: '2026-11-11', hours: 2 });
  const rows = (await ok('dana', 'GET', `/api/calls/${shared.id}/hours`)).rows as any[];
  assert.equal(rows.find((r) => r.id === hour.id).companyId, world.harel);
  assert.equal(rows.find((r) => r.auto).companyId, world.kt);
  // חברה אחת לא עורכת את השעות של האחרת
  assert.equal((await call('dana', 'DELETE', `/api/calls/${shared.id}/hours/${hour.id}`)).status, 403);
  // ורק החברה שפתחה שולחת את הקריאה הלאה
  assert.equal(
    (await call('yossi', 'POST', `/api/calls/${shared.id}/links`, { kind: 'shared', toCompanyId: world.kt })).status,
    403,
  );
});

// ------------------------------------------------------------ 5. סגירה, אירועי מערכת, הבאנר האדום

dbTest('אירועי מערכת, שינוי גורם מטפל, סגירה ופתיחה מחדש', async () => {
  const created = await ok('dana', 'POST', '/api/calls', newCall());
  const eventsOf = async () => ok<any[]>('dana', 'GET', `/api/calls/${created.id}/events`);

  // תאור הפתיחה הוא האירוע הראשון, בכתיבת המערכת
  let events = await eventsOf();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'system');
  assert.equal(events[0].body, 'הלקוח מדווח שאין קו מהבוקר');

  // ההערה האדומה של הלקוח בחברה הזו
  const detail = await ok('dana', 'GET', `/api/calls/${created.id}`);
  assert.equal(detail.clientRemarks, 'לא לצאת לשטח בלי אישור בעלים');

  // שינוי גורם מטפל נרשם בנוסח הקבוע
  await ok('dana', 'PATCH', `/api/calls/${created.id}`, { ownerUserId: world.dana });
  await ok('dana', 'PATCH', `/api/calls/${created.id}`, { ownerUserId: world.moshe });
  events = await eventsOf();
  assert.equal(events[1].body, 'בוצע שינוי גורם מטפל מ: ללא ל: דנה כהן');
  assert.equal(events[2].body, 'בוצע שינוי גורם מטפל מ: דנה כהן ל: משה לוי');
  assert.equal(events[2].kind, 'system');
  // נציג מחברה אחרת אינו יכול להיות גורם מטפל
  assert.equal((await call('dana', 'PATCH', `/api/calls/${created.id}`, { ownerUserId: world.yossi })).status, 400);

  // הערה של נציג היא סוג אחר, ואירוע מערכת אינו נערך
  const note = await ok('moshe', 'POST', `/api/calls/${created.id}/events`, { body: 'דיברתי עם הלקוח' });
  events = await eventsOf();
  assert.equal(events.find((e) => e.id === note.id).kind, 'note');
  assert.equal(
    (await call('dana', 'PATCH', `/api/calls/${created.id}/events/${events[0].id}`, { body: 'שכתוב' })).status,
    403,
  );

  // "שמור אירוע וסגור קריאה"
  const closing = await ok('moshe', 'POST', `/api/calls/${created.id}/events`, { body: 'טופל', close: true });
  assert.equal(closing.closed, true);
  let now = await ok('dana', 'GET', `/api/calls/${created.id}`);
  assert.equal(now.statusId, world.statusClosed);
  assert.ok(now.closedAt);
  assert.equal(now.closedByName, 'משה לוי');

  // סטטוס פתוח פותח מחדש; סטטוס סוגר סוגר ורושם מי ומתי
  await ok('dana', 'PATCH', `/api/calls/${created.id}`, { statusId: world.statusProgress });
  now = await ok('dana', 'GET', `/api/calls/${created.id}`);
  assert.equal(now.closedAt, null);
  await ok('dana', 'PATCH', `/api/calls/${created.id}`, { statusId: world.statusClosed });
  now = await ok('dana', 'GET', `/api/calls/${created.id}`);
  assert.ok(now.closedAt);
  assert.equal(now.closedByName, 'דנה כהן');

  // הרשאות: צופה קורא ואינו כותב; מחיקה דורשת אישור מפורש
  assert.equal((await call('viewer', 'GET', `/api/calls/${created.id}`)).status, 200);
  assert.equal((await call('viewer', 'POST', '/api/calls', newCall())).status, 403);
  assert.equal((await call('moshe', 'DELETE', `/api/calls/${created.id}?confirm=yes`)).status, 403);
  assert.equal((await call('dana', 'DELETE', `/api/calls/${created.id}`)).status, 409);
});

// ------------------------------------------------------------ 6. הרשימה

dbTest('הרשימה: פתוחות בלבד כברירת מחדל, סינון, מיון, דפדוף של 15, חריגות וייצוא', async () => {
  const { db } = await import('../db.ts');
  const all = await ok('dana', 'GET', '/api/calls');
  assert.equal(all.openOnly, true, 'listShowOnlyOpen מהפרמטרים');
  assert.equal(all.pageSize, 15);
  assert.ok(all.rows.length <= 15);
  assert.ok(all.rows.every((r: any) => !r.statusClosing && !r.closedAt));

  const withClosed = await ok('dana', 'GET', '/api/calls?open=false');
  assert.ok(withClosed.total > all.total, 'בלי הסינון נכנסות גם הסגורות');

  // דפדוף: הראל פתח 30+ קריאות
  const page1 = await ok('yossi', 'GET', '/api/calls?sort=number&dir=asc');
  const page2 = await ok('yossi', 'GET', '/api/calls?sort=number&dir=asc&page=2');
  assert.equal(page1.rows.length, 15);
  // קריאות משותפות מחברה אחרת נכנסות לרשימה (ממוינות לפי המספר שלהן), לכן בודקים את אלה של הראל
  const owned = (rows: any[]) => rows.filter((r) => !r.shared).map((r) => r.number);
  assert.equal(owned(page1.rows)[0], 17601);
  assert.deepEqual(owned(page1.rows), owned(page1.rows).slice().sort((a, b) => a - b));
  assert.ok(page2.rows.length > 0 && page2.rows[0].number > page1.rows[14].number);
  assert.ok(page1.total >= 30);
  const desc = await ok('yossi', 'GET', '/api/calls?sort=number&dir=desc');
  assert.ok(desc.rows[0].number > desc.rows[14].number);

  // סינון פר עמודה
  const byNumber = await ok('yossi', 'GET', '/api/calls?number=17605');
  assert.equal(byNumber.total, 1);
  const bySubject = await ok('yossi', 'GET', `/api/calls?subject=${encodeURIComponent('במקביל 7')}`);
  assert.equal(bySubject.total, 1);
  const byClient = await ok('dana', 'GET', `/api/calls?client=${encodeURIComponent('השחר')}&statusId=${world.statusOpen}`);
  assert.ok(byClient.total > 0);
  assert.equal((await ok('dana', 'GET', `/api/calls?client=${encodeURIComponent('אין כזה לקוח')}`)).total, 0);
  assert.equal((await call('dana', 'GET', '/api/calls?statusId=abc')).status, 400);

  // חריגה 1: קריאה פתוחה מעבר ל-markDelayMinutes
  const late = await ok('dana', 'POST', '/api/calls', newCall({ subject: 'קריאה מתעכבת', durationId: world.durNotStarted }));
  await db.query("UPDATE service_calls SET open_at = now() - interval '3 hours' WHERE id = $1", [late.id]);
  await db.query(
    "UPDATE settings SET value = jsonb_set(value, '{markDelayMinutes}', '120') WHERE company_id = $1 AND key = 'params'",
    [world.kt],
  );
  // חריגה 2: מעל תקן השעות של סוג הקריאה
  const over = await ok('dana', 'POST', '/api/calls', newCall({ subject: 'חריגה מהתקן' }));
  await db.query('UPDATE lookups SET std_hours = 1 WHERE id = $1', [world.typeFault]);
  try {
    const flagged = await ok('dana', 'GET', '/api/calls?overdue=true');
    const lateRow = flagged.rows.find((r: any) => r.id === late.id);
    const overRow = flagged.rows.find((r: any) => r.id === over.id);
    assert.equal(lateRow.delayed, true);
    assert.equal(overRow.overStd, true, '1.5 שעות מול תקן של שעה');
    assert.equal(overRow.delayed, false);
    assert.ok(flagged.rows.every((r: any) => r.delayed || r.overStd));
    assert.equal((await ok('dana', 'GET', `/api/calls/${late.id}`)).delayed, true);
    // קריאה סגורה אינה מסומנת
    await ok('dana', 'POST', `/api/calls/${late.id}/events`, { body: 'נסגר', close: true });
    assert.equal((await ok('dana', 'GET', `/api/calls/${late.id}`)).delayed, false);
  } finally {
    await db.query('UPDATE lookups SET std_hours = NULL WHERE id = $1', [world.typeFault]);
    await db.query(
      "UPDATE settings SET value = jsonb_set(value, '{markDelayMinutes}', '0') WHERE company_id = $1 AND key = 'params'",
      [world.kt],
    );
  }

  // ייצוא לאקסל: אותו סינון, קובץ xlsx אמיתי
  const xlsx = await call('yossi', 'GET', '/api/calls/export?open=false');
  assert.equal(xlsx.status, 200);
  assert.match(String(xlsx.headers['content-type']), /spreadsheetml/);
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(xlsx.raw as never);
  const sheet = book.worksheets[0]!;
  assert.equal(sheet.rowCount - 1, (await ok('yossi', 'GET', '/api/calls?open=false')).total, 'כל השורות, לא רק עמוד');
  assert.equal(sheet.getRow(1).getCell(1).value, 'מספר');

  // חיפוש לקוח לטופס, עם ההערה האדומה שלו בחברה הפעילה
  const found = await ok<any[]>('dana', 'GET', `/api/calls/clients?q=${encodeURIComponent('שחר')}`);
  assert.equal(found[0].id, world.client);
  assert.equal(found[0].callRemarks, 'לא לצאת לשטח בלי אישור בעלים');
  assert.equal((await ok<any[]>('dana', 'GET', '/api/calls/clients?q=5551234'))[0].id, world.client);
  const card = await ok('yossi', 'GET', `/api/calls/clients/${world.client}`);
  assert.equal(card.callRemarks, null, 'ההערה של קי טלקום אינה של הראל');
  assert.equal(card.contacts[0].name, 'אבי שחר');
});

// ------------------------------------------------------------ 7. הערות ופתקים

dbTest('הערות: card משותפת לכל החברות, sticky מול נציג אחד עם תזכורת וסימון ביצוע', async () => {
  const created = await ok('dana', 'POST', '/api/calls', newCall());

  const card = await ok('dana', 'POST', '/api/notes', { kind: 'card', clientId: world.client, body: 'לקוח ותיק, משלם בזמן' });
  const sticky = await ok('dana', 'POST', '/api/notes', {
    kind: 'sticky',
    callId: created.id,
    body: 'לחזור ללקוח עם הצעת מחיר',
    dueAt: '2020-01-01T08:00:00Z',
    pinnedFor: world.moshe,
  });

  // הערת הכרטיס נראית גם מהראל — כרטיס הלקוח משותף
  const fromHarel = await ok<any[]>('yossi', 'GET', `/api/notes?clientId=${world.client}`);
  assert.ok(fromHarel.some((n) => n.id === card.id));
  assert.ok(!fromHarel.some((n) => n.id === sticky.id), 'פתק אינו ידע משותף');

  // הפתק מגיע לפי קריאה וגם לפי לקוח, למי שהוא מולו
  const byCall = await ok<any[]>('moshe', 'GET', `/api/notes?callId=${created.id}&kind=sticky`);
  assert.equal(byCall.length, 1);
  assert.equal(byCall[0].pinnedFor, world.moshe);
  const byClient = await ok<any[]>('moshe', 'GET', `/api/notes?clientId=${world.client}`);
  assert.ok(byClient.some((n) => n.id === sticky.id) && byClient.some((n) => n.id === card.id));

  // "הפתקים שלי", כולל סינון למה שעבר זמנו
  const mine = await ok<any[]>('moshe', 'GET', '/api/notes/sticky/mine?overdue=true');
  assert.ok(mine.some((n) => n.id === sticky.id));
  assert.equal((await ok<any[]>('viewer', 'GET', '/api/notes/sticky/mine')).length, 0);

  // סימון ביצוע וביטולו
  await ok('moshe', 'POST', `/api/notes/${sticky.id}/done`, {});
  assert.ok(!(await ok<any[]>('moshe', 'GET', '/api/notes/sticky/mine')).some((n) => n.id === sticky.id));
  const done = (await ok<any[]>('moshe', 'GET', `/api/notes?callId=${created.id}`)).find((n) => n.id === sticky.id);
  assert.ok(done.doneAt);
  assert.equal(done.doneBy, world.moshe);
  await ok('moshe', 'POST', `/api/notes/${sticky.id}/done`, { done: false });

  // פתק חייב נציג מהחברה הפעילה; הערה חייבת לקוח או קריאה
  assert.equal(
    (await call('dana', 'POST', '/api/notes', { kind: 'sticky', clientId: world.client, body: 'x', pinnedFor: world.yossi }))
      .status,
    400,
  );
  assert.equal((await call('dana', 'POST', '/api/notes', { kind: 'card', body: 'x' })).status, 400);
  // זר לא עורך הערה של אחר
  assert.equal((await call('yossi', 'PATCH', `/api/notes/${card.id}`, { body: 'שכתוב' })).status, 403);
});

// ------------------------------------------------------------ 8. מסמכים וחתימה

dbTest('מסמכים: העלאה, הורדה וכיבוי; חתימה נשמרת ונרשמת ביומן', async () => {
  const created = await ok('dana', 'POST', '/api/calls', newCall());

  const boundary = '----servcalltest';
  const payload =
    `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nתמונת הארון\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rack.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\nhello rack\r\n--${boundary}--\r\n`;
  const upload = await app.inject({
    method: 'POST',
    url: `/api/calls/${created.id}/files`,
    cookies: { servcall_session: world.sessions.dana! },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const fileId = JSON.parse(upload.body).id as number;

  const files = await ok<any[]>('dana', 'GET', `/api/calls/${created.id}/files`);
  assert.equal(files[0].fileName, 'rack.txt');
  assert.equal(files[0].description, 'תמונת הארון');
  assert.equal(files[0].size, 10);
  const download = await call('dana', 'GET', `/api/calls/${created.id}/files/${fileId}`);
  assert.equal(download.raw.toString(), 'hello rack');
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  // חברה אחרת לא מגיעה לקובץ
  assert.equal((await call('yossi', 'GET', `/api/calls/${created.id}/files/${fileId}`)).status, 404);

  // ברירת המחדל היא כיבוי ולא מחיקה
  const removed = await ok('moshe', 'DELETE', `/api/calls/${created.id}/files/${fileId}`);
  assert.equal(removed.purged, false);
  assert.equal((await ok<any[]>('moshe', 'GET', `/api/calls/${created.id}/files`)).length, 0);
  assert.equal((await ok<any[]>('dana', 'GET', `/api/calls/${created.id}/files`))[0].active, false, 'מנהל עדיין רואה');

  // חתימה: PNG של פיקסל אחד
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const before = await ok('dana', 'GET', `/api/calls/${created.id}/signatures`);
  assert.equal(before.defaultText, 'מאשר ביצוע לשביעות רצוני');
  const signed = await ok('dana', 'POST', `/api/calls/${created.id}/signatures`, { signerName: 'אבי שחר', image: png });
  const list = await ok('dana', 'GET', `/api/calls/${created.id}/signatures`);
  assert.equal(list.rows[0].signerName, 'אבי שחר');
  assert.equal(list.rows[0].description, 'מאשר ביצוע לשביעות רצוני');
  const image = await call('dana', 'GET', `/api/calls/${created.id}/signatures/${signed.id}/image`);
  assert.equal(image.raw.subarray(1, 4).toString(), 'PNG');
  assert.equal(
    (await call('dana', 'POST', `/api/calls/${created.id}/signatures`, { signerName: 'x', image: 'data:image/svg+xml;base64,AAAA' }))
      .status,
    400,
  );
  const events = await ok<any[]>('dana', 'GET', `/api/calls/${created.id}/events`);
  assert.ok(events.some((e) => e.kind === 'system' && /אבי שחר/.test(e.body)));
});

// ------------------------------------------------------------ 9. עדכונים חיים והפרדת חברות

dbTest('עדכון חי מגיע רק לחברה של הקריאה, ובלי חברה פעילה אין גישה', async () => {
  const listen = async (who: string) => {
    const socket = await app.injectWS('/ws', { headers: { cookie: `servcall_session=${world.sessions[who]}` } });
    const seen: any[] = [];
    socket.on('message', (data: Buffer) => seen.push(JSON.parse(data.toString())));
    return { socket, seen };
  };
  const kt = await listen('moshe');
  const harel = await listen('yossi');

  const created = await ok('dana', 'POST', '/api/calls', newCall());
  await ok('dana', 'POST', `/api/calls/${created.id}/events`, { body: 'עדכון' });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const ktCalls = kt.seen.filter((m) => m.t === 'call' && m.callId === created.id);
  assert.deepEqual(
    ktCalls.map((m) => m.what),
    ['created', 'event'],
  );
  assert.equal(harel.seen.filter((m) => m.t === 'call' && m.callId === created.id).length, 0, 'הראל לא שומע');

  // אחרי שיתוף גם הראל שומע
  await ok('dana', 'POST', `/api/calls/${created.id}/links`, { kind: 'shared', toCompanyId: world.harel });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(harel.seen.some((m) => m.t === 'call' && m.callId === created.id && m.what === 'linked'));
  kt.socket.terminate();
  harel.socket.terminate();

  // משתמש בשתי חברות שעוד לא בחר חברה: ctx.companyId זורק 403
  const { db } = await import('../db.ts');
  const { createSession } = await import('../auth.ts');
  await db.query("INSERT INTO user_companies (user_id, company_id, role) VALUES ($1,$2,'agent')", [
    world.moshe,
    world.harel,
  ]);
  world.sessions.undecided = await createSession(db, world.moshe, null);
  assert.equal((await call('undecided', 'GET', '/api/calls')).status, 403);
  assert.equal((await call('undecided', 'POST', '/api/calls', newCall())).status, 403);
  // ובלי סשן בכלל
  assert.equal((await app.inject({ method: 'GET', url: '/api/calls' })).statusCode, 401);
});
