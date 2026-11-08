// 純邏輯模組：金額換算、統計、CSV。不碰 DOM，可在 Node 測試。

export const CURRENCIES = {
  TWD: { symbol: 'NT$', decimals: 0 },
  USD: { symbol: 'US$', decimals: 2 },
};

/** 把使用者輸入的字串轉成「最小單位整數」（TWD=元、USD=分）。無效回傳 null。 */
export function parseAmount(text, currency) {
  const { decimals } = CURRENCIES[currency];
  const s = String(text ?? '').trim().replace(/,/g, '');
  const re = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`);
  if (!re.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const minor = Number(int) * 10 ** decimals + Number((frac + '0'.repeat(decimals)).slice(0, decimals) || 0);
  return minor > 0 ? minor : null;
}

/** 最小單位 → 顯示用數字字串（含千分位）。 */
export function formatMinor(minor, currency) {
  const { decimals } = CURRENCIES[currency];
  const value = minor / 10 ** decimals;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatMoney(minor, currency) {
  const sign = minor < 0 ? '-' : '';
  return sign + CURRENCIES[currency].symbol + formatMinor(Math.abs(minor), currency);
}

/** 最小單位 → 可編輯的純數字字串（無千分位）。 */
export function minorToInput(minor, currency) {
  const { decimals } = CURRENCIES[currency];
  return decimals ? (minor / 10 ** decimals).toFixed(decimals) : String(minor);
}

/** 換算成新台幣整數（四捨五入）。rate = 1 USD 兌多少 TWD。 */
export function toTwd(minor, currency, rate) {
  if (currency === 'TWD') return minor;
  if (!(rate > 0)) throw new Error('USD 需要有效匯率');
  return Math.round((minor * rate) / 100);
}

/** 本地日期 YYYY-MM-DD */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 某月統計。回傳 { income, expense, balance, byCategory: [{categoryId, name, twd}], items }
 * byCategory 只含支出，依「分類清單順序」排列（顏色跟著分類走，不跟排名走）。
 */
export function monthSummary(transactions, key, categories = []) {
  const items = transactions
    .filter((t) => monthKey(t.date) === key)
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  let income = 0;
  let expense = 0;
  const map = new Map();
  for (const t of items) {
    if (t.type === 'income') income += t.twd;
    else {
      expense += t.twd;
      const cur = map.get(t.categoryId) || { categoryId: t.categoryId, name: t.categoryName, twd: 0 };
      cur.twd += t.twd;
      map.set(t.categoryId, cur);
    }
  }
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const byCategory = [...map.values()].sort(
    (a, b) => (order.get(a.categoryId) ?? 1e9) - (order.get(b.categoryId) ?? 1e9),
  );
  return { income, expense, balance: income - expense, byCategory, items };
}

// ---------- 預算 ----------

export const BUDGET_WARN_RATIO = 0.8; // 用到 80% 提醒「快用完」

/** 預算狀態。limit 沒設（null/0）回傳 null。level：ok / warn（≥80%）/ over（>100%）。 */
export function budgetStatus(spent, limit) {
  if (!(limit > 0)) return null;
  const ratio = spent / limit;
  const level = spent > limit ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok';
  return { spent, limit, ratio, remaining: limit - spent, level };
}

/**
 * 這筆支出有沒有讓預算「跨過」門檻？只在跨過的那一刻提醒一次，不重複轟炸。
 * 回傳 'over'、'warn' 或 null。
 */
export function budgetCrossing(before, after, limit) {
  const a = budgetStatus(before, limit);
  const b = budgetStatus(after, limit);
  if (!a || !b || a.level === b.level) return null;
  if (b.level === 'over') return 'over';
  if (b.level === 'warn' && a.level === 'ok') return 'warn';
  return null;
}

/** 某月各分類支出（台幣）與總支出。 */
export function monthSpending(transactions, key) {
  const byCategory = {};
  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense' || monthKey(t.date) !== key) continue;
    total += t.twd;
    byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + t.twd;
  }
  return { total, byCategory };
}

// ---------- 明細排序 ----------

export const SORT_MODES = {
  newest: '最新在前',
  oldest: '最舊在前',
  amountDesc: '金額高→低',
  amountAsc: '金額低→高',
};

/** 依日期排序時要按天分組；依金額排序時是一整串清單。 */
export const isDateSort = (mode) => mode === 'newest' || mode === 'oldest';

/**
 * 排序明細（不改原陣列）。金額一律用換算後的台幣比較，同金額時新的在前。
 * 未知的 mode 當成 newest。
 */
export function sortItems(items, mode) {
  const byTime = (a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt); // 新→舊
  const cmp = {
    newest: byTime,
    oldest: (a, b) => -byTime(a, b),
    amountDesc: (a, b) => b.twd - a.twd || byTime(a, b),
    amountAsc: (a, b) => a.twd - b.twd || byTime(a, b),
  }[mode] || byTime;
  return [...items].sort(cmp);
}

// ---------- CSV ----------

// 「項目」＝使用者輸入的花費標題（資料欄位名稱是 note）。舊版 CSV 叫「備註」，匯入時兩者都接受。
export const CSV_HEADER = ['日期', '類型', '分類', '幣別', '金額', '匯率', '台幣金額', '項目', 'id', '建立時間'];
const TYPE_LABEL = { expense: '支出', income: '收入' };
const TYPE_FROM_LABEL = { 支出: 'expense', 收入: 'income', expense: 'expense', income: 'income' };

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 匯出 CSV（含 BOM，Excel 開啟中文不亂碼）。 */
export function toCsv(transactions) {
  const rows = [...transactions]
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt))
    .map((t) => [
      t.date,
      TYPE_LABEL[t.type],
      t.categoryName,
      t.currency,
      minorToInput(t.amount, t.currency),
      t.currency === 'USD' ? t.rate : '',
      t.twd,
      t.note || '',
      t.id,
      t.createdAt,
    ]);
  return '﻿' + [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** 解析 CSV 文字成二維陣列（支援引號、逗號、換行）。 */
export function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/**
 * CSV → 交易紀錄。回傳 { records, errors }。
 * 每筆 record 只有 categoryName，categoryId 由呼叫端依名稱對應。
 */
export function fromCsv(text) {
  const rows = parseCsv(text);
  const errors = [];
  if (!rows.length) return { records: [], errors: ['檔案是空的'] };
  const header = rows[0].map((h) => h.trim());
  const idx = Object.fromEntries(CSV_HEADER.map((h) => [h, header.indexOf(h)]));
  if (idx['項目'] < 0) idx['項目'] = header.indexOf('備註');
  for (const need of ['日期', '類型', '分類', '幣別', '金額']) {
    if (idx[need] < 0) return { records: [], errors: [`缺少欄位「${need}」，請用本 App 匯出的檔案`] };
  }
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
  const records = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = get(r, '日期');
    const type = TYPE_FROM_LABEL[get(r, '類型')];
    const currency = get(r, '幣別').toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errors.push(`第 ${line} 列：日期格式錯誤`);
    if (!type) return errors.push(`第 ${line} 列：類型要是「支出」或「收入」`);
    if (!CURRENCIES[currency]) return errors.push(`第 ${line} 列：幣別只支援 TWD、USD`);
    const amount = parseAmount(get(r, '金額'), currency);
    if (amount == null) return errors.push(`第 ${line} 列：金額無效`);
    let rate = null;
    if (currency === 'USD') {
      rate = Number(get(r, '匯率'));
      if (!(rate > 0)) return errors.push(`第 ${line} 列：美金需要匯率`);
    }
    records.push({
      id: get(r, 'id') || null,
      type,
      categoryName: get(r, '分類') || '其他',
      currency,
      amount,
      rate,
      twd: toTwd(amount, currency, rate),
      date,
      note: get(r, '項目'),
      createdAt: get(r, '建立時間') || `${date}T00:00:00.000Z`,
    });
  });
  return { records, errors };
}

/**
 * 一筆新紀錄缺什麼？全部齊了回傳 null，否則回傳要顯示在儲存鈕上的提示。
 * 依序檢查：金額 → 項目（必填）→ 分類 → 美金匯率。
 */
export function draftProblem({ amount, title, categoryId, currency, rate }) {
  if (amount == null) return '儲存';
  if (!String(title ?? '').trim()) return '請先輸入項目';
  if (!categoryId) return '請先選分類';
  if (currency === 'USD' && !(rate > 0)) return '請先設定匯率';
  return null;
}

/** 備份提醒：距離「上次備份／上次略過／開始使用」超過 days 天，且有資料。 */
export function needsBackupReminder({ txCount, lastBackupAt, lastDismissAt, firstUseAt }, now = Date.now(), days = 30) {
  if (!txCount) return false;
  const ref = Math.max(lastBackupAt || 0, lastDismissAt || 0, firstUseAt || 0);
  return now - ref > days * 86400000;
}
