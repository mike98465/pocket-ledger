// 本機儲存（localStorage）。資料只存在這支手機的這個 App 裡。
import { toTwd } from './core.js';

const KEY = 'pocket-ledger.v1';
export const SLOT_COUNT = 8; // 圓餅圖分類色盤（見 css 的 --series-1..8）

const DEFAULT_CATEGORIES = [
  ['expense', '餐飲'], ['expense', '交通'], ['expense', '購物'], ['expense', '居家'],
  ['expense', '娛樂'], ['expense', '醫療'], ['expense', '學習'], ['expense', '其他'],
  ['income', '薪資'], ['income', '獎金'], ['income', '投資'], ['income', '其他'],
];

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function defaults() {
  let slot = 0;
  return {
    version: 1,
    categories: DEFAULT_CATEGORIES.map(([type, name]) => ({
      id: uid(),
      type,
      name,
      // 「其他」用灰色；其餘支出分類依序取色，顏色跟著分類一輩子
      color: type === 'expense' && name !== '其他' ? ++slot : null,
      archived: false,
    })),
    transactions: [],
    meta: { firstUseAt: Date.now(), lastBackupAt: null, lastDismissAt: null, rate: null },
    budgets: { total: null, byCategory: {} }, // 每月預算（台幣），每個月都套用
  };
}

let state = null;

export function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      state = JSON.parse(raw);
      migrate();
      return state;
    } catch {
      // 資料損毀：先另存一份，不直接覆蓋
      localStorage.setItem(`${KEY}.corrupt-${Date.now()}`, raw);
    }
  }
  state = defaults();
  save();
  return state;
}

/** 舊版資料補上新欄位 */
function migrate() {
  if (!state.budgets) state.budgets = { total: null, byCategory: {} };
  if (!state.budgets.byCategory) state.budgets.byCategory = {};
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export const get = () => state;

// ---------- 分類 ----------

export function activeCategories(type) {
  const list = state.categories.filter((c) => c.type === type && !c.archived);
  // 「其他」固定排最後
  return [...list.filter((c) => c.name !== '其他'), ...list.filter((c) => c.name === '其他')];
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}

function nextColor(type) {
  if (type !== 'expense') return null;
  const used = new Set(state.categories.filter((c) => c.type === 'expense' && !c.archived).map((c) => c.color));
  for (let i = 1; i <= SLOT_COUNT; i++) if (!used.has(i)) return i;
  return null; // 色盤用完 → 灰色，不自動生新顏色
}

export function addCategory(type, name) {
  name = name.trim();
  if (!name) throw new Error('名稱不能空白');
  const same = state.categories.find((c) => c.type === type && c.name === name);
  if (same && !same.archived) throw new Error('已經有這個分類了');
  if (same) {
    same.archived = false;
    if (same.color == null) same.color = nextColor(type);
  } else {
    state.categories.push({ id: uid(), type, name, color: nextColor(type), archived: false });
  }
  save();
}

export function renameCategory(id, name) {
  name = name.trim();
  const c = categoryById(id);
  if (!name) throw new Error('名稱不能空白');
  if (state.categories.some((x) => x.id !== id && x.type === c.type && x.name === name && !x.archived)) {
    throw new Error('已經有這個分類了');
  }
  c.name = name;
  for (const t of state.transactions) if (t.categoryId === id) t.categoryName = name;
  save();
}

/** 刪除＝封存：舊紀錄保留原分類名稱，只是不能再選。 */
export function archiveCategory(id) {
  const c = categoryById(id);
  if (activeCategories(c.type).length <= 1) throw new Error('至少要保留一個分類');
  c.archived = true;
  save();
}

// ---------- 交易 ----------

export function addTransaction(t) {
  const c = categoryById(t.categoryId);
  const rec = {
    id: uid(),
    type: t.type,
    categoryId: c.id,
    categoryName: c.name,
    currency: t.currency,
    amount: t.amount,
    rate: t.currency === 'USD' ? t.rate : null,
    twd: toTwd(t.amount, t.currency, t.rate),
    date: t.date,
    note: (t.note || '').trim(),
    createdAt: new Date().toISOString(),
  };
  state.transactions.push(rec);
  save();
  return rec;
}

export function updateTransaction(id, patch) {
  const t = state.transactions.find((x) => x.id === id);
  Object.assign(t, patch);
  const c = categoryById(t.categoryId);
  if (c) t.categoryName = c.name;
  t.rate = t.currency === 'USD' ? t.rate : null;
  t.twd = toTwd(t.amount, t.currency, t.rate);
  t.note = (t.note || '').trim();
  save();
}

export function deleteTransaction(id) {
  state.transactions = state.transactions.filter((x) => x.id !== id);
  save();
}

// 沒有 id 的列（例如在 Excel 手動加的）用內容判斷是否重複
const fingerprint = (t) => [t.date, t.type, t.categoryName, t.currency, t.amount, t.note || ''].join('\u0001');

/** 匯入：依 id 去重（沒有 id 就比對內容）；分類依「類型＋名稱」對應，沒有就新建。 */
export function importRecords(records) {
  const ids = new Set(state.transactions.map((t) => t.id));
  const prints = new Set(state.transactions.map(fingerprint));
  let added = 0;
  let skipped = 0;
  for (const r of records) {
    if (r.id ? ids.has(r.id) : prints.has(fingerprint(r))) { skipped++; continue; }
    let c = state.categories.find((x) => x.type === r.type && x.name === r.categoryName && !x.archived)
      || state.categories.find((x) => x.type === r.type && x.name === r.categoryName);
    if (!c) {
      c = { id: uid(), type: r.type, name: r.categoryName, color: nextColor(r.type), archived: false };
      state.categories.push(c);
    }
    const rec = { ...r, id: r.id || uid(), categoryId: c.id, categoryName: c.name };
    state.transactions.push(rec);
    ids.add(rec.id);
    prints.add(fingerprint(rec));
    added++;
  }
  save();
  return { added, skipped };
}

// ---------- meta ----------

export function setMeta(patch) {
  Object.assign(state.meta, patch);
  save();
}

// ---------- 預算 ----------

/** 設定每月總預算；amount 為 null 表示取消。 */
export function setTotalBudget(amount) {
  state.budgets.total = amount > 0 ? amount : null;
  save();
}

/** 設定某分類的每月預算；amount 為 null 表示取消。 */
export function setCategoryBudget(categoryId, amount) {
  if (amount > 0) state.budgets.byCategory[categoryId] = amount;
  else delete state.budgets.byCategory[categoryId];
  save();
}

/** 目前有效的分類預算（排除已刪除的分類），依分類清單順序。 */
export function activeCategoryBudgets() {
  return activeCategories('expense')
    .filter((c) => state.budgets.byCategory[c.id] > 0)
    .map((c) => ({ category: c, limit: state.budgets.byCategory[c.id] }));
}

// ---------- 完整備份（JSON：紀錄＋分類＋預算＋偏好） ----------

export const BACKUP_APP = 'pocket-ledger';
export const BACKUP_VERSION = 1;

/** 產生完整備份物件。匯率快取、備份時間等只跟這支手機有關的資料不放進去。 */
export function exportBackup() {
  return {
    app: BACKUP_APP,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    categories: state.categories,
    budgets: state.budgets,
    settings: { sortMode: state.meta.sortMode ?? null },
    transactions: state.transactions,
  };
}

/** 檢查是不是本 App 的完整備份；不是就丟出看得懂的錯誤。 */
export function validateBackup(data) {
  if (!data || data.app !== BACKUP_APP) throw new Error('這不是口袋記帳本的備份檔');
  if (!(data.backupVersion <= BACKUP_VERSION)) throw new Error('備份檔版本比 App 新，請先更新 App');
  if (!Array.isArray(data.categories) || !Array.isArray(data.transactions)) throw new Error('備份檔內容不完整');
  return data;
}

/**
 * 從完整備份還原。
 * - 分類：依 id、再依「類型＋名稱」對應到這支手機的分類；名稱、顏色、刪除狀態、順序以備份為準。
 *   這支手機才有、且有紀錄的分類保留在後面（顏色和備份撞到就改用沒用過的）；沒用過的直接移除。
 * - 預算、排序偏好：以備份為準（分類 id 會換成對應後的 id）。
 * - 紀錄：合併，依 id（沒有 id 就比內容）略過重複。
 */
export function restoreBackup(raw) {
  const data = validateBackup(raw);
  const idMap = new Map(); // 備份的分類 id → 這支手機的分類 id
  const restored = [];
  for (const bc of data.categories) {
    const local = state.categories.find((c) => c.id === bc.id)
      || state.categories.find((c) => c.type === bc.type && c.name === bc.name && !restored.includes(c));
    const merged = { ...(local || {}), ...bc, id: local ? local.id : bc.id };
    idMap.set(bc.id, merged.id);
    restored.push(merged);
  }
  const restoredIds = new Set(restored.map((c) => c.id));
  // 這支手機才有的分類：有紀錄的保留，沒用過的（例如新手機的預設分類）移除，避免重複雜亂
  const used = new Set(state.transactions.map((t) => t.categoryId));
  const extras = state.categories.filter((c) => !restoredIds.has(c.id) && used.has(c.id));
  state.categories = [...restored, ...extras];
  // 這支手機才有的分類：顏色若和備份的撞到，改用沒用過的
  for (const c of extras) {
    if (c.type !== 'expense' || c.color == null || c.archived) continue;
    const clash = state.categories.some((x) => x !== c && x.type === 'expense' && !x.archived && x.color === c.color);
    if (clash) { c.color = null; c.color = nextColor('expense'); }
  }

  const byCategory = {};
  for (const [id, amount] of Object.entries(data.budgets?.byCategory || {})) {
    if (amount > 0) byCategory[idMap.get(id) || id] = amount;
  }
  state.budgets = { total: data.budgets?.total > 0 ? data.budgets.total : null, byCategory };
  if (data.settings?.sortMode) state.meta.sortMode = data.settings.sortMode;

  const ids = new Set(state.transactions.map((t) => t.id));
  const prints = new Set(state.transactions.map(fingerprint));
  let added = 0;
  let skipped = 0;
  for (const t of data.transactions) {
    const rec = { ...t, categoryId: idMap.get(t.categoryId) || t.categoryId };
    if (rec.id ? ids.has(rec.id) : prints.has(fingerprint(rec))) { skipped++; continue; }
    if (!rec.id) rec.id = uid();
    state.transactions.push(rec);
    ids.add(rec.id);
    prints.add(fingerprint(rec));
    added++;
  }
  save();
  return { added, skipped, categories: restored.length };
}
