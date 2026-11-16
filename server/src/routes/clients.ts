import type { FastifyInstance, FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';
import { audit, type Ctx } from '../context.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { msg, type Lang } from '../i18n.ts';
import {
  bodyOf,
  flag,
  idOf,
  isDuplicate,
  optBool,
  optInt,
  optNum,
  optText,
  patchSet,
  queryOf,
  requireAdmin,
  requireSuperadmin,
  text,
} from './departments.ts';

/**
 * לקוחות. מאגר אחד לכל ארבע החברות: שם, ח.פ., כתובת וטלפונים נשמרים פעם אחת
 * (clients), וכל חברה רואה *את אותו* לקוח. מה שנפרד הוא client_company_settings:
 * ההערה האדומה שמוצגת על כל קריאה, האחראי המוגדר, עלות השעה והדגל "לא מקבל
 * הודעות" — שורה אחת לכל חברה, ולכן כל שאילתה כאן מצטרפת אליה עם company_id
 * של ההקשר בלבד. כך הערה של קוריץ לא מופיעה לנציג של סדקום.
 *
 * הרשימה עובדת כמו ב-Loren: סינון לכל עמודה, מיון, 15 שורות בדף וייצוא לאקסל
 * של אותו סינון בדיוק (בלי דפדוף).
 */

const PAGE_SIZE = 15;
const EXPORT_LIMIT = 10000;

/** מיון מותר בלבד — שם עמודה מהרשימה הזו ולא מה שהגיע בשורת הכתובת. */
const SORTS: Record<string, string> = {
  name: 'c.name',
  city: 'c.city',
  vatId: 'c.vat_id',
  phone: 'c.phone',
  group: 'g.name',
  owner: '"ownerName"',
  hourCost: 's.hour_cost',
  createdAt: 'c.created_at',
  active: 'c.active',
  id: 'c.id',
};

const CLIENT_COLUMNS = `c.id, c.group_id AS "groupId", g.name AS "groupName", c.name, c.vat_id AS "vatId",
       c.phone, c.phone2, c.mobile, c.fax, c.city, c.street, c.house_no AS "houseNo",
       c.apartment, c.zip, c.po_box AS "poBox", c.link_url AS "linkUrl", c.external_id AS "externalId",
       c.active, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
       s.call_remarks AS "callRemarks", s.default_owner_id AS "defaultOwnerId",
       NULLIF(TRIM(COALESCE(o.first_name, '') || ' ' || COALESCE(o.last_name, '')), '') AS "ownerName",
       s.hour_cost AS "hourCost", COALESCE(s.offline, false) AS offline,
       (s.client_id IS NOT NULL) AS "inCompany", COALESCE(s.active, false) AS "companyActive",
       (SELECT count(*)::int FROM contacts ct WHERE ct.client_id = c.id AND ct.active) AS contacts`;

const FROM_CLIENTS = `FROM clients c
       LEFT JOIN client_groups g ON g.id = c.group_id
       LEFT JOIN client_company_settings s ON s.client_id = c.id AND s.company_id = $1
       LEFT JOIN users o ON o.id = s.default_owner_id`;

export interface ClientRow {
  id: number;
  name: string;
  vatId: string | null;
  phone: string | null;
  phone2: string | null;
  mobile: string | null;
  city: string | null;
  street: string | null;
  houseNo: string | null;
  zip: string | null;
  groupId: number | null;
  groupName: string | null;
  externalId: string | null;
  active: boolean;
  callRemarks: string | null;
  defaultOwnerId: number | null;
  ownerName: string | null;
  hourCost: number | null;
  offline: boolean;
  inCompany: boolean;
  companyActive: boolean;
  contacts: number;
}

/** סינון פר עמודה. כל ערך נכנס כפרמטר, לא כטקסט בשאילתה. */
function listFilters(q: Record<string, string | undefined>, companyId: number) {
  const values: unknown[] = [companyId];
  const where: string[] = [];
  const like = (sql: string, raw: string | undefined) => {
    const v = (raw ?? '').trim();
    if (!v) return;
    values.push(v.slice(0, 80));
    where.push(sql.replaceAll('$v', `$${values.length}`));
  };
  const eq = (sql: string, raw: string | undefined, cast: (v: string) => unknown) => {
    if (raw === undefined || raw === '') return;
    values.push(cast(raw));
    where.push(sql.replaceAll('$v', `$${values.length}`));
  };

  like(`(c.name ILIKE '%' || $v || '%' OR COALESCE(c.vat_id,'') ILIKE '%' || $v || '%'
         OR COALESCE(c.phone,'') ILIKE '%' || $v || '%' OR COALESCE(c.mobile,'') ILIKE '%' || $v || '%'
         OR COALESCE(c.city,'') ILIKE '%' || $v || '%')`, q.q);
  like(`c.name ILIKE '%' || $v || '%'`, q.name);
  like(`COALESCE(c.city,'') ILIKE '%' || $v || '%'`, q.city);
  like(`COALESCE(c.street,'') ILIKE '%' || $v || '%'`, q.street);
  like(`COALESCE(c.vat_id,'') ILIKE '%' || $v || '%'`, q.vatId);
  like(`COALESCE(c.external_id,'') ILIKE '%' || $v || '%'`, q.externalId);
  like(`(COALESCE(c.phone,'') ILIKE '%' || $v || '%' OR COALESCE(c.phone2,'') ILIKE '%' || $v || '%'
         OR COALESCE(c.mobile,'') ILIKE '%' || $v || '%')`, q.phone);
  like(`COALESCE(s.call_remarks,'') ILIKE '%' || $v || '%'`, q.callRemarks);
  eq('c.group_id = $v', q.groupId, (v) => Number(v));
  eq('s.default_owner_id = $v', q.ownerId, (v) => Number(v));
  eq('c.active = $v', q.active, (v) => v === '1' || v === 'true');
  eq('COALESCE(s.offline,false) = $v', q.offline, (v) => v === '1' || v === 'true');
  // ברירת המחדל במסך: רק לקוחות פעילים. ?all=1 מבטל אותה
  if (q.active === undefined && q.all !== '1' && q.all !== 'true') where.push('c.active');
  // רק לקוחות שמוגדרים לחברה הפעילה (יש להם שורת הגדרות פעילה)
  if (q.inCompany === '1' || q.inCompany === 'true') where.push('s.client_id IS NOT NULL AND s.active');
  return { values, sql: where.length ? 'WHERE ' + where.join(' AND ') : '' };
}

function orderBy(q: Record<string, string | undefined>): string {
  const col = SORTS[q.sort ?? 'name'] ?? SORTS.name!;
  const dir = (q.dir ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${col} ${dir} NULLS LAST, c.name ASC, c.id ASC`;
}

const EXPORT_HEADERS: Record<Lang, [keyof ClientRow | 'contacts', string][]> = {
  he: [
    ['id', 'מזהה'],
    ['name', 'שם הלקוח'],
    ['vatId', 'ח.פ. / עוסק'],
    ['groupName', 'קבוצה'],
    ['phone', 'טלפון'],
    ['phone2', 'טלפון 2'],
    ['mobile', 'נייד'],
    ['city', 'עיר'],
    ['street', 'רחוב'],
    ['houseNo', 'מספר'],
    ['zip', 'מיקוד'],
    ['ownerName', 'אחראי בחברה'],
    ['hourCost', 'עלות שעה'],
    ['callRemarks', 'הערות לקריאה'],
    ['offline', 'לא מקבל הודעות'],
    ['contacts', 'אנשי קשר'],
    ['externalId', 'מזהה בהנה"ח'],
    ['active', 'פעיל'],
  ],
  en: [
    ['id', 'ID'],
    ['name', 'Client'],
    ['vatId', 'VAT ID'],
    ['groupName', 'Group'],
    ['phone', 'Phone'],
    ['phone2', 'Phone 2'],
    ['mobile', 'Mobile'],
    ['city', 'City'],
    ['street', 'Street'],
    ['houseNo', 'No.'],
    ['zip', 'ZIP'],
    ['ownerName', 'Owner'],
    ['hourCost', 'Hour cost'],
    ['callRemarks', 'Call remarks'],
    ['offline', 'Offline'],
    ['contacts', 'Contacts'],
    ['externalId', 'Accounting id'],
    ['active', 'Active'],
  ],
};

export function registerClientsRoutes(app: FastifyInstance, ctx: Ctx): void {
  async function one(id: number): Promise<ClientRow> {
    const { rows } = await ctx.db.query<ClientRow>(
      `SELECT ${CLIENT_COLUMNS} ${FROM_CLIENTS} WHERE c.id = $2`,
      [ctx.companyId, id],
    );
    const row = rows[0];
    if (!row) throw notFound(msg('notFound', ctx.lang));
    return row;
  }

  /** שדות משותפים לכל החברות. שינוי כאן נראה מיד לכל ארבע. */
  function sharedFields(b: Record<string, unknown>, creating: boolean): Record<string, unknown> {
    return {
      name: creating || b.name !== undefined ? text(b.name, 'שם הלקוח', 200) : undefined,
      group_id: optInt(b.groupId, 'קבוצה'),
      vat_id: optText(b.vatId, 'ח.פ.', 20),
      phone: optText(b.phone, 'טלפון', 40),
      phone2: optText(b.phone2, 'טלפון 2', 40),
      mobile: optText(b.mobile, 'נייד', 40),
      fax: optText(b.fax, 'פקס', 40),
      city: optText(b.city, 'עיר', 80),
      street: optText(b.street, 'רחוב', 120),
      house_no: optText(b.houseNo, 'מספר בית', 20),
      apartment: optText(b.apartment, 'דירה', 20),
      zip: optText(b.zip, 'מיקוד', 20),
      po_box: optText(b.poBox, 'תא דואר', 20),
      link_url: optText(b.linkUrl, 'קישור', 500),
      external_id: optText(b.externalId, 'מזהה חיצוני', 60),
      active: optBool(b.active, 'פעיל'),
    };
  }

  /** שדות החברה הפעילה בלבד. company_id נלקח מההקשר ולא מהגוף. */
  async function companyFields(b: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ownerId = optInt(b.defaultOwnerId, 'אחראי');
    if (ownerId) {
      const { rows } = await ctx.db.query(
        'SELECT 1 FROM user_companies uc JOIN users u ON u.id = uc.user_id ' +
          'WHERE uc.user_id = $1 AND uc.company_id = $2 AND uc.active AND u.active',
        [ownerId, ctx.companyId],
      );
      if (!rows[0]) throw badRequest('האחראי שנבחר אינו נציג פעיל בחברה הזו');
    }
    return {
      call_remarks: optText(b.callRemarks, 'הערות לקריאה', 2000),
      default_owner_id: ownerId,
      hour_cost: optNum(b.hourCost, 'עלות שעה', 0, 100000),
      offline: optBool(b.offline, 'לא מקבל הודעות'),
      active: optBool(b.companyActive, 'פעיל בחברה'),
    };
  }

  // ---- קבוצות לקוחות (משותפות) ----

  app.get('/api/client-groups', async (req) => {
    const { rows } = await ctx.db.query(
      `SELECT g.id, g.name, g.manager, g.active,
              (SELECT count(*)::int FROM clients c WHERE c.group_id = g.id AND c.active) AS clients
         FROM client_groups g WHERE ($1 OR g.active) ORDER BY g.active DESC, g.name`,
      [flag(req, 'all')],
    );
    return rows;
  });

  app.post('/api/client-groups', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const { rows } = await ctx.db.query<{ id: number }>(
      'INSERT INTO client_groups (name, manager) VALUES ($1,$2) RETURNING id',
      [text(b.name, 'שם הקבוצה', 120), optText(b.manager, 'מנהל הקבוצה', 120) ?? null],
    );
    await audit(ctx, 'client-group.create', String(rows[0]!.id), b, req.ip);
    return { id: rows[0]!.id };
  });

  app.patch('/api/client-groups/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    const patch = patchSet(
      {
        name: b.name === undefined ? undefined : text(b.name, 'שם הקבוצה', 120),
        manager: optText(b.manager, 'מנהל הקבוצה', 120),
        active: optBool(b.active, 'פעילה'),
      },
      2,
    );
    if (!patch) throw badRequest('אין מה לעדכן');
    const { rowCount } = await ctx.db.query(`UPDATE client_groups SET ${patch.set} WHERE id = $1`, [
      id,
      ...patch.values,
    ]);
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await audit(ctx, 'client-group.update', String(id), b, req.ip);
    return { ok: true };
  });

  /** השבתה בלבד: לקוחות שמשויכים לקבוצה נשארים משויכים. */
  app.delete('/api/client-groups/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const { rowCount } = await ctx.db.query('UPDATE client_groups SET active = false WHERE id = $1', [id]);
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await audit(ctx, 'client-group.deactivate', String(id), null, req.ip);
    return { ok: true };
  });

  // ---- רשימת הלקוחות ----

  /**
   * סינון לכל עמודה, מיון, ו-15 שורות בדף (pageSize עד 200 לייצוא במסך).
   * total מוחזר כדי שהדפדוף ידע כמה דפים יש.
   */
  app.get('/api/clients', async (req) => {
    const q = queryOf(req);
    const { values, sql } = listFilters(q, ctx.companyId);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || PAGE_SIZE));
    const page = Math.max(1, Number(q.page) || 1);
    const total = Number(
      (await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n ${FROM_CLIENTS} ${sql}`, values)).rows[0]?.n ?? 0,
    );
    const { rows } = await ctx.db.query<ClientRow>(
      `SELECT ${CLIENT_COLUMNS} ${FROM_CLIENTS} ${sql} ${orderBy(q)}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      values,
    );
    return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  /**
   * ייצוא לאקסל של אותו סינון ומיון, בלי דפדוף. הכותרות לפי שפת המשתמש
   * וה-RTL של הגיליון נקבע לפיה, כדי שהקובץ ייפתח נכון בעברית.
   */
  app.get('/api/clients/export.xlsx', async (req, reply: FastifyReply) => {
    const q = queryOf(req);
    const { values, sql } = listFilters(q, ctx.companyId);
    const { rows } = await ctx.db.query<ClientRow>(
      `SELECT ${CLIENT_COLUMNS} ${FROM_CLIENTS} ${sql} ${orderBy(q)} LIMIT ${EXPORT_LIMIT}`,
      values,
    );
    const yes = ctx.lang === 'en' ? 'Yes' : 'כן';
    const no = ctx.lang === 'en' ? 'No' : 'לא';
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet(ctx.lang === 'en' ? 'Clients' : 'לקוחות', {
      views: [{ rightToLeft: ctx.lang !== 'en', state: 'frozen', ySplit: 1 }],
    });
    const headers = EXPORT_HEADERS[ctx.lang] ?? EXPORT_HEADERS.he;
    sheet.columns = headers.map(([key, header]) => ({ key: String(key), header, width: 18 }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      const cells: Record<string, unknown> = {};
      for (const [key] of headers) {
        const value = (row as unknown as Record<string, unknown>)[key as string] ?? null;
        cells[String(key)] = typeof value === 'boolean' ? (value ? yes : no) : value;
      }
      sheet.addRow(cells);
    }
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    await audit(ctx, 'clients.export', undefined, { rows: rows.length, filters: q }, req.ip);
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="clients.xlsx"')
      .send(buffer);
  });

  app.get('/api/clients/:id', async (req) => one(idOf(req)));

  app.post('/api/clients', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const shared = sharedFields(b, true);
    const company = await companyFields(b);
    try {
      const id = await ctx.db.tx(async (tx) => {
        const keys = Object.keys(shared).filter((k) => shared[k] !== undefined);
        const { rows } = await tx.query<{ id: number }>(
          `INSERT INTO clients (${keys.join(', ')}, created_by)
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) RETURNING id`,
          [...keys.map((k) => shared[k]), ctx.user.id],
        );
        const clientId = rows[0]!.id;
        // שורת ההגדרות של החברה הפעילה נוצרת מיד, גם כשלא נשלח בה כלום
        const ckeys = Object.keys(company).filter((k) => company[k] !== undefined);
        await tx.query(
          `INSERT INTO client_company_settings (client_id, company_id${ckeys.length ? ', ' + ckeys.join(', ') : ''})
           VALUES ($1, $2${ckeys.map((_, i) => `, $${i + 3}`).join('')})`,
          [clientId, ctx.companyId, ...ckeys.map((k) => company[k])],
        );
        return clientId;
      });
      await audit(ctx, 'client.create', String(id), { name: shared.name }, req.ip);
      return one(id);
    } catch (err) {
      if (isDuplicate(err)) throw new HttpError(409, 'כבר קיים לקוח עם המזהה הזה');
      throw err;
    }
  });

  /**
   * עדכון: שדות משותפים + הגדרות החברה הפעילה באותה בקשה.
   * ההגדרות נכתבות ב-upsert, כי לקוח ותיק יכול להיות בלי שורה לחברה הזו.
   */
  app.patch('/api/clients/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    await one(id);
    const shared = patchSet(sharedFields(b, false), 3);
    const company = await companyFields(b);
    const ckeys = Object.keys(company).filter((k) => company[k] !== undefined);
    if (!shared && !ckeys.length) throw badRequest('אין מה לעדכן');

    await ctx.db.tx(async (tx) => {
      if (shared) {
        await tx.query(
          `UPDATE clients SET ${shared.set}, updated_at = now(), updated_by = $2 WHERE id = $1`,
          [id, ctx.user.id, ...shared.values],
        );
      }
      if (ckeys.length) {
        await tx.query(
          `INSERT INTO client_company_settings (client_id, company_id, ${ckeys.join(', ')})
           VALUES ($1, $2${ckeys.map((_, i) => `, $${i + 3}`).join('')})
           ON CONFLICT (client_id, company_id) DO UPDATE SET
           ${ckeys.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}`,
          [id, ctx.companyId, ...ckeys.map((k) => company[k])],
        );
      }
    });
    await audit(ctx, 'client.update', String(id), b, req.ip);
    return one(id);
  });

  /**
   * השבתה. ברירת המחדל היא פר חברה: הלקוח יוצא מהרשימות של *החברה הפעילה*
   * ונשאר אצל האחרות. ?global=1 משבית אותו בכל המערכת ולכן מותר לסופר-אדמין בלבד.
   */
  app.delete('/api/clients/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const global = flag(req, 'global');
    if (global) requireSuperadmin(ctx);
    await one(id);
    if (global) {
      await ctx.db.query('UPDATE clients SET active = false, updated_at = now(), updated_by = $2 WHERE id = $1', [
        id,
        ctx.user.id,
      ]);
    } else {
      await ctx.db.query(
        `INSERT INTO client_company_settings (client_id, company_id, active) VALUES ($1,$2,false)
         ON CONFLICT (client_id, company_id) DO UPDATE SET active = false`,
        [id, ctx.companyId],
      );
    }
    await audit(ctx, global ? 'client.deactivate.global' : 'client.deactivate', String(id), null, req.ip);
    return { ok: true };
  });
}
