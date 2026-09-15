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

let dayState = loadJSON(KEY_DAY, null); // { date, tasks: [...] }
let deferred = loadJSON(KEY_DEFERRED, []); // [{name, category, duration}] 「明日へ」で保留中のタスク

function saveDay() { saveJSON(KEY_DAY, dayState); }
function saveDeferred() { saveJSON(KEY_DEFERRED, deferred); }
function saveHistoryDay(dateStr, tasks) {
  const history = loadJSON(KEY_HISTORY, {});
  history[dateStr] = { tasks };
  const keys = Object.keys(history).sort();
  while (keys.length > 90) delete history[keys.shift()];
  saveJSON(KEY_HISTORY, history);
}

/* ==========================================================================
   日付ロールオーバー（日をまたいだときの処理）
   ========================================================================== */
function rollIfNeeded() {
  const today = todayStr();
  if (dayState && dayState.date === today) return;

  // 前日までの未完了タスクを持ち越す
  let carryTasks = [];
  if (dayState) {
    saveHistoryDay(dayState.date, dayState.tasks);
    carryTasks = dayState.tasks
      .filter(t => !t.done)
      .map(t => ({ ...t, id: genId(), carried: true }));
  }

  // 「明日へ」で保留していたタスクも合流
  if (deferred.length) {
    carryTasks = carryTasks.concat(
      deferred.map(t => ({
        id: genId(), name: t.name, category: t.category, duration: t.duration,
        done: false, doneAt: null, carried: true,
      }))
    );
    deferred = [];
    saveDeferred();
  }

  const merged = carryTasks.map((t, i) => ({ ...t, order: i }));
  dayState = { date: today, tasks: merged };
  saveDay();
}

/* ==========================================================================
   レンダリング
   ========================================================================== */
const el = (id) => document.getElementById(id);

function render() {
  el("dateLabel").textContent = formatDisplayDate(dayState.date);

  const tasks = dayState.tasks;
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
  pop.style.top = `${rect.bottom + 6}px`;

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
el("overlay").addEventListener("click", () => closeSheet(el("taskSheet")));

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
  if (v > 0) {
    taskFormState.duration = v;
    buildDurationChips(el("taskDurationChips"), -1, (m) => {
      taskFormState.duration = m;
      el("taskDurationCustom").value = "";
      refreshTaskSheetUI();
    });
  }
});
el("taskSaveBtn").addEventListener("click", () => {
  const name = el("taskNameInput").value.trim();
  if (!name) { el("taskNameInput").focus(); return; }
  const customVal = parseInt(el("taskDurationCustom").value, 10);
  const duration = customVal > 0 ? customVal : taskFormState.duration;
  const maxOrder = dayState.tasks.reduce((m, t) => Math.max(m, t.order), -1);
  dayState.tasks.push({
    id: genId(), name, category: taskFormState.category, duration,
    done: false, doneAt: null, carried: false, order: maxOrder + 1,
  });
  saveDay();
  closeSheet(el("taskSheet"));
  render();
});

/* ==========================================================================
   起動
   ========================================================================== */
function init() {
  rollIfNeeded();
  render();

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
