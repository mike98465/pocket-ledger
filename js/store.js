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
  };
}

let state = null;

export function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      state = JSON.parse(raw);
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
