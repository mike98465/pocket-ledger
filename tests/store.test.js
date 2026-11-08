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

test('完整備份：舊手機 → 新手機（分類 id 不同）完整還原', () => {
  // 舊手機：改名、刪除、新增分類，設預算與排序，記幾筆
  const food = expenseCat('餐飲');
  store.renameCategory(food.id, '吃飯');
  store.archiveCategory(expenseCat('醫療').id);
  store.addCategory('expense', '寵物');
  const pet = expenseCat('寵物');
  store.setTotalBudget(20000);
  store.setCategoryBudget(food.id, 6000);
  store.setCategoryBudget(pet.id, 1500);
  store.setMeta({ sortMode: 'amountDesc' });
  store.addTransaction({ type: 'expense', currency: 'TWD', amount: 120, categoryId: food.id, date: '2026-11-01', note: '午餐' });
  store.addTransaction({ type: 'expense', currency: 'TWD', amount: 800, categoryId: pet.id, date: '2026-11-02', note: '飼料' });
  const backup = JSON.parse(JSON.stringify(store.exportBackup())); // 模擬寫成檔案再讀回
  const oldCats = store.get().categories.map((c) => [c.type, c.name, c.color, c.archived]);

  // 新手機：全新預設資料（分類 id 都不一樣），先記一筆
  mem.clear();
  store.load();
  const newFood = expenseCat('餐飲');
  assert.notEqual(newFood.id, food.id);
  store.addTransaction({ type: 'expense', currency: 'TWD', amount: 50, categoryId: newFood.id, date: '2026-11-03', note: '新手機的早餐' });

  const r = store.restoreBackup(backup);
  assert.deepEqual([r.added, r.skipped], [2, 0]);

  const s = store.get();
  // 分類：名稱、顏色、刪除狀態、順序和舊手機一樣；
  // 新手機的「餐飲」有一筆早餐所以保留在最後，顏色和「吃飯」撞到 → 換成沒用過的第 8 色
  assert.deepEqual(s.categories.map((c) => [c.type, c.name, c.color, c.archived]), [...oldCats, ['expense', '餐飲', 8, false]]);
  const eat = expenseCat('吃飯');
  assert.equal(s.transactions.find((t) => t.note === '新手機的早餐').categoryId, newFood.id);
  // 預算接到正確的分類
  assert.equal(s.budgets.total, 20000);
  assert.equal(s.budgets.byCategory[eat.id], 6000);
  assert.equal(s.budgets.byCategory[expenseCat('寵物').id], 1500);
  assert.equal(s.meta.sortMode, 'amountDesc');
  // 紀錄：3 筆，每筆都指到存在的分類
  assert.equal(s.transactions.length, 3);
  for (const t of s.transactions) assert.ok(store.categoryById(t.categoryId), `分類不存在：${t.categoryName}`);
  assert.equal(s.transactions.find((t) => t.note === '飼料').categoryId, expenseCat('寵物').id);

  // 再還原一次：全部略過，不重複
  assert.deepEqual([store.restoreBackup(backup).added, store.restoreBackup(backup).skipped], [0, 2]);
  assert.equal(store.get().transactions.length, 3);
});

test('完整備份：這支手機才有的分類保留，顏色撞到會換掉', () => {
  const backup = JSON.parse(JSON.stringify(store.exportBackup()));
  mem.clear();
  store.load();
  store.addCategory('expense', '旅遊'); // 新手機拿到第 8 色
  store.addTransaction({ type: 'expense', currency: 'TWD', amount: 3000, categoryId: expenseCat('旅遊').id, date: '2026-11-04', note: '機票' });
  backup.categories.push({ id: 'b-pet', type: 'expense', name: '寵物', color: 8, archived: false }); // 備份裡第 8 色是寵物
  store.restoreBackup(backup);
  const travel = expenseCat('旅遊');
  assert.ok(travel, '新手機的分類要保留');
  assert.equal(expenseCat('寵物').color, 8);
  assert.notEqual(travel.color, 8); // 撞色 → 改掉（色盤用完就是灰色 null）
});

test('完整備份：不是本 App 的檔案會被擋下', () => {
  assert.throws(() => store.restoreBackup({ foo: 1 }), /不是口袋記帳本的備份檔/);
  assert.throws(() => store.restoreBackup({ app: 'pocket-ledger', backupVersion: 99, categories: [], transactions: [] }), /版本比 App 新/);
  assert.throws(() => store.restoreBackup({ app: 'pocket-ledger', backupVersion: 1 }), /不完整/);
});

test('完整備份：新手機沒用過的預設分類，還原後不會多出來', () => {
  store.renameCategory(expenseCat('餐飲').id, '吃飯');
  const backup = JSON.parse(JSON.stringify(store.exportBackup()));
  mem.clear();
  store.load(); // 全新手機，什麼都還沒記
  store.restoreBackup(backup);
  const names = store.activeCategories('expense').map((c) => c.name);
  assert.ok(names.includes('吃飯'));
  assert.ok(!names.includes('餐飲'), '不應該多出沒用過的「餐飲」');
  assert.equal(store.get().categories.length, backup.categories.length);
});
