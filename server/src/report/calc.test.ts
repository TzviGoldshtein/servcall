import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bankBalance,
  bankNeedsAttention,
  bankUsedHours,
  effectivePrice,
  lineTotal,
  monthlyRevenue,
  splitByReporter,
  splitHours,
  type BankHourEntry,
  type HoursRow,
} from './calc.ts';

// ------------------------------------------------------------- בנק שעות

test('the balance is purchased minus only the hours that count in the bank', () => {
  const entries: BankHourEntry[] = [
    { hours: 3, countsInBank: true },
    { hours: 2.5, countsInBank: true },
    { hours: 4, countsInBank: false },
  ];
  assert.equal(bankUsedHours(entries), 5.5);
  const b = bankBalance(20, entries);
  assert.equal(b.purchased, 20);
  assert.equal(b.used, 5.5);
  assert.equal(b.balance, 14.5);
  assert.equal(b.state, 'ok');
});

test('an hour with no type does not eat the bank', () => {
  const b = bankBalance(10, [
    { hours: 2, countsInBank: null },
    { hours: 1, countsInBank: true },
  ]);
  assert.equal(b.used, 1);
  assert.equal(b.balance, 9);
});

test('the balance is never stored: it follows the reported hours', () => {
  const entries: BankHourEntry[] = [{ hours: 1, countsInBank: true }];
  assert.equal(bankBalance(10, entries).balance, 9);
  entries.push({ hours: 6, countsInBank: true });
  assert.equal(bankBalance(10, entries).balance, 3, 'דיווח נוסף משנה את היתרה מיד');
});

test('an exhausted and an overdrawn bank are told apart', () => {
  const empty = bankBalance(8, [{ hours: 8, countsInBank: true }]);
  assert.equal(empty.balance, 0);
  assert.equal(empty.state, 'empty');
  assert.equal(empty.usedPct, 100);

  const over = bankBalance(8, [{ hours: 11.25, countsInBank: true }]);
  assert.equal(over.balance, -3.25);
  assert.equal(over.state, 'negative');
  assert.ok(over.usedPct > 100, 'מד הניצול עובר 100% ולא נחתך, אחרת החריגה נעלמת');
  assert.ok(bankNeedsAttention(over) && bankNeedsAttention(empty));
});

test('a nearly spent bank is flagged low, by share and by absolute hours', () => {
  assert.equal(bankBalance(100, [{ hours: 90, countsInBank: true }]).state, 'low', '10% נותרו');
  assert.equal(bankBalance(100, [{ hours: 50, countsInBank: true }]).state, 'ok');
  assert.equal(
    bankBalance(1000, [{ hours: 998.5, countsInBank: true }]).state,
    'low',
    'שעה וחצי בבנק ענק היא עדיין יתרה נמוכה',
  );
  assert.ok(!bankNeedsAttention(bankBalance(100, [{ hours: 50, countsInBank: true }])));
});

test('a bank with nothing purchased but hours reported shows full usage', () => {
  const b = bankBalance(0, [{ hours: 2, countsInBank: true }]);
  assert.equal(b.usedPct, 100);
  assert.equal(b.balance, -2);
  assert.equal(b.state, 'negative');
  const fresh = bankBalance(0, []);
  assert.equal(fresh.usedPct, 0);
  assert.equal(fresh.state, 'empty');
});

test('fractions of an hour do not drift', () => {
  const b = bankBalance(10, [
    { hours: 0.1, countsInBank: true },
    { hours: 0.2, countsInBank: true },
  ]);
  assert.equal(b.used, 0.3);
  assert.equal(b.balance, 9.7);
});

// --------------------------------------------- פיצול לחיוב / לא לחיוב

test('billable and non-billable hours stay in two separate columns', () => {
  const rows: HoursRow[] = [
    { reporter: 'יוסי', hours: 3, countsInBank: true },
    { reporter: 'יוסי', hours: 1.5, countsInBank: false },
    { reporter: 'דנה', hours: 2, countsInBank: true },
    { reporter: 'דנה', hours: 0.5, countsInBank: null },
  ];
  const split = splitHours(rows);
  assert.equal(split.billable, 5);
  assert.equal(split.nonBillable, 2, 'שעה בלי סוג נספרת כלא לחיוב ולא נעלמת מהסכום');
  assert.equal(split.total, 7);
  assert.equal(split.billable + split.nonBillable, split.total);
});

test('subtotals per reporting employee add up to the grand total', () => {
  const rows: HoursRow[] = [
    { reporter: 'יוסי', hours: 3, countsInBank: true },
    { reporter: 'דנה', hours: 2, countsInBank: true },
    { reporter: 'דנה', hours: 1.25, countsInBank: false },
    { reporter: '', hours: 0.75, countsInBank: false },
  ];
  const { groups, grand } = splitByReporter(rows);
  assert.deepEqual(groups.map((g) => g.reporter), ['דנה', 'יוסי', '—']);
  const dana = groups.find((g) => g.reporter === 'דנה')!;
  assert.deepEqual([dana.billable, dana.nonBillable, dana.total], [2, 1.25, 3.25]);
  assert.equal(grand.total, 7);
  assert.equal(
    groups.reduce((s, g) => s + g.total, 0),
    grand.total,
  );
  assert.equal(
    groups.reduce((s, g) => s + g.billable, 0),
    grand.billable,
  );
});

test('an empty hours report is zero, not NaN', () => {
  const split = splitHours([]);
  assert.deepEqual(split, { billable: 0, nonBillable: 0, total: 0 });
  assert.deepEqual(splitByReporter([]).groups, []);
});

// -------------------------------------------------- שירותים חודשיים

test('a price set on the client overrides the catalogue price when it is non-zero', () => {
  assert.equal(effectivePrice(120, 5000), 120);
  assert.equal(effectivePrice(0, 5000), 5000, 'אפס פירושו "לפי הקטלוג", לא בחינם');
  assert.equal(effectivePrice(null, 5000), 5000);
  assert.equal(effectivePrice(120, 0), 120);
  assert.equal(effectivePrice(0, 0), 0);
});

test('a line is the effective price times the quantity', () => {
  assert.equal(lineTotal({ cost: 0, price: 250, qty: 3 }), 750);
  assert.equal(lineTotal({ cost: 100, price: 250, qty: 2 }), 200);
  assert.equal(lineTotal({ cost: null, price: 99.9, qty: 1 }), 99.9);
  assert.equal(lineTotal({ cost: 100, price: 250, qty: null }), 0);
});

test('the monthly revenue total follows the same override rule', () => {
  assert.equal(
    monthlyRevenue([
      { cost: 0, price: 5000, qty: 1 },
      { cost: 300, price: 5000, qty: 2 },
      { cost: 0, price: 0, qty: 10 },
    ]),
    5600,
  );
  assert.equal(monthlyRevenue([]), 0);
});
