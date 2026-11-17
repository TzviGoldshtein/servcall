import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';
import { SESSION_COOKIE, findSessionUser } from './auth.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { HttpError } from './errors.ts';
import { msg } from './i18n.ts';
import {
  requestContext,
  requestLang,
  requestState,
  resolveCompany,
  runRequest,
  setRequestUser,
} from './requestContext.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerCallRoutes } from './routes/calls.ts';
import { registerCompanyRoutes } from './routes/companies.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerFileRoutes } from './routes/files.ts';
import { registerHourRoutes } from './routes/hours.ts';
import { registerLinkRoutes } from './routes/links.ts';
import { registerNoteRoutes } from './routes/notes.ts';
import { registerSignatureRoutes } from './routes/signatures.ts';

/** הנתיבים שעובדים בלי סשן. כל השאר דורש התחברות, כולל /ws. */
const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/wa/start',
  '/api/auth/wa/callback',
]);

/**
 * עדכונים חיים, מופרדים לפי חברה. נציג שמחובר בשתי חברות פותח שני חיבורים ושומע
 * בכל אחד רק את החברה שלו — ההפרדה נשמרת גם בערוץ הזה ולא רק בשאילתות.
 */
export class Hub {
  private readonly clients = new Map<WebSocket, { userId: number; companyId: number }>();

  add(socket: WebSocket, userId: number, companyId: number): void {
    this.clients.set(socket, { userId, companyId });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  broadcast(companyId: number, event: unknown): void {
    const text = JSON.stringify(event);
    for (const [socket, who] of this.clients) {
      if (who.companyId === companyId) socket.send(text);
    }
  }

  /** ניתוק מיידי אחרי שינוי הרשאה או סיסמה, בלי לחכות לניסיון הבקשה הבא. */
  dropUser(userId: number): void {
    for (const [socket, who] of this.clients) {
      if (who.userId === userId) socket.close();
    }
  }
}

export async function buildHttpServer(logger: Logger): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger.child({ module: 'http' }, { level: 'warn' }) as FastifyBaseLogger,
    // מאחורי Caddy כתובת הלקוח מגיעה ב-X-Forwarded-For, והיא נרשמת ביומן הפעולות
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const hasWeb = existsSync(config.webDir);
  if (hasWeb) await app.register(fastifyStatic, { root: config.webDir });

  // כל בקשה רצה בהקשר משלה; ה-hook הבא ממלא אותו במשתמש ובחברה הפעילה
  app.addHook('onRequest', (_req, _reply, done) => runRequest(done));

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'same-origin');
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') && path !== '/ws') return;

    // העוגייה היא SameSite=Lax; דחיית מקור זר בכתיבה היא מנעול שני על אותה דלת
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && hostOf(origin) !== req.headers.host) {
        throw new HttpError(403, msg('badOrigin'));
      }
    }
    if (PUBLIC_API.has(path)) return;

    const sid = req.cookies[SESSION_COOKIE];
    const session = await findSessionUser(db, sid);
    if (!session) throw new HttpError(401, msg('authRequired'));
    setRequestUser(session.user, resolveCompany(session.user, session.companyId), sid!);
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    // שגיאות של fastify עצמו (גוף פגום, קובץ גדול מדי) נושאות קוד משלהן
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    logger.error({ err }, 'request failed');
    return reply.code(500).send({ error: msg('serverError', requestLang()) });
  });

  // ציבורי: בדיקת חיות לניטור, וגם הדגל שמסך הכניסה צריך כדי להציג
  // את כפתור הכניסה דרך ווטסאפ צוות רק כשהחיבור מוגדר
  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, waSso: !!(config.waTeamUrl && config.waTeamToken) };
  });

  // ה-ctx נקרא מהבקשה הרצה; ראה requestContext.ts
  const ctx = requestContext(db);
  const hub = new Hub();

  app.get('/ws', { websocket: true }, (socket) => {
    // בלי חברה פעילה אין למה להאזין; סוגרים בנימוס ולא זורקים בתוך ה-upgrade
    const { user, companyId } = requestState();
    if (!user || companyId == null) {
      socket.close(4003, 'no active company');
      return;
    }
    hub.add(socket, user.id, companyId);
    socket.send(JSON.stringify({ t: 'hello', companyId }));
  });

  registerAuthRoutes(app, ctx, hub);
  registerCompanyRoutes(app, ctx, hub);
  // מודול הקריאות: הרשימה והטופס, ומה שתלוי בקריאה. העדכונים החיים יוצאים דרך ה-hub
  registerCallRoutes(app, ctx, hub);
  registerEventRoutes(app, ctx, hub);
  registerHourRoutes(app, ctx, hub);
  registerFileRoutes(app, ctx, hub);
  registerSignatureRoutes(app, ctx, hub);
  registerLinkRoutes(app, ctx, hub);
  registerNoteRoutes(app, ctx, hub);

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]!;
    // נכס חסר חייב להישאר 404, אחרת הדפדפן יקבל HTML במקום סקריפט
    const isPage = !path.startsWith('/api/') && !path.split('/').pop()!.includes('.');
    if (hasWeb && req.method === 'GET' && isPage) return reply.sendFile('index.html');
    return reply.code(404).send({ error: msg('notFound', requestLang()) });
  });

  return app;
}

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};
