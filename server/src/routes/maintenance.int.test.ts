import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import ExcelJS from 'exceljs';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';

// ההעלאות של הבדיקה נכתבות לתיקייה זמנית ולא ל-data/ של הריפו
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'servcall-test-'));

const { config } = await import('../config.ts');
const { hashPassword, verifyPassword } = await import('../auth.ts');
const { HttpError } = await import('../errors.ts');
const { roleIn } = await import('../requestContext.ts');
const { registerDepartmentsRoutes } = await import('./departments.ts');
const { registerUsersRoutes } = await import('./users.ts');
const { registerClientsRoutes } = await import('./clients.ts');
const { registerContactsRoutes } = await import('./contacts.ts');
const { registerLookupsRoutes } = await import('./lookups.ts');
const { registerParamsRoutes } = await import('./params.ts');
const { registerImporterRoutes } = await import('./importer.ts');

import type { Ctx, Role, SessionUser } from '../context.ts';
import type { Db } from '../db.ts';
import type { Hub } from '../http.ts';

/**
 * בדיקות אינטגרציה של מודול התחזוקה מול PostgreSQL אמיתי, בסכמה זמנית משלהן.
 *
 * מה שנבדק כאן הוא מה ש-typecheck לא רואה: שנתון של חברה אחת לא מגיע לחברה
 * אחרת, שאדמין של חברה לא נוגע בשיוך או בזהות של אדם בחברה אחרת, ושהייבוא
 * כותב את השדות שפר חברה לחברה הפעילה בלבד.
 *
 * בלי מסד זמין (DATABASE_URL, ברירת המחדל localhost:5433) הבדיקות מדולגות.
 */

pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

const SCHEMA = `maint_test_${process.pid}`;
const admin = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 1500 });
const reachable = await admin
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false);
const skip = reachable ? false : 'אין PostgreSQL זמין לבדיקות האינטגרציה';

let pool: pg.Pool;
let app: FastifyInstance;
const events: { companyId: number; event: { t: string; entity: string } }[] = [];
const dropped: number[] = [];

/** מי "מחובר" ובאיזו חברה. הבדיקות מחליפות את זה בין בקשה לבקשה. */
const session: { user: SessionUser | null; companyId: number | null } = { user: null, companyId: null };

const company: Record<string, number> = {};
const people: Record<string, number> = {};

function as(name: keyof typeof USERS, companyCode: string | null): void {
  session.user = USERS[name]!();
  session.companyId = companyCode === null ? null : company[companyCode]!;
}

const member = (code: string, role: Role) => ({
  companyId: company[code]!,
  companyCode: code,
  companyName: code,
  role,
  extension: null,
});
const person = (id: number, memberships: SessionUser['memberships'], isSuperadmin = false): SessionUser => ({
  id,
  email: `u${id}@example.test`,
  firstName: 'בדיקה',
  lastName: null,
  lang: 'he',
  isSuperadmin,
  memberships,
});

const USERS = {
  /** אדמין של קי טלקום בלבד */
  ktAdmin: () => person(people.ktAdmin!, [member('kt', 'admin')]),
  /** אדמין של קוריץ בלבד */
  korizAdmin: () => person(people.korizAdmin!, [member('koriz', 'admin')]),
  /** נציג בשתי החברות */
  shared: () => person(people.shared!, [member('kt', 'agent'), member('koriz', 'admin')]),
  viewer: () => person(people.viewer!, [member('kt', 'viewer')]),
  root: () => person(people.root!, [], true),
};

async function call<T = any>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await app.inject({ method: method as 'GET', url, payload: body as object | undefined });
  let parsed: unknown = null;
  try {
    parsed = res.json();
  } catch {
    parsed = res.rawPayload;
  }
  return { status: res.statusCode, body: parsed as T };
}

/** העלאת קובץ כ-multipart, כמו שהדפדפן שולח. */
async function upload(url: string, file: Buffer, fields: Record<string, string> = {}) {
  const boundary = '----servcalltest';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clients.xlsx"\r\n` +
        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n',
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  const res = await app.inject({
    method: 'POST',
    url,
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
}

async function sheetOf(rows: string[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('לקוחות');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

before(async () => {
  if (skip) return;
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 4,
    options: `-c search_path=${SCHEMA},public`,
  });
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of ['001_init.sql', '002_seed.sql']) {
    await pool.query(await readFile(new URL(file, migrations), 'utf8'));
  }

  const db: Db = {
    query: (sql, params) => pool.query(sql, params as never[]),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const scoped: Db = { query: (sql, params) => client.query(sql, params as never[]), tx: (inner) => inner(scoped) };
        const out = await fn(scoped);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };

  for (const row of (await pool.query<{ id: number; code: string }>('SELECT id, code FROM companies')).rows) {
    company[row.code] = row.id;
  }
  const addUser = async (key: string, memberships: [string, Role][], superadmin = false) => {
    const { rows } = await pool.query<{ id: number }>(
      'INSERT INTO users (email, first_name, is_superadmin, password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
      [`${key}@example.test`, key, superadmin, await hashPassword('original-password')],
    );
    people[key] = rows[0]!.id;
    for (const [code, role] of memberships) {
      await pool.query(
        'INSERT INTO user_companies (user_id, company_id, role, extension, external_id) VALUES ($1,$2,$3,$4,$5)',
        [rows[0]!.id, company[code], role, code === 'kt' ? '101' : '202', `${code}-acc`],
      );
    }
  };
  await addUser('ktAdmin', [['kt', 'admin']]);
  await addUser('korizAdmin', [['koriz', 'admin']]);
  await addUser('shared', [['kt', 'agent'], ['koriz', 'admin']]);
  await addUser('viewer', [['kt', 'viewer']]);
  await addUser('root', [], true);

  // אותו חוזה כמו requestContext.ts: בלי חברה פעילה הגישה ל-companyId זורקת 403
  const userOf = (): SessionUser => {
    if (!session.user) throw new HttpError(401, 'נדרשת התחברות');
    return session.user;
  };
  const companyOf = (): number => {
    userOf();
    if (session.companyId == null) throw new HttpError(403, 'לא נבחרה חברה');
    return session.companyId;
  };
  const ctx: Ctx = {
    db,
    get user() {
      return userOf();
    },
    get companyId() {
      return companyOf();
    },
    get role() {
      return roleIn(userOf(), companyOf());
    },
    get lang() {
      return userOf().lang;
    },
  };
  const hub = {
    broadcast: (companyId: number, event: unknown) => events.push({ companyId, event: event as never }),
    dropUser: (userId: number) => dropped.push(userId),
  } as unknown as Hub;

  app = Fastify();
  await app.register(multipart, { limits: { files: 1 } });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    return reply.code(500).send({ error: err.message });
  });
  registerDepartmentsRoutes(app, ctx, hub);
  registerUsersRoutes(app, ctx, hub);
  registerClientsRoutes(app, ctx, hub);
  registerContactsRoutes(app, ctx, hub);
  registerLookupsRoutes(app, ctx, hub);
  registerParamsRoutes(app, ctx, hub);
  registerImporterRoutes(app, ctx, hub);
  await app.ready();
});

after(async () => {
  await app?.close();
  await pool?.end();
  if (!skip) await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

// ---------------------------------------------------------------- הרשאות וחברה פעילה

test('without an active company every maintenance route answers 403', { skip }, async () => {
  as('shared', null);
  for (const url of ['/api/clients', '/api/users', '/api/departments', '/api/lookups', '/api/params']) {
    assert.equal((await call('GET', url)).status, 403, url);
  }
});

test('a viewer reads everything and writes nothing', { skip }, async () => {
  as('viewer', 'kt');
  assert.equal((await call('GET', '/api/clients')).status, 200);
  assert.equal((await call('GET', '/api/lookups?kind=call_status')).status, 200);
  assert.equal((await call('GET', '/api/params')).status, 200);
  assert.equal((await call('POST', '/api/clients', { name: 'לא אמור להיווצר' })).status, 403);
  assert.equal((await call('POST', '/api/departments', { name: 'x' })).status, 403);
  assert.equal((await call('POST', '/api/lookups', { kind: 'call_type', name: 'x' })).status, 403);
  assert.equal((await call('PUT', '/api/params', { requireDetails: true })).status, 403);
  assert.equal((await call('PATCH', `/api/users/${people.viewer}`, { role: 'admin' })).status, 403);
});

// ---------------------------------------------------------------- לקוחות

let clientId = 0;

test('a client is shared, but its call remarks belong to one company', { skip }, async () => {
  as('ktAdmin', 'kt');
  const made = await call('POST', '/api/clients', {
    name: 'בית ספר אורט',
    city: 'חדרה',
    callRemarks: 'לא לתת שירות בלי אישור — חוב פתוח',
    hourCost: 250,
    defaultOwnerId: people.ktAdmin,
    offline: true,
  });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  clientId = made.body.id;
  assert.equal(made.body.callRemarks, 'לא לתת שירות בלי אישור — חוב פתוח');

  // קוריץ רואה את אותו לקוח, בלי אף אחד מהשדות של קי טלקום
  as('korizAdmin', 'koriz');
  const other = await call('GET', `/api/clients/${clientId}`);
  assert.equal(other.status, 200);
  assert.equal(other.body.name, 'בית ספר אורט');
  assert.equal(other.body.callRemarks, null);
  assert.equal(other.body.hourCost, null);
  assert.equal(other.body.defaultOwnerId, null);
  assert.equal(other.body.ownerName, null);
  assert.equal(other.body.offline, false);

  const list = await call('GET', '/api/clients?callRemarks=' + encodeURIComponent('חוב'));
  assert.equal(list.body.total, 0, 'סינון לפי ההערה של חברה אחרת לא מוצא כלום');

  // קוריץ כותבת הערה משלה; של קי טלקום לא זזה
  const patched = await call('PATCH', `/api/clients/${clientId}`, { callRemarks: 'לקוח VIP' });
  assert.equal(patched.body.callRemarks, 'לקוח VIP');
  as('ktAdmin', 'kt');
  assert.equal((await call('GET', `/api/clients/${clientId}`)).body.callRemarks, 'לא לתת שירות בלי אישור — חוב פתוח');
});

test('the default owner must be an agent of the active company', { skip }, async () => {
  as('ktAdmin', 'kt');
  const res = await call('PATCH', `/api/clients/${clientId}`, { defaultOwnerId: people.korizAdmin });
  assert.equal(res.status, 400);
});

test('deactivating a client is per company unless a superadmin does it globally', { skip }, async () => {
  as('korizAdmin', 'koriz');
  assert.equal((await call('DELETE', `/api/clients/${clientId}`)).status, 200);
  assert.equal((await call('GET', '/api/clients?name=' + encodeURIComponent('אורט'))).body.total, 0);
  assert.equal((await call('GET', '/api/clients?all=1&name=' + encodeURIComponent('אורט'))).body.total, 1);

  as('ktAdmin', 'kt');
  assert.equal((await call('GET', '/api/clients?name=' + encodeURIComponent('אורט'))).body.total, 1, 'בקי טלקום הוא עדיין פעיל');
  assert.equal((await call('DELETE', `/api/clients/${clientId}?global=1`)).status, 403);
  assert.equal((await call('PATCH', `/api/clients/${clientId}`, { active: false })).status, 403);
  // אותו ערך שכבר שמור אינו "שינוי" — הטופס שולח את הרשומה כולה
  assert.equal((await call('PATCH', `/api/clients/${clientId}`, { active: true, city: 'חדרה' })).status, 200);
});

test('the list pages by 15, sorts and filters per column, and exports the same filter', { skip }, async () => {
  as('ktAdmin', 'kt');
  for (let i = 1; i <= 17; i++) {
    const res = await call('POST', '/api/clients', { name: `לקוח דפדוף ${String(i).padStart(2, '0')}`, city: 'עפולה' });
    assert.equal(res.status, 200);
  }
  const first = await call('GET', '/api/clients?city=' + encodeURIComponent('עפולה') + '&sort=name&dir=desc');
  assert.equal(first.body.total, 17);
  assert.equal(first.body.pageSize, 15);
  assert.equal(first.body.pages, 2);
  assert.equal(first.body.rows.length, 15);
  assert.equal(first.body.rows[0].name, 'לקוח דפדוף 17');
  const second = await call('GET', '/api/clients?city=' + encodeURIComponent('עפולה') + '&sort=name&dir=desc&page=2');
  assert.equal(second.body.rows.length, 2);
  // עמודת מיון שלא ברשימה לא מגיעה ל-SQL
  assert.equal((await call('GET', '/api/clients?sort=' + encodeURIComponent('c.id; DROP TABLE clients'))).status, 200);
  assert.equal((await call('GET', '/api/clients?groupId=abc')).status, 400);

  const res = await app.inject({ method: 'GET', url: '/api/clients/export.xlsx?city=' + encodeURIComponent('עפולה') });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /spreadsheetml/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(res.rawPayload as never);
  assert.equal(book.worksheets[0]!.rowCount, 18, 'כותרת + 17 לקוחות, בלי דפדוף');
});

// ---------------------------------------------------------------- אנשי קשר

test('a contact keeps mobile_e164 normalised and is shown by its Google name', { skip }, async () => {
  as('ktAdmin', 'kt');
  const made = await call('POST', `/api/clients/${clientId}/contacts`, {
    firstName: 'משה',
    lastName: 'כהן',
    mobile: '050-123 4567',
    mobileE164: '+10000000000', // הדפדפן לא קובע את המנורמל
  });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.mobileE164, '+972501234567');
  assert.equal(made.body.displayName, 'משה כהן');
  assert.equal(made.body.clientName, 'בית ספר אורט');

  await pool.query('UPDATE contacts SET google_name = $2 WHERE id = $1', [made.body.id, 'משה כהן - אב בית']);
  const lookup = await call('GET', '/api/contacts/lookup?phone=972501234567');
  assert.equal(lookup.body.matches.length, 1);
  assert.equal(lookup.body.matches[0].displayName, 'משה כהן - אב בית');
  assert.equal(lookup.body.matches[0].clientName, 'בית ספר אורט');
  assert.equal(lookup.body.matches[0].callRemarks, 'לא לתת שירות בלי אישור — חוב פתוח');

  // אותה שיחה נכנסת בקוריץ: אותו איש קשר, ההערה של קוריץ
  as('korizAdmin', 'koriz');
  assert.equal((await call('GET', '/api/contacts/lookup?phone=0501234567')).body.matches[0].callRemarks, 'לקוח VIP');

  as('ktAdmin', 'kt');
  const changed = await call('PATCH', `/api/contacts/${made.body.id}`, { mobile: '+44 20 7946 0958' });
  assert.equal(changed.body.mobileE164, '+442079460958');
  const cleared = await call('PATCH', `/api/contacts/${made.body.id}`, { mobile: '' });
  assert.equal(cleared.body.mobileE164, null);
  assert.equal(cleared.body.mobile, null);
});

// ---------------------------------------------------------------- נציגים

test('an admin sees and edits only the membership of the active company', { skip }, async () => {
  as('ktAdmin', 'kt');
  const list = await call('GET', '/api/users?all=1');
  const ids = list.body.map((u: { id: number }) => u.id);
  assert.ok(ids.includes(people.shared));
  assert.ok(!ids.includes(people.korizAdmin), 'נציג של קוריץ בלבד לא מופיע בקי טלקום');
  const shared = list.body.find((u: { id: number }) => u.id === people.shared);
  assert.equal(shared.role, 'agent');
  assert.equal(shared.extension, '101');
  assert.equal(shared.externalId, 'kt-acc');
  assert.equal(shared.inOtherCompanies, true);
  assert.equal(shared.memberships, undefined);

  assert.equal((await call('GET', `/api/users/${people.korizAdmin}`)).status, 404);
  assert.equal((await call('PATCH', `/api/users/${people.korizAdmin}`, { role: 'viewer' })).status, 404);
  assert.equal((await call('DELETE', `/api/users/${people.korizAdmin}/membership`)).status, 404);

  const res = await call('PATCH', `/api/users/${people.shared}`, { extension: '155', role: 'opener', externalId: 'kt-9' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rows = await pool.query(
    'SELECT company_id, role, extension, external_id FROM user_companies WHERE user_id = $1 ORDER BY company_id',
    [people.shared],
  );
  assert.deepEqual(
    rows.rows.map((r) => [r.company_id, r.role, r.extension, r.external_id]),
    [
      [company.kt, 'opener', '155', 'kt-9'],
      [company.koriz, 'admin', '202', 'koriz-acc'],
    ],
  );
  assert.ok(dropped.includes(people.shared!), 'שינוי הרשאה סוגר את החיבור החי');

  // company_id של חברה אחרת בגוף הבקשה נדחה ולא "מתפרש"
  assert.equal((await call('PATCH', `/api/users/${people.shared}`, { companyId: company.koriz, role: 'viewer' })).status, 400);
});

test('sign-in identity of a person who works elsewhere is not editable from one company', { skip }, async () => {
  as('ktAdmin', 'kt');
  assert.equal((await call('POST', `/api/users/${people.shared}/password`, { password: 'new-password-1' })).status, 403);
  assert.equal((await call('PATCH', `/api/users/${people.shared}`, { email: 'taken-over@example.test' })).status, 403);
  const stored = await pool.query('SELECT password_hash, email FROM users WHERE id = $1', [people.shared]);
  assert.equal(await verifyPassword('original-password', stored.rows[0].password_hash), true);
  assert.equal(stored.rows[0].email, 'shared@example.test');

  // אדם ששייך לחברה הזו בלבד — כן
  assert.equal((await call('POST', `/api/users/${people.viewer}/password`, { password: 'short' })).status, 400);
  assert.equal((await call('POST', `/api/users/${people.viewer}/password`, { password: 'new-password-1' })).status, 200);
  const viewer = await pool.query('SELECT password_hash FROM users WHERE id = $1', [people.viewer]);
  assert.match(viewer.rows[0].password_hash, /^scrypt\$/);
  assert.equal(await verifyPassword('new-password-1', viewer.rows[0].password_hash), true);

  // סופר-אדמין רשאי, וגם רואה את מפת החברות
  as('root', 'kt');
  assert.equal((await call('POST', `/api/users/${people.shared}/password`, { password: 'root-set-pass' })).status, 200);
  assert.equal((await call('GET', `/api/users/${people.shared}`)).body.memberships.length, 2);
});

test('an admin cannot demote or remove themselves, nor grant superadmin', { skip }, async () => {
  as('ktAdmin', 'kt');
  assert.equal((await call('PATCH', `/api/users/${people.ktAdmin}`, { role: 'agent' })).status, 400);
  assert.equal((await call('DELETE', `/api/users/${people.ktAdmin}/membership`)).status, 400);
  assert.equal((await call('PATCH', `/api/users/${people.viewer}`, { isSuperadmin: true })).status, 403);
  assert.equal((await call('DELETE', `/api/users/${people.viewer}`)).status, 403);
  // PUT בלי הרשאה לא מוריד אדמין קיים לנציג
  const put = await call('PUT', `/api/users/${people.ktAdmin}/membership`, { extension: '100' });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.role, 'admin');
});

test('an existing person joins a second company with separate details', { skip }, async () => {
  as('ktAdmin', 'kt');
  const available = await call('GET', '/api/users/available?q=korizAdmin');
  assert.equal(available.body.length, 1);
  assert.deepEqual(Object.keys(available.body[0]).sort(), ['email', 'firstName', 'id', 'lastName']);

  const joined = await call('PUT', `/api/users/${people.korizAdmin}/membership`, { extension: '177', externalId: 'kt-77' });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.role, 'agent');
  const koriz = await pool.query(
    'SELECT role, extension, external_id FROM user_companies WHERE user_id = $1 AND company_id = $2',
    [people.korizAdmin, company.koriz],
  );
  assert.deepEqual(koriz.rows[0], { role: 'admin', extension: '202', external_id: 'koriz-acc' });

  const dup = await call('POST', '/api/users', { email: 'SHARED@example.test', firstName: 'כפול' });
  assert.equal(dup.status, 409);
});

// ---------------------------------------------------------------- טבלאות קוד

test('one generic lookup API serves the six kinds with their own extra columns', { skip }, async () => {
  as('ktAdmin', 'kt');
  const kinds = await call('GET', '/api/lookups/kinds');
  assert.deepEqual(
    kinds.body.map((k: { kind: string }) => k.kind),
    ['call_type', 'call_status', 'billing_status', 'duration', 'hour_type', 'service_type'],
  );

  const wrong = await call('POST', '/api/lookups', { kind: 'duration', name: 'x', isClosing: true });
  assert.equal(wrong.status, 400, 'עמודה של סוג אחר נדחית');
  const duration = await call('POST', '/api/lookups', { kind: 'duration', name: '10 דקות', minutes: 10 });
  assert.equal(duration.body.minutes, 10);
  assert.equal(duration.body.companyId, null);

  const mine = await call('POST', '/api/lookups', { kind: 'call_type', name: 'התקנת מרכזייה', companyOnly: true, stdHours: 4 });
  assert.equal(mine.body.companyId, company.kt);
  assert.equal(mine.body.stdHours, 4);

  // ערך של קי טלקום בלבד לא נראה ולא נערך מקוריץ
  as('korizAdmin', 'koriz');
  const theirs = await call('GET', '/api/lookups?kind=call_type&all=1');
  assert.ok(!theirs.body.some((l: { id: number }) => l.id === mine.body.id));
  assert.equal((await call('PATCH', `/api/lookups/${mine.body.id}`, { name: 'נגנב' })).status, 404);
  assert.equal((await call('DELETE', `/api/lookups/${mine.body.id}`)).status, 404);

  // הבוחרים מקבלים פעילים בלבד
  as('ktAdmin', 'kt');
  assert.equal((await call('DELETE', `/api/lookups/${duration.body.id}`)).status, 200);
  const pickers = await call('GET', '/api/lookups?kind=duration');
  assert.ok(!pickers.body.some((l: { id: number }) => l.id === duration.body.id));
  const all = await call('GET', '/api/lookups?kind=duration&all=1');
  assert.ok(all.body.some((l: { id: number; active: boolean }) => l.id === duration.body.id && !l.active));
});

test('a status that some company uses as its default cannot be switched off', { skip }, async () => {
  as('ktAdmin', 'kt');
  const { values } = (await call('GET', '/api/params')).body;
  assert.equal((await call('DELETE', `/api/lookups/${values.defaultStatusNew}`)).status, 400);
  assert.equal((await call('PATCH', `/api/lookups/${values.defaultStatusClose}`, { isClosing: false })).status, 400);
});

// ---------------------------------------------------------------- פרמטרים

test('params are validated, never widened, and kept per company', { skip }, async () => {
  as('ktAdmin', 'kt');
  assert.equal((await call('PUT', '/api/params', { somethingNew: true })).status, 400, 'מפתח לא מוכר');
  assert.equal((await call('PUT', '/api/params', { requireDetails: 'yes' })).status, 400);
  assert.equal((await call('PUT', '/api/params', { idleLogoutMinutes: 2 })).status, 400);
  assert.equal((await call('PUT', '/api/params', { idleLogoutMinutes: true })).status, 400);
  assert.equal((await call('PUT', '/api/params', { markDelayMinutes: 1.5 })).status, 400);

  const statuses = (await call('GET', '/api/lookups?kind=call_status')).body as { id: number; isClosing: boolean }[];
  const open = statuses.find((s) => !s.isClosing)!;
  const closing = statuses.filter((s) => s.isClosing)[1]!;
  assert.equal((await call('PUT', '/api/params', { defaultStatusClose: open.id })).status, 400, 'חייב להיות סטטוס סוגר');
  const type = (await call('GET', '/api/lookups?kind=call_type')).body[0];
  assert.equal((await call('PUT', '/api/params', { defaultStatusNew: type.id })).status, 400, 'ערך מסוג אחר');

  const before = await pool.query("SELECT value FROM settings WHERE key = 'params' AND company_id = $1", [company.koriz]);
  const saved = await call('PUT', '/api/params', {
    values: { requireDetails: true, idleLogoutMinutes: 30, defaultStatusClose: closing.id },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.changed.sort(), ['defaultStatusClose', 'idleLogoutMinutes', 'requireDetails']);

  const kt = await pool.query("SELECT value FROM settings WHERE key = 'params' AND company_id = $1", [company.kt]);
  assert.equal(kt.rows[0].value.requireDetails, true);
  assert.equal(kt.rows[0].value.idleLogoutMinutes, 30);
  assert.deepEqual(Object.keys(kt.rows[0].value).sort(), Object.keys(before.rows[0].value).sort(), 'אותם מפתחות כמו ב-seed');
  const koriz = await pool.query("SELECT value FROM settings WHERE key = 'params' AND company_id = $1", [company.koriz]);
  assert.deepEqual(koriz.rows[0].value, before.rows[0].value, 'הפרמטרים של קוריץ לא זזו');

  assert.ok(
    events.some((e) => e.companyId === company.kt && e.event.entity === 'params') &&
      !events.some((e) => e.companyId !== company.kt && e.event.entity === 'params'),
    'עדכון הפרמטרים משודר לחברה הפעילה בלבד',
  );
});

// ---------------------------------------------------------------- ייבוא

test('the importer previews, reports row/column/reason, and writes per-company fields to the active company only', { skip }, async () => {
  as('ktAdmin', 'kt');
  const file = await sheetOf([
    ['שם לקוח', 'עיר', 'הערות לקריאה', 'עלות שעה', 'שם פרטי', 'נייד איש קשר', 'מייל'],
    ['מפעלי ייבוא בע"מ', 'נתניה', 'לבדוק חוזה', '300', 'דנה', '052-7654321', 'dana@example.test'],
    ['', 'חיפה', '', '', '', '', ''],
    ['לקוח עם טעויות', 'חיפה', '', 'בערך 100', 'רון', '12', 'not-an-email'],
    ['מפעלי ייבוא בע"מ', 'נתניה', '', '', 'יוסי', '03-5551234', ''],
  ]);
  const preview = await upload('/api/import/clients/preview', file);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.mapping, [
    'clientName', 'city', 'callRemarks', 'hourCost', 'contactFirstName', 'contactMobile', 'contactEmail',
  ]);
  assert.deepEqual(preview.body.totals, { rows: 4, valid: 2, invalid: 2, contacts: 2 });
  const count = await pool.query("SELECT count(*)::int AS n FROM clients WHERE name LIKE 'מפעלי ייבוא%'");
  assert.equal(count.rows[0].n, 0, 'התצוגה המקדימה לא כותבת כלום');

  const issue = (row: number, field: string) =>
    preview.body.issues.find((i: { row: number; field: string }) => i.row === row && i.field === field);
  assert.equal(issue(3, 'clientName').column, 'שם לקוח');
  assert.ok(issue(3, 'clientName').reason);
  assert.equal(issue(4, 'hourCost').column, 'עלות שעה');
  assert.equal(issue(4, 'contactMobile').column, 'נייד איש קשר');
  assert.equal(issue(4, 'contactEmail').column, 'מייל');

  // ה-token שייך למי שהעלה ולחברה שבה העלה
  as('korizAdmin', 'koriz');
  assert.equal((await call('POST', '/api/import/clients/run', { token: preview.body.token })).status, 404);

  as('ktAdmin', 'kt');
  const bad = await call('POST', '/api/import/clients/validate', { token: preview.body.token, mapping: ['city'] });
  assert.equal(bad.status, 400, 'בלי עמודת שם לקוח אין ייבוא');
  const run = await call('POST', '/api/import/clients/run', { token: preview.body.token });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.clientsCreated, 1);
  assert.equal(run.body.contactsCreated, 2);
  assert.equal(run.body.skipped, 2);

  const client = await pool.query("SELECT id FROM clients WHERE name = 'מפעלי ייבוא בע\"מ'");
  assert.equal(client.rows.length, 1, 'שתי שורות של אותו לקוח הן לקוח אחד עם שני אנשי קשר');
  const settings = await pool.query(
    'SELECT company_id, call_remarks, hour_cost FROM client_company_settings WHERE client_id = $1',
    [client.rows[0].id],
  );
  assert.deepEqual(settings.rows, [{ company_id: company.kt, call_remarks: 'לבדוק חוזה', hour_cost: 300 }]);
  const contacts = await pool.query('SELECT first_name, mobile_e164 FROM contacts WHERE client_id = $1 ORDER BY id', [
    client.rows[0].id,
  ]);
  assert.deepEqual(contacts.rows, [
    { first_name: 'דנה', mobile_e164: '+972527654321' },
    { first_name: 'יוסי', mobile_e164: '+97235551234' },
  ]);

  const report = await call('GET', `/api/import/clients/${preview.body.token}/errors`);
  assert.equal(report.body.total, 4);
  for (const item of report.body.issues) {
    assert.ok(Number.isInteger(item.row) && item.column && item.reason, 'כל שגיאה נושאת שורה, עמודה וסיבה');
  }
  const xlsx = await app.inject({ method: 'GET', url: `/api/import/clients/${preview.body.token}/errors?format=xlsx` });
  assert.match(String(xlsx.headers['content-type']), /spreadsheetml/);

  // ייבוא חוזר בלי "לעדכן קיימים" לא דורס את ההערה שכבר שמורה
  const again = await upload(
    '/api/import/clients/preview',
    await sheetOf([
      ['שם לקוח', 'הערות לקריאה'],
      ['מפעלי ייבוא בע"מ', 'הערה חדשה מהקובץ'],
    ]),
  );
  const rerun = await call('POST', '/api/import/clients/run', { token: again.body.token });
  assert.equal(rerun.body.clientsCreated, 0);
  const kept = await pool.query(
    'SELECT call_remarks FROM client_company_settings WHERE client_id = $1 AND company_id = $2',
    [client.rows[0].id, company.kt],
  );
  assert.equal(kept.rows[0].call_remarks, 'לבדוק חוזה');
});

test('shared data changes reach every company; no event carries the data itself', { skip }, async () => {
  const clientEvents = events.filter((e) => e.event.entity === 'client');
  assert.ok(new Set(clientEvents.map((e) => e.companyId)).size >= 4);
  for (const e of events) {
    assert.deepEqual(Object.keys(e.event).sort(), ['entity', 'id', 't']);
  }
});
