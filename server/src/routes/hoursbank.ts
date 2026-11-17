/**
 * בנק שעות.
 *
 * העיקרון: **היתרה מחושבת, לא נשמרת.** בטבלה נשמרות רק השעות שנרכשו
 * (hours_banks.hours); היתרה היא הרכישה פחות השעות שדווחו ונזקפו לבנק,
 * ורק אלה שסוג השעה שלהן נספר בבנק (lookups.counts_in_bank). עמודת יתרה
 * שמורה הייתה מתפצלת מהמציאות בכל תיקון דיווח בדיעבד.
 *
 * כל בנק שייך לחברה אחת, ואותו לקוח יכול להיות בעל בנקים נפרדים בכל אחת
 * מארבע החברות — שעות וחיוב אינם משותפים.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit, type Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { bankBalance, round2 } from '../report/calc.ts';
import { fetchBankEntries, fetchHoursBanks, type BankRow } from '../report/data.ts';
import { EMPTY_FILTERS, bankTable, reportHead, reportToExcel, reportToPdf } from '../report/index.ts';
import { amount, contentDisposition, id as idField, isTrue, optionalText, requireRole, text } from '../report/input.ts';
import { dateText, hoursText } from '../report/fmt.ts';
import { texts } from '../report/texts.ts';
import type { ReportResult } from '../report/types.ts';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const idOf = (req: FastifyRequest): number => idField((req.params as { id: string }).id, 'בנק שעות');

/** השורה שהמסך מקבל: הנתון השמור, ולידו היתרה המחושבת והמד. */
const toView = (b: BankRow, lang: 'he' | 'en') => {
  const balance = bankBalance(b.purchased, [{ hours: b.used_hours, countsInBank: true }]);
  return {
    id: b.id,
    name: b.name,
    clientId: b.client_id,
    clientName: b.client_name,
    groupName: b.group_name,
    active: b.active,
    entries: b.entries,
    lastWorkDate: b.last_work_date,
    lastWorkDateText: b.last_work_date ? dateText(b.last_work_date, lang) : null,
    purchased: balance.purchased,
    used: balance.used,
    balance: balance.balance,
    usedPct: balance.usedPct,
    /** ok | low | empty | negative — המסך צובע את המד לפי זה. */
    state: balance.state,
    balanceText: hoursText(balance.balance),
  };
};

export function registerHoursBankRoutes(app: FastifyInstance, ctx: Ctx): void {
  /** רשימת הבנקים של החברה, עם היתרה המחושבת לכל אחד. */
  app.get('/api/hours-banks', async (req) => {
    requireRole(ctx, 'viewer');
    const q = (req.query ?? {}) as Record<string, unknown>;
    const clientIds = q.clientId ? [idField(q.clientId, 'לקוח')] : [];
    const rows = await fetchHoursBanks(ctx, {
      ...(clientIds.length ? { clientIds } : {}),
      activeOnly: !isTrue(q.includeInactive),
    });
    const banks = rows.map((b) => toView(b, ctx.lang));
    // רק הבנקים שדורשים תשומת לב — יתרה נמוכה, אפס או חריגה
    const list = isTrue(q.attentionOnly) ? banks.filter((b) => b.state !== 'ok') : banks;
    return {
      banks: list,
      totals: {
        purchased: round2(banks.reduce((s, b) => s + b.purchased, 0)),
        used: round2(banks.reduce((s, b) => s + b.used, 0)),
        balance: round2(banks.reduce((s, b) => s + b.balance, 0)),
        needAttention: banks.filter((b) => b.state !== 'ok').length,
      },
    };
  });

  /** בנק אחד עם התנועות שלו: כל דיווח שנזקף אליו, והאם הוא נספר בבנק. */
  app.get('/api/hours-banks/:id', async (req) => {
    requireRole(ctx, 'viewer');
    const bankId = idOf(req);
    const rows = await fetchHoursBanks(ctx, { bankIds: [bankId], activeOnly: false });
    const bank = rows[0];
    if (!bank) throw notFound('בנק השעות לא נמצא');
    const entries = await fetchBankEntries(ctx, bankId);
    return {
      bank: toView(bank, ctx.lang),
      entries: entries.map((e) => ({
        id: e.id,
        workDate: e.work_date,
        workDateText: dateText(e.work_date, ctx.lang),
        reporter: e.reporter_name,
        callId: e.call_id,
        callNumber: e.call_number,
        subject: e.subject,
        description: e.description,
        hours: e.hours,
        hourType: e.hour_type_name,
        /** false = דווח על הבנק אבל סוג השעה אינו נספר בו, ולכן לא גרע מהיתרה */
        countsInBank: e.counts_in_bank === true,
        auto: e.auto,
      })),
    };
  });

  app.post('/api/hours-banks', async (req) => {
    requireRole(ctx, 'admin');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const clientId = idField(b.clientId, 'לקוח');
    const name = text(b.name, 'שם הבנק', 80);
    const hours = amount(b.hours ?? 0, 'שעות שנרכשו', 100_000);
    const { rows } = await ctx.db.query<{ id: number }>(
      'INSERT INTO hours_banks (client_id, company_id, name, hours) VALUES ($1,$2,$3,$4) RETURNING id',
      [clientId, ctx.companyId, name, hours],
    );
    const created = rows[0];
    if (!created) throw badRequest('יצירת בנק השעות נכשלה');
    await audit(ctx, 'hoursBank.create', String(created.id), { clientId, name, hours }, req.ip);
    const fresh = await fetchHoursBanks(ctx, { bankIds: [created.id], activeOnly: false });
    return fresh[0] ? toView(fresh[0], ctx.lang) : { id: created.id };
  });

  /**
   * עדכון הבנק. אפשר לשנות את השעות שנרכשו ואת השם — אך לא את היתרה:
   * היא תוצאה של הדיווחים ואין לה שדה.
   */
  app.patch('/api/hours-banks/:id', async (req) => {
    requireRole(ctx, 'admin');
    const bankId = idOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const values: unknown[] = [bankId, ctx.companyId];
    const name = optionalText(b.name, 'שם הבנק', 80);
    if (name !== null) {
      sets.push(`name = $${values.push(name)}`);
    }
    if (b.hours !== undefined) {
      sets.push(`hours = $${values.push(amount(b.hours, 'שעות שנרכשו', 100_000))}`);
    }
    if (b.active !== undefined) {
      sets.push(`active = $${values.push(isTrue(b.active))}`);
    }
    if (!sets.length) throw badRequest('אין מה לעדכן');
    const { rowCount } = await ctx.db.query(
      `UPDATE hours_banks SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
      values,
    );
    if (!rowCount) throw notFound('בנק השעות לא נמצא');
    await audit(ctx, 'hoursBank.update', String(bankId), b, req.ip);
    const fresh = await fetchHoursBanks(ctx, { bankIds: [bankId], activeOnly: false });
    return fresh[0] ? toView(fresh[0], ctx.lang) : { id: bankId };
  });

  /**
   * השבתה ולא מחיקה: לדיווחי השעות יש הפניה לבנק, וההיסטוריה חייבת להישאר
   * קריאה גם אחרי שהבנק נסגר.
   */
  app.delete('/api/hours-banks/:id', async (req) => {
    requireRole(ctx, 'admin');
    const bankId = idOf(req);
    const { rowCount } = await ctx.db.query(
      'UPDATE hours_banks SET active = false WHERE id = $1 AND company_id = $2',
      [bankId, ctx.companyId],
    );
    if (!rowCount) throw notFound('בנק השעות לא נמצא');
    await audit(ctx, 'hoursBank.deactivate', String(bankId), null, req.ip);
    return { ok: true };
  });

  /** ייצוא מצב בנקי השעות — אותה כותרת אחידה כמו בשאר הדו"חות. */
  app.get('/api/hours-banks/export/:format', async (req, reply: FastifyReply) => {
    requireRole(ctx, 'agent');
    const format = (req.params as { format: string }).format;
    if (format !== 'pdf' && format !== 'excel') throw badRequest('פורמט לא נתמך');
    const q = (req.query ?? {}) as Record<string, unknown>;
    const clientIds = q.clientId ? [idField(q.clientId, 'לקוח')] : [];
    const result = await bankReport(clientIds);
    await audit(ctx, 'hoursBank.export', format, { clientIds }, req.ip);
    if (format === 'excel') {
      const xlsx = await reportToExcel(result);
      return reply
        .type(XLSX_MIME)
        .header('Content-Disposition', contentDisposition(`${result.head.reportName}.xlsx`, 'hours-banks.xlsx'))
        .send(xlsx);
    }
    const pdf = await reportToPdf(result);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', contentDisposition(`${result.head.reportName}.pdf`, 'hours-banks.pdf'))
      .send(pdf);
  });

  /** מסך בנק השעות מפיק דו"ח משלו, ולכן הוא מרכיב כותרת כמו כל דו"ח אחר. */
  async function bankReport(clientIds: number[]): Promise<ReportResult> {
    const def = {
      id: 'hours-banks',
      nameKey: 'colBank' as const,
      orientation: 'landscape' as const,
      fields: [],
      build: async () => [],
    };
    const [head, table] = await Promise.all([
      reportHead(ctx, def, { ...EMPTY_FILTERS, clientIds }),
      bankTable(ctx, clientIds),
    ]);
    return { id: def.id, head: { ...head, reportName: texts(ctx.lang).colBank }, blocks: [table], orientation: 'landscape' };
  }
}
