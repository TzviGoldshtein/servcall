import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactDisplayName, normaliseE164, waDigits } from './contacts.ts';

/**
 * זיהוי הודעת ווטסאפ נכנסת נשען על mobile_e164, ולכן הנרמול הוא קוד קריטי:
 * מספר שנשמר בצורה אחרת פשוט לא יזוהה, והלקוח ייראה כאלמוני.
 */

test('a local Israeli number becomes E.164 with the default country code', () => {
  assert.equal(normaliseE164('050-1234567'), '+972501234567');
  assert.equal(normaliseE164('0501234567'), '+972501234567');
  assert.equal(normaliseE164(' 050 123 4567 '), '+972501234567');
  assert.equal(normaliseE164('03-6512345'), '+97236512345');
});

test('a number that is already international is kept as it is', () => {
  assert.equal(normaliseE164('+972-50-123-4567'), '+972501234567');
  assert.equal(normaliseE164('00972501234567'), '+972501234567');
  assert.equal(normaliseE164('972501234567'), '+972501234567');
  assert.equal(normaliseE164('+1 (212) 555-0199'), '+12125550199');
});

test('a local number without the leading zero still gets the country code', () => {
  assert.equal(normaliseE164('501234567'), '+972501234567');
});

test('normalising twice changes nothing', () => {
  const once = normaliseE164('050-123-4567');
  assert.equal(normaliseE164(once), once);
});

test('the country code comes from the configuration, not from the code', () => {
  assert.equal(normaliseE164('050-1234567', '44'), '+44501234567');
  assert.equal(normaliseE164('0501234567', '1'), '+1501234567');
});

test('what is not a mobile number is rejected instead of guessed', () => {
  assert.equal(normaliseE164(''), null);
  assert.equal(normaliseE164('   '), null);
  assert.equal(normaliseE164(null), null);
  assert.equal(normaliseE164(undefined), null);
  assert.equal(normaliseE164('לא ידוע'), null);
  assert.equal(normaliseE164('*2000'), null, 'קוד מרכזייה');
  assert.equal(normaliseE164('1-800-123-456'), null, 'מספר שירות 1-800');
  assert.equal(normaliseE164('1700700700'), null, 'מספר שירות 1-700');
  assert.equal(normaliseE164('456'), null, 'קצר מדי');
  assert.equal(normaliseE164('0501234567890123'), null, 'ארוך מהתקן (15 ספרות)');
});

test('the WhatsApp form of the number is the digits without the plus', () => {
  assert.equal(waDigits('+972501234567'), '972501234567');
  assert.equal(waDigits(null), null);
  assert.equal(waDigits(''), null);
});

test('the contact is shown by its Google name, and the client keeps its own name', () => {
  // google_name מגיע מאנשי הקשר של גוגל ומנצח; שם הלקוח (clients.name) לא נוגע בזה
  assert.equal(contactDisplayName({ google_name: 'משה כהן - אורט', first_name: 'משה', last_name: 'כהן' }), 'משה כהן - אורט');
  assert.equal(contactDisplayName({ googleName: '  ', firstName: 'משה', lastName: 'כהן' }), 'משה כהן');
  assert.equal(contactDisplayName({ first_name: 'משה', last_name: null }), 'משה');
  assert.equal(contactDisplayName({ firstName: 'דנה' }), 'דנה');
});
