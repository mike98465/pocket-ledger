import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, formatMoney, toTwd, monthSummary, shiftMonth,
  toCsv, fromCsv, parseCsv, needsBackupReminder,
} from '../js/core.js';

test('parseAmount：台幣只收整數', () => {
  assert.equal(parseAmount('120', 'TWD'), 120);
  assert.equal(parseAmount('1,200', 'TWD'), 1200);
  assert.equal(parseAmount('12.5', 'TWD'), null);
  assert.equal(parseAmount('0', 'TWD'), null);
  assert.equal(parseAmount('abc', 'TWD'), null);
});

test('parseAmount：美金到小數 2 位，存成分', () => {
  assert.equal(parseAmount('12.5', 'USD'), 1250);
  assert.equal(parseAmount('12.05', 'USD'), 1205);
  assert.equal(parseAmount('12', 'USD'), 1200);
  assert.equal(parseAmount('12.', 'USD'), 1200);
  assert.equal(parseAmount('12.345', 'USD'), null);
});

test('formatMoney', () => {
  assert.equal(formatMoney(1234567, 'TWD'), 'NT$1,234,567');
  assert.equal(formatMoney(1250, 'USD'), 'US$12.50');
  assert.equal(formatMoney(-300, 'TWD'), '-NT$300');
});

test('toTwd：美金依匯率四捨五入成台幣整數', () => {
  assert.equal(toTwd(500, 'TWD'), 500);
  assert.equal(toTwd(1250, 'USD', 32.847), 411); // 12.50 * 32.847 = 410.5875
  assert.equal(toTwd(100, 'USD', 32.5), 33); // 32.5 → 33
  assert.throws(() => toTwd(100, 'USD', 0));
});

test('shiftMonth 跨年', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

const cats = [
  { id: 'food', name: '餐飲' },
  { id: 'traffic', name: '交通' },
];
const txs = [
  { id: '1', type: 'expense', categoryId: 'traffic', categoryName: '交通', currency: 'TWD', amount: 50, twd: 50, date: '2026-11-02', createdAt: 'a' },
  { id: '2', type: 'expense', categoryId: 'food', categoryName: '餐飲', currency: 'TWD', amount: 120, twd: 120, date: '2026-11-03', createdAt: 'b' },
  { id: '3', type: 'income', categoryId: 'inv', categoryName: '投資', currency: 'USD', amount: 1250, rate: 32.847, twd: 411, date: '2026-11-05', createdAt: 'c' },
  { id: '4', type: 'expense', categoryId: 'food', categoryName: '餐飲', currency: 'TWD', amount: 80, twd: 80, date: '2026-10-31', createdAt: 'd' },
];

test('monthSummary：合計、結餘、分類依清單順序', () => {
  const s = monthSummary(txs, '2026-11', cats);
  assert.equal(s.income, 411);
  assert.equal(s.expense, 170);
  assert.equal(s.balance, 241);
  assert.deepEqual(s.byCategory.map((c) => [c.categoryId, c.twd]), [['food', 120], ['traffic', 50]]);
  assert.deepEqual(s.items.map((t) => t.id), ['3', '2', '1']);
});

test('CSV 匯出再匯入，資料一致', () => {
  const tricky = { ...txs[0], id: '9', note: '含,逗號 "引號"\n換行' };
  const csv = toCsv([...txs, tricky]);
  assert.ok(csv.startsWith('﻿日期,'));
  const { records, errors } = fromCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 5);
  const r9 = records.find((r) => r.id === '9');
  assert.equal(r9.note, '含,逗號 "引號"\n換行');
  const r3 = records.find((r) => r.id === '3');
  assert.equal(r3.amount, 1250);
  assert.equal(r3.rate, 32.847);
  assert.equal(r3.twd, 411);
  assert.equal(r3.type, 'income');
});

test('fromCsv：錯誤列會回報、正確列照收', () => {
  const csv = '日期,類型,分類,幣別,金額,匯率\n2026-11-01,支出,餐飲,TWD,100,\n2026-13,支出,餐飲,TWD,100,\n2026-11-02,收入,投資,USD,10,\n';
  const { records, errors } = fromCsv(csv);
  assert.equal(records.length, 1);
  assert.equal(errors.length, 2);
});

test('parseCsv 處理 CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('needsBackupReminder', () => {
  const day = 86400000;
  const now = 100 * day;
  assert.equal(needsBackupReminder({ txCount: 0, firstUseAt: 0 }, now), false);
  assert.equal(needsBackupReminder({ txCount: 5, firstUseAt: 80 * day }, now), false);
  assert.equal(needsBackupReminder({ txCount: 5, firstUseAt: 60 * day }, now), true);
  assert.equal(needsBackupReminder({ txCount: 5, firstUseAt: 1, lastBackupAt: 75 * day }, now), false);
  assert.equal(needsBackupReminder({ txCount: 5, firstUseAt: 1, lastDismissAt: 90 * day }, now), false);
});

test('fromCsv：舊版「備註」欄位也能匯入成項目', () => {
  const { records } = fromCsv('日期,類型,分類,幣別,金額,匯率,備註\n2026-11-01,支出,餐飲,TWD,100,,午餐便當\n');
  assert.equal(records[0].note, '午餐便當');
});

test('toCsv：欄位名稱是「項目」', () => {
  assert.ok(toCsv([]).startsWith('﻿日期,類型,分類,幣別,金額,匯率,台幣金額,項目,'));
});

test('draftProblem：項目必填，依序提示缺什麼', async () => {
  const { draftProblem } = await import('../js/core.js');
  const ok = { amount: 100, title: '午餐', categoryId: 'c', currency: 'TWD', rate: null };
  assert.equal(draftProblem(ok), null);
  assert.equal(draftProblem({ ...ok, amount: null }), '儲存'); // 還沒輸入金額：按鈕維持「儲存」但不能按
  assert.equal(draftProblem({ ...ok, title: '' }), '請先輸入項目');
  assert.equal(draftProblem({ ...ok, title: '   ' }), '請先輸入項目');
  assert.equal(draftProblem({ ...ok, categoryId: undefined }), '請先選分類');
  assert.equal(draftProblem({ ...ok, currency: 'USD', rate: null }), '請先設定匯率');
  assert.equal(draftProblem({ ...ok, currency: 'USD', rate: 32.8 }), null);
});

test('sortItems：四種排序，不改原陣列', async () => {
  const { sortItems, isDateSort } = await import('../js/core.js');
  const items = [
    { id: 'a', date: '2026-11-01', createdAt: '1', twd: 300 },
    { id: 'b', date: '2026-11-03', createdAt: '2', twd: 50 },
    { id: 'c', date: '2026-11-02', createdAt: '3', twd: 300 },
    { id: 'd', date: '2026-11-03', createdAt: '4', twd: 1200 },
  ];
  const ids = (mode) => sortItems(items, mode).map((t) => t.id).join('');
  assert.equal(ids('newest'), 'dbca');
  assert.equal(ids('oldest'), 'acbd');
  assert.equal(ids('amountDesc'), 'dcab'); // 同為 300：較新的 c 在前
  assert.equal(ids('amountAsc'), 'bcad');
  assert.equal(ids('???'), 'dbca');
  assert.equal(items.map((t) => t.id).join(''), 'abcd');
  assert.equal(isDateSort('oldest'), true);
  assert.equal(isDateSort('amountAsc'), false);
});

test('budgetStatus：沒設預算回 null；80% 以上 warn；超過 100% 才算 over', async () => {
  const { budgetStatus } = await import('../js/core.js');
  assert.equal(budgetStatus(500, null), null);
  assert.equal(budgetStatus(500, 0), null);
  assert.equal(budgetStatus(7999, 10000).level, 'ok');
  assert.equal(budgetStatus(8000, 10000).level, 'warn');
  assert.equal(budgetStatus(10000, 10000).level, 'warn'); // 剛好用完還不算超支
  const s = budgetStatus(10001, 10000);
  assert.equal(s.level, 'over');
  assert.equal(s.remaining, -1);
});

test('budgetCrossing：只在跨過門檻那一筆提醒', async () => {
  const { budgetCrossing } = await import('../js/core.js');
  assert.equal(budgetCrossing(7000, 7500, 10000), null); // 還沒到 80%
  assert.equal(budgetCrossing(7500, 8200, 10000), 'warn'); // 跨過 80%
  assert.equal(budgetCrossing(8200, 9000, 10000), null); // 已經提醒過
  assert.equal(budgetCrossing(9000, 10500, 10000), 'over'); // 跨過 100%
  assert.equal(budgetCrossing(7000, 12000, 10000), 'over'); // 一次跨兩級只提醒超支
  assert.equal(budgetCrossing(10500, 11000, 10000), null); // 已超支過
  assert.equal(budgetCrossing(0, 50000, null), null); // 沒設預算
});

test('monthSpending：只算該月支出', async () => {
  const { monthSpending } = await import('../js/core.js');
  const r = monthSpending(txs, '2026-11');
  assert.equal(r.total, 170);
  assert.deepEqual(r.byCategory, { traffic: 50, food: 120 });
});
