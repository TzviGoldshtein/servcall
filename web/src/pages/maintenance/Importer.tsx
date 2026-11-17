import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, s, Toggle, useAction, useLang } from './shared';

/**
 * ייבוא לקוחות ואנשי קשר מאקסל, בשלושה שלבים שמופיעים כאן בזה אחר זה:
 *   1. בחירת קובץ → השרת קורא אותו, מזהה כותרות ומציע התאמת עמודות.
 *   2. התאמה ובדיקה → רואים 20 שורות ראשונות כפי שייובאו, וכמה שורות תקינות.
 *      שום דבר לא נכתב למסד עד שלוחצים "ייבוא".
 *   3. ייבוא → וכשיש שגיאות, דו"ח של שורה, עמודה וסיבה שאפשר להוריד כאקסל
 *      ולשלוח למי שהכין את הקובץ.
 *
 * הלקוחות ואנשי הקשר נכתבים למאגר המשותף; הערות הקריאה ועלות השעה נכתבות
 * לחברה שאתה עובד בה כרגע בלבד.
 */

interface ImportIssue {
  row: number;
  column: string;
  field: string | null;
  reason: string;
}

interface ParsedRow {
  row: number;
  ok: boolean;
  client: { name: string; city: string | null; phone: string | null; vatId: string | null } | null;
  contact: { firstName: string; lastName: string | null; mobileE164: string | null; email: string | null } | null;
  issues: ImportIssue[];
}

interface Preview {
  token: string;
  sheet: string;
  fileName: string;
  headers: string[];
  mapping: (string | null)[];
  fields: { field: string; label: string; perCompany: boolean }[];
  totals: { rows: number; valid: number; invalid: number; contacts: number };
  preview: ParsedRow[];
  issues: ImportIssue[];
}

interface RunResult {
  clientsCreated: number;
  clientsUpdated: number;
  contactsCreated: number;
  contactsUpdated: number;
  skipped: number;
  issues: ImportIssue[];
  issuesTotal: number;
  token: string;
}

export default function Importer() {
  const { tx } = useLang();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [createGroups, setCreateGroups] = useState(false);
  const { run, error, busy } = useAction();

  async function upload(file: File) {
    setResult(null);
    const body = new FormData();
    body.append('file', file);
    const data = await run(() => api.post<Preview>('/api/import/clients/preview', body));
    if (data) setPreview(data);
  }

  /** שינוי התאמה של עמודה אחת: נשלח לשרת שבודק מחדש את כל השורות. */
  async function remap(index: number, field: string) {
    if (!preview) return;
    const mapping = [...preview.mapping];
    mapping[index] = field || null;
    const data = await run(() =>
      api.post<Preview>('/api/import/clients/validate', { token: preview.token, mapping }),
    );
    if (data) setPreview({ ...preview, ...data });
  }

  async function doImport() {
    if (!preview) return;
    const data = await run(() =>
      api.post<RunResult>('/api/import/clients/run', {
        token: preview.token,
        mapping: preview.mapping,
        updateExisting,
        createGroups,
      }),
    );
    if (data) setResult(data);
  }

  const issues = result?.issues ?? preview?.issues ?? [];

  return (
    <div style={s.page}>
      <h2 style={s.title}>{tx('ייבוא לקוחות מאקסל', 'Import clients from Excel')}</h2>
      <p style={s.hint}>
        {tx(
          'הקובץ נבדק לפני שנכתב משהו. אפשר להוריד תבנית עם הכותרות שהמערכת מזהה לבד.',
          'The file is checked before anything is written. A template with the headers we recognise can be downloaded.',
        )}
      </p>

      <section style={s.card}>
        <div style={s.row}>
          <Field label={tx('קובץ אקסל (xlsx)', 'Excel file (xlsx)')}>
            <input
              style={s.input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </Field>
          <a style={{ ...s.button, textDecoration: 'var(--link-decoration, none)' }} href="/api/import/clients/template.xlsx">
            {tx('הורדת תבנית', 'Download a template')}
          </a>
        </div>
        <ErrorText>{error}</ErrorText>
      </section>

      {preview && (
        <section style={s.card}>
          <div style={s.head}>
            <strong style={{ flex: 1 }}>
              {tx('התאמת עמודות', 'Column mapping')} · {preview.fileName} / {preview.sheet}
            </strong>
            <span style={s.badge}>
              {preview.totals.valid} {tx('תקינות', 'valid')} · {preview.totals.invalid} {tx('שגויות', 'with errors')} ·{' '}
              {preview.totals.contacts} {tx('אנשי קשר', 'contacts')}
            </span>
          </div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>{tx('עמודה בקובץ', 'Column in the file')}</th>
                <th style={s.th}>{tx('תיובא לשדה', 'Imported into')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.headers.map((header, index) => (
                <tr key={`${header}-${index}`}>
                  <td style={s.td}>{header || tx('(ריק)', '(empty)')}</td>
                  <td style={s.td}>
                    <select
                      style={s.input}
                      value={preview.mapping[index] ?? ''}
                      disabled={busy}
                      onChange={(e) => void remap(index, e.target.value)}
                      aria-label={tx(`שדה לעמודה ${header}`, `Field for column ${header}`)}
                    >
                      <option value="">{tx('לא לייבא', 'Do not import')}</option>
                      {preview.fields.map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label}
                          {f.perCompany ? tx(' (פר חברה)', ' (per company)') : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Toggle
            label={tx('לעדכן לקוחות ואנשי קשר קיימים', 'Update existing clients and contacts')}
            help={tx(
              'כשכבוי מתווספים חדשים בלבד, ושום נתון קיים לא נדרס. תא ריק בקובץ לא מוחק נתון בשום מצב.',
              'When off only new records are added and nothing existing is overwritten. An empty cell never deletes data.',
            )}
            checked={updateExisting}
            onChange={setUpdateExisting}
          />
          <Toggle
            label={tx('ליצור קבוצות לקוחות חסרות', 'Create missing client groups')}
            help={tx(
              'כשכבוי, שם קבוצה שאינו קיים מדווח כשגיאה במקום להיווצר בשקט.',
              'When off, an unknown group name is reported as an error instead of being created quietly.',
            )}
            checked={createGroups}
            onChange={setCreateGroups}
          />

          <strong>{tx('20 השורות הראשונות', 'The first 20 rows')}</strong>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>{tx('שורה', 'Row')}</th>
                <th style={s.th}>{tx('לקוח', 'Client')}</th>
                <th style={s.th}>{tx('עיר', 'City')}</th>
                <th style={s.th}>{tx('טלפון', 'Phone')}</th>
                <th style={s.th}>{tx('איש קשר', 'Contact')}</th>
                <th style={s.th}>{tx('נייד מנורמל', 'Normalised mobile')}</th>
                <th style={s.th}>{tx('תקין', 'Valid')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.preview.map((row) => (
                <tr key={row.row} style={row.ok ? undefined : s.muted}>
                  <td style={s.td}>{row.row}</td>
                  <td style={s.td}>{row.client?.name ?? '—'}</td>
                  <td style={s.td}>{row.client?.city ?? '—'}</td>
                  <td style={s.td} dir="ltr">
                    {row.client?.phone ?? '—'}
                  </td>
                  <td style={s.td}>
                    {row.contact ? `${row.contact.firstName} ${row.contact.lastName ?? ''}`.trim() : '—'}
                  </td>
                  <td style={s.td} dir="ltr">
                    {row.contact?.mobileE164 ?? '—'}
                  </td>
                  <td style={row.ok ? s.td : { ...s.td, ...s.remarks }}>
                    {row.ok ? tx('כן', 'Yes') : tx('לא', 'No')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={s.row}>
            <button type="button" style={s.primary} onClick={() => void doImport()} disabled={busy || !preview.totals.valid}>
              {tx(`ייבוא ${preview.totals.valid} שורות`, `Import ${preview.totals.valid} rows`)}
            </button>
            <button type="button" style={s.button} onClick={() => setPreview(null)} disabled={busy}>
              {tx('ביטול', 'Cancel')}
            </button>
            {preview.totals.invalid > 0 && (
              <span style={s.hint}>
                {tx(
                  'שורות שגויות מדווחות בדו"ח ואינן נכנסות; השאר כן.',
                  'Rows with errors are reported and skipped; the rest are imported.',
                )}
              </span>
            )}
          </div>
        </section>
      )}

      {result && (
        <section style={s.card}>
          <strong>{tx('הייבוא הסתיים', 'Import finished')}</strong>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            <li>
              {tx('לקוחות חדשים', 'New clients')}: {result.clientsCreated}
            </li>
            <li>
              {tx('לקוחות שעודכנו', 'Updated clients')}: {result.clientsUpdated}
            </li>
            <li>
              {tx('אנשי קשר חדשים', 'New contacts')}: {result.contactsCreated}
            </li>
            <li>
              {tx('אנשי קשר שעודכנו', 'Updated contacts')}: {result.contactsUpdated}
            </li>
            <li>
              {tx('שורות שלא נכנסו', 'Skipped rows')}: {result.skipped}
            </li>
          </ul>
        </section>
      )}

      {issues.length > 0 && (
        <section style={s.card}>
          <div style={s.head}>
            <strong style={{ flex: 1 }}>
              {tx('דו"ח שגיאות', 'Error report')} ({result?.issuesTotal ?? issues.length})
            </strong>
            {preview && (
              <a
                style={{ ...s.button, textDecoration: 'var(--link-decoration, none)' }}
                href={`/api/import/clients/${preview.token}/errors?format=xlsx`}
              >
                {tx('הורדה כאקסל', 'Download as Excel')}
              </a>
            )}
          </div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>{tx('שורה', 'Row')}</th>
                <th style={s.th}>{tx('עמודה', 'Column')}</th>
                <th style={s.th}>{tx('סיבה', 'Reason')}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue, index) => (
                <tr key={`${issue.row}-${issue.field ?? index}`}>
                  <td style={s.td}>{issue.row}</td>
                  <td style={s.td}>{issue.column}</td>
                  <td style={s.td}>{issue.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
