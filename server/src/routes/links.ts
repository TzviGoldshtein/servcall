/**
 * העברת עבודה בין חברות הקבוצה.
 *
 * שתי צורות, ו-`call_links.kind` מבדיל ביניהן:
 *
 * `child`   — נפתחת קריאה חדשה ונפרדת בחברה המקבלת, עם מספר משלה מהרצף שלה,
 *             שעות וחיוב משלה. הקריאה המקורית נשארת פתוחה ומקושרת. זו ברירת
 *             המחדל, כי כל חברה מחייבת בנפרד.
 * `shared`  — קריאה אחת ששתי החברות רואות ומעדכנות. אין קריאה שנייה; השעות
 *             נושאות את החברה המדווחת (ראה hours.ts).
 * `transfer`— קריאת בת, ובנוסף סגירת האב. העבודה עברה הלאה.
 *
 * הצד המקבל רואה באנר עם שם החברה המקורית והסיבה, ואת אירועי קריאת האב
 * לקריאה בלבד. `relay_allowed` מאפשר לו *לבקש* שהודעה תועבר ללקוח — הבקשה
 * הולכת לנציג של החברה המקורית לאישור, ולא נשלחת מעצמה לעולם.
 */
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import { audit } from '../context.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import { msg } from '../i18n.ts';
import {
  closeCall,
  createCall,
  idParam,
  loadParams,
  nameExpr,
  optionalId,
  optionalText,
  personExpr,
  requireCall,
  requireRole,
  systemEvent,
  text,
  withDb,
  type CallRecord,
} from './calls.ts';

const KINDS = new Set(['child', 'shared', 'transfer']);

interface LinkRow {
  id: number;
  parent_call_id: number;
  child_call_id: number | null;
  kind: string;
  to_company_id: number;
  relay_allowed: boolean;
  reason: string | null;
  parent_company_id: number;
}

interface RelayRow {
  id: number;
  link_id: number;
  call_id: number;
  from_company_id: number;
  status: string;
  body: string;
  channel: string;
  parent_call_id: number;
  parent_company_id: number;
  to_company_id: number;
  relay_allowed: boolean;
}

/** קישור שאחד הצדדים שלו הוא החברה הפעילה. */
async function requireLink(ctx: Ctx, linkId: number): Promise<LinkRow> {
  const { rows } = await ctx.db.query<LinkRow>(
    'SELECT kl.id, kl.parent_call_id, kl.child_call_id, kl.kind, kl.to_company_id, kl.relay_allowed, ' +
      'kl.reason, p.company_id AS parent_company_id ' +
      'FROM call_links kl JOIN service_calls p ON p.id = kl.parent_call_id WHERE kl.id = $1',
    [linkId],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  if (row.parent_company_id !== ctx.companyId && row.to_company_id !== ctx.companyId) {
    throw forbidden(msg('forbidden', ctx.lang));
  }
  return row;
}

const companyName = async (ctx: Ctx, companyId: number): Promise<string> => {
  const { rows } = await ctx.db.query<{ name: string }>(
    `SELECT ${nameExpr('c', '$2')} AS name FROM companies c WHERE c.id = $1`,
    [companyId, ctx.lang],
  );
  return rows[0]?.name ?? String(companyId);
};

export function registerLinkRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  /**
   * החברות שאפשר להעביר אליהן, ולכל אחת שדות החובה וטבלאות הקוד שלה — כדי
   * שדיאלוג ההעברה ישאל מראש בדיוק את מה שהחברה המקבלת דורשת.
   */
  app.get('/api/calls/:id/links/targets', async (req) => {
    await requireCall(ctx, idParam(req));
    const { rows } = await db.query<{ id: number; code: string; name: string }>(
      `SELECT id, code, ${nameExpr('companies', '$2')} AS name FROM companies ` +
        'WHERE active AND id <> $1 ORDER BY id',
      [ctx.companyId, ctx.lang],
    );
    const targets = [];
    for (const company of rows) {
      const params = await loadParams(db, company.id);
      const lookups = await db.query(
        `SELECT id, kind, ${nameExpr('l', '$1')} AS name, sort, minutes, std_hours AS "stdHours" ` +
          'FROM lookups l WHERE (company_id IS NULL OR company_id = $2) AND active ' +
          "AND kind IN ('call_type','call_status','billing_status','duration') ORDER BY kind, sort, id",
        [ctx.lang, company.id],
      );
      const agents = await db.query(
        `SELECT u.id, ${personExpr('u')} AS name FROM users u ` +
          'JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = $1 ' +
          'WHERE u.active AND uc.active ORDER BY u.first_name',
        [company.id],
      );
      targets.push({ ...company, params, lookups: lookups.rows, agents: agents.rows });
    }
    return targets;
  });

  /** הקישורים של הקריאה — גם היוצאים (היא האב) וגם הנכנס (היא הבת). */
  app.get('/api/calls/:id/links', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const { rows } = await db.query(
      'SELECT kl.id, kl.kind, kl.reason, kl.relay_allowed AS "relayAllowed", ' +
        'kl.created_at AS "createdAt", kl.accepted_at AS "acceptedAt", ' +
        `${personExpr('cu')} AS "createdByName", ${personExpr('au')} AS "acceptedByName", ` +
        'kl.parent_call_id AS "parentCallId", p.number AS "parentNumber", p.subject AS "parentSubject", ' +
        `p.company_id AS "parentCompanyId", ${nameExpr('pc', '$2')} AS "parentCompanyName", ` +
        'kl.child_call_id AS "childCallId", c.number AS "childNumber", ' +
        `kl.to_company_id AS "toCompanyId", ${nameExpr('tc', '$2')} AS "toCompanyName", ` +
        '(kl.parent_call_id = $1) AS outgoing, ' +
        '(SELECT count(*) FROM call_relay_requests rr ' +
        "  WHERE rr.link_id = kl.id AND rr.status = 'pending') AS \"pendingRelays\" " +
        'FROM call_links kl ' +
        'JOIN service_calls p ON p.id = kl.parent_call_id ' +
        'JOIN companies pc ON pc.id = p.company_id ' +
        'JOIN companies tc ON tc.id = kl.to_company_id ' +
        'LEFT JOIN service_calls c ON c.id = kl.child_call_id ' +
        'LEFT JOIN users cu ON cu.id = kl.created_by ' +
        'LEFT JOIN users au ON au.id = kl.accepted_by ' +
        'WHERE kl.parent_call_id = $1 OR kl.child_call_id = $1 ORDER BY kl.created_at',
      [call.id, ctx.lang],
    );
    return rows;
  });

  /**
   * שליחת עבודה לחברה אחרת. ב-child וב-transfer נפתחת קריאה בחברה המקבלת עם
   * מספר מהרצף שלה — הכל בטרנזקציה אחת עם הקישור, כך שלא נשאר קישור בלי קריאה.
   */
  app.post('/api/calls/:id/links', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    if (call.shared) throw forbidden('רק החברה שפתחה את הקריאה שולחת אותה הלאה');
    const body = req.body as Record<string, unknown>;
    const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'child';
    const toCompanyId = optionalId(body.toCompanyId, 'חברה מקבלת');
    if (!toCompanyId) throw badRequest('חסר שדה: חברה מקבלת');
    if (toCompanyId === call.companyId) throw badRequest('אי אפשר להעביר קריאה לחברה של עצמה');
    const { rows: target } = await db.query<{ id: number }>(
      'SELECT id FROM companies WHERE id = $1 AND active',
      [toCompanyId],
    );
    if (!target[0]) throw badRequest('החברה המקבלת אינה פעילה');
    const reason = optionalText(body.reason, 'סיבת ההעברה', 2000);
    const relayAllowed = body.relayAllowed === true;

    return db.tx(async (tx) => {
      const txCtx = withDb(ctx, tx);
      let child: CallRecord | null = null;
      if (kind !== 'shared') {
        // קריאת בת: מספר, שעות וחיוב משלה בחברה המקבלת
        child = await createCall(
          txCtx,
          toCompanyId,
          {
            clientId: call.clientId,
            contactId: call.contactId,
            ownerUserId: optionalId(body.ownerUserId, 'גורם מטפל') ?? null,
            subject: optionalText(body.subject, 'נושא', 500) ?? call.subject,
            details: optionalText(body.details, 'תאור', 20_000) ?? reason ?? call.details,
            typeId: optionalId(body.typeId, 'סוג קריאה') ?? null,
            statusId: optionalId(body.statusId, 'סטטוס') ?? null,
            billingStatusId: optionalId(body.billingStatusId, 'סטטוס חיוב') ?? null,
            durationId: optionalId(body.durationId, 'משך טיפול') ?? null,
          },
          'web',
        );
      }
      const { rows } = await tx.query<{ id: number }>(
        'INSERT INTO call_links (parent_call_id, child_call_id, kind, to_company_id, relay_allowed, reason, ' +
          'created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [call.id, child?.id ?? null, kind, toCompanyId, relayAllowed, reason, ctx.user.id],
      );
      const linkId = rows[0]!.id;
      const toName = await companyName(txCtx, toCompanyId);
      const fromName = await companyName(txCtx, call.companyId);

      if (kind === 'shared') {
        await systemEvent(tx, call.id, `הקריאה שותפה עם חברת ${toName}${reason ? `. סיבה: ${reason}` : ''}`, ctx.user.id);
      } else {
        await systemEvent(
          tx,
          call.id,
          `נשלחה עבודה לחברת ${toName} (קריאה ${child!.number})${reason ? `. סיבה: ${reason}` : ''}`,
          ctx.user.id,
        );
        await systemEvent(
          tx,
          child!.id,
          `הקריאה נפתחה מהעברת עבודה מחברת ${fromName}, קריאה ${call.number}${reason ? `. סיבה: ${reason}` : ''}`,
          ctx.user.id,
        );
      }
      // העברה = קריאת בת, ועוד סגירת האב
      if (kind === 'transfer') await closeCall(txCtx, call);
      await audit(txCtx, 'call.link.create', String(call.id), { linkId, kind, toCompanyId, childId: child?.id });
      return { id: linkId, kind, childCallId: child?.id ?? null, childNumber: child?.number ?? null };
    });
  });

  /** הצד המקבל מאשר שהוא לוקח את העבודה. */
  app.post('/api/calls/:id/links/:linkId/accept', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const link = await requireLink(ctx, idParam(req, 'linkId'));
    if (link.to_company_id !== ctx.companyId) throw forbidden('רק החברה המקבלת מאשרת את ההעברה');
    await db.query(
      'UPDATE call_links SET accepted_by = $2, accepted_at = coalesce(accepted_at, now()) WHERE id = $1',
      [link.id, ctx.user.id],
    );
    await systemEvent(db, call.id, 'ההעברה אושרה על ידי החברה המקבלת', ctx.user.id);
    await audit(ctx, 'call.link.accept', String(call.id), { linkId: link.id });
    return { ok: true };
  });

  /**
   * הבאנר של הצד המקבל: שם החברה המקורית, הסיבה, והאירועים של קריאת האב
   * לקריאה בלבד. בקריאה משותפת אין אב נפרד — מוחזר הקישור עצמו.
   */
  app.get('/api/calls/:id/origin', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const { rows } = await db.query<{
      linkId: number;
      kind: string;
      reason: string | null;
      relayAllowed: boolean;
      acceptedAt: string | null;
      parentCallId: number;
      parentNumber: number;
      parentSubject: string;
      fromCompanyId: number;
      fromCompanyName: string;
    }>(
      'SELECT kl.id AS "linkId", kl.kind, kl.reason, kl.relay_allowed AS "relayAllowed", ' +
        'kl.accepted_at AS "acceptedAt", p.id AS "parentCallId", p.number AS "parentNumber", ' +
        `p.subject AS "parentSubject", p.company_id AS "fromCompanyId", ${nameExpr('pc', '$3')} AS "fromCompanyName" ` +
        'FROM call_links kl ' +
        'JOIN service_calls p ON p.id = kl.parent_call_id ' +
        'JOIN companies pc ON pc.id = p.company_id ' +
        'WHERE kl.to_company_id = $2 AND (kl.child_call_id = $1 OR (kl.kind = \'shared\' AND kl.parent_call_id = $1)) ' +
        'ORDER BY kl.created_at LIMIT 1',
      [call.id, ctx.companyId, ctx.lang],
    );
    const origin = rows[0];
    if (!origin) return null;
    // אירועי האב, לקריאה בלבד — הצד המקבל רואה מה קרה אצל הלקוח ולא נוגע בהם
    const events = await db.query(
      'SELECT ce.id, ce.body, ce.kind, ce.created_at AS "createdAt", ' +
        `${personExpr('u')} AS "createdByName" ` +
        'FROM call_events ce LEFT JOIN users u ON u.id = ce.created_by ' +
        'WHERE ce.call_id = $1 ORDER BY ce.created_at, ce.id',
      [origin.parentCallId],
    );
    return { ...origin, parentEvents: events.rows };
  });

  /** הבקשות להעברת הודעה ללקוח על הקריאה הזו, לשני הצדדים. */
  app.get('/api/calls/:id/relay-requests', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const { rows } = await db.query(
      'SELECT rr.id, rr.body, rr.channel, rr.status, rr.requested_at AS "requestedAt", ' +
        `${personExpr('ru')} AS "requestedByName", ${nameExpr('fc', '$2')} AS "fromCompanyName", ` +
        'rr.decided_at AS "decidedAt", ' +
        `${personExpr('du')} AS "decidedByName", rr.decision_note AS "decisionNote" ` +
        'FROM call_relay_requests rr ' +
        'JOIN companies fc ON fc.id = rr.from_company_id ' +
        'LEFT JOIN users ru ON ru.id = rr.requested_by ' +
        'LEFT JOIN users du ON du.id = rr.decided_by ' +
        'JOIN call_links kl ON kl.id = rr.link_id ' +
        'WHERE rr.call_id = $1 OR kl.parent_call_id = $1 ORDER BY rr.requested_at DESC',
      [call.id, ctx.lang],
    );
    return rows;
  });

  /**
   * החברה המקבלת מבקשת שהודעה תועבר ללקוח. הבקשה נרשמת כממתינה ועולה אצל
   * נציג של החברה המקורית. שום הודעה לא יוצאת כאן.
   */
  app.post('/api/calls/:id/relay-requests', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const body = req.body as Record<string, unknown>;
    const link = await requireLink(ctx, optionalId(body.linkId, 'קישור') ?? 0);
    if (link.to_company_id !== ctx.companyId) throw forbidden('רק החברה המקבלת מבקשת העברת הודעה');
    if (!link.relay_allowed) throw forbidden('הקישור אינו מאפשר העברת הודעות ללקוח');
    const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const message = text(body.body, 'ההודעה ללקוח', 4000);
    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO call_relay_requests (link_id, call_id, from_company_id, body, channel, requested_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [link.id, call.id, ctx.companyId, message, channel, ctx.user.id],
    );
    await systemEvent(
      db,
      link.parent_call_id,
      `התקבלה בקשה להעברת הודעה ללקוח מחברת ${await companyName(ctx, ctx.companyId)}: ${message}`,
      ctx.user.id,
    );
    await audit(ctx, 'call.relay.request', String(call.id), { requestId: rows[0]!.id, linkId: link.id, channel });
    return { id: rows[0]!.id, status: 'pending' };
  });

  /** מה שממתין לאישור של החברה הפעילה — התיבה של הנציג בחברה המקורית. */
  app.get('/api/relay-requests/pending', async () => {
    const { rows } = await db.query(
      'SELECT rr.id, rr.body, rr.channel, rr.requested_at AS "requestedAt", ' +
        `${personExpr('ru')} AS "requestedByName", ${nameExpr('fc', '$2')} AS "fromCompanyName", ` +
        'p.id AS "parentCallId", p.number AS "parentNumber", p.subject AS "parentSubject", ' +
        'cl.name AS "clientName" ' +
        'FROM call_relay_requests rr ' +
        'JOIN call_links kl ON kl.id = rr.link_id ' +
        'JOIN service_calls p ON p.id = kl.parent_call_id ' +
        'JOIN clients cl ON cl.id = p.client_id ' +
        'JOIN companies fc ON fc.id = rr.from_company_id ' +
        'LEFT JOIN users ru ON ru.id = rr.requested_by ' +
        "WHERE rr.status = 'pending' AND p.company_id = $1 ORDER BY rr.requested_at",
      [ctx.companyId, ctx.lang],
    );
    return rows;
  });

  /**
   * נציג של החברה המקורית מאשר את ההעברה ללקוח. רק האישור מכניס שורה ל-outbox,
   * ואם ההתראות ללקוח כבויות השורה נרשמת כחסומה — כך רואים שהבקשה אושרה
   * ובכל זאת לא יצאה הודעה.
   */
  app.post('/api/relay-requests/:requestId/approve', async (req) => {
    requireRole(ctx, 'agent');
    const request = await requireRelay(ctx, idParam(req, 'requestId'));
    if (request.parent_company_id !== ctx.companyId) throw forbidden('האישור הוא של החברה המקורית');
    if (request.status !== 'pending') throw badRequest('הבקשה כבר טופלה');
    const note = optionalText((req.body as { note?: unknown }).note, 'הערה', 2000);

    return db.tx(async (tx) => {
      const txCtx = withDb(ctx, tx);
      const { rows } = await tx.query<{ address: string | null; allowed: boolean }>(
        'SELECT CASE WHEN $2 = \'whatsapp\' THEN coalesce(ct.mobile_e164, ct.mobile, cl.mobile) ' +
          '  ELSE coalesce(ct.email, uc.recipients_email) END AS address, ' +
          'coalesce((SELECT CASE WHEN $2 = \'whatsapp\' THEN np.whatsapp ELSE np.email END FROM notify_prefs np ' +
          '  WHERE np.company_id = p.company_id AND np.client_id = p.client_id), ' +
          ' (SELECT CASE WHEN $2 = \'whatsapp\' THEN np.whatsapp ELSE np.email END FROM notify_prefs np ' +
          '  WHERE np.company_id = p.company_id AND np.client_id IS NULL), false) AS allowed ' +
          'FROM service_calls p ' +
          'JOIN clients cl ON cl.id = p.client_id ' +
          'LEFT JOIN contacts ct ON ct.id = p.contact_id ' +
          'LEFT JOIN user_companies uc ON uc.user_id = p.owner_user_id AND uc.company_id = p.company_id ' +
          'WHERE p.id = $1',
        [request.parent_call_id, request.channel],
      );
      const address = rows[0]?.address ?? null;
      const allowed = rows[0]?.allowed === true;
      let outboxId: number | null = null;
      if (address) {
        const queued = await tx.query<{ id: number }>(
          'INSERT INTO outbox (company_id, channel, call_id, to_address, subject, body, status) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [
            ctx.companyId,
            request.channel,
            request.parent_call_id,
            address,
            'עדכון בקריאת שירות',
            request.body,
            allowed ? 'pending' : 'blocked',
          ],
        );
        outboxId = queued.rows[0]!.id;
      }
      await tx.query(
        "UPDATE call_relay_requests SET status = 'approved', decided_by = $2, decided_at = now(), " +
          'decision_note = $3, outbox_id = $4 WHERE id = $1',
        [request.id, ctx.user.id, note, outboxId],
      );
      await systemEvent(tx, request.parent_call_id, `בקשת העברת הודעה ללקוח אושרה: ${request.body}`, ctx.user.id);
      await systemEvent(tx, request.call_id, 'בקשת העברת ההודעה ללקוח אושרה בחברה המקורית', ctx.user.id);
      await audit(txCtx, 'call.relay.approve', String(request.parent_call_id), {
        requestId: request.id,
        outboxId,
        blocked: !allowed,
      });
      return { ok: true, queued: outboxId !== null, blocked: outboxId !== null && !allowed };
    });
  });

  app.post('/api/relay-requests/:requestId/reject', async (req) => {
    requireRole(ctx, 'agent');
    const request = await requireRelay(ctx, idParam(req, 'requestId'));
    if (request.parent_company_id !== ctx.companyId) throw forbidden('הדחייה היא של החברה המקורית');
    if (request.status !== 'pending') throw badRequest('הבקשה כבר טופלה');
    const note = optionalText((req.body as { note?: unknown }).note, 'הערה', 2000);
    await db.query(
      "UPDATE call_relay_requests SET status = 'rejected', decided_by = $2, decided_at = now(), " +
        'decision_note = $3 WHERE id = $1',
      [request.id, ctx.user.id, note],
    );
    await systemEvent(
      db,
      request.call_id,
      `בקשת העברת ההודעה ללקוח נדחתה${note ? `: ${note}` : ''}`,
      ctx.user.id,
    );
    await audit(ctx, 'call.relay.reject', String(request.parent_call_id), { requestId: request.id });
    return { ok: true };
  });
}

async function requireRelay(ctx: Ctx, requestId: number): Promise<RelayRow> {
  const { rows } = await ctx.db.query<RelayRow>(
    'SELECT rr.id, rr.link_id, rr.call_id, rr.from_company_id, rr.status, rr.body, rr.channel, ' +
      'kl.parent_call_id, kl.to_company_id, kl.relay_allowed, p.company_id AS parent_company_id ' +
      'FROM call_relay_requests rr ' +
      'JOIN call_links kl ON kl.id = rr.link_id ' +
      'JOIN service_calls p ON p.id = kl.parent_call_id ' +
      'WHERE rr.id = $1',
    [requestId],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  if (row.parent_company_id !== ctx.companyId && row.from_company_id !== ctx.companyId) {
    throw forbidden(msg('forbidden', ctx.lang));
  }
  return row;
}
