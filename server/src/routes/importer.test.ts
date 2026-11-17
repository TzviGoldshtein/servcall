import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellText,
  parseBoolCell,
  parseMoney,
  suggestMapping,
  validateImportRow,
  type ImportField,
} from './importer.ts';

/**
 * הייבוא מאקסל הוא הדלת שדרכה נכנסים נתונים שלא אנחנו הקלדנו, ולכן הבדיקה
 * של שורה בודדת היא הלב שלו: מה מתקבל, מה נדחה, ובאיזו עמודה בדיוק.
 */

const row = (cells: Partial<Record<ImportField, string>>, n = 7) =>
  validateImportRow(n, cells, { countryCode: '972' });

test('column headers in Hebrew and English are matched automatically', () => {
  assert.deepEqual(suggestMapping(['שם לקוח', 'נייד איש קשר', 'מייל', 'עיר']), [
    'clientName',
    'contactMobile',
    'contactEmail',
    'city',
  ]);
  assert.deepEqual(suggestMapping(['Client name', 'VAT id', 'Contact mobile']), [
    'clientName',
    'vatId',
    'contactMobile',
  ]);
});

test('a column we do not recognise is left for the user to map', () => {
  const mapping = suggestMapping(['שם לקוח', 'מספר מדף בארכיון', '']);
  assert.deepEqual(mapping, ['clientName', null, null]);
});

test('the same field is never mapped to two columns', () => {
  const mapping = suggestMapping(['שם לקוח', 'שם הלקוח']);
  assert.equal(mapping[0], 'clientName');
  assert.equal(mapping[1], null);
});

test('a full row is imported, with the mobile normalised for WhatsApp', () => {
  const out = row({
    clientName: 'בית ספר אורט',
    vatId: '51-234567-8',
    city: 'חדרה',
    hourCost: '1,200 ₪',
    offline: 'לא',
    contactFirstName: 'משה',
    contactLastName: 'כהן',
    contactMobile: '050-1234567',
    contactEmail: 'Moshe@Example.COM',
    contactPosition: 'אב בית',
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.issues, []);
  assert.equal(out.client?.name, 'בית ספר אורט');
  assert.equal(out.client?.vatId, '512345678');
  assert.equal(out.client?.hourCost, 1200);
  assert.equal(out.client?.offline, false);
  assert.equal(out.contact?.mobileE164, '+972501234567');
  assert.equal(out.contact?.email, 'moshe@example.com');
});

test('a row without a client name is reported, with the row number and the column', () => {
  const out = validateImportRow(12, { clientName: '  ', city: 'חדרה' }, { countryCode: '972' });
  assert.equal(out.ok, false);
  assert.equal(out.client, null);
  assert.equal(out.issues.length, 1);
  assert.equal(out.issues[0]!.row, 12);
  assert.equal(out.issues[0]!.field, 'clientName');
  assert.equal(out.issues[0]!.column, 'שם הלקוח');
  assert.match(out.issues[0]!.reason, /שם לקוח/);
});

test('the error report names the column as it appears in the file', () => {
  const out = validateImportRow(
    3,
    { clientName: '' },
    { countryCode: '972', headers: { clientName: 'Customer (full)' } },
  );
  assert.equal(out.issues[0]!.column, 'Customer (full)');
});

test('a bad VAT id, hour cost or yes/no cell is refused, not rounded off', () => {
  assert.match(row({ clientName: 'א', vatId: '12' }).issues[0]!.reason, /ח\.פ\./);
  const cost = row({ clientName: 'א', hourCost: 'לפי הסכם' });
  assert.equal(cost.ok, false);
  assert.equal(cost.issues[0]!.field, 'hourCost');
  const offline = row({ clientName: 'א', offline: 'אולי' });
  assert.equal(offline.issues[0]!.field, 'offline');
});

test('contact details without a first name do not quietly lose the contact', () => {
  const out = row({ clientName: 'א', contactMobile: '0501234567', contactEmail: 'a@b.co' });
  assert.equal(out.ok, false);
  assert.equal(out.contact, null);
  assert.equal(out.issues[0]!.field, 'contactFirstName');
});

test('a contact mobile that cannot be matched in WhatsApp is reported', () => {
  const out = row({ clientName: 'א', contactFirstName: 'דנה', contactMobile: '1-800-500-500' });
  assert.equal(out.ok, false);
  assert.equal(out.issues[0]!.field, 'contactMobile');
  assert.match(out.issues[0]!.reason, /ווטסאפ/);
});

test('a malformed e-mail is reported and the rest of the contact still parses', () => {
  const out = row({ clientName: 'א', contactFirstName: 'דנה', contactEmail: 'dana(at)example.com' });
  assert.equal(out.ok, false);
  assert.equal(out.issues[0]!.field, 'contactEmail');
  assert.equal(out.contact?.email, null);
  assert.equal(out.contact?.firstName, 'דנה');
});

test('several problems in one row are all reported together', () => {
  const out = row({ clientName: '', vatId: 'xx', hourCost: 'חינם' });
  assert.equal(out.issues.length, 3);
  assert.deepEqual(
    out.issues.map((i) => i.field),
    ['clientName', 'vatId', 'hourCost'],
  );
});

test('a client row with no contact columns is valid on its own', () => {
  const out = row({ clientName: 'סדקום בדיקה', phone: '04-6000000' });
  assert.equal(out.ok, true);
  assert.equal(out.contact, null);
  assert.equal(out.client?.phone, '04-6000000');
});

test('numbers, yes/no words and Excel cell shapes are read the way a person wrote them', () => {
  assert.equal(parseMoney('1,200 ₪'), 1200);
  assert.equal(parseMoney('120.50'), 120.5);
  assert.equal(parseMoney(''), undefined);
  assert.equal(parseMoney('בערך 100'), undefined);
  assert.equal(parseBoolCell('כן'), true);
  assert.equal(parseBoolCell('NO'), false);
  assert.equal(parseBoolCell(''), undefined);
  assert.equal(parseBoolCell('אולי'), undefined);
  assert.equal(cellText(null), '');
  assert.equal(cellText(' אורט '), 'אורט');
  assert.equal(cellText(42), '42');
  assert.equal(cellText({ richText: [{ text: 'בית ' }, { text: 'ספר' }] }), 'בית ספר');
  assert.equal(cellText({ formula: 'A1&B1', result: 'אורט' }), 'אורט');
  assert.equal(cellText({ text: 'mail', hyperlink: 'mailto:a@b.co' }), 'mail');
  assert.equal(cellText(new Date('2026-03-01T10:00:00Z')), '2026-03-01');
});
