import type { FastifyInstance } from 'fastify';
import { audit, type Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { localName, msg } from '../i18n.ts';
import {
  bodyOf,
  flag,
  idOf,
  optBool,
  optInt,
  optNum,
  optText,
  patchSet,
  queryOf,
  requireAdmin,
  text,
} from './departments.ts';

/**
 * טבלאות הקוד — מסך אחד שמשרת את כל ששת הסוגים. במקום שש מסכים כמעט זהים,
 * המסך מקבל מכאן את התיאור של כל סוג (אילו עמודות נוספות יש לו) ומצייר אותן.
 *
 * טווח הראייה: ערך עם company_id = NULL משותף לכל ארבע החברות (כך מגיע כל
 * ה-seed), וערך עם company_id שייך לחברה אחת. כל שאילתה כאן מחזירה את
 * המשותפים + אלה של החברה הפעילה, ולעולם לא ערך של חברה אחרת.
 *
 * רק ערך פעיל (active) מגיע לבוחרים בטופס הקריאה; ערך שהושבת נשאר במסד כדי
 * שקריאות היסטוריות ימשיכו להציג את הסטטוס שבו נסגרו.
 */

export const LOOKUP_KINDS = [
  'call_type',
  'call_status',
  'billing_status',
  'duration',
  'hour_type',
  'service_type',
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

type ExtraType = 'bool' | 'int' | 'money' | 'hours' | 'department';

/** העמודות הנוספות של כל סוג — מה שהמסך הגנרי צריך לדעת כדי לצייר טופס. */
export const KIND_EXTRAS: Record<LookupKind, { column: string; key: string; type: ExtraType; he: string; en: string }[]> = {
  call_type: [{ column: 'std_hours', key: 'stdHours', type: 'hours', he: 'תקן שעות לטיפול', en: 'Standard hours' }],
  call_status: [{ column: 'is_closing', key: 'isClosing', type: 'bool', he: 'סוגר קריאה', en: 'Closes the call' }],
  billing_status: [],
  duration: [{ column: 'minutes', key: 'minutes', type: 'int', he: 'דקות', en: 'Minutes' }],
  hour_type: [
    { column: 'counts_in_bank', key: 'countsInBank', type: 'bool', he: 'נספר בבנק שעות', en: 'Counts in hours bank' },
    { column: 'price', key: 'price', type: 'money', he: 'מחיר לשעה', en: 'Hour price' },
  ],
  service_type: [
    { column: 'department_id', key: 'departmentId', type: 'department', he: 'מחלקה מטפלת', en: 'Department' },
    { column: 'price', key: 'price', type: 'money', he: 'מחיר', en: 'Price' },
  ],
};

const KIND_LABELS: Record<LookupKind, { he: string; en: string }> = {
  call_type: { he: 'סוגי קריאה', en: 'Call types' },
  call_status: { he: 'סטטוס קריאה', en: 'Call statuses' },
  billing_status: { he: 'סטטוס חיוב', en: 'Billing statuses' },
  duration: { he: 'משך טיפול', en: 'Durations' },
  hour_type: { he: 'סוגי שעות', en: 'Hour types' },
  service_type: { he: 'סוגי שירות', en: 'Service types' },
};

const isKind = (v: unknown): v is LookupKind => typeof v === 'string' && (LOOKUP_KINDS as readonly string[]).includes(v);

function kindOf(value: unknown): LookupKind {
  if (!isKind(value)) throw badRequest('סוג טבלת קוד לא מוכר');
  return value;
}

const LOOKUP_COLUMNS = `l.id, l.kind, l.company_id AS "companyId", l.name, l.name_en AS "nameEn", l.sort,
       l.is_closing AS "isClosing", l.minutes, l.department_id AS "departmentId",
       d.name AS "departmentName", l.counts_in_bank AS "countsInBank",
       l.std_hours AS "stdHours", l.price, l.active`;

interface LookupRow {
  id: number;
  kind: LookupKind;
  companyId: number | null;
  name: string;
  nameEn: string | null;
  sort: number;
  active: boolean;
}

export function registerLookupsRoutes(app: FastifyInstance, ctx: Ctx): void {
  /** רק ערכים משותפים או של החברה הפעילה. זה הגדר שמונע הצצה לחברה אחרת. */
  const VISIBLE = '(l.company_id IS NULL OR l.company_id = $1)';

  async function one(id: number) {
    const { rows } = await ctx.db.query<LookupRow>(
      `SELECT ${LOOKUP_COLUMNS} FROM lookups l LEFT JOIN departments d ON d.id = l.department_id
        WHERE l.id = $2 AND ${VISIBLE}`,
      [ctx.companyId, id],
    );
    const row = rows[0];
    if (!row) throw notFound(msg('notFound', ctx.lang));
    return row;
  }

  /** העמודות הנוספות של הסוג, לפי הטבלה למעלה. שדה שלא שייך לסוג נדחה. */
  async function extraFields(kind: LookupKind, b: Record<string, unknown>): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const extra of KIND_EXTRAS[kind]) {
      const raw = b[extra.key];
      if (raw === undefined) continue;
      if (extra.type === 'bool') out[extra.column] = optBool(raw, extra.he) ?? false;
      else if (extra.type === 'int') out[extra.column] = optInt(raw, extra.he, 0, 100000);
      else if (extra.type === 'money') out[extra.column] = optNum(raw, extra.he, 0, 1000000);
      else if (extra.type === 'hours') out[extra.column] = optNum(raw, extra.he, 0, 9999);
      else {
        const departmentId = optInt(raw, extra.he);
        if (departmentId) {
          const { rows } = await ctx.db.query('SELECT 1 FROM departments WHERE id = $1 AND active', [departmentId]);
          if (!rows[0]) throw badRequest('המחלקה שנבחרה לא קיימת או מושבתת');
        }
        out[extra.column] = departmentId;
      }
    }
    // שדה של סוג אחר שנשלח בטעות — נדחה במקום להישמר בשקט על הרשומה
    for (const other of LOOKUP_KINDS) {
      if (other === kind) continue;
      for (const extra of KIND_EXTRAS[other]) {
        if (b[extra.key] !== undefined && !KIND_EXTRAS[kind].some((e) => e.key === extra.key)) {
          throw badRequest(`השדה ${extra.he} אינו שייך לסוג הזה`);
        }
      }
    }
    return out;
  }

  /** ערך שמשמש כברירת מחדל בפרמטרים של החברה לא מושבת בשקט. */
  async function guardDefaults(id: number): Promise<void> {
    const { rows } = await ctx.db.query<{ key: string }>(
      `SELECT key FROM settings
        WHERE company_id = $1 AND key = 'params'
          AND ((value->>'defaultStatusNew')::int = $2 OR (value->>'defaultStatusClose')::int = $2)`,
      [ctx.companyId, id],
    );
    if (rows[0]) throw badRequest('הערך הזה מוגדר כברירת מחדל בפרמטרים של החברה. יש לשנות שם קודם');
  }

  // ---- קריאה ----

  /** התיאור של ששת הסוגים — המסך הגנרי נבנה ממנו, ולא מרשימה מקובעת בדפדפן. */
  app.get('/api/lookups/kinds', async () =>
    LOOKUP_KINDS.map((kind) => ({
      kind,
      label: ctx.lang === 'en' ? KIND_LABELS[kind].en : KIND_LABELS[kind].he,
      extras: KIND_EXTRAS[kind].map((e) => ({
        key: e.key,
        type: e.type,
        label: ctx.lang === 'en' ? e.en : e.he,
      })),
    })),
  );

  /**
   * רשימה לסוג אחד (?kind=call_status) או לכולם. ברירת המחדל: פעילים בלבד —
   * זה מה שהבוחרים בטופס הקריאה מקבלים. ?all=1 מחזיר גם מושבתים, למסך התחזוקה.
   */
  app.get('/api/lookups', async (req) => {
    const q = queryOf(req);
    const kind = q.kind === undefined || q.kind === '' ? null : kindOf(q.kind);
    const { rows } = await ctx.db.query<LookupRow>(
      `SELECT ${LOOKUP_COLUMNS} FROM lookups l LEFT JOIN departments d ON d.id = l.department_id
        WHERE ${VISIBLE} AND ($2::text IS NULL OR l.kind = $2) AND ($3 OR l.active)
        ORDER BY l.kind, l.sort, l.name`,
      [ctx.companyId, kind, flag(req, 'all')],
    );
    return rows.map((r) => ({
      ...r,
      label: localName({ name: r.name, name_en: r.nameEn }, ctx.lang),
      /** ערך משותף לכל החברות — המסך מסמן אותו, כי שינוי בו נראה לכולן. */
      shared: r.companyId === null,
    }));
  });

  // ---- כתיבה ----

  /**
   * ערך חדש. ברירת המחדל היא ערך משותף לכל החברות (כמו כל ה-seed); עם
   * { companyOnly: true } הוא נשמר לחברה הפעילה בלבד.
   */
  app.post('/api/lookups', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const kind = kindOf(b.kind);
    const values: Record<string, unknown> = {
      kind,
      company_id: b.companyOnly === true ? ctx.companyId : null,
      name: text(b.name, 'שם', 120),
      name_en: optText(b.nameEn, 'שם באנגלית', 120) ?? null,
      sort: optInt(b.sort, 'סדר', 0, 100000) ?? null,
      ...(await extraFields(kind, b)),
    };
    if (values.sort === null) {
      const { rows } = await ctx.db.query<{ next: number }>(
        `SELECT COALESCE(max(l.sort) + 1, 1) AS next FROM lookups l
          WHERE l.kind = $1 AND (l.company_id IS NULL OR l.company_id = $2)`,
        [kind, ctx.companyId],
      );
      values.sort = rows[0]?.next ?? 1;
    }
    const keys = Object.keys(values);
    const { rows } = await ctx.db.query<{ id: number }>(
      `INSERT INTO lookups (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => values[k]),
    );
    await audit(ctx, 'lookup.create', String(rows[0]!.id), values, req.ip);
    return one(rows[0]!.id);
  });

  app.patch('/api/lookups/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    const current = await one(id);
    if (b.active === false) await guardDefaults(id);
    const patch = patchSet(
      {
        name: b.name === undefined ? undefined : text(b.name, 'שם', 120),
        name_en: optText(b.nameEn, 'שם באנגלית', 120),
        sort: optInt(b.sort, 'סדר', 0, 100000),
        active: optBool(b.active, 'פעיל'),
        ...(await extraFields(current.kind, b)),
      },
      3,
    );
    if (!patch) throw badRequest('אין מה לעדכן');
    // ה-WHERE חוזר על טווח הראייה, כדי שגם PATCH לא ייגע בערך של חברה אחרת
    const { rowCount } = await ctx.db.query(
      `UPDATE lookups l SET ${patch.set} WHERE l.id = $2 AND ${VISIBLE}`,
      [ctx.companyId, id, ...patch.values],
    );
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await audit(ctx, 'lookup.update', String(id), b, req.ip);
    return one(id);
  });

  /** סדר ההצגה בבוחרים: רשימת מזהים לפי הסדר החדש. */
  app.post('/api/lookups/reorder', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const kind = kindOf(b.kind);
    const ids = Array.isArray(b.ids) ? b.ids.filter((v): v is number => Number.isInteger(v)) : [];
    if (!ids.length) throw badRequest('לא נשלחה רשימת מזהים');
    await ctx.db.tx(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.query(
          'UPDATE lookups SET sort = $1 WHERE id = $2 AND kind = $3 AND (company_id IS NULL OR company_id = $4)',
          [index + 1, id, kind, ctx.companyId],
        );
      }
    });
    await audit(ctx, 'lookup.reorder', kind, { ids }, req.ip);
    return { ok: true };
  });

  /** השבתה בלבד — קריאות שנסגרו בסטטוס הזה חייבות להמשיך להציג אותו. */
  app.delete('/api/lookups/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    await one(id);
    await guardDefaults(id);
    const { rowCount } = await ctx.db.query(
      `UPDATE lookups l SET active = false WHERE l.id = $2 AND ${VISIBLE}`,
      [ctx.companyId, id],
    );
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await audit(ctx, 'lookup.deactivate', String(id), null, req.ip);
    return { ok: true };
  });
}
