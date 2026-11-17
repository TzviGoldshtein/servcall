/**
 * הרכבת הדו"ח: בלוקים + הכותרת האחידה, ומשם לשלושת הפלטים.
 * מי שקורא מכאן (routes/reports.ts) לא צריך לדעת איך נראה HTML או Excel.
 */
import type { Ctx } from '../context.ts';
import { notFound } from '../errors.ts';
import { dirOf, localName } from '../i18n.ts';
import { brandOf, fetchCompany, logoDataUri } from './data.ts';
import { renderReportExcel } from './excel.ts';
import { filterText, type ReportFilters } from './filters.ts';
import { dateTimeText, personName } from './fmt.ts';
import { footerTemplate, renderReportHtml } from './layout.ts';
import { htmlToPdf } from './pdf.ts';
import { findReport, REPORTS, type ReportDef } from './reports.ts';
import { texts } from './texts.ts';
import type { ReportHead, ReportResult } from './types.ts';

export * from './types.ts';
export { parseFilters, EMPTY_FILTERS } from './filters.ts';
export { REPORTS, findReport } from './reports.ts';
export { bankTable } from './reports.ts';

/** הכותרת האחידה של כל הדו"חות — אותם שדות בכל אחד-עשר. */
export async function reportHead(ctx: Ctx, def: ReportDef, f: ReportFilters): Promise<ReportHead> {
  const t = texts(ctx.lang);
  const company = await fetchCompany(ctx);
  const logo = await logoDataUri(company);
  return {
    systemName: t.systemName,
    companyName: localName(company, ctx.lang),
    companyLogo: logo,
    reportName: t[def.nameKey],
    generatedAt: `${t.generatedAt} ${dateTimeText(new Date(), ctx.lang)}`,
    byLabel: t.producedBy,
    byUser: personName(ctx.user.firstName, ctx.user.lastName) || ctx.user.email,
    filterText: filterText(f, ctx.lang),
    brand: brandOf(company),
    lang: ctx.lang,
    dir: dirOf(ctx.lang),
    pageLabel: t.page,
    emptyText: t.noData,
  };
}

export async function buildReport(ctx: Ctx, id: string, f: ReportFilters): Promise<ReportResult> {
  const def = findReport(id);
  if (!def) throw notFound(`דו"ח לא מוכר: ${id}`);
  const [head, blocks] = await Promise.all([reportHead(ctx, def, f), def.build(ctx, f)]);
  return { id: def.id, head, blocks, orientation: def.orientation };
}

export const reportToHtml = (result: ReportResult): string => renderReportHtml(result);

export const reportToPdf = (result: ReportResult): Promise<Buffer> =>
  htmlToPdf(renderReportHtml(result), {
    landscape: result.orientation === 'landscape',
    footerTemplate: footerTemplate(result.head),
  });

export const reportToExcel = (result: ReportResult): Promise<Buffer> => renderReportExcel(result);

/** שם הקובץ להורדה: שם הדו"ח, החברה והתאריך, בלי תווים שישברו כותרת HTTP. */
export function reportFileName(result: ReportResult, ext: 'pdf' | 'xlsx'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = `${result.head.reportName}-${stamp}`.replace(/["\\\r\n]/g, '').replace(/\s+/g, '_');
  return `${safe}.${ext}`;
}

/** המאגר כפי שמסך הדו"חות מקבל אותו. */
export const reportCatalogue = (ctx: Ctx) =>
  REPORTS.map((r) => ({
    id: r.id,
    name: texts(ctx.lang)[r.nameKey],
    orientation: r.orientation,
    fields: r.fields,
  }));
