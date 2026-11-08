import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('app.js 的 APP_VERSION 與 sw.js 的 VERSION 一致', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8').match(/const VERSION = '([^']+)'/)[1];
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').match(/const APP_VERSION = '([^']+)'/)[1];
  assert.equal(app, sw);
});

test('sw.js 的請求都跳過瀏覽器 HTTP 快取', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /cache: 'reload'/); // 安裝時
  assert.match(sw, /cache: 'no-cache'/); // 平常請求時
});
