import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  NonceJar,
  WaSsoError,
  WA_SSO_TTL_SECONDS,
  signWaToken,
  verifyWaToken,
} from './waSso.ts';

const SECRET = 'shared-with-wa-team';
const NOW = Date.UTC(2026, 0, 1, 10, 0, 0);
const rejects = (fn: () => unknown, why: string) => assert.throws(fn, WaSsoError, why);

test('a token signed by wa-team opens the session in its own company', () => {
  const token = signWaToken(SECRET, { aud: 'servcall', waAccountId: 3, waUserId: 41 }, NOW);
  const payload = verifyWaToken(SECRET, token, { aud: 'servcall' }, NOW + 1000);
  assert.equal(payload.waAccountId, 3);
  assert.equal(payload.waUserId, 41);
  assert.equal(payload.exp - payload.iat, WA_SSO_TTL_SECONDS);
});

test('another secret cannot mint a token', () => {
  const token = signWaToken('someone-elses-secret', { aud: 'servcall', waAccountId: 3, waUserId: 41 }, NOW);
  rejects(() => verifyWaToken(SECRET, token, { aud: 'servcall' }, NOW), 'bad signature');
});

test('the payload cannot be edited without the secret', () => {
  const token = signWaToken(SECRET, { aud: 'servcall', waAccountId: 3, waUserId: 41 }, NOW);
  const [prefix, body, sig] = token.split('.');
  const forged = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8'));
  forged.waUserId = 1; // להיכנס בשם מישהו אחר
  const tampered = [prefix, Buffer.from(JSON.stringify(forged)).toString('base64url'), sig].join('.');
  rejects(() => verifyWaToken(SECRET, tampered, { aud: 'servcall' }, NOW), 'bad signature');
});

test('an outgoing token is not accepted as an incoming one', () => {
  const outgoing = signWaToken(SECRET, { aud: 'wa-team' }, NOW);
  rejects(() => verifyWaToken(SECRET, outgoing, { aud: 'servcall' }, NOW), 'wrong audience');
});

test('a token expires, with a little patience for clock skew', () => {
  const token = signWaToken(SECRET, { aud: 'servcall', waAccountId: 3, waUserId: 41 }, NOW);
  // 20 שניות אחרי התפוגה: שעון שסטה, עוד תקין
  assert.ok(verifyWaToken(SECRET, token, { aud: 'servcall' }, NOW + (WA_SSO_TTL_SECONDS + 20) * 1000));
  rejects(
    () => verifyWaToken(SECRET, token, { aud: 'servcall' }, NOW + (WA_SSO_TTL_SECONDS + 90) * 1000),
    'expired',
  );
  rejects(() => verifyWaToken(SECRET, token, { aud: 'servcall' }, NOW - 5 * 60_000), 'issued in the future');
});

test('a self-signed long lifetime is refused even when the signature is ours', () => {
  const iat = Math.floor(NOW / 1000);
  const body =
    'sc1.' +
    Buffer.from(
      JSON.stringify({ v: 1, aud: 'servcall', iat, exp: iat + 86_400, nonce: 'n', waAccountId: 3, waUserId: 41 }),
    ).toString('base64url');
  const token = body + '.' + createHmac('sha256', SECRET).update(body).digest('base64url');
  rejects(() => verifyWaToken(SECRET, token, { aud: 'servcall' }, NOW), 'lifetime too long');
});

test('a malformed token is rejected and never parsed', () => {
  rejects(() => verifyWaToken(SECRET, 'nonsense', { aud: 'servcall' }, NOW), 'malformed token');
  rejects(() => verifyWaToken(SECRET, 'sc2.a.b', { aud: 'servcall' }, NOW), 'malformed token');
  rejects(() => verifyWaToken('', 'sc1.a.b', { aud: 'servcall' }, NOW), 'not configured');
});

test('next must stay inside this site', () => {
  const ok = signWaToken(SECRET, { aud: 'servcall', waAccountId: 3, waUserId: 41, next: '/calls/8' }, NOW);
  assert.equal(verifyWaToken(SECRET, ok, { aud: 'servcall' }, NOW).next, '/calls/8');
  const away = signWaToken(SECRET, { aud: 'servcall', waAccountId: 3, waUserId: 41, next: '//evil.example' }, NOW);
  rejects(() => verifyWaToken(SECRET, away, { aud: 'servcall' }, NOW), 'bad next path');
});

test('a token in the browser history cannot be used twice', () => {
  const jar = new NonceJar();
  assert.equal(jar.use('abc', NOW), true);
  assert.equal(jar.use('abc', NOW + 1000), false);
  // אחרי שהאסימון ממילא פג, אין צורך להמשיך לזכור אותו
  assert.equal(jar.use('def', NOW + 10 * 60_000), true);
});
