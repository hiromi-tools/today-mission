"use strict";

/* ==========================================================================
   設定・定数
   ========================================================================== */
const CATEGORIES = [
  { id: "housework", label: "家事",     color: "var(--cat-housework)", bg: "var(--cat-housework-bg)" },
  { id: "work",      label: "仕事",     color: "var(--cat-work)",      bg: "var(--cat-work-bg)" },
  { id: "aoikai",    label: "あおい会", color: "var(--cat-aoikai)",    bg: "var(--cat-aoikai-bg)" },
  { id: "hogosha",   label: "保護者会", color: "var(--cat-hogosha)",   bg: "var(--cat-hogosha-bg)" },
  { id: "juken",     label: "受験",     color: "var(--cat-juken)",     bg: "var(--cat-juken-bg)" },
  { id: "other",     label: "その他",   color: "var(--cat-other)",     bg: "var(--cat-other-bg)" },
];
const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const DURATION_PRESETS = [5, 10, 15, 20, 30, 45, 60];
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const KEY_DAY = "tm_day_v1";
const KEY_RECURRING = "tm_recurring_v1";
const KEY_HISTORY = "tm_history_v1";
const KEY_DEFERRED = "tm_deferred_v1";

/* ==========================================================================
   日付ユーティリティ
   ========================================================================== */
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function weekdayOf(dateStr) {
  return new Date(dateStr + "T00:00:00").getDay();
}
function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_LABELS[d.getDay()]}）`;
}
function formatDuration(min) {
  min = Math.max(0, Math.round(min));
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ==========================================================================
   ストレージ
   ========================================================================== */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("読み込みエラー", key, e);
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("保存エラー", key, e);
  }
}

// 初回起動時のみ、固定タスクの初期セットを登録する
// （tm_recurring_v1 キーがまだ一度も保存されていない場合だけ実行 — 既存データは一切上書きしない）
const DEFAULT_RECURRING = [
  { name: "洗濯する",           category: "housework", duration: 5,  days: [0, 1, 2, 3, 4, 5, 6] },
  { name: "洗濯干す",           category: "housework", duration: 15, days: [0, 1, 2, 3, 4, 5, 6] },
  { name: "洗濯たたむ・しまう", category: "housework", duration: 10, days: [0, 1, 2, 3, 4, 5, 6] },
  { name: "朝の食器洗い",       category: "housework", duration: 15, days: [0, 1, 2, 3, 4, 5, 6] },
  { name: "夜の食器洗い",       category: "housework", duration: 20, days: [0, 1, 2, 3, 4, 5, 6] },
  { name: "掃除",               category: "housework", duration: 15, days: [0, 1, 2, 3, 4, 5, 6] },
  { name: "夜ご飯作る",         category: "housework", duration: 60, days: [0, 1, 2, 3, 4, 5, 6] },
  { name: "ゴミ捨て",           category: "housework", duration: 5,  days: [1, 4] }, // 月・木
];

let recurring;
if (localStorage.getItem(KEY_RECURRING) === null) {
  recurring = DEFAULT_RECURRING.map(r => ({ id: genId(), name: r.name, category: r.category, duration: r.duration, days: [...r.days] }));
  saveJSON(KEY_RECURRING, recurring);
} else {
  recurring = loadJSON(KEY_RECURRING, []);
}
let dayState = loadJSON(KEY_DAY, null); // { date, tasks: [...] }
let deferred = loadJSON(KEY_DEFERRED, []); // [{name, category, duration}]

function saveRecurring() { saveJSON(KEY_RECURRING, recurring); }
function saveDay() { saveJSON(KEY_DAY, dayState); }
function saveDeferred() { saveJSON(KEY_DEFERRED, deferred); }
function saveHistoryDay(dateStr, tasks) {
  const history = loadJSON(KEY_HISTORY, {});
  history[dateStr] = { tasks };
  // 直近90日分のみ保持
  const keys = Object.keys(history).sort();
  while (keys.length > 90) {
    delete history[keys.shift()];
  }
  saveJSON(KEY_HISTORY, history);
}

/* ==========================================================================
   日付ロールオーバー（日をまたいだ処理）
   ========================================================================== */
function buildRecurringInstances(dateStr) {
  const wd = weekdayOf(dateStr);
  return recurring
    .filter(r => r.days.includes(wd))
    .map(r => ({
      id: genId(),
      name: r.name,
      category: r.category,
      duration: r.duration,
      done: false,
      doneAt: null,
      carried: false,
      recurringId: r.id,
    }));
}

function rollIfNeeded() {
  const today = todayStr();
  if (dayState && dayState.date === today) return;

  // 前日までの未完了（固定タスク以外）を持ち越し候補にする
  let carryTasks = [];
  if (dayState) {
    saveHistoryDay(dayState.date, dayState.tasks);
    carryTasks = dayState.tasks
      .filter(t => !t.done && !t.recurringId)
      .map(t => ({ ...t, id: genId(), carried: true }));
  }

  // 「明日へ」で保留していたタスクも合流
  if (deferred.length) {
    carryTasks = carryTasks.concat(
      deferred.map(t => ({
        id: genId(),
        name: t.name,
        category: t.category,
        duration: t.duration,
        done: false,
        doneAt: null,
        carried: true,
        recurringId: null,
      }))
    );
    deferred = [];
    saveDeferred();
  }

  // 何日か開かなかった場合でも、固定タスクは飛ばした日数分を再現する必要はない
  // （固定タスクは前日の完了状態を引き継がない仕様のため、今日の分だけ生成すればよい）
  const todays = buildRecurringInstances(today);
  const merged = [...carryTasks, ...todays].map((t, i) => ({ ...t, order: i }));
  dayState = { date: today, tasks: merged };
  saveDay();
}

/* ==========================================================================
   レンダリング — 今日の画面
   ========================================================================== */
const el = (id) => document.getElementById(id);

function currentTasks() { return dayState.tasks; }

function render() {
  el("dateLabel").textContent = formatDisplayDate(dayState.date);

  const tasks = currentTasks();
  const pending = tasks.filter(t => !t.done).sort((a, b) => a.order - b.order);
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  const remainingCount = pending.length;
  const remainingMinutes = pending.reduce((s, t) => s + t.duration, 0);
  const totalCount = tasks.length;
  const doneCount = done.length;

  el("statRemainingCount").textContent = remainingCount;
  el("statRemainingTime").textContent = formatDuration(remainingMinutes);
  el("statDoneCount").textContent = doneCount;
  el("statTotalCount").textContent = totalCount;
  el("progressFill").style.width = totalCount ? `${Math.round((doneCount / totalCount) * 100)}%` : "0%";

  renderCatBreakdown(pending);
  renderTaskList(el("pendingList"), pending, false);
  renderTaskList(el("doneList"), done, true);

  el("pendingEmpty").style.display = pending.length ? "none" : "block";
  el("pendingCountLabel").textContent = pending.length ? `残り${pending.length}件` : "";

  el("doneSectionLabel").style.display = done.length ? "block" : "none";
  el("doneCountLabel").textContent = done.length ? `${done.length}件` : "";
}

function renderCatBreakdown(pending) {
  const wrap = el("catBreakdown");
  wrap.innerHTML = "";
  const totals = {};
  pending.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.duration; });
  const cats = CATEGORIES.filter(c => totals[c.id] > 0);
  if (!cats.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "flex";
  cats.forEach(c => {
    const pill = document.createElement("div");
    pill.className = "cat-pill";
    pill.style.background = c.bg;
    pill.innerHTML = `<span class="dot" style="background:${c.color}"></span>${c.label} <span class="time">${formatDuration(totals[c.id])}</span>`;
    wrap.appendChild(pill);
  });
}

function taskRowHTML(t) {
  const cat = CAT_BY_ID[t.category] || CAT_BY_ID.other;
  const carriedTag = (!t.done && t.carried) ? `<span class="carried-tag">昨日から持ち越し</span>` : "";
  return `
    <div class="task-card ${t.carried ? "carried" : ""} ${t.done ? "done" : ""}" data-id="${t.id}">
      ${t.done ? "" : `<div class="drag-handle" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
      </div>`}
      <button class="check ${t.done ? "checked" : ""}" data-action="toggle" aria-label="完了にする">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
      <div class="task-tap-area">
        <div class="task-name">${escapeHTML(t.name)}</div>
        <div class="task-meta">
          <span class="cat-chip" style="background:${cat.bg}"><span class="dot" style="background:${cat.color}"></span>${cat.label}</span>
          <span class="task-duration">${formatDuration(t.duration)}</span>
          ${carriedTag}
        </div>
      </div>
      ${t.done ? "" : `<button class="more-btn" data-action="more" aria-label="その他の操作">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
      </button>`}
    </div>`;
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

let sortableInstance = null;
function renderTaskList(container, list, isDone) {
  container.innerHTML = list.map(taskRowHTML).join("");

  container.querySelectorAll('[data-action="toggle"]').forEach(btn => {
    btn.addEventListener("click", () => toggleTask(btn.closest(".task-card").dataset.id));
  });
  container.querySelectorAll('[data-action="more"]').forEach(btn => {
    btn.addEventListener("click", (ev) => openActionPopover(ev, btn.closest(".task-card").dataset.id));
  });

  if (!isDone) {
    if (sortableInstance) sortableInstance.destroy();
    sortableInstance = new Sortable(container, {
      animation: 160,
      handle: ".drag-handle",
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      onEnd: () => {
        const ids = [...container.querySelectorAll(".task-card")].map(n => n.dataset.id);
        ids.forEach((id, i) => {
          const t = dayState.tasks.find(x => x.id === id);
          if (t) t.order = i;
        });
        saveDay();
      },
    });
  }
}

function toggleTask(id) {
  const t = dayState.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  saveDay();
  render();
}

/* ---- タスクの「…」操作（明日へ／削除） ---- */
function openActionPopover(ev, id) {
  closeActionPopover();
  const pop = document.createElement("div");
  pop.className = "action-pop";
  pop.id = "activePopover";
  pop.innerHTML = `
    <button data-act="tomorrow">明日へ送る</button>
    <button data-act="delete" class="danger">削除する</button>`;
  document.body.appendChild(pop);

  const rect = ev.currentTarget.getBoundingClientRect();
  const popW = 170;
  let left = rect.right - popW;
  left = Math.max(10, Math.min(left, window.innerWidth - popW - 10));
  pop.style.left = `${left}px`;
  let top = rect.bottom + 6;
  pop.style.top = `${top}px`;

  pop.querySelector('[data-act="tomorrow"]').addEventListener("click", () => {
    sendTaskToTomorrow(id);
    closeActionPopover();
  });
  pop.querySelector('[data-act="delete"]').addEventListener("click", () => {
    dayState.tasks = dayState.tasks.filter(t => t.id !== id);
    saveDay();
    closeActionPopover();
    render();
  });

  setTimeout(() => document.addEventListener("click", onDocClickCloseActionPopover), 0);
}
function onDocClickCloseActionPopover(ev) {
  const pop = el("activePopover");
  if (pop && !pop.contains(ev.target)) closeActionPopover();
}
function closeActionPopover() {
  const pop = el("activePopover");
  if (pop) pop.remove();
  document.removeEventListener("click", onDocClickCloseActionPopover);
}

function sendTaskToTomorrow(id) {
  const t = dayState.tasks.find(x => x.id === id);
  if (!t) return;
  deferred.push({ name: t.name, category: t.category, duration: t.duration });
  saveDeferred();
  dayState.tasks = dayState.tasks.filter(x => x.id !== id);
  saveDay();
  render();
}

/* ==========================================================================
   汎用シート（bottom sheet）開閉
   ========================================================================== */
function openSheet(sheetEl) {
  el("overlay").classList.add("open");
  sheetEl.classList.add("open");
}
function closeSheet(sheetEl) {
  el("overlay").classList.remove("open");
  sheetEl.classList.remove("open");
}
el("overlay").addEventListener("click", () => {
  closeSheet(el("taskSheet"));
  closeSheet(el("recurringSheet"));
});

/* ==========================================================================
   タスク追加シート
   ========================================================================== */
let taskFormState = { category: CATEGORIES[0].id, duration: DURATION_PRESETS[0] };

function buildCategoryChips(container, selectedId, onSelect) {
  container.innerHTML = "";
  CATEGORIES.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-btn cat-select" + (c.id === selectedId ? " selected" : "");
    btn.innerHTML = `<span class="dot" style="background:${c.id === selectedId ? "#fff" : c.color}"></span>${c.label}`;
    btn.addEventListener("click", () => onSelect(c.id));
    container.appendChild(btn);
  });
}
function buildDurationChips(container, selected, onSelect) {
  container.innerHTML = "";
  DURATION_PRESETS.forEach(m => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-btn" + (m === selected ? " selected" : "");
    btn.textContent = formatDuration(m);
    btn.addEventListener("click", () => onSelect(m));
    container.appendChild(btn);
  });
}

function refreshTaskSheetUI() {
  buildCategoryChips(el("taskCategoryChips"), taskFormState.category, (id) => {
    taskFormState.category = id;
    refreshTaskSheetUI();
  });
  buildDurationChips(el("taskDurationChips"), taskFormState.duration, (m) => {
    taskFormState.duration = m;
    el("taskDurationCustom").value = "";
    refreshTaskSheetUI();
  });
}

el("addTaskFab").addEventListener("click", () => {
  taskFormState = { category: CATEGORIES[0].id, duration: DURATION_PRESETS[0] };
  el("taskNameInput").value = "";
  el("taskDurationCustom").value = "";
  refreshTaskSheetUI();
  openSheet(el("taskSheet"));
  setTimeout(() => el("taskNameInput").focus(), 250);
});
el("taskCancelBtn").addEventListener("click", () => closeSheet(el("taskSheet")));
el("taskDurationCustom").addEventListener("input", () => {
  const v = parseInt(el("taskDurationCustom").value, 10);
  if (v > 0) { taskFormState.duration = v; buildDurationChips(el("taskDurationChips"), -1, (m) => { taskFormState.duration = m; el("taskDurationCustom").value = ""; refreshTaskSheetUI(); }); }
});
el("taskSaveBtn").addEventListener("click", () => {
  const name = el("taskNameInput").value.trim();
  if (!name) { el("taskNameInput").focus(); return; }
  const customVal = parseInt(el("taskDurationCustom").value, 10);
  const duration = customVal > 0 ? customVal : taskFormState.duration;
  const maxOrder = dayState.tasks.reduce((m, t) => Math.max(m, t.order), -1);
  dayState.tasks.push({
    id: genId(), name, category: taskFormState.category, duration,
    done: false, doneAt: null, carried: false, recurringId: null, order: maxOrder + 1,
  });
  saveDay();
  closeSheet(el("taskSheet"));
  render();
});

/* ==========================================================================
   固定タスク設定画面
   ========================================================================== */
el("openSettingsBtn").addEventListener("click", () => {
  renderRecurringList();
  el("settingsScreen").classList.add("open");
});
el("closeSettingsBtn").addEventListener("click", () => {
  el("settingsScreen").classList.remove("open");
});

function daysSummary(days) {
  if (days.length === 7) return "毎日";
  const weekdays = [1, 2, 3, 4, 5];
  if (days.length === 5 && weekdays.every(d => days.includes(d))) return "平日";
  return [...days].sort().map(d => WEEKDAY_LABELS[d]).join("・");
}

function renderRecurringList() {
  const wrap = el("recurringList");
  if (!recurring.length) {
    wrap.innerHTML = `<div class="empty-state">まだ固定タスクがありません。<br>右下の + から、毎日や曜日ごとに繰り返すタスクを登録できます。</div>`;
    return;
  }
  wrap.innerHTML = recurring.map(r => {
    const cat = CAT_BY_ID[r.category] || CAT_BY_ID.other;
    return `
    <div class="recurring-card" data-id="${r.id}">
      <div class="top-row">
        <div class="name">${escapeHTML(r.name)}</div>
        <div class="row-actions">
          <button data-act="edit" aria-label="編集">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
        </div>
      </div>
      <div class="meta-row">
        <span class="cat-chip" style="background:${cat.bg}"><span class="dot" style="background:${cat.color}"></span>${cat.label}</span>
        <span class="task-duration">${formatDuration(r.duration)}</span>
        <span class="days-tag">${daysSummary(r.days)}</span>
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll('[data-act="edit"]').forEach(btn => {
    btn.addEventListener("click", () => openRecurringSheet(btn.closest(".recurring-card").dataset.id));
  });
}

let recurringFormState = { id: null, category: CATEGORIES[0].id, duration: DURATION_PRESETS[0], days: [] };

function buildDayGrid() {
  const grid = el("dayGrid");
  grid.innerHTML = "";
  WEEKDAY_LABELS.forEach((label, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-btn" + (recurringFormState.days.includes(idx) ? " selected" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      const i = recurringFormState.days.indexOf(idx);
      if (i >= 0) recurringFormState.days.splice(i, 1);
      else recurringFormState.days.push(idx);
      refreshRecurringSheetUI();
    });
    grid.appendChild(btn);
  });
  el("everydayToggle").classList.toggle("selected", recurringFormState.days.length === 7);
}

function refreshRecurringSheetUI() {
  buildCategoryChips(el("recurringCategoryChips"), recurringFormState.category, (id) => {
    recurringFormState.category = id;
    refreshRecurringSheetUI();
  });
  buildDurationChips(el("recurringDurationChips"), recurringFormState.duration, (m) => {
    recurringFormState.duration = m;
    el("recurringDurationCustom").value = "";
    refreshRecurringSheetUI();
  });
  buildDayGrid();
}

function openRecurringSheet(id) {
  const existing = id ? recurring.find(r => r.id === id) : null;
  recurringFormState = existing
    ? { id: existing.id, category: existing.category, duration: existing.duration, days: [...existing.days] }
    : { id: null, category: CATEGORIES[0].id, duration: DURATION_PRESETS[0], days: [] };

  el("recurringSheetTitle").textContent = existing ? "固定タスクを編集" : "固定タスクを追加";
  el("recurringNameInput").value = existing ? existing.name : "";
  el("recurringDurationCustom").value = "";
  el("recurringDeleteBtn").style.display = existing ? "block" : "none";
  refreshRecurringSheetUI();
  openSheet(el("recurringSheet"));
}

el("addRecurringFab").addEventListener("click", () => openRecurringSheet(null));
el("recurringCancelBtn").addEventListener("click", () => closeSheet(el("recurringSheet")));
el("everydayToggle").addEventListener("click", () => {
  recurringFormState.days = recurringFormState.days.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6];
  refreshRecurringSheetUI();
});
el("recurringDurationCustom").addEventListener("input", () => {
  const v = parseInt(el("recurringDurationCustom").value, 10);
  if (v > 0) { recurringFormState.duration = v; refreshRecurringSheetUI(); }
});

el("recurringSaveBtn").addEventListener("click", () => {
  const name = el("recurringNameInput").value.trim();
  if (!name) { el("recurringNameInput").focus(); return; }
  if (!recurringFormState.days.length) { alert("曜日を1つ以上選んでください。"); return; }
  const customVal = parseInt(el("recurringDurationCustom").value, 10);
  const duration = customVal > 0 ? customVal : recurringFormState.duration;

  if (recurringFormState.id) {
    const r = recurring.find(x => x.id === recurringFormState.id);
    Object.assign(r, { name, category: recurringFormState.category, duration, days: recurringFormState.days });
  } else {
    recurring.push({ id: genId(), name, category: recurringFormState.category, duration, days: recurringFormState.days });
  }
  saveRecurring();
  closeSheet(el("recurringSheet"));
  renderRecurringList();
  // 今日が対象の曜日なら即座に一覧へ反映
  syncTodayWithRecurringChange();
});

el("recurringDeleteBtn").addEventListener("click", () => {
  if (!recurringFormState.id) return;
  if (!confirm("この固定タスクを削除しますか？")) return;
  recurring = recurring.filter(r => r.id !== recurringFormState.id);
  saveRecurring();
  closeSheet(el("recurringSheet"));
  renderRecurringList();
  syncTodayWithRecurringChange();
});

// 固定タスクの追加・編集・削除を、今日未完了で残っている自動生成分に穏やかに反映する
function syncTodayWithRecurringChange() {
  const wd = weekdayOf(dayState.date);
  const validRecurringIds = new Set(recurring.filter(r => r.days.includes(wd)).map(r => r.id));

  // 今日の対象から外れた／削除された固定タスクの未完了インスタンスを取り除く
  dayState.tasks = dayState.tasks.filter(t => {
    if (!t.recurringId) return true;
    if (t.done) return true;
    return validRecurringIds.has(t.recurringId);
  });

  // 新しく今日の対象になった固定タスクを追加（まだ無ければ）
  const existingRecurringIds = new Set(dayState.tasks.map(t => t.recurringId).filter(Boolean));
  let maxOrder = dayState.tasks.reduce((m, t) => Math.max(m, t.order), -1);
  recurring.filter(r => r.days.includes(wd) && !existingRecurringIds.has(r.id)).forEach(r => {
    maxOrder += 1;
    dayState.tasks.push({
      id: genId(), name: r.name, category: r.category, duration: r.duration,
      done: false, doneAt: null, carried: false, recurringId: r.id, order: maxOrder,
    });
  });

  saveDay();
  render();
}

/* ==========================================================================
   起動
   ========================================================================== */
function init() {
  rollIfNeeded();
  // 今日時点で反映されるべき固定タスクを過不足なく同期してから描画する
  // （新しく固定タスクを設定した直後や、設定変更があった場合でも今日の分に反映される。
  //   既に生成済みなら重複追加はしない）
  syncTodayWithRecurringChange();

  // 日付が変わったタイミングをアプリを開きっぱなしでも検知する
  setInterval(() => {
    if (dayState.date !== todayStr()) {
      rollIfNeeded();
      render();
    }
  }, 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && dayState.date !== todayStr()) {
      rollIfNeeded();
      render();
    }
  });
}

init();
