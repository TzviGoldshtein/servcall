/**
 * הערות — שני סוגים בטבלה אחת (`notes.kind`).
 *
 * `card`   — הערת כרטיס לקוח: חלק מה-CRM המשותף לכל החברות. מה שאנחנו יודעים
 *            על הלקוח, ונשאר שם גם אחרי שהקריאה נסגרה.
 * `sticky` — פתק תזכורת מול העיניים של נציג אחד (`pinned_for`), עם `due_at`
 *            וסימון ביצוע. הוא לא ידע משותף: הוא מה שמישהו צריך לעשות.
 *
 * שני הסוגים מגיעים גם לפי לקוח וגם לפי קריאה, ועוברים דרך ה-API הזה מפני
 * שמערכת הווטסאפ מציגה ויוצרת אותם גם.
 */
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { audit } from '../context.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import { msg } from '../i18n.ts';
import { idParam, optionalId, personExpr, requireCall, requireRole, text } from './calls.ts';

type NoteKind = 'card' | 'sticky';

interface NoteRow {
  id: number;
  kind: NoteKind;
  client_id: number | null;
  call_id: number | null;
  company_id: number | null;
  author_id: number | null;
  pinned_for: number | null;
}

const kindOf = (value: unknown, fallback?: NoteKind): NoteKind => {
  if (value === 'card' || value === 'sticky') return value;
  if (fallback) return fallback;
  throw badRequest('סוג הערה לא תקין');
};

/** זמן תזכורת. undefined = לא נשלח, null = נוקה. */
const dueOf = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw badRequest('תאריך תזכורת לא תקין');
  return value;
};

const mentionsOf = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
};

const SELECT_NOTE =
  'SELECT n.id, n.kind, n.client_id AS "clientId", cl.name AS "clientName", ' +
  'n.call_id AS "callId", sc.number AS "callNumber", sc.subject AS "callSubject", ' +
  'n.company_id AS "companyId", n.body, n.author_id AS "authorId", ' +
  `${personExpr('au')} AS "authorName", n.created_at AS "createdAt", n.edited_at AS "editedAt", ` +
  `n.pinned_for AS "pinnedFor", ${personExpr('pf')} AS "pinnedForName", ` +
  'n.due_at AS "dueAt", n.done_at AS "doneAt", n.done_by AS "doneBy", ' +
  `${personExpr('db_')} AS "doneByName", n.mentions ` +
  'FROM notes n ' +
  'LEFT JOIN clients cl ON cl.id = n.client_id ' +
  'LEFT JOIN service_calls sc ON sc.id = n.call_id ' +
  'LEFT JOIN users au ON au.id = n.author_id ' +
  'LEFT JOIN users pf ON pf.id = n.pinned_for ' +
  'LEFT JOIN users db_ ON db_.id = n.done_by ';

export function registerNoteRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  /**
   * הערות לפי לקוח או לפי קריאה. הערות כרטיס משותפות לכל החברות; פתקים מוצגים
   * רק למי שהם מולו, ולמנהל.
   */
  app.get('/api/notes', async (req) => {
    const query = req.query as { clientId?: string; callId?: string; kind?: string; done?: string };
    const where: string[] = [];
    const values: unknown[] = [ctx.user.id, ctx.companyId];
    const add = (value: unknown): string => `$${values.push(value)}`;

    if (query.callId) {
      const call = await requireCall(ctx, Number(query.callId));
      where.push(`n.call_id = ${add(call.id)}`);
    } else if (query.clientId) {
      where.push(`n.client_id = ${add(Number(query.clientId))}`);
    } else {
      throw badRequest('נדרש לקוח או קריאה');
    }
    if (query.kind) where.push(`n.kind = ${add(kindOf(query.kind))}`);
    if (query.done === 'false') where.push('n.done_at IS NULL');
    // פתק הוא פרטי לנציג שהוא מולו; הערת כרטיס גלויה לכולם
    where.push("(n.kind = 'card' OR n.pinned_for = $1 OR n.author_id = $1" + (ctx.role === 'admin' ? ' OR true' : '') + ')');
    // פתק נרשם על החברה הפעילה; הערת כרטיס היא של כל הקבוצה
    where.push("(n.kind = 'card' OR n.company_id IS NULL OR n.company_id = $2)");

    const { rows } = await db.query(
      `${SELECT_NOTE} WHERE ${where.join(' AND ')} ORDER BY n.done_at NULLS FIRST, n.due_at NULLS LAST, n.created_at DESC`,
      values,
    );
    return rows;
  });

  /** הפתקים שלי שעוד לא בוצעו — מה שעומד מול העיניים של הנציג. */
  app.get('/api/notes/sticky/mine', async (req) => {
    const overdueOnly = (req.query as { overdue?: string }).overdue === 'true';
    const { rows } = await db.query(
      `${SELECT_NOTE} WHERE n.kind = 'sticky' AND n.pinned_for = $1 AND n.done_at IS NULL ` +
        'AND (n.company_id IS NULL OR n.company_id = $2) ' +
        (overdueOnly ? 'AND n.due_at IS NOT NULL AND n.due_at < now() ' : '') +
        'ORDER BY n.due_at NULLS LAST, n.created_at DESC LIMIT 200',
      [ctx.user.id, ctx.companyId],
    );
    return rows;
  });

  /**
   * הערה חדשה. `sticky` חייב נציג שהפתק מולו — ברירת המחדל היא אני עצמי;
   * `card` נשמר ללא חברה, כי כרטיס הלקוח משותף לכל הקבוצה.
   */
  app.post('/api/notes', async (req) => {
    requireRole(ctx, 'opener');
    const body = req.body as Record<string, unknown>;
    const kind = kindOf(body.kind, 'card');
    const content = text(body.body, 'תוכן ההערה', 10_000);
    let clientId = optionalId(body.clientId, 'לקוח') ?? null;
    let callId = optionalId(body.callId, 'קריאה') ?? null;
    if (callId) {
      const call = await requireCall(ctx, callId);
      callId = call.id;
      // פתק על קריאה נושא גם את הלקוח שלה, כדי שיימצא מכרטיס הלקוח
      clientId = clientId ?? call.clientId;
    }
    if (!clientId && !callId) throw badRequest('הערה חייבת להיות על לקוח או על קריאה');

    const pinnedFor = kind === 'sticky' ? (optionalId(body.pinnedFor, 'נציג') ?? ctx.user.id) : null;
    if (pinnedFor && pinnedFor !== ctx.user.id) await assertSameCompany(ctx, pinnedFor);
    const dueAt = kind === 'sticky' ? (dueOf(body.dueAt) ?? null) : null;

    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO notes (kind, client_id, call_id, company_id, body, author_id, pinned_for, due_at, mentions) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [
        kind,
        clientId,
        callId,
        // הערת כרטיס היא של כל הקבוצה; פתק נרשם על החברה הפעילה
        kind === 'card' ? null : ctx.companyId,
        content,
        ctx.user.id,
        pinnedFor,
        dueAt,
        mentionsOf(body.mentions),
      ],
    );
    await audit(ctx, 'note.create', String(rows[0]!.id), { kind, clientId, callId, pinnedFor });
    return { id: rows[0]!.id };
  });

  /** עריכת הערה: הכותב, מי שהפתק מולו, או מנהל. */
  app.patch('/api/notes/:id', async (req) => {
    const note = await requireNote(ctx, idParam(req));
    assertMayEdit(ctx, note);
    const body = req.body as Record<string, unknown>;
    const pinnedFor = note.kind === 'sticky' ? optionalId(body.pinnedFor, 'נציג') : undefined;
    if (pinnedFor) await assertSameCompany(ctx, pinnedFor);
    const dueAt = note.kind === 'sticky' ? dueOf(body.dueAt) : undefined;

    await db.query(
      'UPDATE notes SET body = coalesce($2, body), ' +
        'pinned_for = CASE WHEN $3 THEN coalesce($4::int, pinned_for) ELSE pinned_for END, ' +
        'due_at = CASE WHEN $5 THEN $6::timestamptz ELSE due_at END, ' +
        'mentions = CASE WHEN $7 THEN $8::int[] ELSE mentions END, ' +
        'edited_at = now() WHERE id = $1',
      [
        note.id,
        body.body === undefined ? null : text(body.body, 'תוכן ההערה', 10_000),
        pinnedFor !== undefined,
        pinnedFor ?? null,
        dueAt !== undefined,
        dueAt ?? null,
        Array.isArray(body.mentions),
        mentionsOf(body.mentions),
      ],
    );
    await audit(ctx, 'note.edit', String(note.id), { kind: note.kind });
    return { ok: true };
  });

  /** סימון פתק כבוצע, או ביטול הסימון (`done: false`). */
  app.post('/api/notes/:id/done', async (req) => {
    const note = await requireNote(ctx, idParam(req));
    if (note.kind !== 'sticky') throw badRequest('סימון ביצוע הוא לפתקים בלבד');
    assertMayEdit(ctx, note);
    const done = (req.body as { done?: unknown }).done !== false;
    await db.query(
      'UPDATE notes SET done_at = CASE WHEN $2 THEN now() END, done_by = CASE WHEN $2 THEN $3::int END ' +
        'WHERE id = $1',
      [note.id, done, ctx.user.id],
    );
    await audit(ctx, done ? 'note.done' : 'note.undone', String(note.id));
    return { ok: true, done };
  });

  /** מחיקת הערה: הכותב או מנהל. הערת כרטיס היא ידע משותף — עדיף לתקן אותה. */
  app.delete('/api/notes/:id', async (req) => {
    const note = await requireNote(ctx, idParam(req));
    if (note.author_id !== ctx.user.id && note.pinned_for !== ctx.user.id && ctx.role !== 'admin') {
      throw forbidden(msg('forbidden', ctx.lang));
    }
    if (note.kind === 'card' && ctx.role !== 'admin' && note.author_id !== ctx.user.id) {
      throw forbidden('הערת כרטיס נמחקת על ידי הכותב או מנהל');
    }
    await db.query('DELETE FROM notes WHERE id = $1', [note.id]);
    await audit(ctx, 'note.delete', String(note.id), { kind: note.kind });
    return { ok: true };
  });
}

async function requireNote(ctx: Ctx, id: number): Promise<NoteRow> {
  const { rows } = await ctx.db.query<NoteRow>(
    'SELECT id, kind, client_id, call_id, company_id, author_id, pinned_for FROM notes WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  // פתק של חברה אחרת לא נראה מכאן; הערת כרטיס משותפת לכל הקבוצה
  if (row.kind === 'sticky' && row.company_id !== null && row.company_id !== ctx.companyId) {
    throw notFound(msg('notFound', ctx.lang));
  }
  if (row.call_id !== null) await requireCall(ctx, row.call_id);
  return row;
}

function assertMayEdit(ctx: Ctx, note: NoteRow): void {
  if (note.author_id === ctx.user.id || note.pinned_for === ctx.user.id || ctx.role === 'admin') return;
  throw forbidden(msg('forbidden', ctx.lang));
}

/** פתק מוצמד רק לנציג שמשויך לחברה הפעילה. */
async function assertSameCompany(ctx: Ctx, userId: number): Promise<void> {
  const { rows } = await ctx.db.query<{ user_id: number }>(
    'SELECT user_id FROM user_companies WHERE user_id = $1 AND company_id = $2 AND active',
    [userId, ctx.companyId],
  );
  if (!rows[0]) throw badRequest('הנציג אינו משויך לחברה הפעילה');
}
