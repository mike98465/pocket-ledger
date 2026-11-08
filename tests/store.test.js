import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 用記憶體假裝 localStorage
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../js/store.js');
const { fromCsv, toCsv } = await import('../js/core.js');

beforeEach(() => {
  mem.clear();
  store.load();
});

const expenseCat = (name) => store.activeCategories('expense').find((c) => c.name === name);

test('預設分類：「其他」灰色且排最後，其餘依序取色', () => {
  const list = store.activeCategories('expense');
  assert.equal(list.at(-1).name, '其他');
  assert.equal(list.at(-1).color, null);
  assert.deepEqual(list.slice(0, -1).map((c) => c.color), [1, 2, 3, 4, 5, 6, 7]);
});

test('色盤用完的新分類是灰色，不自動產生新顏色', () => {
  store.addCategory('expense', 'A'); // 拿到第 8 色
  store.addCategory('expense', 'B');
  assert.equal(expenseCat('A').color, 8);
  assert.equal(expenseCat('B').color, null);
});

test('刪除分類後，舊紀錄保留名稱；改名會同步舊紀錄', () => {
  const food = expenseCat('餐飲');
  store.addTransaction({ type: 'expense', currency: 'TWD', amount: 100, categoryId: food.id, date: '2026-11-01' });
  store.renameCategory(food.id, '吃飯');
  assert.equal(store.get().transactions[0].categoryName, '吃飯');
  store.archiveCategory(food.id);
  assert.equal(store.get().transactions[0].categoryName, '吃飯');
  assert.ok(!store.activeCategories('expense').some((c) => c.id === food.id));
});

test('匯入：有 id 依 id 去重，沒有 id 依內容去重', () => {
  const csv = '日期,類型,分類,幣別,金額,匯率,備註,id\n'
    + '2026-11-01,支出,餐飲,TWD,100,,午餐,abc\n'
    + '2026-11-02,支出,餐飲,TWD,50,,手動加的,\n';
  const { records } = fromCsv(csv);
  assert.deepEqual(store.importRecords(records), { added: 2, skipped: 0 });
  assert.deepEqual(store.importRecords(fromCsv(csv).records), { added: 0, skipped: 2 });
  assert.equal(store.get().transactions.length, 2);
});

test('匯入不存在的分類會自動建立', () => {
  const { records } = fromCsv('日期,類型,分類,幣別,金額\n2026-11-01,支出,寵物,TWD,300\n');
  store.importRecords(records);
  const pet = expenseCat('寵物');
  assert.ok(pet);
  assert.equal(store.get().transactions[0].categoryId, pet.id);
});

test('匯出→清空→匯入，資料完全還原', () => {
  const food = expenseCat('餐飲');
  const inv = store.activeCategories('income').find((c) => c.name === '投資');
  store.addTransaction({ type: 'expense', currency: 'TWD', amount: 85, categoryId: food.id, date: '2026-11-08', note: '午餐, "便當"' });
  store.addTransaction({ type: 'income', currency: 'USD', amount: 321, rate: 32.847, categoryId: inv.id, date: '2026-11-08' });
  const before = store.get().transactions.map(({ categoryId, ...rest }) => rest);
  const csv = toCsv(store.get().transactions);
  store.get().transactions.length = 0;
  store.importRecords(fromCsv(csv).records);
  const after = store.get().transactions.map(({ categoryId, ...rest }) => rest);
  assert.deepEqual(after, before);
});

test('預算：設定、取消；刪除的分類不列入；舊資料自動補欄位', () => {
  const food = expenseCat('餐飲');
  const fun = expenseCat('娛樂');
  store.setTotalBudget(20000);
  store.setCategoryBudget(food.id, 6000);
  store.setCategoryBudget(fun.id, 2000);
  assert.equal(store.get().budgets.total, 20000);
  assert.deepEqual(store.activeCategoryBudgets().map((b) => [b.category.name, b.limit]), [['餐飲', 6000], ['娛樂', 2000]]);
  store.archiveCategory(fun.id);
  assert.deepEqual(store.activeCategoryBudgets().map((b) => b.category.name), ['餐飲']);
  store.setCategoryBudget(food.id, null);
  store.setTotalBudget(0);
  assert.equal(store.get().budgets.total, null);
  assert.deepEqual(store.activeCategoryBudgets(), []);

  // 舊版資料沒有 budgets 欄位
  const old = JSON.parse(mem.get('pocket-ledger.v1'));
  delete old.budgets;
  mem.set('pocket-ledger.v1', JSON.stringify(old));
  store.load();
  assert.deepEqual(store.get().budgets, { total: null, byCategory: {} });
});
