/**
 * ה-HTML של הדו"ח — גם מה שיוצא ל-PDF וגם מה שאפשר לפתוח בדפדפן לבדיקה.
 *
 * הכותרת זהה בכל אחד-עשר הדו"חות: לוגו החברה, שם המערכת, שם החברה, תאריך
 * ושעת ההפקה, "הופק ע"י", ואחריהם פס בצבע החברה עם שם הדו"ח. מספר העמוד
 * מגיע מתבנית התחתית של כרומיום (pdf.ts), כי רק המדפיס יודע כמה עמודים יש.
 *
 * כל הצבעים כאן הם משתני CSS: הכרום נגזר מהחברה, וצבעי הסטטוס קבועים לכולן.
 */
import type { Block, ReportHead, ReportResult, Tone } from './types.ts';
import { barChartSvg } from './chart.ts';
import { statusCssVars } from './status.ts';

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** שומר על רווחים ושורות חדשות בתיאורי עבודה שהוקלדו ביד. */
const escMulti = (v: unknown): string => esc(v).replace(/\r?\n/g, '<br/>');

const toneClass = (tone?: Tone): string => (tone && tone !== 'plain' ? ` class="t-${tone}"` : '');

const alignStyle = (align?: string, numeric?: boolean): string => {
  const a = align ?? (numeric ? 'end' : undefined);
  return a ? ` style="text-align:${a}"` : '';
};

function cssVars(head: ReportHead): string {
  const vars: Record<string, string> = {
    '--primary': head.brand.primary,
    '--primary-contrast': head.brand.onPrimary,
    '--accent': head.brand.accent,
    ...statusCssVars(),
  };
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

const STYLE = `
  @page { margin: 14mm 10mm 16mm 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 2mm;
    font-family: "Noto Sans Hebrew", "Noto Sans", system-ui, sans-serif;
    font-size: 10.5px; color: #1B1F24; background: #FFFFFF;
  }
  h1, h2, h3 { margin: 0; font-weight: 600; }
  /* ---- הכותרת האחידה ---- */
  .rep-head { display: flex; align-items: center; gap: 10px; padding: 4px 0 6px; }
  .rep-logo { height: 34px; max-width: 120px; object-fit: contain; }
  .rep-logo-fallback {
    height: 34px; min-width: 34px; padding: 0 8px; border-radius: 4px;
    background: var(--primary); color: var(--primary-contrast);
    display: flex; align-items: center; font-weight: 700; font-size: 13px;
  }
  .rep-titles { display: flex; flex-direction: column; gap: 1px; }
  .rep-system { font-size: 12px; font-weight: 600; color: var(--primary); }
  .rep-company { font-size: 11px; }
  .rep-meta { margin-inline-start: auto; text-align: end; font-size: 9.5px; color: #4B5563; line-height: 1.5; }
  .rep-bar {
    background: var(--primary); color: var(--primary-contrast);
    padding: 5px 10px; border-radius: 3px; font-size: 13px; font-weight: 600;
    display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
  }
  .rep-bar .rep-filter { font-size: 9.5px; font-weight: 400; opacity: 0.92; text-align: end; }
  /* ---- טבלאות ---- */
  .block { margin-top: 10px; }
  .block > h2 { font-size: 11.5px; margin-bottom: 3px; color: var(--primary); }
  .block > .note { font-size: 9px; color: #4B5563; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: var(--primary); color: var(--primary-contrast);
    font-size: 9.5px; font-weight: 600; padding: 4px 5px; border: 1px solid var(--primary);
    text-align: start;
  }
  tbody td, tfoot td { border: 1px solid #D5DAE0; padding: 3px 5px; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #F6F8FA; }
  tbody tr { page-break-inside: avoid; }
  tfoot td { font-weight: 700; background: #ECEFF3; border-top: 2px solid var(--accent); }
  td.rowhead { font-weight: 600; background: #FFFFFF; }
  td.total, th.total { font-weight: 700; }
  tr.subtotal td { font-weight: 700; background: #EEF2F6; }
  .t-red { color: var(--status-open); }
  .t-muted { color: #6B7280; }
  .t-strong { font-weight: 700; }
  /* ---- איתור קריאות: שתי שורות לקריאה ---- */
  tr.call-desc td { border-top: 0; color: var(--status-open); white-space: pre-line; }
  tr.call-events td { border-top: 0; font-size: 9px; }
  tr.call-events ul { margin: 0; padding-inline-start: 14px; }
  .count-line { margin-top: 5px; font-weight: 700; font-size: 11px; }
  /* ---- בלוק שדות: הדו"ח המפורט ---- */
  .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 14px; }
  .fields .f { display: flex; gap: 6px; border-bottom: 1px solid #E5E8EC; padding: 2px 0; }
  .fields .f b { font-weight: 600; min-width: 95px; color: #374151; }
  .fields .f.wide { grid-column: 1 / -1; }
  /* ---- גרפים ---- */
  .chart { color: #1B1F24; }
  .chart .bar-label { font-size: 10px; fill: #1B1F24; }
  .chart .bar-value { font-size: 10px; fill: #374151; font-weight: 600; }
  .legend { font-size: 9px; color: #4B5563; margin-top: 4px; }
  .page-break { page-break-after: always; break-after: page; }
  .empty { padding: 14px; text-align: center; color: #6B7280; border: 1px dashed #C7CDD4; border-radius: 4px; }
`;

function headHtml(head: ReportHead): string {
  const logo = head.companyLogo
    ? `<img class="rep-logo" src="${esc(head.companyLogo)}" alt=""/>`
    : `<span class="rep-logo-fallback">${esc(head.companyName.slice(0, 2))}</span>`;
  return `
  <header>
    <div class="rep-head">
      ${logo}
      <div class="rep-titles">
        <span class="rep-system">${esc(head.systemName)}</span>
        <span class="rep-company">${esc(head.companyName)}</span>
      </div>
      <div class="rep-meta">
        <div>${esc(head.generatedAt)}</div>
        <div>${esc(head.byLabel)} ${esc(head.byUser)}</div>
      </div>
    </div>
    <div class="rep-bar">
      <h1>${esc(head.reportName)}</h1>
      ${head.filterText ? `<span class="rep-filter">${esc(head.filterText)}</span>` : ''}
    </div>
  </header>`;
}

function blockHtml(block: Block, head: ReportHead): string {
  switch (block.kind) {
    case 'break':
      return '<div class="page-break"></div>';

    case 'table': {
      const cols = block.columns;
      const body = block.rows.length
        ? block.rows
            .map((row, ri) => {
              const sub = block.subtotalRows?.includes(ri) ? ' class="subtotal"' : '';
              const cells = cols
                .map((c, ci) => {
                  const cell = row[ci] ?? { text: '' };
                  return `<td${toneClass(cell.tone)}${alignStyle(c.align, c.numeric)}>${escMulti(cell.text)}</td>`;
                })
                .join('');
              return `<tr${sub}>${cells}</tr>`;
            })
            .join('')
        : `<tr><td colspan="${cols.length}" class="t-muted">—</td></tr>`;
      const total = block.total
        ? `<tfoot><tr>${cols
            .map((c, ci) => {
              const cell = block.total![ci] ?? { text: '' };
              return `<td${alignStyle(c.align, c.numeric)}>${esc(cell.text)}</td>`;
            })
            .join('')}</tr></tfoot>`
        : '';
      return `<section class="block">
        ${block.title ? `<h2>${esc(block.title)}</h2>` : ''}
        ${block.note ? `<div class="note">${esc(block.note)}</div>` : ''}
        <table>
          <thead><tr>${cols.map((c) => `<th${alignStyle(c.align, c.numeric)}>${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
          ${total}
        </table>
      </section>`;
    }

    case 'pivot': {
      const head2 = `<tr>${block.rowHeads.map((h) => `<th>${esc(h)}</th>`).join('')}${block.cols
        .map((c) => `<th style="text-align:center">${esc(c)}</th>`)
        .join('')}<th class="total" style="text-align:end">${esc(block.totalLabel)}</th></tr>`;
      const body = block.rows.length
        ? block.rows
            .map((r) => {
              // תא שהתמזג לשורה שמעליו לא מצויר שוב — זה המיזוג האנכי של הקבוצה
              const heads = r.spans
                .map((span, i) =>
                  span === 0 ? '' : `<td class="rowhead"${span > 1 ? ` rowspan="${span}"` : ''}>${esc(r.keys[i] ?? '')}</td>`,
                )
                .join('');
              const values = r.values
                .map((v) => `<td style="text-align:center">${v === 0 ? '' : esc(v)}</td>`)
                .join('');
              return `<tr>${heads}${values}<td class="total" style="text-align:end">${esc(r.total)}</td></tr>`;
            })
            .join('')
        : `<tr><td colspan="${block.rowHeads.length + block.cols.length + 1}" class="t-muted">—</td></tr>`;
      const foot = `<tfoot><tr>
        <td colspan="${block.rowHeads.length}">${esc(block.totalLabel)}</td>
        ${block.colTotals.map((v) => `<td style="text-align:center">${esc(v)}</td>`).join('')}
        <td style="text-align:end">${esc(block.grandTotal)}</td>
      </tr></tfoot>`;
      return `<section class="block">
        ${block.title ? `<h2>${esc(block.title)}</h2>` : ''}
        ${block.note ? `<div class="note">${esc(block.note)}</div>` : ''}
        <table><thead>${head2}</thead><tbody>${body}</tbody>${foot}</table>
      </section>`;
    }

    case 'chart':
      return `<section class="block">
        <h2>${esc(block.title)}</h2>
        ${block.subtitle ? `<div class="note">${esc(block.subtitle)}</div>` : ''}
        ${
          block.bars.length
            ? barChartSvg(block, { dir: head.dir, accent: head.brand.accent })
            : `<div class="empty">—</div>`
        }
        <div class="legend">${esc(block.valueLabel)}: ${esc(block.total)}</div>
      </section>`;

    case 'callList': {
      const cols = block.columns;
      const rows = block.items
        .map((item) => {
          const first = cols
            .map((c, ci) => {
              const cell = item.cells[ci] ?? { text: '' };
              return `<td${toneClass(cell.tone)}${alignStyle(c.align, c.numeric)}>${esc(cell.text)}</td>`;
            })
            .join('');
          // השורה השנייה: התיאור באדום, כמו בדו"ח המקורי
          const desc = `<tr class="call-desc"><td colspan="${cols.length}">${escMulti(item.description || '—')}</td></tr>`;
          const events = item.events?.length
            ? `<tr class="call-events"><td colspan="${cols.length}"><ul>${item.events
                .map((e) => `<li>${esc(e.when)} — ${esc(e.who)}: ${escMulti(e.body)}</li>`)
                .join('')}</ul></td></tr>`
            : '';
          return `<tr>${first}</tr>${desc}${events}`;
        })
        .join('');
      return `<section class="block">
        ${block.title ? `<h2>${esc(block.title)}</h2>` : ''}
        <table>
          <thead><tr>${cols.map((c) => `<th${alignStyle(c.align, c.numeric)}>${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${cols.length}" class="t-muted">—</td></tr>`}</tbody>
        </table>
        <div class="count-line">${esc(block.countLabel)}: ${esc(block.count)}</div>
      </section>`;
    }

    case 'fields':
      return `<section class="block">
        <h2>${esc(block.title)}</h2>
        <div class="fields">${block.fields
          .map(
            (f) =>
              `<div class="f${f.value.length > 60 ? ' wide' : ''}"><b>${esc(f.label)}</b><span${toneClass(
                f.tone,
              )}>${escMulti(f.value)}</span></div>`,
          )
          .join('')}</div>
      </section>`;
  }
}

/** מסמך ה-HTML השלם של הדו"ח. */
export function renderReportHtml(result: ReportResult): string {
  const { head } = result;
  const body = result.blocks.length
    ? result.blocks.map((b) => blockHtml(b, head)).join('\n')
    : `<div class="block empty">${esc(head.emptyText)}</div>`;
  return `<!doctype html>
<html lang="${esc(head.lang)}" dir="${esc(head.dir)}">
<head>
<meta charset="utf-8"/>
<title>${esc(head.reportName)} — ${esc(head.companyName)}</title>
<style>${STYLE}</style>
</head>
<body style="${esc(cssVars(head))}">
${headHtml(head)}
<main>${body}</main>
</body>
</html>`;
}

/** תבנית התחתית של כרומיום: מספר עמוד מתוך סך העמודים, בשפת הדו"ח. */
export function footerTemplate(head: ReportHead): string {
  return `<div style="width:100%;font-size:8px;color:#4B5563;padding:0 12mm;
    font-family:'Noto Sans Hebrew','Noto Sans',sans-serif;direction:${head.dir};
    display:flex;justify-content:space-between">
    <span>${esc(head.companyName)} — ${esc(head.reportName)}</span>
    <span>${esc(head.pageLabel)} <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}
