import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { COMPANY_COLUMNS, brandOf, type CompanyBrand, type CompanyRow } from '../branding.ts';
import { config } from '../config.ts';
import { audit, can, type Ctx, type Role } from '../context.ts';
import { HttpError, badRequest, forbidden, notFound } from '../errors.ts';
import type { Hub } from '../http.ts';
import { roleIn } from '../requestContext.ts';
import { readUpload } from '../uploads.ts';
import { hexColor, intOf, optionalText } from '../validate.ts';

/** חברה כפי שהיא מוצגת בבורר החברות: המיתוג, ומה שהנציג הוא בתוכה. */
export interface CompanyOption extends CompanyBrand {
  role: Role;
  extension: string | null;
  /** false = סופר-אדמין שרואה חברה שאינו משויך אליה. */
  member: boolean;
}

const LOGO_DIR = () => join(config.mediaDir, 'branding');

/** רק הסוגים שאנחנו יודעים להגיש בחזרה בדיוק באותו סוג תוכן. */
const LOGO_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};
const TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** יעד הניגודיות שהגזירה מכוונת אליו. מתחת ל-3 אין קריאות, מעל 12 הכרום שחור. */
function primaryTarget(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 3 || n > 12) throw badRequest('יעד הניגודיות חייב להיות בין 3 ל-12');
  return Math.round(n * 10) / 10;
}

export function registerCompanyRoutes(app: FastifyInstance, ctx: Ctx, hub: Hub): void {
  const { db } = ctx;

  const companyRow = async (id: number): Promise<CompanyRow> => {
    const { rows } = await db.query<CompanyRow>(
      `SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = $1 AND active`,
      [id],
    );
    if (!rows[0]) throw notFound('החברה לא נמצאה');
    return rows[0];
  };

  /**
   * החברות שהנציג יכול לעבוד בהן, עם הערכה הנגזרת והלוגו של כל אחת. סופר-אדמין
   * רואה גם חברות שאינו משויך אליהן, כי הוא זה שמגדיר אותן.
   */
  app.get('/api/companies', async (): Promise<CompanyOption[]> => {
    const user = ctx.user;
    const { rows } = await db.query<CompanyRow & { role: Role | null; extension: string | null }>(
      `SELECT ${COMPANY_COLUMNS.split(', ').map((c) => 'c.' + c).join(', ')},
              uc.role, uc.extension
       FROM companies c
       LEFT JOIN user_companies uc ON uc.company_id = c.id AND uc.user_id = $1 AND uc.active
       WHERE c.active AND (uc.user_id IS NOT NULL OR $2::boolean)
       ORDER BY c.id`,
      [user.id, user.isSuperadmin],
    );
    return rows.map((row) => ({
      ...brandOf(row),
      role: row.role ?? 'admin',
      extension: row.extension,
      member: row.role !== null,
    }));
  });

  /**
   * שינוי המיתוג של חברה. מותר למנהל באותה חברה — לא למנהל בחברה אחרת.
   * מחזיר את הערכה כפי שנגזרה מחדש, כדי שמסך ההגדרות יציג את התוצאה האמיתית
   * ולא ניחוש של הדפדפן: הגזירה היא בשרת וזה המקום היחיד שמחליט מה הצבעים.
   *
   * הגוף הוא JSON, או multipart כשמעלים לוגו (שדה `logo`, ושדה `removeLogo=1` למחיקה).
   */
  app.put('/api/companies/:id/branding', async (req): Promise<CompanyBrand> => {
    const id = intOf((req.params as { id: string }).id, 'חברה');
    if (!can(roleIn(ctx.user, id), 'admin')) throw forbidden('שינוי מיתוג מותר למנהל החברה בלבד');
    const current = await companyRow(id);

    const fields: Record<string, unknown> = {};
    let newLogo: string | null = null;
    if (req.isMultipart()) {
      const upload = await readUpload(req);
      Object.assign(fields, upload.fields);
      if (upload.file) {
        const ext = LOGO_TYPES[upload.file.mime];
        if (!ext) {
          await rm(upload.file.tempFile, { force: true });
          throw badRequest('אפשר להעלות PNG, JPG, WebP או SVG');
        }
        await mkdir(LOGO_DIR(), { recursive: true });
        newLogo = join(LOGO_DIR(), `${current.code}-${randomUUID()}${ext}`);
        await rename(upload.file.tempFile, newLogo);
      }
    } else {
      Object.assign(fields, (req.body ?? {}) as Record<string, unknown>);
    }

    const brandPrimary = fields.brandPrimary === undefined
      ? current.brand_primary
      : hexColor(fields.brandPrimary, 'צבע ראשי');
    // מחרוזת ריקה = החברה הופכת מונוכרומטית והכפתורים חוזרים לצבע הבסיס
    const accentRaw = optionalText(fields.brandAccent, 'צבע משני', 7);
    const brandAccent = fields.brandAccent === undefined
      ? current.brand_accent
      : accentRaw && hexColor(accentRaw, 'צבע משני');
    const target = fields.primaryTarget === undefined
      ? Number(current.primary_target)
      : primaryTarget(fields.primaryTarget);
    const removeLogo = fields.removeLogo === '1' || fields.removeLogo === true;
    const logoPath = newLogo ?? (removeLogo ? null : current.logo_path);

    const { rows } = await db.query<CompanyRow>(
      `UPDATE companies
       SET brand_primary = $2, brand_accent = $3, primary_target = $4, logo_path = $5
       WHERE id = $1
       RETURNING ${COMPANY_COLUMNS}`,
      [id, brandPrimary, brandAccent || null, target, logoPath],
    );
    // הקובץ הקודם נמחק רק אחרי שהשורה עודכנה, כדי שכשל בעדכון לא ישאיר חברה בלי לוגו
    if (current.logo_path && current.logo_path !== logoPath) {
      await rm(current.logo_path, { force: true });
    }

    await audit(
      { db, user: ctx.user, companyId: id },
      'company.branding',
      String(id),
      { brandPrimary, brandAccent: brandAccent || null, primaryTarget: target, logo: !!logoPath },
      req.ip,
    );
    const brand = brandOf(rows[0]!);
    // לשוניות אחרות של אותה חברה מחליפות ערכה בלי רענון
    hub.broadcast(id, { t: 'branding', companyId: id });
    return brand;
  });

  /**
   * הגשת הלוגו. פתוח למי שרשאי לעבוד בחברה — הלוגו יושב בכותרת המערכת ולא במקום ציבורי.
   */
  app.get('/api/companies/:id/logo', async (req, reply) =>
    sendLogo(reply, await companyRow(intOf((req.params as { id: string }).id, 'חברה')), 'logo'),
  );

  app.get('/api/companies/:id/logo-mark', async (req, reply) =>
    sendLogo(reply, await companyRow(intOf((req.params as { id: string }).id, 'חברה')), 'mark'),
  );

  const sendLogo = async (reply: FastifyReply, row: CompanyRow, kind: 'logo' | 'mark') => {
    roleIn(ctx.user, row.id);
    const path = kind === 'logo' ? row.logo_path : row.logo_mark_path;
    const type = path ? TYPE_BY_EXT[extname(path).toLowerCase()] : undefined;
    if (!path || !type) throw notFound('לא הועלה לוגו');
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) throw new HttpError(404, 'קובץ הלוגו חסר בשרת');
    reply
      .type(type)
      // סוג התוכן נקבע לפי הסיומת שאנחנו כתבנו בהעלאה ולעולם לא מנוחש; nosniff חוסם ניחוש בדפדפן.
      // CSP נועד ל-SVG: צפייה ישירה בקובץ לא תריץ ממנו סקריפט במקור שלנו.
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
      // הכתובת נושאת גרסה (שם הקובץ), ולכן אפשר מטמון ארוך
      .header('Cache-Control', 'private, max-age=604800');
    return reply.send(createReadStream(path));
  };
}
