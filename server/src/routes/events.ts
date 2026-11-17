/**
 * יומן האירועים של הקריאה.
 *
 * שני סוגי רשומות גרות כאן יחד: הערה של נציג (`kind = 'note'`) ואירוע שהמערכת
 * כתבה בעצמה (`kind = 'system'`) — תאור הפתיחה, שינוי גורם מטפל, חתימה, העברה
 * לחברה אחרת. הממשק מציג אותם אחרת, ולכן השרת לא מאחד אותם: נציג לא יכול לכתוב
 * אירוע מערכת ולא לערוך אותו.
 *
 * הכפתור "שמור אירוע וסגור קריאה" הוא אותו POST עם `close: true`.
 */
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { audit } from '../context.ts';
import { HttpError, forbidden, notFound } from '../errors.ts';
import { msg } from '../i18n.ts';
import {
  closeCall,
  idParam,
  notifyCall,
  personExpr,
  requireCall,
  requireRole,
  text,
  withDb,
  type Live,
} from './calls.ts';

interface EventRow {
  id: number;
  call_id: number;
  kind: string;
  created_by: number | null;
}

export function registerEventRoutes(app: FastifyInstance, ctx: Ctx, hub: Live): void {
  const { db } = ctx;

  app.get('/api/calls/:id/events', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const { rows } = await db.query(
      'SELECT ce.id, ce.body, ce.kind, ce.created_at AS "createdAt", ce.created_by AS "createdBy", ' +
        `${personExpr('u')} AS "createdByName", ce.emailed_to AS "emailedTo", ` +
        'ce.wa_message_id AS "waMessageId" ' +
        'FROM call_events ce LEFT JOIN users u ON u.id = ce.created_by ' +
        'WHERE ce.call_id = $1 ORDER BY ce.created_at, ce.id',
      [call.id],
    );
    return rows;
  });

  /**
   * הערה חדשה. `close: true` מעביר את הקריאה ל-defaultStatusClose ורושם מי סגר
   * ומתי — זה הכפתור "שמור אירוע וסגור קריאה" שבטופס.
   */
  app.post('/api/calls/:id/events', async (req) => {
    requireRole(ctx, 'opener');
    const call = await requireCall(ctx, idParam(req));
    const body = req.body as { body?: unknown; close?: unknown };
    const content = text(body.body, 'תאור האירוע', 20_000);
    const close = body.close === true;

    const saved = await db.tx(async (tx) => {
      const txCtx = withDb(ctx, tx);
      const { rows } = await tx.query<{ id: number }>(
        "INSERT INTO call_events (call_id, body, kind, created_by) VALUES ($1, $2, 'note', $3) RETURNING id",
        [call.id, content, ctx.user.id],
      );
      await tx.query('UPDATE service_calls SET updated_at = now(), updated_by = $2 WHERE id = $1', [
        call.id,
        ctx.user.id,
      ]);
      if (close) {
        requireRole(ctx, 'agent');
        await closeCall(txCtx, call);
      }
      await audit(txCtx, 'call.event.add', String(call.id), { eventId: rows[0]!.id, close });
      return { id: rows[0]!.id, closed: close };
    });
    await notifyCall(db, hub, call.id, close ? 'closed' : 'event');
    return saved;
  });

  /** עריכת הערה: הכותב עצמו או מנהל. אירוע מערכת הוא תיעוד ואינו נערך. */
  app.patch('/api/calls/:id/events/:eventId', async (req) => {
    requireRole(ctx, 'opener');
    const call = await requireCall(ctx, idParam(req));
    const event = await requireEvent(ctx, call.id, idParam(req, 'eventId'));
    if (event.kind !== 'note') throw forbidden('אירוע מערכת אינו נערך');
    if (event.created_by !== ctx.user.id && ctx.role !== 'admin') {
      throw forbidden(msg('forbidden', ctx.lang));
    }
    const content = text((req.body as { body?: unknown }).body, 'תאור האירוע', 20_000);
    await db.query('UPDATE call_events SET body = $2 WHERE id = $1', [event.id, content]);
    await audit(ctx, 'call.event.edit', String(call.id), { eventId: event.id });
    await notifyCall(db, hub, call.id, 'event');
    return { ok: true };
  });

  /**
   * מחיקת הערה. עדיף לתקן את ההערה מלמחוק אותה — ולכן למנהל בלבד, ורק עם
   * אישור מפורש. אירוע מערכת לא נמחק בכלל: הוא התיעוד של מה שקרה.
   */
  app.delete('/api/calls/:id/events/:eventId', async (req) => {
    requireRole(ctx, 'admin');
    const call = await requireCall(ctx, idParam(req));
    const event = await requireEvent(ctx, call.id, idParam(req, 'eventId'));
    if (event.kind !== 'note') throw forbidden('אירוע מערכת אינו נמחק');
    if ((req.query as { confirm?: string }).confirm !== 'yes') {
      throw new HttpError(409, 'אשרו את מחיקת האירוע');
    }
    await db.query('DELETE FROM call_events WHERE id = $1', [event.id]);
    await audit(ctx, 'call.event.delete', String(call.id), { eventId: event.id });
    await notifyCall(db, hub, call.id, 'event');
    return { ok: true };
  });
}

async function requireEvent(ctx: Ctx, callId: number, eventId: number): Promise<EventRow> {
  const { rows } = await ctx.db.query<EventRow>(
    'SELECT id, call_id, kind, created_by FROM call_events WHERE id = $1 AND call_id = $2',
    [eventId, callId],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  return row;
}
