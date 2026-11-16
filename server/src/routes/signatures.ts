/**
 * חתימת הלקוח — הטאב "חתימה".
 *
 * הדפדפן שולח את הציור מהקנבס כ-data URL של PNG; השרת פורס אותו, שומר קובץ
 * תחת `MEDIA_DIR/signatures/<חברה>/<קריאה>/` ורושם שורה ב-call_signatures.
 * נוסח האישור ברירת המחדל מגיע מהפרמטר `signatureDefaultText` של החברה.
 *
 * חתימה היא תיעוד: היא לא נערכת, והמחיקה שלה למנהל בלבד ועם אישור מפורש.
 */
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Ctx } from '../context.ts';
import { audit } from '../context.ts';
import { HttpError, badRequest, notFound } from '../errors.ts';
import { msg } from '../i18n.ts';
import {
  idParam,
  loadParams,
  optionalText,
  requireCall,
  requireRole,
  systemEvent,
  text,
  withDb,
} from './calls.ts';

interface SignatureRow {
  id: number;
  call_id: number;
  image_path: string;
  signer_name: string;
}

/** גודל מקסימלי לציור חתימה. קנבס של טאבלט מגיע לכמה מאות קילובייט. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** פורס data URL של PNG לבייטים. כל פורמט אחר נדחה — לא מקבלים SVG לכאן. */
function decodeSignature(value: unknown): Buffer {
  const raw = text(value, 'חתימה', 4 * 1024 * 1024);
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
  if (!match) throw badRequest('החתימה אינה תמונת PNG תקינה');
  const bytes = Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64');
  if (!bytes.length) throw badRequest('החתימה ריקה');
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'קובץ החתימה גדול מדי');
  return bytes;
}

export function registerSignatureRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  app.get('/api/calls/:id/signatures', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const params = await loadParams(db, call.companyId);
    const { rows } = await db.query(
      'SELECT id, description, signer_name AS "signerName", remarks, signed_at AS "signedAt" ' +
        'FROM call_signatures WHERE call_id = $1 ORDER BY signed_at DESC, id DESC',
      [call.id],
    );
    return { rows, defaultText: params.signatureDefaultText };
  });

  /** שמירת חתימה. נרשם גם אירוע מערכת, כדי שיישאר ביומן מי חתם ומתי. */
  app.post('/api/calls/:id/signatures', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const body = req.body as Record<string, unknown>;
    const params = await loadParams(db, call.companyId);
    const signerName = text(body.signerName, 'שם החותם', 200);
    const description = optionalText(body.description, 'תאור', 500) ?? params.signatureDefaultText;
    const bytes = decodeSignature(body.image);

    const folder = join('signatures', String(call.companyId), String(call.id));
    await mkdir(join(config.mediaDir, folder), { recursive: true });
    const relative = join(folder, `${randomUUID()}.png`);
    await writeFile(join(config.mediaDir, relative), bytes);

    return db.tx(async (tx) => {
      const txCtx = withDb(ctx, tx);
      const { rows } = await tx.query<{ id: number }>(
        'INSERT INTO call_signatures (call_id, description, signer_name, remarks, image_path) ' +
          'VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [call.id, description, signerName, optionalText(body.remarks, 'הערות', 2000), relative],
      );
      await systemEvent(tx, call.id, `נחתמה חתימת לקוח על ידי: ${signerName}`, ctx.user.id);
      await tx.query('UPDATE service_calls SET updated_at = now(), updated_by = $2 WHERE id = $1', [
        call.id,
        ctx.user.id,
      ]);
      await audit(txCtx, 'call.signature.add', String(call.id), { signatureId: rows[0]!.id, signerName });
      return { id: rows[0]!.id };
    });
  });

  app.get('/api/calls/:id/signatures/:signatureId/image', async (req, reply) => {
    const call = await requireCall(ctx, idParam(req));
    const row = await requireSignature(ctx, call.id, idParam(req, 'signatureId'));
    const absolute = join(config.mediaDir, row.image_path);
    const info = await stat(absolute).catch(() => undefined);
    if (!info?.isFile()) throw notFound('קובץ החתימה לא נמצא בשרת');
    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=86400')
      .header('Content-Length', info.size)
      .type('image/png')
      .send(createReadStream(absolute));
  });

  /** מחיקת חתימה: למנהל, ועם אישור מפורש. */
  app.delete('/api/calls/:id/signatures/:signatureId', async (req) => {
    requireRole(ctx, 'admin');
    const call = await requireCall(ctx, idParam(req));
    const row = await requireSignature(ctx, call.id, idParam(req, 'signatureId'));
    if ((req.query as { confirm?: string }).confirm !== 'yes') {
      throw new HttpError(409, 'אשרו את מחיקת החתימה');
    }
    await db.query('DELETE FROM call_signatures WHERE id = $1', [row.id]);
    await rm(join(config.mediaDir, row.image_path), { force: true });
    await audit(ctx, 'call.signature.delete', String(call.id), { signatureId: row.id });
    return { ok: true };
  });
}

async function requireSignature(ctx: Ctx, callId: number, signatureId: number): Promise<SignatureRow> {
  const { rows } = await ctx.db.query<SignatureRow>(
    'SELECT id, call_id, image_path, signer_name FROM call_signatures WHERE id = $1 AND call_id = $2',
    [signatureId, callId],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  return row;
}
