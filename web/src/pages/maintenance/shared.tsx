import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '../../i18n';

/**
 * השכבה הדקה שכל מסכי התחזוקה יושבים עליה.
 *
 * מה שמגיע מהמעטפת (web/src/api.ts, web/src/i18n.ts, web/src/styles.css) נוגע
 * בקובץ הזה בלבד, כדי שאם חוזה המעטפת ישתנה — יהיה מקום אחד לתקן ולא עשרה מסכים:
 *   api  — api.get/post/patch/put/del(url, body?) שמחזירים JSON וזורקים Error עם הודעה.
 *   i18n — useI18n() שמחזיר { lang, dir }.
 *
 * טקסטים: מסכי התחזוקה נושאים את הזוג עברית/אנגלית אצלם (tx), ולא מפתחות מילון,
 * כי מילון חסר שקט היה מציג "maint.clients.title" ללקוח. כל טקסט שמגיע מהשרת
 * (שמות טבלאות קוד, תיאורי פרמטרים) כבר חוזר בשפת המשתמש.
 *
 * צבעים: רק משתני CSS (--primary, --accent, …). אין כאן אף צבע מיתוג מקובע,
 * כי אותו מסך משרת ארבע חברות בארבע ערכות צבע.
 */

export type Lang = 'he' | 'en';

export function useLang() {
  const { lang, dir } = useI18n() as { lang: Lang; dir: 'rtl' | 'ltr' };
  return {
    lang,
    dir,
    /** tx('שמור', 'Save') — הטקסט לפי שפת המשתמש. */
    tx: (he: string, en: string) => (lang === 'en' ? en : he),
  };
}

/** סגנונות בסיס. כולם נגזרים ממשתני ה-CSS של החברה הפעילה. */
export const s: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 16, padding: 16 },
  head: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 20, color: 'var(--primary)' },
  hint: { margin: 0, fontSize: 13, opacity: 0.75 },
  card: {
    border: '1px solid var(--accent-divider)',
    borderRadius: 10,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    background: 'var(--primary)',
    color: 'var(--primary-contrast)',
    padding: '8px 10px',
    textAlign: 'start',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--accent-divider)', textAlign: 'start' },
  filterCell: { padding: 4, background: 'var(--primary-subtle)' },
  filter: { width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '4px 6px' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180, flex: '1 1 180px' },
  label: { fontSize: 12, opacity: 0.8 },
  input: { font: 'inherit', padding: '6px 8px', width: '100%', boxSizing: 'border-box' },
  primary: {
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    border: 0,
    borderRadius: 6,
    padding: '7px 14px',
    font: 'inherit',
    cursor: 'pointer',
  },
  button: {
    background: 'transparent',
    color: 'inherit',
    border: '1px solid var(--accent-divider)',
    borderRadius: 6,
    padding: '6px 12px',
    font: 'inherit',
    cursor: 'pointer',
  },
  danger: { border: '1px solid var(--danger, currentColor)', borderRadius: 6, padding: '6px 12px', font: 'inherit', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  /** ההערה האדומה של הלקוח — צבע סמנטי, זהה בכל החברות (ראו theme.ts). */
  remarks: { color: 'var(--danger, #B3261E)', fontWeight: 600 },
  error: { color: 'var(--danger, #B3261E)', margin: 0, fontSize: 13 },
  muted: { opacity: 0.7 },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 40,
  },
  modal: {
    background: 'var(--surface, #fff)',
    color: 'inherit',
    borderRadius: 12,
    maxWidth: 820,
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  badge: {
    background: 'var(--primary-subtle)',
    color: 'var(--primary-on-subtle)',
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 12,
  },
};

/** הרצת פעולה מול השרת: שגיאה לתצוגה ליד הכפתור, ודגל busy לנעילה בינתיים. */
export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setError('');
    setBusy(true);
    try {
      return await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, error, busy, setError };
}

export function ErrorText({ children }: { children: string }) {
  return children ? (
    <p style={s.error} role="alert">
      {children}
    </p>
  ) : null;
}

/** טעינה של נתון מהשרת עם רענון ידני. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    return load()
      .then((value) => {
        setData(value);
        setError('');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => void reload(), [reload]);
  return { data, error, loading, reload, setData };
}

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const { tx } = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div style={s.head}>
          <h3 style={{ ...s.title, flex: 1 }}>{title}</h3>
          <button type="button" style={s.button} onClick={onClose} aria-label={tx('סגור', 'Close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label style={{ ...s.field, ...(wide ? { flexBasis: '100%' } : null) }}>
      <span style={s.label}>{label}</span>
      {children}
    </label>
  );
}

/** מתג כן/לא עם שורת הסבר — הצורה שבה מוצגים הפרמטרים וההגדרות. */
export function Toggle({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginBlockStart: 3 }}
      />
      <span>
        <span>{label}</span>
        {help ? <span style={{ ...s.hint, display: 'block' }}>{help}</span> : null}
      </span>
    </label>
  );
}

/** דפדוף של 15 שורות בדף, כמו ברשימת הלקוחות. */
export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage(page: number): void;
}) {
  const { tx } = useLang();
  return (
    <div style={s.row}>
      <button type="button" style={s.button} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {tx('הקודם', 'Previous')}
      </button>
      <span style={s.muted}>
        {tx('דף', 'Page')} {page} / {pages} · {total} {tx('רשומות', 'records')}
      </span>
      <button type="button" style={s.button} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {tx('הבא', 'Next')}
      </button>
    </div>
  );
}

/** כותרת עמודה שאפשר למיין לפיה. החץ מצביע לכיוון המיון הנוכחי. */
export function SortHeader({
  column,
  label,
  sort,
  dir,
  onSort,
  children,
}: {
  column: string;
  label: string;
  sort: string;
  dir: 'asc' | 'desc';
  onSort(column: string): void;
  children?: ReactNode;
}) {
  return (
    <th style={s.th} onClick={() => onSort(column)} aria-sort={sort === column ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}
      {sort === column ? <span aria-hidden> {dir === 'asc' ? '▲' : '▼'}</span> : null}
      {children}
    </th>
  );
}

export const yesNo = (value: boolean, lang: Lang) => (value ? (lang === 'en' ? 'Yes' : 'כן') : lang === 'en' ? 'No' : 'לא');
