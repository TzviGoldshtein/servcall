/**
 * הבדיקות של ליבת הקריאות. אין כאן מסד נתונים אמיתי: ה-Db מוחלף בפרשן קטן
 * שמבין בדיוק את המשפטים שהקוד שולח, ומריץ כל שאילתה אחרי tick — כך שאם
 * הקצאת המספר הייתה נעשית ב-SELECT ואז UPDATE, השזירה בין הבקשות הייתה
 * מייצרת מספר כפול והבדיקה הייתה נופלת.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Ctx, SessionUser } from '../context.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../errors.ts';
import {
  AUTO_HOURS_DESCRIPTION,
  allocateNumber,
  createCall,
  missingFields,
  syncAutoHours,
  type Params,
} from './calls.ts';
import { registerLinkRoutes } from './links.ts';

// ------------------------------------------------------------ מסד נתונים מדומה

interface Row {
  [key: string]: unknown;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const PARAMS: Record<string, unknown> = {
  defaultStatusNew: 1,
  defaultStatusClose: 6,
  markDelayMinutes: 60,
  requireCallType: true,
  requireDetails: false,
  requireBillingStatus: false,
  requireDuration: true,
};

const LOOKUPS: Row[] = [
  { id: 1, kind: 'call_status', name: 'פתוחה', is_closing: false, minutes: null, std_hours: null, counts_in_bank: null },
  { id: 6, kind: 'call_status', name: 'סגורה', is_closing: true, minutes: null, std_hours: null, counts_in_bank: null },
  { id: 20, kind: 'call_type', name: 'דיווח תקלה', is_closing: null, minutes: null, std_hours: 2, counts_in_bank: null },
  { id: 30, kind: 'duration', name: '90 דקות', is_closing: null, minutes: 90, std_hours: null, counts_in_bank: null },
  { id: 31, kind: 'duration', name: 'טרם התחיל', is_closing: null, minutes: 0, std_hours: null, counts_in_bank: null },
  { id: 40, kind: 'hour_type', name: 'לחיוב', is_closing: null, minutes: null, std_hours: null, counts_in_bank: true },
];

class FakeDb implements Db {
  companies: Row[] = [
    { id: 1, code: 'kt', name: 'קי טלקום', call_seq_next: 1, active: true },
    { id: 4, code: 'harel', name: 'הראל מחשוב', call_seq_next: 17601, active: true },
  ];
  calls: Row[] = [];
  events: Row[] = [];
  hours: Row[] = [];
  links: Row[] = [];
  audit: Row[] = [];
  /** כל משפט SQL שנשלח, לפי הסדר — כדי לבדוק *איך* נעשתה ההקצאה. */
  statements: string[] = [];
  private nextId = 1;

  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.statements.push(sql);
    await tick();
    const rows = this.run(sql, params) as T[];
    return { rows, rowCount: rows.length };
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  private run(sql: string, p: unknown[]): Row[] {
    const has = (needle: string) => sql.includes(needle);

    // הקצאת מספר: העלאה והחזרה במשפט אחד
    if (has('UPDATE companies SET call_seq_next')) {
      const company = this.companies.find((c) => c.id === p[0]);
      if (!company) return [];
      const number = company.call_seq_next as number;
      company.call_seq_next = number + 1;
      return [{ number }];
    }
    if (has("key = 'params'")) return [{ value: PARAMS }];
    if (has('FROM lookups') && has('WHERE id = $1 AND kind = $2')) {
      const row = LOOKUPS.find((l) => l.id === p[0] && l.kind === p[1]);
      return row ? [row] : [];
    }
    if (has('INSERT INTO service_calls')) {
      const id = this.nextId++;
      this.calls.push({
        id,
        company_id: p[0],
        number: p[1],
        client_id: p[2],
        contact_id: p[3],
        owner_user_id: p[4],
        subject: p[5],
        details: p[6],
        type_id: p[7],
        status_id: p[8],
        billing_status_id: p[9],
        duration_id: p[10],
        closed_at: p[13] ? 'now' : null,
      });
      return [{ id }];
    }
    if (has('INSERT INTO call_events')) {
      this.events.push({ call_id: p[0], body: p[1], kind: 'system', created_by: p[2] });
      return [];
    }
    if (has('DELETE FROM call_hours')) {
      this.hours = this.hours.filter((h) => !(h.call_id === p[0] && h.auto === true && h.company_id === p[1]));
      return [];
    }
    if (has('INSERT INTO call_hours')) {
      this.hours.push({
        call_id: p[0],
        company_id: p[1],
        reporter_id: p[2],
        hours: p[3],
        description: p[4],
        auto: true,
        hour_type_id: LOOKUPS.find((l) => l.kind === 'hour_type' && l.counts_in_bank === true)?.id ?? null,
      });
      return [];
    }
    if (has('INSERT INTO audit_log')) {
      this.audit.push({ company_id: p[0], user_id: p[1], action: p[2], target: p[3] });
      return [];
    }
    if (has('INSERT INTO call_links')) {
      const id = this.nextId++;
      this.links.push({
        id,
        parent_call_id: p[0],
        child_call_id: p[1],
        kind: p[2],
        to_company_id: p[3],
        relay_allowed: p[4],
        reason: p[5],
      });
      return [{ id }];
    }
    if (has('FROM service_calls sc WHERE sc.id = $1')) {
      const call = this.calls.find((c) => c.id === Number(p[0]));
      if (!call) return [];
      return [
        {
          id: call.id,
          companyId: call.company_id,
          number: call.number,
          clientId: call.client_id,
          contactId: call.contact_id,
          ownerUserId: call.owner_user_id,
          subject: call.subject,
          details: call.details,
          typeId: call.type_id,
          statusId: call.status_id,
          billingStatusId: call.billing_status_id,
          durationId: call.duration_id,
          openAt: 'now',
          closedAt: call.closed_at,
          source: 'web',
          shared: call.company_id !== p[1],
        },
      ];
    }
    if (has('SELECT id FROM companies WHERE id = $1 AND active')) {
      const row = this.companies.find((c) => c.id === p[0] && c.active);
      return row ? [{ id: row.id }] : [];
    }
    if (has('FROM companies c WHERE c.id = $1')) {
      const row = this.companies.find((c) => c.id === p[0]);
      return row ? [{ name: row.name }] : [];
    }
    if (has('UPDATE service_calls SET status_id')) {
      const call = this.calls.find((c) => c.id === p[0]);
      if (call) {
        call.status_id = p[1];
        call.closed_at = 'now';
        call.closed_by = p[2];
      }
      return [];
    }
    throw new Error('שאילתה שלא נתמכת בבדיקה: ' + sql.slice(0, 90));
  }
}

const USER: SessionUser = {
  id: 7,
  email: 'agent@example.com',
  firstName: 'דנה',
  lastName: 'כהן',
  lang: 'he',
  isSuperadmin: false,
  memberships: [],
};

const ctxFor = (db: Db, companyId = 1): Ctx => ({ db, user: USER, companyId, role: 'admin', lang: 'he' });

const baseParams: Params = {
  defaultStatusNew: 1,
  defaultStatusClose: 6,
  signatureDefaultText: '',
  listShowOnlyOpen: true,
  listShowTime: true,
  listDescending: true,
  markDelayMinutes: 0,
  requireCallType: false,
  requireDetails: false,
  requireBillingStatus: false,
  requireDuration: false,
  sendRemarksLog: true,
  contactCanOnlyOpen: false,
};

// ------------------------------------------------------------ 1. מספור במקביל

test('מספר הקריאה הוא רצף פר חברה, גם כששתי קריאות נפתחות יחד', async () => {
  const db = new FakeDb();
  const taken = await Promise.all(
    Array.from({ length: 40 }, () => db.tx((tx) => allocateNumber(tx, 4))),
  );
  const sorted = [...taken].sort((a, b) => a - b);

  assert.equal(new Set(taken).size, 40, 'כל קריאה קיבלה מספר משלה');
  // הראל ממשיך את המערכת הישנה: הרצף מתחיל ב-17601
  assert.equal(sorted[0], 17601);
  assert.equal(sorted[39], 17640);
  assert.equal(db.companies.find((c) => c.id === 4)!.call_seq_next, 17641);

  // ההקצאה היא משפט אחד שמעלה ומחזיר — לא SELECT ואז UPDATE
  assert.equal(db.statements.length, 40);
  for (const sql of db.statements) {
    assert.match(sql, /UPDATE companies SET call_seq_next = call_seq_next \+ 1 .*RETURNING/);
  }

  // הרצף של חברה אחרת אינו מושפע
  const other = await db.tx((tx) => allocateNumber(tx, 1));
  assert.equal(other, 1);
});

// ------------------------------------------------------------ 2. משך טיפול ושעות

test('בחירת משך טיפול יוצרת שורת שעות אוטומטית, ושינוי מחליף רק אותה', async () => {
  const db = new FakeDb();
  const ctx = ctxFor(db);
  // שורה שדווחה ביד — אסור שתיגע
  db.hours.push({ call_id: 5, company_id: 1, hours: 3, description: 'עבודה באתר הלקוח', auto: false });

  await syncAutoHours(db, 5, 1, 30, ctx);
  const auto = db.hours.filter((h) => h.auto === true);
  assert.equal(auto.length, 1);
  assert.equal(auto[0]!.hours, 1.5, '90 דקות = 1.5 שעות');
  assert.equal(auto[0]!.description, AUTO_HOURS_DESCRIPTION);
  assert.equal(auto[0]!.hour_type_id, 40, 'נרשם כסוג שעה שנספר בבנק (לחיוב)');

  // שינוי המשך מחליף את השורה האוטומטית בלבד
  await syncAutoHours(db, 5, 1, 30, ctx);
  assert.equal(db.hours.filter((h) => h.auto === true).length, 1);
  assert.equal(db.hours.filter((h) => h.auto === false).length, 1);

  // משך של 0 דקות ("טרם התחיל") לא מדווח שעות
  await syncAutoHours(db, 5, 1, 31, ctx);
  assert.equal(db.hours.filter((h) => h.auto === true).length, 0);
  assert.equal(db.hours.filter((h) => h.auto === false).length, 1, 'הדיווח הידני נשאר');

  // ניקוי המשך מוחק את השורה האוטומטית
  await syncAutoHours(db, 5, 1, 30, ctx);
  await syncAutoHours(db, 5, 1, null, ctx);
  assert.equal(db.hours.filter((h) => h.auto === true).length, 0);
});

// ------------------------------------------------------------ 3. שדות חובה

test('שדות החובה נקבעים מהפרמטרים של החברה', () => {
  const full = { clientId: 3, subject: 'אין חיוג החוצה', statusId: 1, typeId: 20, durationId: 30, details: 'בדקנו' };

  assert.deepEqual(missingFields(baseParams, full), []);
  // לקוח, נושא וסטטוס הם חובה תמיד, גם כשכל הדגלים כבויים
  assert.deepEqual(missingFields(baseParams, {}).sort(), ['clientId', 'statusId', 'subject']);

  const strict: Params = {
    ...baseParams,
    requireCallType: true,
    requireDetails: true,
    requireBillingStatus: true,
    requireDuration: true,
  };
  assert.deepEqual(missingFields(strict, { clientId: 3, subject: 'נושא', statusId: 1 }).sort(), [
    'billingStatusId',
    'details',
    'durationId',
    'typeId',
  ]);
  assert.deepEqual(missingFields(strict, { ...full, billingStatusId: 2 }), []);

  // עדכון חלקי נבדק מול מה שכבר שמור על הקריאה
  assert.deepEqual(missingFields(strict, { subject: 'נושא חדש' }, { ...full, billingStatusId: 2 }), []);
  assert.deepEqual(missingFields(strict, { durationId: null }, { ...full, billingStatusId: 2 }), ['durationId']);
});

test('פתיחת קריאה בלי שדה חובה נעצרת עם 400', async () => {
  const db = new FakeDb();
  const ctx = ctxFor(db);
  await assert.rejects(
    () => createCall(ctx, 1, { clientId: 3, subject: 'אין חיוג', typeId: 20 }),
    (err: unknown) => err instanceof HttpError && err.status === 400 && /משך טיפול/.test(err.message),
  );
  assert.equal(db.calls.length, 0, 'לא נפתחה קריאה');
  assert.equal(db.companies.find((c) => c.id === 1)!.call_seq_next, 1, 'לא נשרף מספר');
});

// ------------------------------------------------------------ 4. העברה לחברה אחרת

/** אפליקציית Fastify מדומה: אוספת את המסלולים כדי להפעיל אותם ישירות. */
class FakeApp {
  handlers = new Map<string, (req: unknown, reply: unknown) => Promise<unknown>>();
  private add(method: string) {
    return (path: string, handler: (req: never, reply: never) => Promise<unknown>) => {
      this.handlers.set(`${method} ${path}`, handler as (req: unknown, reply: unknown) => Promise<unknown>);
      return this;
    };
  }
  get = this.add('GET');
  post = this.add('POST');
  patch = this.add('PATCH');
  delete = this.add('DELETE');
  call(route: string, req: Record<string, unknown>): Promise<unknown> {
    const handler = this.handlers.get(route);
    if (!handler) throw new Error('אין מסלול ' + route);
    return handler({ params: {}, query: {}, body: {}, ip: '127.0.0.1', ...req }, {});
  }
}

test('העברת עבודה פותחת קריאת בת ממוספרת ברצף של החברה המקבלת', async () => {
  const db = new FakeDb();
  const ctx = ctxFor(db, 1);
  const parent = await createCall(ctx, 1, {
    clientId: 3,
    subject: 'תקלת תקשורת באתר',
    details: 'אין קו',
    typeId: 20,
    durationId: 30,
  });
  assert.equal(parent.number, 1, 'הקריאה הראשונה של קי טלקום');

  const app = new FakeApp();
  registerLinkRoutes(app as never, ctx);
  const result = (await app.call('POST /api/calls/:id/links', {
    params: { id: String(parent.id) },
    body: {
      kind: 'transfer',
      toCompanyId: 4,
      reason: 'הציוד בטיפול הראל',
      relayAllowed: true,
      typeId: 20,
      durationId: 30,
    },
  })) as { childCallId: number; childNumber: number; kind: string };

  // הבת נפתחה בחברה המקבלת, עם מספר מהרצף שלה ולא מהרצף של השולחת
  const child = db.calls.find((c) => c.id === result.childCallId)!;
  assert.equal(child.company_id, 4);
  assert.equal(child.number, 17601);
  assert.equal(result.childNumber, 17601);
  assert.equal(db.companies.find((c) => c.id === 4)!.call_seq_next, 17602);
  assert.equal(db.companies.find((c) => c.id === 1)!.call_seq_next, 2, 'הרצף של השולחת לא זז');

  // השעות של הבת נרשמות על החברה המקבלת — כל חברה מחייבת את שלה
  const childHours = db.hours.filter((h) => h.call_id === child.id);
  assert.equal(childHours.length, 1);
  assert.equal(childHours[0]!.company_id, 4);

  // הקישור נשמר, והעברה סוגרת את קריאת האב
  const link = db.links[0]!;
  assert.equal(link.kind, 'transfer');
  assert.equal(link.to_company_id, 4);
  assert.equal(link.child_call_id, child.id);
  assert.equal(link.relay_allowed, true);
  assert.equal(db.calls.find((c) => c.id === parent.id)!.status_id, 6, 'האב עבר ל-defaultStatusClose');
  assert.ok(db.calls.find((c) => c.id === parent.id)!.closed_at, 'נרשם מתי נסגרה');

  // שני הצדדים קיבלו אירוע מערכת שמסביר מה קרה
  assert.ok(db.events.some((e) => e.call_id === parent.id && /הראל/.test(String(e.body))));
  assert.ok(db.events.some((e) => e.call_id === child.id && /קי טלקום/.test(String(e.body))));
});

test('קריאה משותפת אינה פותחת קריאה שנייה ואינה שורפת מספר', async () => {
  const db = new FakeDb();
  const ctx = ctxFor(db, 1);
  const parent = await createCall(ctx, 1, { clientId: 3, subject: 'פרויקט משותף', typeId: 20, durationId: 30 });
  const app = new FakeApp();
  registerLinkRoutes(app as never, ctx);
  const result = (await app.call('POST /api/calls/:id/links', {
    params: { id: String(parent.id) },
    body: { kind: 'shared', toCompanyId: 4, reason: 'עבודה משותפת' },
  })) as { childCallId: number | null };

  assert.equal(result.childCallId, null);
  assert.equal(db.calls.length, 1);
  assert.equal(db.companies.find((c) => c.id === 4)!.call_seq_next, 17601);
  assert.equal(db.calls[0]!.closed_at, null, 'האב נשאר פתוח');
});
