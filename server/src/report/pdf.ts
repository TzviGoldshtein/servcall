/**
 * הדפסת דו"ח ל-PDF בכרומיום ללא ראש.
 *
 * כרומיום מותקן בתמונת הדוקר ו-CHROMIUM_PATH מצביע עליו. שתי החלטות חשובות:
 *   1. **מקביליות אחת.** לשרת ארבעה ליבות שהוא חולק עם מערכות אחרות, ושני
 *      כרומיומים שמדפיסים יחד מרעיבים את השרת. כל בקשת PDF עומדת בתור.
 *   2. הדפסה דרך פרוטוקול הניפוי (CDP) ולא דרך ‎--print-to-pdf, כי רק כך
 *      אפשר לקבל תחתית עם "עמוד X מתוך Y" — וזה מה שהדו"ח דורש.
 *
 * הדף נטען מקובץ מקומי זמני: אין רשת, אין תלות בשרת שרץ, והלוגו מוטמע כ-data URI.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { HttpError } from '../errors.ts';

/** תהליך כרומיום: stdin סגור, stdout ו-stderr נקראים. */
type Chromium = ChildProcessByStdio<null, Readable, Readable>;

const CHROMIUM = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const LAUNCH_TIMEOUT_MS = 20_000;
const PRINT_TIMEOUT_MS = 60_000;

export interface PdfOptions {
  landscape?: boolean;
  /** תבנית התחתית של כרומיום, עם pageNumber ו-totalPages. */
  footerTemplate?: string;
  headerTemplate?: string;
}

/** התור. כל עבודה מחכה לקודמת — מקביליות 1, בכוונה. */
let tail: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  // התור לא נשבר מכשלון של עבודה אחת
  tail = run.catch(() => undefined);
  return run;
}

export const pdfQueueDepth = (): Promise<unknown> => tail;

// ------------------------------------------------------------- חיבור CDP

interface CdpPending {
  resolve(v: Record<string, unknown>): void;
  reject(e: Error): void;
}

class Cdp {
  private readonly pending = new Map<number, CdpPending>();
  private readonly waiters = new Map<string, ((p: Record<string, unknown>) => void)[]>();
  private next = 1;
  // שדה מפורש ולא parameter property: node מריץ טסטים ב-strip-only,
  // שאינו תומך בקיצור הזה.
  private readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw) => this.onMessage(String(raw)));
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
      const fail = (err: Error) => reject(err);
      ws.once('error', fail);
      ws.once('open', () => {
        ws.off('error', fail);
        resolve(new Cdp(ws));
      });
    });
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string }; sessionId?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message ?? 'CDP error'));
      else slot.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) {
      const list = this.waiters.get(msg.method);
      if (list?.length) {
        this.waiters.set(msg.method, []);
        for (const fn of list) fn(msg.params ?? {});
      }
    }
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.next++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  once(method: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const list = this.waiters.get(method) ?? [];
      list.push(resolve);
      this.waiters.set(method, list);
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* נסגר בכל מקרה כשהתהליך נהרג */
    }
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

/** מחכה לשורת "DevTools listening on ws://…" ששולח כרומיום ל-stderr. */
function devtoolsUrl(child: Chromium): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += String(chunk);
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) {
        child.stderr.off('data', onData);
        resolve(m[0]);
      }
    };
    child.stderr.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`chromium exited with ${code}: ${buf.slice(-400)}`)));
  });
}

// ------------------------------------------------------------- ההדפסה

async function printOnce(html: string, opts: PdfOptions): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'servcall-pdf-'));
  const page = join(dir, 'report.html');
  let child: Chromium | null = null;
  let cdp: Cdp | null = null;
  try {
    await writeFile(page, html, 'utf8');
    try {
      child = spawn(
        CHROMIUM,
        [
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--no-first-run',
          '--no-default-browser-check',
          '--hide-scrollbars',
          '--force-color-profile=srgb',
          '--font-render-hinting=none',
          `--user-data-dir=${join(dir, 'profile')}`,
          '--remote-debugging-port=0',
          'about:blank',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      throw new HttpError(503, 'מודול ההדפסה אינו זמין בשרת');
    }
    child.on('error', () => undefined);

    const wsUrl = await withTimeout(devtoolsUrl(child), LAUNCH_TIMEOUT_MS, 'chromium launch');
    cdp = await Cdp.connect(wsUrl);

    const target = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId?: string };
    if (!target.targetId) throw new Error('no target');
    const attached = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })) as {
      sessionId?: string;
    };
    const sessionId = attached.sessionId;
    if (!sessionId) throw new Error('no session');

    await cdp.send('Page.enable', {}, sessionId);
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: pathToFileURL(page).href }, sessionId);
    await withTimeout(loaded, PRINT_TIMEOUT_MS, 'page load');

    const printed = (await withTimeout(
      cdp.send(
        'Page.printToPDF',
        {
          printBackground: true,
          landscape: Boolean(opts.landscape),
          displayHeaderFooter: Boolean(opts.footerTemplate || opts.headerTemplate),
          headerTemplate: opts.headerTemplate ?? '<span></span>',
          footerTemplate: opts.footerTemplate ?? '<span></span>',
          marginTop: 0.5,
          marginBottom: 0.6,
          marginLeft: 0.35,
          marginRight: 0.35,
          scale: 1,
          preferCSSPageSize: false,
        },
        sessionId,
      ),
      PRINT_TIMEOUT_MS,
      'printToPDF',
    )) as { data?: string };
    if (!printed.data) throw new Error('empty pdf');
    return Buffer.from(printed.data, 'base64');
  } finally {
    cdp?.close();
    if (child && child.exitCode === null) child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * HTML → PDF. העבודות נכנסות לתור; כשל בהדפסה חוזר כשגיאת 503 בעברית ולא
 * כקריסה, כי המשתמש עדיין רואה את הדו"ח על המסך ויכול לייצא ל-Excel.
 */
export const htmlToPdf = (html: string, opts: PdfOptions = {}): Promise<Buffer> =>
  serial(async () => {
    try {
      return await printOnce(html, opts);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, `הפקת ה-PDF נכשלה: ${err instanceof Error ? err.message : 'שגיאה'}`);
    }
  });

export const chromiumPath = (): string => CHROMIUM;
