/**
 * מסמכים על קריאה — הטאב "מסמכים".
 *
 * הקבצים נשמרים על הדיסק תחת `MEDIA_DIR/calls/<חברה>/<קריאה>/`, ובמסד נשמר
 * הנתיב היחסי בלבד, כך שאפשר להזיז את התיקייה. הורדה חוזרת עם ה-mime ששמור
 * ועם nosniff: קובץ שהגיע מלקוח לא ירוץ כסקריפט במקור שלנו.
 *
 * מחיקה אינה הדרך: ברירת המחדל היא כיבוי (`active = false`), והקובץ נמחק
 * מהדיסק רק כשמנהל מבקש זאת במפורש.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Multipart } from '@fastify/multipart';
import { config } from '../config.ts';
import type { Ctx } from '../context.ts';
import { audit } from '../context.ts';
import { HttpError, badRequest, notFound } from '../errors.ts';
import { msg } from '../i18n.ts';
import { idParam, optionalText, personExpr, requireCall, requireRole } from './calls.ts';

interface FileRow {
  id: number;
  call_id: number;
  file_path: string;
  file_name: string | null;
  mime: string | null;
}

/** תיקיית הקבצים של קריאה, יחסית ל-MEDIA_DIR. */
const folderOf = (companyId: number, callId: number) => join('calls', String(companyId), String(callId));

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
};

const extensionOf = (mime: string, fileName: string): string => {
  const fromName = fileName.includes('.') ? fileName.split('.').pop()! : '';
  if (/^[A-Za-z0-9]{1,8}$/.test(fromName)) return fromName.toLowerCase();
  return EXTENSION[mime] ?? 'bin';
};

/** שומר את הקובץ היחיד שבבקשה, ומחזיר את הנתיב היחסי ואת השדות שנשלחו איתו. */
async function saveUpload(
  req: FastifyRequest,
  companyId: number,
  callId: number,
): Promise<{ relative: string; fileName: string; mime: string; size: number; fields: Record<string, string> }> {
  const folder = folderOf(companyId, callId);
  await mkdir(join(config.mediaDir, folder), { recursive: true });
  const fields: Record<string, string> = {};
  let saved: { relative: string; fileName: string; mime: string; size: number } | undefined;

  for await (const part of req.parts() as AsyncIterableIterator<Multipart>) {
    if (part.type === 'field') {
      if (typeof part.value === 'string') fields[part.fieldname] = part.value;
      continue;
    }
    if (saved) {
      // קובץ אחד בכל בקשה; השאר נזרקים כדי שהזרם לא ייתקע
      part.file.resume();
      continue;
    }
    const fileName = part.filename || 'file';
    const relative = join(folder, `${randomUUID()}.${extensionOf(part.mimetype, fileName)}`);
    const absolute = join(config.mediaDir, relative);
    await pipeline(part.file, createWriteStream(absolute));
    if (part.file.truncated) {
      await rm(absolute, { force: true });
      throw new HttpError(413, `הקובץ גדול מדי (מעל ${config.maxUploadMb}MB)`);
    }
    const info = await stat(absolute);
    saved = { relative, fileName, mime: part.mimetype, size: info.size };
  }
  if (!saved) throw badRequest('לא נשלח קובץ');
  return { ...saved, fields };
}

export function registerFileRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  app.get('/api/calls/:id/files', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const { rows } = await db.query(
      'SELECT cf.id, cf.description, cf.file_name AS "fileName", cf.mime, cf.size, ' +
        `cf.uploaded_by AS "uploadedBy", ${personExpr('u')} AS "uploadedByName", ` +
        'cf.created_at AS "createdAt", cf.active ' +
        'FROM call_files cf LEFT JOIN users u ON u.id = cf.uploaded_by ' +
        'WHERE cf.call_id = $1 AND (cf.active OR $2) ORDER BY cf.created_at DESC, cf.id DESC',
      [call.id, ctx.role === 'admin'],
    );
    return rows;
  });

  /** העלאת מסמך (multipart). שדה הטקסט `description` אופציונלי. */
  app.post('/api/calls/:id/files', async (req) => {
    requireRole(ctx, 'opener');
    const call = await requireCall(ctx, idParam(req));
    const upload = await saveUpload(req, call.companyId, call.id);
    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO call_files (call_id, description, file_path, file_name, mime, size, uploaded_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [
        call.id,
        optionalText(upload.fields.description, 'תאור', 500),
        upload.relative,
        upload.fileName,
        upload.mime,
        upload.size,
        ctx.user.id,
      ],
    );
    await audit(ctx, 'call.file.add', String(call.id), { fileId: rows[0]!.id, name: upload.fileName });
    return { id: rows[0]!.id };
  });

  /** הורדת מסמך. ה-mime הוא זה ששמור, ולא נגזר משם הקובץ. */
  app.get('/api/calls/:id/files/:fileId', async (req, reply) => {
    const call = await requireCall(ctx, idParam(req));
    const row = await requireFile(ctx, call.id, idParam(req, 'fileId'));
    const absolute = join(config.mediaDir, row.file_path);
    const info = await stat(absolute).catch(() => undefined);
    if (!info?.isFile()) throw notFound('הקובץ לא נמצא בשרת');
    const name = encodeURIComponent(row.file_name ?? `file-${row.id}`);
    const inline = (req.query as { inline?: string }).inline === '1';
    return reply
      .header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=86400')
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`)
      .header('Content-Length', info.size)
      .type(inline ? (row.mime ?? 'application/octet-stream') : 'application/octet-stream')
      .send(createReadStream(absolute));
  });

  app.patch('/api/calls/:id/files/:fileId', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const row = await requireFile(ctx, call.id, idParam(req, 'fileId'));
    const body = req.body as { description?: unknown; active?: unknown };
    await db.query(
      'UPDATE call_files SET description = coalesce($2, description), active = coalesce($3::boolean, active) ' +
        'WHERE id = $1',
      [row.id, optionalText(body.description, 'תאור', 500), typeof body.active === 'boolean' ? body.active : null],
    );
    await audit(ctx, 'call.file.edit', String(call.id), { fileId: row.id, body });
    return { ok: true };
  });

  /**
   * ברירת המחדל היא כיבוי המסמך, לא מחיקה. `purge=yes` מוחק גם מהדיסק —
   * למנהל בלבד, ואין דרך חזרה.
   */
  app.delete('/api/calls/:id/files/:fileId', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const row = await requireFile(ctx, call.id, idParam(req, 'fileId'));
    const purge = (req.query as { purge?: string }).purge === 'yes';
    if (!purge) {
      await db.query('UPDATE call_files SET active = false WHERE id = $1', [row.id]);
      await audit(ctx, 'call.file.deactivate', String(call.id), { fileId: row.id });
      return { ok: true, purged: false };
    }
    requireRole(ctx, 'admin');
    await db.query('DELETE FROM call_files WHERE id = $1', [row.id]);
    await rm(join(config.mediaDir, row.file_path), { force: true });
    await audit(ctx, 'call.file.delete', String(call.id), { fileId: row.id });
    return { ok: true, purged: true };
  });
}

async function requireFile(ctx: Ctx, callId: number, fileId: number): Promise<FileRow> {
  const { rows } = await ctx.db.query<FileRow>(
    'SELECT id, call_id, file_path, file_name, mime FROM call_files WHERE id = $1 AND call_id = $2',
    [fileId, callId],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  return row;
}
