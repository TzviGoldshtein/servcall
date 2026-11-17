/**
 * מסלולי הדו"חות.
 *
 * לכל דו"ח שלושה פלטים מאותו מודל: JSON למסך, PDF להדפסה ולשליחה ללקוח,
 * ו-Excel למי שרוצה להמשיך לחשב. הסינון מגיע ב-query כדי שכל דו"ח יהיה
 * כתובת שאפשר לשמור במועדפים ולהוריד בקישור ישיר.
 *
 * ההיקף: כל דו"ח נבנה על ctx.companyId. אין פרמטר חברה, גם לא למנהל —
 * מי שרוצה את הדו"ח של חברה אחרת מחליף חברה ומפיק מחדש.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit, type Ctx } from '../context.ts';
import { fetchFilterOptions } from '../report/data.ts';
import {
  buildReport,
  parseFilters,
  reportCatalogue,
  reportFileName,
  reportToExcel,
  reportToHtml,
  reportToPdf,
} from '../report/index.ts';
import { contentDisposition, requireRole } from '../report/input.ts';
import { texts } from '../report/texts.ts';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** דו"חות שחושפים כספים ושעות — לנציג ומעלה, לא לצופה חיצוני. */
const BILLING_REPORTS = new Set(['hours', 'services']);

const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;

export function registerReportRoutes(app: FastifyInstance, ctx: Ctx): void {
  const guard = (id: string): void => {
    requireRole(ctx, BILLING_REPORTS.has(id) ? 'agent' : 'viewer');
  };

  /** מאגר הדו"חות: מה יש, ואילו שדות סינון כל אחד מציג. */
  app.get('/api/reports', async (req) => {
    return { reports: reportCatalogue(ctx), labels: texts(ctx.lang) };
  });

  /** הרשימות למסך הסינון — לקוחות, קבוצות, נציגים וטבלאות הקוד של החברה. */
  app.get('/api/reports/options', async (req) => {
    return fetchFilterOptions(ctx);
  });

  /** הדו"ח כנתונים, בשביל המסך. */
  app.get('/api/reports/:id', async (req) => {
    const id = idOf(req);
    guard(id);
    return buildReport(ctx, id, parseFilters(req.query));
  });

  /**
   * ה-HTML של הדו"ח — אותו מסמך שנשלח לכרומיום. שימושי להדפסה מהדפדפן
   * ולבדיקה, ולכן הוא לא מוריד קובץ אלא מוצג.
   */
  app.get('/api/reports/:id/html', async (req, reply: FastifyReply) => {
    const id = idOf(req);
    guard(id);
    const result = await buildReport(ctx, id, parseFilters(req.query));
    return reply.type('text/html; charset=utf-8').send(reportToHtml(result));
  });

  app.get('/api/reports/:id/pdf', async (req, reply: FastifyReply) => {
    const id = idOf(req);
    guard(id);
    const filters = parseFilters(req.query);
    const result = await buildReport(ctx, id, filters);
    const pdf = await reportToPdf(result);
    // ייצוא הוא הוצאת נתונים מהמערכת — נרשם ביומן, כולל הסינון שהופק
    await audit(ctx, 'report.export', `${id}:pdf`, { filters }, req.ip);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', contentDisposition(reportFileName(result, 'pdf'), `${id}.pdf`))
      .send(pdf);
  });

  app.get('/api/reports/:id/excel', async (req, reply: FastifyReply) => {
    const id = idOf(req);
    guard(id);
    const filters = parseFilters(req.query);
    const result = await buildReport(ctx, id, filters);
    const xlsx = await reportToExcel(result);
    await audit(ctx, 'report.export', `${id}:xlsx`, { filters }, req.ip);
    return reply
      .type(XLSX_MIME)
      .header('Content-Disposition', contentDisposition(reportFileName(result, 'xlsx'), `${id}.xlsx`))
      .send(xlsx);
  });
}
