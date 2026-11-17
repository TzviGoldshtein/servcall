/**
 * שעות על קריאה.
 *
 * שתי מקורות לשורת שעות: דיווח ביד, ושורה אוטומטית שנוצרה מבחירת משך הטיפול
 * (`auto = true`, התיאור "משך טיפול"). השורה האוטומטית מנוהלת מהטופס דרך שדה
 * המשך — כאן היא לקריאה בלבד, אחרת שינוי המשך היה דורס עריכה ידנית בלי שיראו.
 *
 * כל שורה נושאת `company_id` של החברה המדווחת. בקריאה משותפת בין שתי חברות זה
 * מה שמפריד את החיוב: כל חברה מחייבת את השעות שדיווחה.
 */
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { audit } from '../context.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import { msg } from '../i18n.ts';
import {
  idParam,
  lookupOf,
  notifyCall,
  optionalId,
  optionalText,
  personExpr,
  requireCall,
  requireRole,
  type Live,
} from './calls.ts';

interface HourRow {
  id: number;
  call_id: number;
  company_id: number;
  auto: boolean;
  reporter_id: number | null;
}

/** מספר שעות: עד שתי ספרות אחרי הנקודה, כמו בעמודה. */
function hoursOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 999) throw badRequest('מספר שעות לא תקין');
  return Math.round(n * 100) / 100;
}

const dateOf = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest('תאריך לא תקין');
  return value;
};

const timeOf = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) throw badRequest('שעה לא תקינה');
  return value;
};

export function registerHourRoutes(app: FastifyInstance, ctx: Ctx, hub: Live): void {
  const { db } = ctx;

  app.get('/api/calls/:id/hours', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const { rows } = await db.query(
      'SELECT ch.id, ch.company_id AS "companyId", co.name AS "companyName", ' +
        'ch.work_date AS "workDate", ch.from_time AS "fromTime", ch.to_time AS "toTime", ' +
        `ch.hours, ch.hour_price AS "hourPrice", ch.description, ch.auto, ` +
        'ch.hour_type_id AS "hourTypeId", l.name AS "hourTypeName", ' +
        'l.counts_in_bank AS "countsInBank", ch.hours_bank_id AS "hoursBankId", ' +
        `hb.name AS "hoursBankName", ch.reporter_id AS "reporterId", ${personExpr('u')} AS "reporterName", ` +
        'ch.created_at AS "createdAt", (ch.hours * ch.hour_price) AS total ' +
        'FROM call_hours ch ' +
        'JOIN companies co ON co.id = ch.company_id ' +
        'LEFT JOIN lookups l ON l.id = ch.hour_type_id ' +
        'LEFT JOIN hours_banks hb ON hb.id = ch.hours_bank_id ' +
        'LEFT JOIN users u ON u.id = ch.reporter_id ' +
        'WHERE ch.call_id = $1 ORDER BY ch.work_date, ch.id',
      [call.id],
    );
    const total = rows.reduce((sum, r) => sum + Number((r as { hours: number }).hours), 0);
    return { rows, hoursTotal: Math.round(total * 100) / 100 };
  });

  /** דיווח שעות ביד. החברה הרושמת היא החברה הפעילה, גם בקריאה משותפת. */
  app.post('/api/calls/:id/hours', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const body = req.body as Record<string, unknown>;
    const hourTypeId = optionalId(body.hourTypeId, 'סוג שעה') ?? null;
    if (hourTypeId) await lookupOf(db, ctx.companyId, hourTypeId, 'hour_type');
    const hoursBankId = optionalId(body.hoursBankId, 'בנק שעות') ?? null;
    if (hoursBankId) await requireBank(ctx, call.clientId, hoursBankId);

    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO call_hours (call_id, company_id, work_date, reporter_id, from_time, to_time, hours, ' +
        'hour_price, description, hour_type_id, hours_bank_id, auto) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7, ' +
        // מחיר השעה של הלקוח באותה חברה, אלא אם נשלח מחיר מפורש
        '  coalesce($8::numeric, (SELECT ccs.hour_cost FROM client_company_settings ccs ' +
        '    WHERE ccs.client_id = $11 AND ccs.company_id = $2), 0), ' +
        '$9,$10,$12, false) RETURNING id',
      [
        call.id,
        ctx.companyId,
        dateOf(body.workDate),
        optionalId(body.reporterId, 'מדווח') ?? ctx.user.id,
        timeOf(body.fromTime),
        timeOf(body.toTime),
        hoursOf(body.hours),
        body.hourPrice === undefined || body.hourPrice === null || body.hourPrice === '' ? null : Number(body.hourPrice),
        optionalText(body.description, 'תאור', 500) ?? 'דיווח שעות',
        hourTypeId,
        call.clientId,
        hoursBankId,
      ],
    );
    await audit(ctx, 'call.hours.add', String(call.id), { hourId: rows[0]!.id });
    await notifyCall(db, hub, call.id, 'hours');
    return { id: rows[0]!.id };
  });

  /** עריכת שורה ידנית. השורה האוטומטית נשלטת משדה משך הטיפול בלבד. */
  app.patch('/api/calls/:id/hours/:hourId', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const row = await requireHour(ctx, call.id, idParam(req, 'hourId'));
    const body = req.body as Record<string, unknown>;
    const hourTypeId = optionalId(body.hourTypeId, 'סוג שעה');
    if (hourTypeId) await lookupOf(db, ctx.companyId, hourTypeId, 'hour_type');
    const hoursBankId = optionalId(body.hoursBankId, 'בנק שעות');
    if (hoursBankId) await requireBank(ctx, call.clientId, hoursBankId);

    await db.query(
      'UPDATE call_hours SET ' +
        'work_date = coalesce($2::date, work_date), ' +
        'from_time = CASE WHEN $3 THEN $4::time ELSE from_time END, ' +
        'to_time = CASE WHEN $5 THEN $6::time ELSE to_time END, ' +
        'hours = coalesce($7::numeric, hours), ' +
        'hour_price = coalesce($8::numeric, hour_price), ' +
        'description = coalesce($9, description), ' +
        'hour_type_id = CASE WHEN $10 THEN $11::int ELSE hour_type_id END, ' +
        'hours_bank_id = CASE WHEN $12 THEN $13::int ELSE hours_bank_id END, ' +
        'reporter_id = coalesce($14::int, reporter_id) ' +
        'WHERE id = $1',
      [
        row.id,
        body.workDate === undefined ? null : dateOf(body.workDate),
        'fromTime' in body,
        timeOf(body.fromTime),
        'toTime' in body,
        timeOf(body.toTime),
        body.hours === undefined ? null : hoursOf(body.hours),
        body.hourPrice === undefined || body.hourPrice === null || body.hourPrice === '' ? null : Number(body.hourPrice),
        optionalText(body.description, 'תאור', 500),
        'hourTypeId' in body,
        hourTypeId ?? null,
        'hoursBankId' in body,
        hoursBankId ?? null,
        optionalId(body.reporterId, 'מדווח') ?? null,
      ],
    );
    await audit(ctx, 'call.hours.edit', String(call.id), { hourId: row.id });
    await notifyCall(db, hub, call.id, 'hours');
    return { ok: true };
  });

  app.delete('/api/calls/:id/hours/:hourId', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const row = await requireHour(ctx, call.id, idParam(req, 'hourId'));
    await db.query('DELETE FROM call_hours WHERE id = $1', [row.id]);
    await audit(ctx, 'call.hours.delete', String(call.id), { hourId: row.id });
    await notifyCall(db, hub, call.id, 'hours');
    return { ok: true };
  });

  /** בנקי השעות של הלקוח בחברה הזו, עם היתרה: נרכש פחות מה שנוצל. */
  app.get('/api/calls/:id/hours-banks', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const { rows } = await db.query(
      'SELECT hb.id, hb.name, hb.hours, ' +
        'coalesce((SELECT sum(ch.hours) FROM call_hours ch WHERE ch.hours_bank_id = hb.id), 0) AS used, ' +
        'hb.hours - coalesce((SELECT sum(ch.hours) FROM call_hours ch WHERE ch.hours_bank_id = hb.id), 0) ' +
        'AS balance ' +
        'FROM hours_banks hb WHERE hb.client_id = $1 AND hb.company_id = $2 AND hb.active ORDER BY hb.id',
      [call.clientId, ctx.companyId],
    );
    return rows;
  });
}

/**
 * שורה שהחברה הפעילה רשאית לגעת בה: שלה, ולא אוטומטית. חברה אחת לא עורכת
 * את השעות של חברה אחרת גם בקריאה משותפת.
 */
async function requireHour(ctx: Ctx, callId: number, hourId: number): Promise<HourRow> {
  const { rows } = await ctx.db.query<HourRow>(
    'SELECT id, call_id, company_id, auto, reporter_id FROM call_hours WHERE id = $1 AND call_id = $2',
    [hourId, callId],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  if (row.company_id !== ctx.companyId) throw forbidden('השעות דווחו על ידי חברה אחרת');
  if (row.auto) throw forbidden('שורת משך הטיפול מתעדכנת משדה המשך בטופס');
  return row;
}

async function requireBank(ctx: Ctx, clientId: number, bankId: number): Promise<void> {
  const { rows } = await ctx.db.query<{ id: number }>(
    'SELECT id FROM hours_banks WHERE id = $1 AND client_id = $2 AND company_id = $3 AND active',
    [bankId, clientId, ctx.companyId],
  );
  if (!rows[0]) throw badRequest('בנק השעות אינו של הלקוח בחברה הזו');
}
