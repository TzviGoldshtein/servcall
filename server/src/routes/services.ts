/**
 * שירותים חודשיים: קטלוג השירותים של החברה (items) ומה שכל לקוח משלם עליו
 * בכל חודש (client_items).
 *
 * הכלל שקובע את הכסף: **מחיר שנקבע על הלקוח דוחה את מחיר הקטלוג כשהוא שונה
 * מאפס.** אפס אינו "בחינם" אלא "לפי הקטלוג" — כך היה במערכת הקודמת, וכך
 * נשמר, אחרת לקוחות היו מאבדים חיוב בשקט. החישוב עצמו ב-report/calc.ts
 * ונבדק בטסטים.
 *
 * הקטלוג הוא פר חברה; הלקוח משותף, החיוב לא.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit, type Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { effectivePrice, lineTotal, monthlyRevenue, round2 } from '../report/calc.ts';
import { fetchClientItems, fetchItems, type ClientItemRow } from '../report/data.ts';
import { EMPTY_FILTERS } from '../report/index.ts';
import { amount, id as idField, isTrue, optionalText, requireRole, text } from '../report/input.ts';
import { dateText, dateTimeText, moneyText } from '../report/fmt.ts';
import { localName } from '../i18n.ts';
import type { Lang } from '../i18n.ts';

const idOf = (req: FastifyRequest): number => idField((req.params as { id: string }).id, 'מזהה');

/** שורת שירות של לקוח כפי שהמסך מקבל אותה, עם המחיר הקובע וסך החודש. */
const toView = (r: ClientItemRow, lang: Lang) => {
  const price = effectivePrice(r.cost, r.catalog_price);
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    groupName: r.group_name,
    itemId: r.item_id,
    itemName: localName({ name: r.item_name, name_en: r.item_name_en }, lang),
    catalogPrice: r.catalog_price,
    /** המחיר שנקבע על הלקוח. 0 = לפי הקטלוג. */
    cost: r.cost,
    /** המחיר הקובע בפועל — זה שמחייב. */
    price,
    /** האם המחיר של הלקוח דוחה את הקטלוג. */
    overridesCatalog: r.cost !== 0,
    qty: r.qty,
    monthly: lineTotal({ cost: r.cost, price: r.catalog_price, qty: r.qty }),
    monthlyText: moneyText(lineTotal({ cost: r.cost, price: r.catalog_price, qty: r.qty }), lang),
    active: r.active,
    since: r.created_at,
    sinceText: dateText(r.created_at, lang),
    updatedAt: r.updated_at,
  };
};

export function registerServiceRoutes(app: FastifyInstance, ctx: Ctx): void {
  // ------------------------------------------------ קטלוג השירותים

  app.get('/api/items', async (req) => {
    requireRole(ctx, 'viewer');
    const q = (req.query ?? {}) as Record<string, unknown>;
    const rows = await fetchItems(ctx, !isTrue(q.includeInactive));
    return rows.map((it) => ({
      id: it.id,
      name: it.name,
      nameEn: it.name_en,
      displayName: localName(it, ctx.lang),
      price: it.price,
      priceText: moneyText(it.price, ctx.lang),
      active: it.active,
      /** על כמה לקוחות השירות הזה מחויב כרגע. */
      clients: it.clients,
    }));
  });

  app.post('/api/items', async (req) => {
    requireRole(ctx, 'admin');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = text(b.name, 'שם השירות', 120);
    const nameEn = optionalText(b.nameEn, 'שם באנגלית', 120);
    const price = amount(b.price ?? 0, 'מחיר');
    const { rows } = await ctx.db.query<{ id: number }>(
      'INSERT INTO items (company_id, name, name_en, price) VALUES ($1,$2,$3,$4) RETURNING id',
      [ctx.companyId, name, nameEn, price],
    );
    const created = rows[0];
    if (!created) throw badRequest('יצירת השירות נכשלה');
    await audit(ctx, 'item.create', String(created.id), { name, price }, req.ip);
    return { id: created.id, name, nameEn, price, active: true, clients: 0 };
  });

  app.patch('/api/items/:id', async (req) => {
    requireRole(ctx, 'admin');
    const itemId = idOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const values: unknown[] = [itemId, ctx.companyId];
    const name = optionalText(b.name, 'שם השירות', 120);
    if (name !== null) sets.push(`name = $${values.push(name)}`);
    if (b.nameEn !== undefined) sets.push(`name_en = $${values.push(optionalText(b.nameEn, 'שם באנגלית', 120))}`);
    if (b.price !== undefined) sets.push(`price = $${values.push(amount(b.price, 'מחיר'))}`);
    if (b.active !== undefined) sets.push(`active = $${values.push(isTrue(b.active))}`);
    if (!sets.length) throw badRequest('אין מה לעדכן');
    const { rowCount } = await ctx.db.query(
      `UPDATE items SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
      values,
    );
    if (!rowCount) throw notFound('השירות לא נמצא');
    await audit(ctx, 'item.update', String(itemId), b, req.ip);
    return { ok: true };
  });

  /**
   * השבתה ולא מחיקה: client_items מצביע על השירות עם ON DELETE RESTRICT,
   * והחיובים ההיסטוריים צריכים להמשיך להציג שם.
   */
  app.delete('/api/items/:id', async (req) => {
    requireRole(ctx, 'admin');
    const itemId = idOf(req);
    const { rowCount } = await ctx.db.query('UPDATE items SET active = false WHERE id = $1 AND company_id = $2', [
      itemId,
      ctx.companyId,
    ]);
    if (!rowCount) throw notFound('השירות לא נמצא');
    await audit(ctx, 'item.deactivate', String(itemId), null, req.ip);
    return { ok: true };
  });

  // ------------------------------------- מה שהלקוח משלם בכל חודש

  app.get('/api/client-items', async (req) => {
    requireRole(ctx, 'viewer');
    const q = (req.query ?? {}) as Record<string, unknown>;
    const filters = {
      ...EMPTY_FILTERS,
      activeOnly: !isTrue(q.includeInactive),
      clientIds: q.clientId ? [idField(q.clientId, 'לקוח')] : [],
      itemIds: q.itemId ? [idField(q.itemId, 'שירות')] : [],
      q: q.q ? String(q.q).slice(0, 120) : null,
    };
    const rows = await fetchClientItems(ctx, filters);
    const lines = rows.map((r) => toView(r, ctx.lang));
    const revenue = monthlyRevenue(rows.map((r) => ({ cost: r.cost, price: r.catalog_price, qty: r.qty })));
    return {
      lines,
      totals: {
        /** סך ההכנסה החודשית מהשורות שהוחזרו. */
        monthly: revenue,
        monthlyText: moneyText(revenue, ctx.lang),
        lines: lines.length,
        clients: new Set(rows.map((r) => r.client_id)).size,
      },
    };
  });

  /** סיכום להכנסה החודשית של החברה, ופירוט לפי שירות — לכרטיס שבראש המסך. */
  app.get('/api/client-items/summary', async (req) => {
    requireRole(ctx, 'agent');
    const rows = await fetchClientItems(ctx, { ...EMPTY_FILTERS, activeOnly: true });
    const perItem = new Map<number, { itemId: number; itemName: string; clients: number; monthly: number }>();
    for (const r of rows) {
      const hit = perItem.get(r.item_id) ?? {
        itemId: r.item_id,
        itemName: localName({ name: r.item_name, name_en: r.item_name_en }, ctx.lang),
        clients: 0,
        monthly: 0,
      };
      hit.clients += 1;
      hit.monthly = round2(hit.monthly + lineTotal({ cost: r.cost, price: r.catalog_price, qty: r.qty }));
      perItem.set(r.item_id, hit);
    }
    const monthly = monthlyRevenue(rows.map((r) => ({ cost: r.cost, price: r.catalog_price, qty: r.qty })));
    return {
      monthly,
      monthlyText: moneyText(monthly, ctx.lang),
      yearly: round2(monthly * 12),
      clients: new Set(rows.map((r) => r.client_id)).size,
      lines: rows.length,
      perItem: [...perItem.values()].sort((a, b) => b.monthly - a.monthly),
    };
  });

  /**
   * שורה אחת, לטופס. מעבר לנתוני הלשונית "כללי" היא נושאת את "פרטי עדכון":
   * מי הוסיף, מי עדכן ומי הסיר, ומתי — כולל שורות שכבר הוסרו, כדי שאפשר יהיה
   * להסביר ירידה בהכנסה גם בדיעבד.
   */
  app.get('/api/client-items/:id', async (req) => {
    requireRole(ctx, 'viewer');
    const rowId = idOf(req);
    const person = (alias: string) =>
      `NULLIF(TRIM(COALESCE(${alias}.first_name,'') || ' ' || COALESCE(${alias}.last_name,'')), '')`;
    const { rows } = await ctx.db.query<
      ClientItemRow & {
        removed_at: string | null;
        created_by_name: string | null;
        updated_by_name: string | null;
        removed_by_name: string | null;
      }
    >(
      `SELECT ci.id, ci.client_id, cl.name AS client_name, cg.name AS group_name,
              ci.item_id, it.name AS item_name, it.name_en AS item_name_en,
              it.price AS catalog_price, ci.cost, ci.qty, ci.active, ci.created_at, ci.updated_at, ci.removed_at,
              ${person('cu')} AS created_by_name, ${person('uu')} AS updated_by_name, ${person('ru')} AS removed_by_name
       FROM client_items ci
       JOIN clients cl ON cl.id = ci.client_id
       LEFT JOIN client_groups cg ON cg.id = cl.group_id
       JOIN items it ON it.id = ci.item_id AND it.company_id = ci.company_id
       LEFT JOIN users cu ON cu.id = ci.created_by
       LEFT JOIN users uu ON uu.id = ci.updated_by
       LEFT JOIN users ru ON ru.id = ci.removed_by
       WHERE ci.id = $1 AND ci.company_id = $2`,
      [rowId, ctx.companyId],
    );
    const row = rows[0];
    if (!row) throw notFound('השירות של הלקוח לא נמצא');
    const stamp = (at: string | null) => (at ? dateTimeText(at, ctx.lang) : null);
    return {
      ...toView(row, ctx.lang),
      audit: {
        createdAt: stamp(row.created_at),
        createdBy: row.created_by_name,
        updatedAt: stamp(row.updated_at),
        updatedBy: row.updated_by_name,
        removedAt: stamp(row.removed_at),
        removedBy: row.removed_by_name,
      },
    };
  });

  app.post('/api/client-items', async (req) => {
    requireRole(ctx, 'agent');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const clientId = idField(b.clientId, 'לקוח');
    const itemId = idField(b.itemId, 'שירות');
    const cost = amount(b.cost ?? 0, 'מחיר ללקוח');
    const qty = amount(b.qty ?? 1, 'כמות', 10_000);
    // השירות חייב להיות מהקטלוג של החברה הפעילה
    const { rows: itemRows } = await ctx.db.query<{ id: number }>(
      'SELECT id FROM items WHERE id = $1 AND company_id = $2',
      [itemId, ctx.companyId],
    );
    if (!itemRows[0]) throw badRequest('השירות אינו בקטלוג של החברה');
    // הלקוחות משותפים לכל החברות, ולכן כאן בודקים רק שהלקוח קיים
    const { rows: clientRows } = await ctx.db.query<{ id: number }>('SELECT id FROM clients WHERE id = $1', [clientId]);
    if (!clientRows[0]) throw badRequest('הלקוח לא נמצא');
    const { rows } = await ctx.db.query<{ id: number }>(
      'INSERT INTO client_items (client_id, company_id, item_id, cost, qty, created_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [clientId, ctx.companyId, itemId, cost, qty, ctx.user.id],
    );
    const created = rows[0];
    if (!created) throw badRequest('הוספת השירות ללקוח נכשלה');
    await audit(ctx, 'clientItem.create', String(created.id), { clientId, itemId, cost, qty }, req.ip);
    const fresh = await fetchClientItems(ctx, { ...EMPTY_FILTERS, clientIds: [clientId], activeOnly: false });
    const row = fresh.find((r) => r.id === created.id);
    return row ? toView(row, ctx.lang) : { id: created.id };
  });

  app.patch('/api/client-items/:id', async (req) => {
    requireRole(ctx, 'agent');
    const rowId = idOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const values: unknown[] = [rowId, ctx.companyId];
    if (b.cost !== undefined) sets.push(`cost = $${values.push(amount(b.cost, 'מחיר ללקוח'))}`);
    if (b.qty !== undefined) sets.push(`qty = $${values.push(amount(b.qty, 'כמות', 10_000))}`);
    if (b.active !== undefined) sets.push(`active = $${values.push(isTrue(b.active))}`);
    if (!sets.length) throw badRequest('אין מה לעדכן');
    sets.push(`updated_at = now()`, `updated_by = $${values.push(ctx.user.id)}`);
    const { rowCount } = await ctx.db.query(
      `UPDATE client_items SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2 AND removed_at IS NULL`,
      values,
    );
    if (!rowCount) throw notFound('השירות של הלקוח לא נמצא');
    await audit(ctx, 'clientItem.update', String(rowId), b, req.ip);
    return { ok: true };
  });

  /** הסרה רכה: נשמר מי הסיר ומתי, כדי שאפשר יהיה להסביר ירידה בהכנסה. */
  app.delete('/api/client-items/:id', async (req) => {
    requireRole(ctx, 'agent');
    const rowId = idOf(req);
    const { rowCount } = await ctx.db.query(
      'UPDATE client_items SET active = false, removed_at = now(), removed_by = $3 ' +
        'WHERE id = $1 AND company_id = $2 AND removed_at IS NULL',
      [rowId, ctx.companyId, ctx.user.id],
    );
    if (!rowCount) throw notFound('השירות של הלקוח לא נמצא');
    await audit(ctx, 'clientItem.remove', String(rowId), null, req.ip);
    return { ok: true };
  });
}
