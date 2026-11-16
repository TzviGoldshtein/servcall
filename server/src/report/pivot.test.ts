import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPivot, tally, round2, type PivotFact } from './pivot.ts';

const STATUSES = ['פתוחה', 'בטיפול', 'סגורה'];

test('pivot counts calls and totals every row, column and the whole table', () => {
  const facts: PivotFact[] = [
    { rowKeys: ['דיווח תקלה'], col: 'פתוחה' },
    { rowKeys: ['דיווח תקלה'], col: 'פתוחה' },
    { rowKeys: ['דיווח תקלה'], col: 'סגורה' },
    { rowKeys: ['לביצוע'], col: 'בטיפול' },
  ];
  const p = buildPivot(facts, {
    rowHeads: ['סוג קריאה'],
    cols: STATUSES,
    totalLabel: 'סה"כ',
    sumLabel: 'סה"כ הכל',
  });

  assert.deepEqual(p.cols, STATUSES);
  const fault = p.rows.find((r) => r.keys[0] === 'דיווח תקלה')!;
  assert.deepEqual(fault.values, [2, 0, 1], 'שילוב בלי נתון נשאר אפס ולא נעלם');
  assert.equal(fault.total, 3);
  assert.deepEqual(p.colTotals, [2, 1, 1]);
  assert.equal(p.grandTotal, 4);
  assert.equal(
    p.grandTotal,
    p.colTotals.reduce((s, v) => s + v, 0),
    'סכום העמודות חייב להיות שווה לסכום-העל',
  );
});

test('a column from the lookup table with no calls is still shown as zero', () => {
  const p = buildPivot([{ rowKeys: ['לביצוע'], col: 'בטיפול' }], {
    rowHeads: ['סוג קריאה'],
    cols: STATUSES,
    totalLabel: 'סה"כ',
    sumLabel: 'סה"כ הכל',
  });
  assert.deepEqual(p.cols, STATUSES);
  assert.deepEqual(p.colTotals, [0, 1, 0]);
});

test('a value outside the given column order joins the table instead of being dropped', () => {
  const p = buildPivot(
    [
      { rowKeys: ['לביצוע'], col: 'בטיפול' },
      { rowKeys: ['לביצוע'], col: 'סטטוס שהוסיפו אחר כך' },
    ],
    { rowHeads: ['סוג קריאה'], cols: STATUSES, totalLabel: 'סה"כ', sumLabel: 'סה"כ הכל' },
  );
  assert.ok(p.cols.includes('סטטוס שהוסיפו אחר כך'));
  assert.equal(p.grandTotal, 2);
});

test('the group cell is merged vertically over its clients', () => {
  const facts: PivotFact[] = [
    { rowKeys: ['קבוצת א', 'לקוח 1'], col: 'פתוחה' },
    { rowKeys: ['קבוצת א', 'לקוח 2'], col: 'סגורה' },
    { rowKeys: ['קבוצת א', 'לקוח 2'], col: 'סגורה' },
    { rowKeys: ['קבוצת ב', 'לקוח 3'], col: 'פתוחה' },
  ];
  const p = buildPivot(facts, {
    rowHeads: ['קבוצה', 'לקוח'],
    cols: STATUSES,
    totalLabel: 'סה"כ',
    sumLabel: 'סה"כ הכל',
  });

  assert.equal(p.rows.length, 3, 'שורה לכל לקוח, לא לכל קריאה');
  assert.deepEqual(
    p.rows.map((r) => r.spans[0]),
    [2, 0, 1],
    'התא של קבוצת א נמתח על שני לקוחות, השורה השנייה לא מציירת תא',
  );
  assert.deepEqual(
    p.rows.map((r) => r.spans[1]),
    [1, 1, 1],
    'רמת הלקוח לא ממוזגת אף פעם',
  );
  assert.equal(
    p.rows.reduce((s, r) => s + r.spans[0]!, 0),
    p.rows.length,
    'סך המיזוגים מכסה בדיוק את כל השורות',
  );
  assert.equal(p.grandTotal, 4);
});

test('without the group level the same calls collapse to one row per client', () => {
  const facts: PivotFact[] = [
    { rowKeys: ['לקוח 1'], col: 'פתוחה' },
    { rowKeys: ['לקוח 1'], col: 'סגורה' },
  ];
  const p = buildPivot(facts, {
    rowHeads: ['לקוח'],
    cols: STATUSES,
    totalLabel: 'סה"כ',
    sumLabel: 'סה"כ הכל',
  });
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.rows[0]!.spans, [1]);
  assert.equal(p.rows[0]!.total, 2);
});

test('a missing key gets the empty label instead of an invisible row', () => {
  const p = buildPivot([{ rowKeys: [''], col: '' }], {
    rowHeads: ['סוג קריאה'],
    totalLabel: 'סה"כ',
    sumLabel: 'סה"כ הכל',
    emptyLabel: 'ללא',
  });
  assert.deepEqual(p.rows[0]!.keys, ['ללא']);
  assert.deepEqual(p.cols, ['ללא']);
  assert.equal(p.grandTotal, 1);
});

test('hours pivot sums fractions without float noise', () => {
  const facts: PivotFact[] = [
    { rowKeys: ['יוסי'], col: 'לחיוב', value: 2.4 },
    { rowKeys: ['יוסי'], col: 'לחיוב', value: 4.8 },
    { rowKeys: ['יוסי'], col: 'לא לחיוב', value: 0.1 },
  ];
  const p = buildPivot(facts, { rowHeads: ['עובד'], totalLabel: 'סה"כ', sumLabel: 'סה"כ הכל' });
  assert.equal(p.rows[0]!.values[p.cols.indexOf('לחיוב')], 7.2);
  assert.equal(p.rows[0]!.values[p.cols.indexOf('לא לחיוב')], 0.1);
  assert.equal(p.rows[0]!.total, 7.3);
  assert.equal(p.grandTotal, 7.3);
});

test('tally sorts descending and shares add up to a hundred', () => {
  const { rows, total } = tally([
    { label: 'לקוח א' },
    { label: 'לקוח א' },
    { label: 'לקוח ב' },
    { label: '' },
  ], 'ללא');
  assert.equal(total, 4);
  assert.deepEqual(rows.map((r) => r.label), ['לקוח א', 'ללא', 'לקוח ב']);
  assert.equal(rows[0]!.value, 2);
  assert.equal(round2(rows.reduce((s, r) => s + r.share, 0)), 100);
});
