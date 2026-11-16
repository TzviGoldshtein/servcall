import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { HttpError } from './errors.ts';

export interface Upload {
  fields: Record<string, string>;
  file?: { tempFile: string; mime: string; fileName: string };
}

/**
 * קורא בקשת multipart ומוריד את הקובץ היחיד שבה לנתיב זמני, שעל הקורא לצרוך או למחוק.
 * כתיבה לדיסק ולא לזיכרון, כדי ששליחה גדולה לא תפיל את התהליך.
 */
export async function readUpload(req: FastifyRequest): Promise<Upload> {
  const tmpDir = join(config.mediaDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const upload: Upload = { fields: {} };
  for await (const part of req.parts()) {
    if (part.type === 'field') {
      if (typeof part.value === 'string') upload.fields[part.fieldname] = part.value;
      continue;
    }
    if (upload.file) {
      // יותר מקובץ אחד: מרוקנים את הזרם כדי שהבקשה לא תיתקע
      part.file.resume();
      continue;
    }
    const tempFile = join(tmpDir, randomUUID());
    await pipeline(part.file, createWriteStream(tempFile));
    if (part.file.truncated) {
      await rm(tempFile, { force: true });
      throw new HttpError(413, `הקובץ גדול מדי (מעל ${config.maxUploadMb}MB)`);
    }
    upload.file = { tempFile, mime: part.mimetype, fileName: part.filename || 'file' };
  }
  return upload;
}
