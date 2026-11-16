import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_WARN_SECONDS, idleMinutesOf, idlePhase, secondsUntilLock } from './idle.ts';

const minutes = (n: number) => n * 60_000;

test('the warning comes a minute before the lock, and not before', () => {
  assert.equal(IDLE_WARN_SECONDS, 60);
  assert.equal(idlePhase(minutes(0), 45), 'active');
  assert.equal(idlePhase(minutes(43.9), 45), 'active');
  assert.equal(idlePhase(minutes(44), 45), 'warning');
  assert.equal(idlePhase(minutes(44.9), 45), 'warning');
  assert.equal(idlePhase(minutes(45), 45), 'locked');
  assert.equal(idlePhase(minutes(90), 45), 'locked');
});

test('the countdown shown in the warning', () => {
  assert.equal(secondsUntilLock(minutes(44), 45), 60);
  assert.equal(secondsUntilLock(minutes(44.5), 45), 30);
  assert.equal(secondsUntilLock(minutes(46), 45), 0);
  assert.equal(secondsUntilLock(minutes(5), 0), Number.POSITIVE_INFINITY);
});

test('a company may switch the automatic lock off', () => {
  assert.equal(idlePhase(minutes(600), 0), 'active');
  assert.equal(idlePhase(minutes(600), -1), 'active');
});

test('a window shorter than the warning still warns, and still locks', () => {
  // חצי דקה: האזהרה מופיעה מיד, אבל הנעילה עדיין קורית בזמן
  assert.equal(idlePhase(0, 0.5), 'warning');
  assert.equal(idlePhase(minutes(0.49), 0.5), 'warning');
  assert.equal(idlePhase(minutes(0.5), 0.5), 'locked');
});

test('the company parameter wins over the server default, bad values do not', () => {
  assert.equal(idleMinutesOf({ idleLogoutMinutes: 20 }, 45), 20);
  assert.equal(idleMinutesOf({ idleLogoutMinutes: 0 }, 45), 0, 'off is a real choice, not a missing value');
  assert.equal(idleMinutesOf({ idleLogoutMinutes: '20' }, 45), 45);
  assert.equal(idleMinutesOf({ idleLogoutMinutes: -5 }, 45), 45);
  assert.equal(idleMinutesOf({}, 45), 45);
  assert.equal(idleMinutesOf(null, 45), 45);
});
