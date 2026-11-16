import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTheme, contrast } from './theme.ts';

const COMPANIES = [
  { code: 'kt',     primary: '#58AE2B', accent: '#00A59E', primaryTarget: 4.6 },
  { code: 'koriz',  primary: '#263674', accent: '#EF9D3A', primaryTarget: 4.6 },
  { code: 'sedcom', primary: '#5FA5E6', accent: null,      primaryTarget: 4.6 },
  { code: 'harel',  primary: '#1B68B3', accent: null,      primaryTarget: 9.0 },
];

test('every derived colour meets AA on its own background', () => {
  for (const c of COMPANIES) {
    for (const dark of [false, true]) {
      const t = deriveTheme(c, dark);
      assert.ok(t.contrastRatios.primaryOnBg >= 4.5, `${c.code} primary ${dark ? 'dark' : 'light'}`);
      assert.ok(t.contrastRatios.onPrimaryOnPrimary >= 4.5, `${c.code} onPrimary`);
      assert.ok(t.contrastRatios.onButtonOnButton >= 4.5, `${c.code} button label`);
      assert.ok(t.contrastRatios.onSubtleOnSubtle >= 4.5, `${c.code} onSubtle`);
      assert.ok(t.contrastRatios.arrowOnBg >= 3.0, `${c.code} arrow`);
    }
  }
});

test('matches the values approved on the design canvas', () => {
  const kt = deriveTheme(COMPANIES[0]!);
  assert.equal(kt.primary, '#428320');
  assert.equal(kt.button, '#00A59E');
  assert.equal(kt.onButton, '#111418');

  const koriz = deriveTheme(COMPANIES[1]!);
  assert.equal(koriz.primary, '#263674');
  assert.equal(koriz.button, '#EF9D3A');
  assert.equal(koriz.onButton, '#111418');

  const sedcom = deriveTheme(COMPANIES[2]!);
  assert.equal(sedcom.button, '#5FA5E6', 'monochrome company keeps the raw brand colour on buttons');
  assert.equal(sedcom.onButton, '#111418');

  const harel = deriveTheme(COMPANIES[3]!);
  assert.equal(harel.button, '#1B68B3');
  assert.equal(harel.onButton, '#FFFFFF', 'Harel blue is too dark for black label text');
});

test('Sedcom and Harel stay apart in the chrome', () => {
  const s = deriveTheme(COMPANIES[2]!).primary;
  const h = deriveTheme(COMPANIES[3]!).primary;
  assert.ok(contrast(s, h) >= 1.8, `Sedcom ${s} vs Harel ${h} is only ${contrast(s, h).toFixed(2)}:1`);
});

test('a hueless or extreme brand colour is reported, not silently broken', () => {
  assert.ok(deriveTheme({ primary: '#808080' }).notes.includes('noHue'));
  const yellow = deriveTheme({ primary: '#FFE94D' });
  assert.ok(yellow.notes.includes('bigShift'));
  assert.ok(yellow.contrastRatios.primaryOnBg >= 4.5);
});
