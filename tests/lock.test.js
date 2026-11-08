import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, verifyPin, isValidPin, lockoutMs, shouldRelock } from '../js/lock.js';

test('hashPin／verifyPin：對的密碼通過、錯的不通過，且不存原始密碼', async () => {
  const rec = await hashPin('2580');
  assert.ok(!JSON.stringify(rec).includes('2580'));
  assert.equal(await verifyPin('2580', rec), true);
  assert.equal(await verifyPin('2581', rec), false);
  assert.equal(await verifyPin('', rec), false);
  assert.equal(await verifyPin('2580', null), false);
});

test('同一個密碼每次雜湊結果都不同（有加鹽）', async () => {
  const a = await hashPin('1234');
  const b = await hashPin('1234');
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.salt, b.salt);
});

test('密碼格式：只收 4 位數字', async () => {
  assert.equal(isValidPin('1234'), true);
  assert.equal(isValidPin('123'), false);
  assert.equal(isValidPin('12345'), false);
  assert.equal(isValidPin('12a4'), false);
  await assert.rejects(() => hashPin('12'), /4 位數字/);
});

test('lockoutMs：前 5 次不用等，之後 30 秒起加倍，最多 15 分鐘', () => {
  assert.equal(lockoutMs(4), 0);
  assert.equal(lockoutMs(5), 30000);
  assert.equal(lockoutMs(6), 60000);
  assert.equal(lockoutMs(7), 120000);
  assert.equal(lockoutMs(20), 15 * 60000);
});

test('shouldRelock：離開超過設定時間才重新上鎖', () => {
  assert.equal(shouldRelock(null, 1000, 60000), false);
  assert.equal(shouldRelock(0, 59999, 60000), false);
  assert.equal(shouldRelock(0, 60000, 60000), true);
  assert.equal(shouldRelock(0, 1, 0), true); // 「立即」
});
