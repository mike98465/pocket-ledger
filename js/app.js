import {
  CURRENCIES, parseAmount, formatMoney, formatMinor, minorToInput, toTwd,
  localDate, monthKey, shiftMonth, monthSummary, toCsv, fromCsv, needsBackupReminder, draftProblem,
  SORT_MODES, sortItems, isDateSort, budgetStatus, budgetCrossing, monthSpending, BUDGET_WARN_RATIO,
} from './core.js';
import * as store from './store.js';

const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const RATE_MAX_AGE = 6 * 3600 * 1000;
const APP_VERSION = 'v7'; // 要和 sw.js 的 VERSION 一致（有測試檢查）

const $screen = document.getElementById('screen');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const $file = document.getElementById('file-input');

// ---------- 工具 ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const seriesColor = (cat) => (cat?.color ? `var(--series-${cat.color})` : 'var(--series-none)');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M9 6h11v12H9l-6-6z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>',
};

let toastTimer;
/** level：''（一般）、'warn'（快用完）、'over'（超支）。預算提醒停留久一點。 */
function toast(msg, level = '') {
  $toast.textContent = msg;
  $toast.className = `toast show ${level}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), level ? 5000 : 2200);
}

function safe(fn) {
  try {
    fn();
  } catch (e) {
    console.error(e);
    const quota = e?.name === 'QuotaExceededError';
    toast(quota ? '儲存空間不足，請先匯出備份' : e.message || '發生錯誤');
  }
}

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WEEK[new Date(y, m - 1, d).getDay()];
  const today = localDate();
  const yest = localDate(new Date(Date.now() - 86400000));
  const prefix = dateStr === today ? '今天 · ' : dateStr === yest ? '昨天 · ' : '';
  return `${prefix}${m}月${d}日 週${wd}`;
}

// ---------- 匯率 ----------

async function ensureRate(force = false) {
  const cached = store.get().meta.rate;
  if (!force && cached && Date.now() - cached.fetchedAt < RATE_MAX_AGE) return cached;
  try {
    const res = await fetch(RATE_URL, { cache: 'no-store' });
    const data = await res.json();
    const value = data?.rates?.TWD;
    if (data.result !== 'success' || !(value > 0)) throw new Error('bad rate');
    const rate = { value: Math.round(value * 10000) / 10000, fetchedAt: Date.now(), updatedAt: data.time_last_update_utc };
    store.setMeta({ rate });
    return rate;
  } catch {
    return cached; // 沒網路：用上次的
  }
}

// ---------- 分頁 ----------

const ui = {
  tab: 'record',
  month: monthKey(localDate()),
  focusCat: null,
};

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  render();
  window.scrollTo(0, 0);
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) setTab(b.dataset.tab);
});

function render() {
  if (ui.tab === 'record') renderRecord();
  else if (ui.tab === 'stats') renderStats();
  else renderSettings();
}

// ---------- 記帳畫面 ----------

const draft = {
  type: 'expense',
  currency: 'TWD',
  input: '',
  catByType: {},
  date: localDate(),
  note: '',
  rate: null, // 數字；null 表示還沒拿到
  rateEdited: false,
};

function draftCategoryId() {
  const list = store.activeCategories(draft.type);
  const id = draft.catByType[draft.type];
  return list.some((c) => c.id === id) ? id : list[0]?.id;
}

function draftAmount() {
  return parseAmount(draft.input, draft.currency);
}

function draftIssue() {
  return draftProblem({
    amount: draftAmount(), title: draft.note, categoryId: draftCategoryId(),
    currency: draft.currency, rate: draft.rate,
  });
}

function canSave() {
  return draftIssue() == null;
}

// 打字時不重畫整個畫面（避免鍵盤收起），只更新儲存鈕
function updateSaveButton() {
  const btn = $screen.querySelector('[data-act="save"]');
  if (!btn) return;
  btn.disabled = !canSave();
  btn.textContent = draftIssue() ?? '儲存';
}

function renderRecord() {
  const s = store.get();
  const showBanner = needsBackupReminder({ txCount: s.transactions.length, ...s.meta });
  const catId = draftCategoryId();
  const cur = CURRENCIES[draft.currency];
  const amt = draftAmount();
  const display = draft.input
    ? (() => {
        const [i, f] = draft.input.split('.');
        return Number(i || 0).toLocaleString('en-US') + (f !== undefined ? '.' + f : '');
      })()
    : '0';

  $screen.innerHTML = `
    <div class="record">
      ${showBanner ? `
        <div class="card banner" role="alert">
          <p>已經超過 30 天沒備份了。資料只存在這支手機，建議現在匯出一份。</p>
          <button class="act" data-act="backup">匯出</button>
          <button class="close" data-act="dismiss" aria-label="稍後提醒">✕</button>
        </div>` : ''}
      <div class="record-top">
        <div class="seg" role="group" aria-label="收支">
          <button data-type="expense" aria-pressed="${draft.type === 'expense'}">支出</button>
          <button data-type="income" aria-pressed="${draft.type === 'income'}">收入</button>
        </div>
        <div class="seg" role="group" aria-label="幣別">
          <button data-cur="TWD" aria-pressed="${draft.currency === 'TWD'}">TWD</button>
          <button data-cur="USD" aria-pressed="${draft.currency === 'USD'}">USD</button>
        </div>
      </div>

      <div class="card amount-box">
        <div class="amount num ${draft.input ? draft.type : 'empty'}" aria-live="polite">
          <span class="cur">${cur.symbol}</span>${display}
        </div>
        ${draft.currency === 'USD' ? `
          <div class="rate-line num">
            <span>${draft.rate ? `匯率 ${draft.rate}${draft.rateEdited ? '（自訂）' : ''}${amt ? ` · ≈ ${formatMoney(toTwd(amt, 'USD', draft.rate), 'TWD')}` : ''}` : '取得匯率中…'}</span>
            <button data-act="edit-rate">修改</button>
          </div>` : ''}
        ${draft.type === 'expense' ? budgetHint(amt) : ''}
      </div>

      <div class="meta-row">
        <label class="title-input"><input type="text" id="d-note" placeholder="${draft.type === 'expense' ? '買了什麼？例如：午餐便當' : '什麼收入？例如：VOO 股息'}" value="${esc(draft.note)}" maxlength="40" enterkeyhint="done" aria-label="項目（必填）" required aria-required="true"></label>
        <label class="date-input"><input type="date" id="d-date" value="${draft.date}" max="9999-12-31" aria-label="日期"></label>
      </div>

      <div class="cats" role="group" aria-label="分類">
        ${store.activeCategories(draft.type).map((c) => `
          <button class="cat" data-cat="${c.id}" aria-pressed="${c.id === catId}">
            ${draft.type === 'expense' ? `<span class="dot" style="background:${seriesColor(c)}"></span>` : ''}${esc(c.name)}
          </button>`).join('')}
      </div>

      <div class="keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => `<button class="key num" data-key="${k}">${k}</button>`).join('')}
        <button class="key" data-key="." ${draft.currency === 'TWD' ? 'disabled aria-label="台幣不用小數點"' : 'aria-label="小數點"'}>.</button>
        <button class="key num" data-key="0">0</button>
        <button class="key" data-key="del" aria-label="刪除">${ICON.del}</button>
      </div>
      <button class="save" data-act="save" ${canSave() ? '' : 'disabled'}>${draftIssue() ?? '儲存'}</button>
    </div>`;

  if (draft.currency === 'USD' && !draft.rateEdited) {
    ensureRate().then((r) => {
      if (r && !draft.rateEdited && draft.rate !== r.value) {
        draft.rate = r.value;
        if (ui.tab === 'record') renderRecord();
      } else if (!r && !draft.rate && ui.tab === 'record') {
        const line = $screen.querySelector('.rate-line span');
        if (line) line.textContent = '無法取得匯率，請按「修改」手動輸入';
      }
    });
  }
}

function pressKey(k) {
  const dec = CURRENCIES[draft.currency].decimals;
  let s = draft.input;
  if (k === 'del') s = s.slice(0, -1);
  else if (k === '.') {
    if (!dec || s.includes('.')) return;
    s = (s || '0') + '.';
  } else {
    const [i, f] = s.split('.');
    if (f !== undefined && f.length >= dec) return;
    if (f === undefined && i.length >= 9) return;
    s = s === '0' ? k : s + k;
  }
  draft.input = s;
  renderRecord();
}

$screen.addEventListener('click', (e) => {
  if (ui.tab !== 'record') return;
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.key) return pressKey(t.dataset.key);
  if (t.dataset.type) { draft.type = t.dataset.type; return renderRecord(); }
  if (t.dataset.cur) {
    if (t.dataset.cur !== draft.currency) {
      draft.currency = t.dataset.cur;
      // 台幣不能有小數：切換時把小數拿掉
      if (draft.currency === 'TWD') draft.input = draft.input.split('.')[0];
    }
    return renderRecord();
  }
  if (t.dataset.cat) { draft.catByType[draft.type] = t.dataset.cat; return renderRecord(); }
  const act = t.dataset.act;
  if (act === 'edit-rate') {
    const v = prompt('1 美元 = 多少新台幣？', draft.rate ?? '');
    if (v == null) return;
    const n = Number(v);
    if (!(n > 0 && n < 1000)) return toast('匯率格式不對');
    draft.rate = Math.round(n * 10000) / 10000;
    draft.rateEdited = true;
    return renderRecord();
  }
  if (act === 'save') return saveDraft();
  if (act === 'backup') return exportCsv();
  if (act === 'dismiss') { store.setMeta({ lastDismissAt: Date.now() }); return renderRecord(); }
});

$screen.addEventListener('input', (e) => {
  if (ui.tab !== 'record') return;
  if (e.target.id === 'd-note') {
    draft.note = e.target.value;
    updateSaveButton();
  }
  if (e.target.id === 'd-date' && e.target.value) draft.date = e.target.value;
});

// ---------- 預算 ----------

const PCT = (r) => `${Math.round(r * 100)}%`;

/** 記帳畫面上的一行：記完這筆後，分類預算／總預算還剩多少。 */
function budgetHint(amt) {
  const s = store.get();
  const catId = draftCategoryId();
  const catLimit = s.budgets.byCategory[catId];
  if (!s.budgets.total && !catLimit) return '';
  const extra = amt && (draft.currency === 'TWD' || draft.rate > 0) ? toTwd(amt, draft.currency, draft.rate) : 0;
  const spent = monthSpending(s.transactions, monthKey(draft.date));
  const parts = [];
  let worst = 'ok';
  const add = (label, used, limit) => {
    const st = budgetStatus(used + extra, limit);
    if (!st) return;
    if (st.level === 'over' || (st.level === 'warn' && worst === 'ok')) worst = st.level;
    parts.push(st.level === 'over'
      ? `${label}超支 ${formatMoney(-st.remaining, 'TWD')}`
      : `${label}剩 ${formatMoney(st.remaining, 'TWD')}`);
  };
  add(esc(store.categoryById(catId)?.name || ''), spent.byCategory[catId] || 0, catLimit);
  add('總預算', spent.total, s.budgets.total);
  const icon = worst === 'ok' ? '' : '⚠️ ';
  return `<div class="budget-line num ${worst}">${icon}${extra ? '記完後 ' : '本月 '}${parts.join(' · ')}</div>`;
}

/** 存檔後檢查：這筆有沒有讓預算跨過 80% 或 100%。有就回傳提醒文字與等級。 */
function budgetAlert(rec, before) {
  if (rec.type !== 'expense') return null;
  const s = store.get();
  const after = monthSpending(s.transactions, monthKey(rec.date));
  const checks = [
    [rec.categoryName, before.byCategory[rec.categoryId] || 0, after.byCategory[rec.categoryId] || 0, s.budgets.byCategory[rec.categoryId]],
    ['總預算', before.total, after.total, s.budgets.total],
  ];
  const lines = [];
  let level = null;
  for (const [name, b, a, limit] of checks) {
    const crossed = budgetCrossing(b, a, limit);
    if (!crossed) continue;
    if (crossed === 'over') {
      level = 'over';
      lines.push(`${name}已超支 ${formatMoney(a - limit, 'TWD')}（預算 ${formatMoney(limit, 'TWD')}）`);
    } else {
      level = level || 'warn';
      lines.push(`${name}已用 ${PCT(a / limit)}，剩 ${formatMoney(limit - a, 'TWD')}`);
    }
  }
  const month = monthKey(rec.date) === monthKey(localDate()) ? '' : `${Number(rec.date.slice(5, 7))}月 `;
  return level ? { level, text: `⚠️ ${month}${lines.join('\n')}` } : null;
}

/** 統計頁的預算卡片：每個預算一條進度條，顏色＋文字一起標示狀態（不只靠顏色）。 */
function budgetCard(key) {
  const s = store.get();
  const spent = monthSpending(s.transactions, key);
  const rows = [];
  if (s.budgets.total) rows.push({ name: '總預算', used: spent.total, limit: s.budgets.total, color: null });
  for (const { category, limit } of store.activeCategoryBudgets()) {
    rows.push({ name: category.name, used: spent.byCategory[category.id] || 0, limit, color: seriesColor(category) });
  }
  if (!rows.length) return '';
  const label = { ok: '', warn: '⚠️ 快用完', over: '⛔ 超支' };
  return `
    <h2>本月預算</h2>
    <div class="card budget-card">
      ${rows.map((r) => {
        const st = budgetStatus(r.used, r.limit);
        return `
        <div class="budget-row ${st.level}">
          <div class="budget-top">
            <span class="name">${r.color ? `<span class="dot" style="background:${r.color}"></span>` : ''}${esc(r.name)}</span>
            <span class="num nums">${formatMinor(r.used, 'TWD')} / ${formatMinor(r.limit, 'TWD')}</span>
          </div>
          <div class="bar" role="progressbar" aria-label="${esc(r.name)}預算" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(st.ratio * 100)}">
            <span style="width:${Math.min(st.ratio, 1) * 100}%"></span>
          </div>
          <div class="budget-foot num">
            <span class="status">${label[st.level]}</span>
            <span>${st.level === 'over' ? `超出 ${formatMoney(-st.remaining, 'TWD')}` : `剩 ${formatMoney(st.remaining, 'TWD')}（已用 ${PCT(st.ratio)}）`}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/** 詢問預算金額。回傳 undefined＝不變（取消或輸入錯誤）、null＝取消預算、數字＝新預算。 */
function askBudget(title, current) {
  const v = prompt(`${title}（新台幣，留空＝不設定）`, current ? String(current) : '');
  if (v == null) return undefined;
  if (!v.trim()) return null;
  const n = parseAmount(v, 'TWD');
  if (n == null) { toast('請輸入正整數金額'); return undefined; }
  return n;
}

function saveDraft() {
  if (!canSave()) return;
  safe(() => {
    const before = monthSpending(store.get().transactions, monthKey(draft.date));
    const rec = store.addTransaction({
      type: draft.type,
      currency: draft.currency,
      amount: draftAmount(),
      rate: draft.rate,
      categoryId: draftCategoryId(),
      date: draft.date,
      note: draft.note,
    });
    draft.input = '';
    draft.note = '';
    const saved = `已記錄 ${rec.note || rec.categoryName} ${formatMoney(rec.amount, rec.currency)}`;
    const warning = budgetAlert(rec, before);
    if (warning) {
      navigator.vibrate?.([30, 60, 30]);
      toast(`${saved}
${warning.text}`, warning.level);
    } else {
      navigator.vibrate?.(10);
      toast(saved);
    }
    renderRecord();
    setTimeout(reloadIfIdle, 1500); // 有新版就趁現在換
  });
}

// ---------- 統計畫面 ----------

function donutSvg(byCategory, total) {
  const R = 80;
  const W = 22;
  const C = 2 * Math.PI * R;
  const GAP = byCategory.length > 1 ? 2 : 0; // 區塊間 2px 間隙
  let offset = 0;
  const segs = byCategory.map((c) => {
    const len = (c.twd / total) * C;
    const cat = store.categoryById(c.categoryId);
    const dash = Math.max(len - GAP, 0.5);
    const el = `<circle class="donut-seg ${ui.focusCat === c.categoryId ? 'on' : ''}" data-focus="${c.categoryId}"
      cx="100" cy="100" r="${R}" fill="none" stroke="${seriesColor(cat)}" stroke-width="${W}"
      stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 100 100)"><title>${esc(c.name)} ${formatMoney(c.twd, 'TWD')}</title></circle>`;
    offset += len;
    return el;
  });
  return `<svg viewBox="0 0 200 200" role="img" aria-label="本月支出分類圓餅圖">
    <circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--fill)" stroke-width="${W}"/>
    ${segs.join('')}</svg>`;
}

/** 明細的一列。showDate：依金額排序時在標題下方標出日期。 */
function txRow(t, showDate) {
  const [, m, d] = t.date.split('-').map(Number);
  return `
    <button class="tx" data-tx="${t.id}">
      <span class="dot" style="background:${t.type === 'expense' ? seriesColor(store.categoryById(t.categoryId)) : 'var(--income)'}"></span>
      <span class="body">
        <div class="title-line">
          <span class="title">${esc(t.note || t.categoryName)}</span>
          ${t.note ? `<span class="chip">${esc(t.categoryName)}</span>` : ''}
        </div>
        ${showDate ? `<div class="when num">${m}/${d}</div>` : ''}
      </span>
      <span class="money num">
        <div class="main ${t.type}">${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount, t.currency)}</div>
        ${t.currency === 'USD' ? `<div class="sub">≈ ${formatMoney(t.twd, 'TWD')} · @${t.rate}</div>` : ''}
      </span>
    </button>`;
}

function renderStats() {
  const s = store.get();
  const expenseOrder = s.categories.filter((c) => c.type === 'expense');
  // 圓餅圖順序 = 分類清單順序（「其他」最後），顏色跟分類走
  const ordered = [...expenseOrder.filter((c) => c.name !== '其他'), ...expenseOrder.filter((c) => c.name === '其他')];
  const sum = monthSummary(s.transactions, ui.month, ordered);
  const [y, m] = ui.month.split('-').map(Number);
  const isThisMonth = ui.month === monthKey(localDate());
  if (ui.focusCat && !sum.byCategory.some((c) => c.categoryId === ui.focusCat)) ui.focusCat = null;
  const focus = sum.byCategory.find((c) => c.categoryId === ui.focusCat);

  const sortMode = s.meta.sortMode in SORT_MODES ? s.meta.sortMode : 'newest';
  const sorted = sortItems(sum.items, sortMode);
  // 依日期排序時按天分組；依金額排序時是一整串清單
  const days = [];
  if (isDateSort(sortMode)) {
    for (const t of sorted) {
      let d = days[days.length - 1];
      if (!d || d.date !== t.date) days.push((d = { date: t.date, items: [], net: 0 }));
      d.items.push(t);
      d.net += t.type === 'income' ? t.twd : -t.twd;
    }
  }

  $screen.innerHTML = `
    <div class="month-nav">
      <h1>${y}年${m}月</h1>
      <div class="arrows">
        <button class="icon-btn" data-month="-1" aria-label="上個月">${ICON.back}</button>
        <button class="icon-btn" data-month="1" aria-label="下個月" ${isThisMonth ? 'disabled' : ''}>${ICON.fwd}</button>
      </div>
    </div>

    <div class="tiles">
      <div class="card tile"><div class="label">收入 NT$</div><div class="value num" style="color:var(--income)">${formatMinor(sum.income, 'TWD')}</div></div>
      <div class="card tile"><div class="label">支出 NT$</div><div class="value num">${formatMinor(sum.expense, 'TWD')}</div></div>
      <div class="card tile"><div class="label">結餘 NT$</div><div class="value num" style="color:${sum.balance < 0 ? 'var(--expense)' : 'var(--text)'}">${sum.balance < 0 ? '-' : ''}${formatMinor(Math.abs(sum.balance), 'TWD')}</div></div>
    </div>

    ${budgetCard(ui.month)}

    <h2>支出分類（美金已換算台幣）</h2>
    <div class="card chart-card">
      ${sum.expense ? `
        <div class="donut-wrap ${focus ? 'focused' : ''}">
          ${donutSvg(sum.byCategory, sum.expense)}
          <div class="donut-center">
            <div class="c-label">${focus ? esc(focus.name) : '總支出'}</div>
            <div class="c-value num">${formatMoney(focus ? focus.twd : sum.expense, 'TWD')}</div>
            ${focus ? `<div class="c-sub num">${Math.round((focus.twd / sum.expense) * 100)}%</div>` : ''}
          </div>
        </div>
        <ul class="legend">
          ${sum.byCategory.map((c) => `
            <li data-focus="${c.categoryId}" class="${ui.focusCat === c.categoryId ? 'on' : ''}">
              <span class="swatch" style="background:${seriesColor(store.categoryById(c.categoryId))}"></span>
              <span class="name">${esc(c.name)}</span>
              <span class="pct num">${((c.twd / sum.expense) * 100).toFixed(0)}%</span>
              <span class="amt num">${formatMoney(c.twd, 'TWD')}</span>
            </li>`).join('')}
        </ul>` : '<div class="empty-state">這個月還沒有支出</div>'}
    </div>

    <div class="list-head">
      <h2>明細（點一筆可以修改）</h2>
      <label class="sort-picker">
        <span class="sr-only">排序</span>
        <select id="sort-mode" aria-label="明細排序">
          ${Object.entries(SORT_MODES).map(([k, label]) => `<option value="${k}" ${k === sortMode ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
    </div>
    ${!sorted.length ? '<div class="card empty-state">這個月還沒有紀錄。到「記帳」記第一筆吧！</div>'
      : isDateSort(sortMode) ? days.map((d) => `
      <div class="day-head"><span>${dayLabel(d.date)}</span><span class="num">${d.net >= 0 ? '+' : ''}${formatMoney(d.net, 'TWD')}</span></div>
      <div class="card list">${d.items.map((t) => txRow(t, false)).join('')}</div>`).join('')
      : `<div class="card list" style="margin-top:6px">${sorted.map((t) => txRow(t, true)).join('')}</div>`}
  `;
}

$screen.addEventListener('change', (e) => {
  if (ui.tab !== 'stats' || e.target.id !== 'sort-mode') return;
  store.setMeta({ sortMode: e.target.value }); // 記住選擇
  renderStats();
});

$screen.addEventListener('click', (e) => {
  if (ui.tab !== 'stats') return;
  const m = e.target.closest('[data-month]');
  if (m) { ui.month = shiftMonth(ui.month, Number(m.dataset.month)); ui.focusCat = null; return renderStats(); }
  const f = e.target.closest('[data-focus]');
  if (f) { ui.focusCat = ui.focusCat === f.dataset.focus ? null : f.dataset.focus; return renderStats(); }
  const tx = e.target.closest('[data-tx]');
  if (tx) openEditor(tx.dataset.tx);
});

// 左右滑動換月份
let touchX = null;
$screen.addEventListener('touchstart', (e) => { touchX = ui.tab === 'stats' ? e.touches[0].clientX : null; }, { passive: true });
$screen.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) < 70) return;
  const next = shiftMonth(ui.month, dx < 0 ? 1 : -1);
  if (next > monthKey(localDate())) return;
  ui.month = next;
  ui.focusCat = null;
  renderStats();
});

// ---------- 編輯面板 ----------

function openEditor(id) {
  const t = store.get().transactions.find((x) => x.id === id);
  if (!t) return;
  const e = { ...t };

  const draw = () => {
    const cats = store.activeCategories(e.type);
    const current = store.categoryById(e.categoryId);
    const options = [...cats];
    if (current && current.type === e.type && !cats.includes(current)) options.unshift(current); // 已刪除的分類仍可保留
    if (!options.some((c) => c.id === e.categoryId)) e.categoryId = options[0]?.id;
    $sheet.innerHTML = `
      <form class="sheet-inner" method="dialog">
        <div class="sheet-head">
          <button type="button" data-act="close">取消</button>
          <h3 tabindex="-1" autofocus>修改紀錄</h3>
          <button type="button" class="primary" data-act="save">儲存</button>
        </div>
        <div class="seg" role="group" aria-label="收支">
          <button type="button" data-type="expense" aria-pressed="${e.type === 'expense'}">支出</button>
          <button type="button" data-type="income" aria-pressed="${e.type === 'income'}">收入</button>
        </div>
        <div class="card group">
          <label class="field"><span>幣別</span>
            <select id="e-cur"><option ${e.currency === 'TWD' ? 'selected' : ''}>TWD</option><option ${e.currency === 'USD' ? 'selected' : ''}>USD</option></select>
          </label>
          <label class="field"><span>金額</span>
            <input id="e-amt" class="num" inputmode="decimal" value="${minorToInput(e.amount, e.currency)}">
          </label>
          ${e.currency === 'USD' ? `<label class="field"><span>匯率</span>
            <input id="e-rate" class="num" inputmode="decimal" value="${e.rate ?? ''}" placeholder="1 USD = ? TWD"></label>` : ''}
          <label class="field"><span>分類</span>
            <select id="e-cat">${options.map((c) => `<option value="${c.id}" ${c.id === e.categoryId ? 'selected' : ''}>${esc(c.name)}${c.archived ? '（已刪除）' : ''}</option>`).join('')}</select>
          </label>
          <label class="field"><span>日期</span><input id="e-date" type="date" value="${e.date}"></label>
          <label class="field"><span>項目</span><input id="e-note" value="${esc(e.note)}" maxlength="40" placeholder="必填" required></label>
        </div>
        <button type="button" class="danger-btn" data-act="delete">刪除這筆</button>
      </form>`;
  };

  const readForm = () => {
    e.currency = $sheet.querySelector('#e-cur').value;
    e.categoryId = $sheet.querySelector('#e-cat').value;
    e.date = $sheet.querySelector('#e-date').value || e.date;
    e.note = $sheet.querySelector('#e-note').value;
    e._amt = $sheet.querySelector('#e-amt').value;
    const r = $sheet.querySelector('#e-rate');
    if (r) e._rate = r.value;
  };

  $sheet.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) {
      if (ev.target === $sheet) $sheet.close(); // 點背景關閉
      return;
    }
    if (b.dataset.type) {
      readForm();
      e.type = b.dataset.type;
      e.amount = parseAmount(e._amt, e.currency) ?? e.amount;
      return draw();
    }
    const act = b.dataset.act;
    if (act === 'close') return $sheet.close();
    if (act === 'delete') {
      if (!confirm(`確定刪除這筆 ${t.note || t.categoryName} ${formatMoney(t.amount, t.currency)}？`)) return;
      return safe(() => { store.deleteTransaction(t.id); $sheet.close(); toast('已刪除'); render(); });
    }
    if (act === 'save') {
      readForm();
      const amount = parseAmount(e._amt, e.currency);
      if (amount == null) return toast(e.currency === 'TWD' ? '台幣金額要是正整數' : '美金金額最多 2 位小數');
      if (!e.note.trim()) {
        $sheet.querySelector('#e-note').focus();
        return toast('項目不能空白');
      }
      let rate = null;
      if (e.currency === 'USD') {
        rate = Number(e._rate);
        if (!(rate > 0 && rate < 1000)) return toast('請輸入有效匯率');
      }
      safe(() => {
        store.updateTransaction(t.id, {
          type: e.type, currency: e.currency, amount, rate,
          categoryId: e.categoryId, date: e.date, note: e.note,
        });
        $sheet.close();
        toast('已更新');
        render();
      });
    }
  };

  $sheet.onchange = async (ev) => {
    if (ev.target.id !== 'e-cur') return;
    readForm();
    // 換幣別：金額欄位保留使用者輸入；換成 TWD 去掉小數
    if (e.currency === 'TWD') e._amt = String(e._amt).split('.')[0];
    e.amount = parseAmount(e._amt, e.currency) ?? e.amount;
    if (e.currency === 'USD' && !e.rate) e.rate = (await ensureRate())?.value ?? null;
    draw();
    $sheet.querySelector('#e-amt').value = e._amt;
  };

  draw();
  $sheet.showModal();
}

// ---------- 設定畫面 ----------

const settingsUi = { catType: 'expense' };

function renderSettings() {
  const s = store.get();
  const cats = store.activeCategories(settingsUi.catType);
  const last = s.meta.lastBackupAt ? new Date(s.meta.lastBackupAt).toLocaleDateString('zh-TW') : '從未備份';
  const rate = s.meta.rate;
  $screen.innerHTML = `
    <h1>設定</h1>

    <h2>每月預算</h2>
    <div class="card group">
      <button class="row" data-budget="total">
        <span class="grow">總預算</span>
        <span class="detail num">${s.budgets.total ? formatMoney(s.budgets.total, 'TWD') : '未設定'}</span>
        <span class="link">設定</span>
      </button>
      ${store.activeCategories('expense').map((c) => `
        <button class="row" data-budget="${c.id}">
          <span class="dot" style="background:${seriesColor(c)}"></span>
          <span class="grow">${esc(c.name)}</span>
          <span class="detail num">${s.budgets.byCategory[c.id] ? formatMoney(s.budgets.byCategory[c.id], 'TWD') : '未設定'}</span>
          <span class="link">設定</span>
        </button>`).join('')}
    </div>
    <p class="foot">每個月套用同一組預算，美金支出換算成台幣計算。用到 ${PCT(BUDGET_WARN_RATIO)} 時提醒快用完，超過預算時提醒超支；記帳畫面會顯示還剩多少。</p>

    <h2>分類</h2>
    <div class="seg" role="group" aria-label="分類類型" style="margin-bottom:8px">
      <button data-ctype="expense" aria-pressed="${settingsUi.catType === 'expense'}">支出分類</button>
      <button data-ctype="income" aria-pressed="${settingsUi.catType === 'income'}">收入分類</button>
    </div>
    <div class="card group">
      ${cats.map((c) => `
        <div class="row">
          ${settingsUi.catType === 'expense' ? `<span class="dot" style="background:${seriesColor(c)}"></span>` : ''}
          <span class="grow">${esc(c.name)}</span>
          <button class="link" data-rename="${c.id}">改名</button>
          <button class="del" data-archive="${c.id}">刪除</button>
        </div>`).join('')}
      <button class="row action" data-act="add-cat">＋ 新增分類</button>
    </div>
    <p class="foot">刪除分類後，舊紀錄會保留原本的分類名稱。「其他」永遠排在最後。</p>

    <h2>備份</h2>
    <div class="card group">
      <button class="row action" data-act="export">匯出 CSV（可用 Excel 開啟）</button>
      <button class="row action" data-act="import">從 CSV 匯入／還原</button>
      <div class="row"><span class="grow">上次備份</span><span class="detail">${last}</span></div>
      <div class="row"><span class="grow">紀錄筆數</span><span class="detail num">${s.transactions.length}</span></div>
    </div>
    <p class="foot">資料只存在這支 iPhone 的這個 App 裡。換手機或刪除 App 前，請先匯出 CSV 存到「檔案」或雲端硬碟。匯入時重複的紀錄會自動略過。</p>

    <h2>匯率</h2>
    <div class="card group">
      <div class="row"><span class="grow">1 USD</span><span class="detail num">${rate ? `${rate.value} TWD` : '尚未取得'}</span></div>
      <button class="row action" data-act="refresh-rate">重新抓取匯率</button>
    </div>
    <p class="foot">${rate ? `資料更新：${esc(rate.updatedAt || '')}<br>` : ''}匯率來源：<a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a>（每日更新）。每筆美金紀錄會存下當時的匯率，之後匯率變動不影響舊帳。</p>

    <h2>關於</h2>
    <div class="card group">
      <div class="row"><span class="grow">版本</span><span class="detail">${APP_VERSION}</span></div>
      <div class="row"><span class="grow">儲存狀態</span><span class="detail" id="persist">檢查中…</span></div>
    </div>
  `;
  const $persist = document.getElementById('persist');
  if (!navigator.storage?.persisted) $persist.textContent = '不支援檢查';
  else navigator.storage.persisted().then((p) => {
    $persist.textContent = p ? '已鎖定，不會被系統清除' : '一般（建議加入主畫面使用）';
  });
}

$screen.addEventListener('click', async (e) => {
  if (ui.tab !== 'settings') return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ctype) { settingsUi.catType = b.dataset.ctype; return renderSettings(); }
  if (b.dataset.rename) {
    const c = store.categoryById(b.dataset.rename);
    const name = prompt('新的分類名稱', c.name);
    if (name == null) return;
    return safe(() => { store.renameCategory(c.id, name); renderSettings(); });
  }
  if (b.dataset.archive) {
    const c = store.categoryById(b.dataset.archive);
    if (!confirm(`刪除分類「${c.name}」？舊紀錄會保留這個名稱。`)) return;
    return safe(() => { store.archiveCategory(c.id); renderSettings(); });
  }
  const act = b.dataset.act;
  if (b.dataset.budget) {
    const isTotal = b.dataset.budget === 'total';
    const c = isTotal ? null : store.categoryById(b.dataset.budget);
    const cur = isTotal ? store.get().budgets.total : store.get().budgets.byCategory[c.id];
    const v = askBudget(isTotal ? '每月總預算' : `「${c.name}」每月預算`, cur);
    if (v === undefined) return;
    return safe(() => {
      if (isTotal) store.setTotalBudget(v);
      else store.setCategoryBudget(c.id, v);
      toast(v ? `已設定 ${formatMoney(v, 'TWD')}` : '已取消預算');
      renderSettings();
    });
  }
  if (act === 'add-cat') {
    const name = prompt(settingsUi.catType === 'expense' ? '新增支出分類' : '新增收入分類');
    if (name == null) return;
    return safe(() => { store.addCategory(settingsUi.catType, name); renderSettings(); });
  }
  if (act === 'export') return exportCsv();
  if (act === 'import') { $file.value = ''; return $file.click(); }
  if (act === 'refresh-rate') {
    const r = await ensureRate(true);
    toast(r ? `1 USD = ${r.value} TWD` : '無法連線，請稍後再試');
    if (!draft.rateEdited && r) draft.rate = r.value;
    return renderSettings();
  }
});

// ---------- 匯出／匯入 ----------

async function exportCsv() {
  const s = store.get();
  if (!s.transactions.length) return toast('還沒有紀錄可以匯出');
  const name = `記帳備份-${localDate()}.csv`;
  const blob = new Blob([toCsv(s.transactions)], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], name, { type: 'text/csv' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    store.setMeta({ lastBackupAt: Date.now() });
    toast(`已匯出 ${s.transactions.length} 筆`);
    render();
  } catch (err) {
    if (err?.name !== 'AbortError') toast('匯出失敗：' + (err?.message || err));
  }
}

$file.addEventListener('change', async () => {
  const f = $file.files?.[0];
  if (!f) return;
  const text = await f.text();
  const { records, errors } = fromCsv(text);
  if (!records.length) return toast(errors[0] || '沒有可匯入的資料');
  const msg = `找到 ${records.length} 筆紀錄${errors.length ? `，另有 ${errors.length} 列格式錯誤會略過` : ''}。要匯入嗎？（重複的會自動略過）`;
  if (!confirm(msg)) return;
  safe(() => {
    const { added, skipped } = store.importRecords(records);
    toast(`匯入 ${added} 筆${skipped ? `，略過重複 ${skipped} 筆` : ''}`);
    if (errors.length) console.warn(errors);
    render();
  });
});

// ---------- 關掉放大手勢 ----------
// iOS 不一定遵守 viewport 的 user-scalable=no，所以再攔截兩指縮放（Safari 專有的 gesture 事件）
// 與多指 touchmove。按兩下放大由 CSS touch-action: manipulation 處理。
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// ---------- 啟動 ----------

try {
  store.load();
} catch (e) {
  $screen.innerHTML = '<div class="empty-state">無法讀取本機儲存空間。<br>請確認不是在「私密瀏覽」模式。</div>';
  throw e;
}
navigator.storage?.persist?.();
render();
ensureRate().then((r) => { if (r && !draft.rateEdited) draft.rate = r.value; });

// 回到前景時，日期若跨日就更新成今天
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const today = localDate();
  if (draft.lastToday && draft.lastToday !== today && draft.date === draft.lastToday) {
    draft.date = today;
    if (ui.tab === 'record') renderRecord();
  }
  draft.lastToday = today;
});
draft.lastToday = localDate();

// ---------- 自動更新 ----------
// 新版 service worker 接手後重新載入頁面；但正在輸入或開著編輯面板時先不打斷，等閒置再換。
let updateReady = false;
$sheet.addEventListener('close', () => setTimeout(reloadIfIdle, 1500));

function reloadIfIdle() {
  if (!updateReady) return;
  const busy = draft.input || draft.note.trim() || $sheet.open;
  if (!busy) location.reload();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller; // 第一次安裝不用重新載入
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // iPhone 上滑掉 App 不一定真的結束它，所以每次回到前景都檢查一次更新
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
        else reloadIfIdle();
      });
    })
    .catch((e) => console.warn('SW 註冊失敗', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    updateReady = true;
    reloadIfIdle();
  });
}

