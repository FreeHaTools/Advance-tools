/* Family Board — frontend logic.
 *
 * Talks to /api/tools/family_board/* (tool.py).
 * Three tabs: Lists (HA todo entities), Chores (local, rotation),
 * Notes (local sticky notes). Polls GET /board every 5 s and re-renders
 * in place without stomping an input the user is typing in.
 */
"use strict";

const API = "/api/tools/family_board";
const $  = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday",
                  "saturday", "sunday"];
const DAY_SHORT = { monday:"Mon", tuesday:"Tue", wednesday:"Wed",
                    thursday:"Thu", friday:"Fri", saturday:"Sat", sunday:"Sun" };
const NOTE_COLORS = ["yellow", "pink", "blue", "green", "orange"];
const EMOJIS = ["🧹","🍽️","🗑️","🧺","👕","🛏️","🚿","🐕","🪴","🛒","♻️","🧽","🍳","🚗"];

let BOARD = { connected:false, lists:[], chores:[], notes:[], done_log:[] };
let TAB = "lists";
let EDIT_CHORE = null;      // chore being edited in the modal (or null)
let ASG = [];               // assignee chips in the chore modal
let DAYS = new Set();       // selected weekday pills in the chore modal
let NOTE_DRAFT = null;      // unsaved new note {color, audience}
let RENAMING = false;       // an item rename input is open
const DONE_OPEN = new Set(); // entity_ids whose "Done" section is expanded
let USERS = [];              // panel users (audience picker), from GET /users
const AUD_OPEN = new Set();  // note ids with the audience editor expanded

/* ------------------------------------------------------------ utils */

async function api(method, path, body) {
  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(API + path, opt);
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) throw new Error(data.error || data.message || ("HTTP " + r.status));
  return data;
}

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

function rel(ts) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts * 1000 : new Date(ts).getTime();
  const d = (Date.now() - ms) / 1000;
  if (isNaN(d) || d < 0) return "";
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " h ago";
  return Math.floor(d / 86400) + " d ago";
}

function typingInside(el) {
  const a = document.activeElement;
  return a && el.contains(a) &&
    (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}

/* ------------------------------------------------------------ hints */

const TIPS = {
  rotation: { t: "Turn rotation",
    b: "People take turns in the order you add them. Marking the chore " +
       "done passes the turn to the next person; after the last one it " +
       "wraps back to the first.",
    ex: "Mom → Dad → Sam → Mom → …" },
  days: { t: "Due days",
    b: "Pick the weekdays this chore should be done. Leave every day " +
       "unselected to make it due every day.",
    ex: "Trash day: only “Tue” selected → the card shows “Next: Tue” " +
        "on other days." },
  clear: { t: "Clear completed",
    b: "Permanently removes every item in the Done section of this list — " +
       "also from the HA mobile app. Handy before a new shopping run." },
  streak: { t: "Streak",
    b: "How many due days in a row this chore was actually done. Miss a " +
       "day and the flame just stops growing — nothing is deleted." },
  audience: { t: "Note audience",
    b: "Users are the accounts people and wall tablets log in with — " +
       "they are managed in Hub → Users. “Everyone” shows the note on " +
       "every dashboard that has the Family Notes widget; “Specific " +
       "users” shows it only to the selected accounts. Family members " +
       "can reply to a note right from their dashboard.",
    ex: "Target a note at “kids_tablet” and it only appears on the " +
        "tablet logged in as kids_tablet." },
};

const tipbox = $("#tipbox");
function showTip(h) {
  const d = TIPS[h.dataset.tip] || h._hint;
  if (!d) return;
  tipbox.innerHTML = `<b class="t">${esc(d.t)}</b>${esc(d.b)}` +
    (d.ex ? `<div class="ex">${esc(d.ex)}</div>` : "");
  tipbox.style.display = "block";
  const r = h.getBoundingClientRect(), tw = tipbox.offsetWidth;
  let x = Math.min(r.left, innerWidth - tw - 10);
  let y = r.bottom + 8;
  if (y + tipbox.offsetHeight > innerHeight - 8)
    y = r.top - tipbox.offsetHeight - 8;
  tipbox.style.left = Math.max(8, x) + "px";
  tipbox.style.top = Math.max(8, y) + "px";
}
document.addEventListener("mouseover", (e) => {
  const h = e.target.closest(".hint");
  if (!h) { tipbox.style.display = "none"; return; }
  showTip(h);
});
document.addEventListener("click", (e) => {     // touch screens
  const h = e.target.closest(".hint");
  if (h) showTip(h); else tipbox.style.display = "none";
});

/* ------------------------------------------------------------ modals */

$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]"))
      m.classList.remove("open");
  });
});
function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

let confirmCb = null;
function askConfirm(title, sub, cb) {
  $("#confirmTitle").textContent = title;
  $("#confirmSub").textContent = sub;
  confirmCb = cb;
  openModal("#confirmModal");
}
$("#confirmYes").onclick = () => {
  closeModal("#confirmModal");
  if (confirmCb) confirmCb();
  confirmCb = null;
};

/* ------------------------------------------------------------ tabs */

function setTab(name) {
  TAB = name;
  $$("#tabs .tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  $$(".tabpane").forEach((p) => p.classList.toggle("on", p.id === "tab-" + name));
  moveTabline();
}
function moveTabline() {
  const b = $(`#tabs .tab[data-tab="${TAB}"]`);
  if (!b) return;
  const line = $("#tabline");
  line.style.left = b.offsetLeft + "px";
  line.style.width = b.offsetWidth + "px";
}
$$("#tabs .tab").forEach((b) => b.onclick = () => setTab(b.dataset.tab));
addEventListener("resize", moveTabline);

/* ------------------------------------------------------------ confetti */

function burst(x, y) {
  const colors = ["#6be675", "#22b8cf", "#ffb86b", "#ff6b81", "#e8edf7"];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement("span");
    p.className = "pop";
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--dx", (Math.random() * 180 - 90) + "px");
    p.style.setProperty("--dy", (Math.random() * -140 - 20) + "px");
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 850);
  }
}

/* ------------------------------------------------------------ load + poll */

/* Set by load(); read by the poller to drive PMPoll's error backoff without
   making the many direct load() callers handle a rejected promise. */
let LOAD_OK = true;

async function load() {
  try {
    BOARD = await api("GET", "/board");
    const dot = $("#connStat .dot");
    dot.classList.toggle("ok", !!BOARD.connected);
    $("#connStat").lastChild.textContent =
      BOARD.connected ? "connected" : "no HA connection";
    renderAll();
    LOAD_OK = true;
  } catch (e) {
    /* transient — keep last render, but tell the poller so it backs off */
    LOAD_OK = false;
  }
}

function renderAll() {
  const due = (BOARD.chores || []).filter((c) => c.due_today).length;
  $("#nLists").textContent = BOARD.lists.length ? `(${BOARD.lists.length})` : "";
  $("#nChores").textContent = due ? `(${due} due)` : "";
  $("#nNotes").textContent = BOARD.notes.length ? `(${BOARD.notes.length})` : "";
  renderLists();
  renderChores();
  renderNotes();
}

/* ============================================================ LISTS */

const addId = (eid) => "add_" + eid.replace(/\W/g, "_");

function renderLists() {
  const grid = $("#listsGrid");
  if (RENAMING && typingInside(grid)) return;   // don't stomp a rename

  // preserve the add-input the user may be typing in
  let keep = null;
  const a = document.activeElement;
  if (a && grid.contains(a) && a.tagName === "INPUT" && a.id)
    keep = { id: a.id, value: a.value, pos: a.selectionStart };

  grid.innerHTML = "";
  if (!BOARD.connected) {
    grid.innerHTML = `<div class="empty"><span class="big">🔌</span>
      Waiting for the Home Assistant connection…</div>`;
    return;
  }
  if (!BOARD.lists.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.innerHTML = `<span class="big">🛒</span>
      <b>No lists yet.</b><br>
      Create your first one — try <b>Shopping</b> for groceries or
      <b>Weekend jobs</b> for the honey-do list.<br>
      Lists sync with the HA mobile app and voice assistants.<br><br>`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "＋ New list";
    btn.onclick = openListModal;
    d.appendChild(btn);
    grid.appendChild(d);
    return;
  }

  for (const list of BOARD.lists) grid.appendChild(listColumn(list));

  const add = document.createElement("div");
  add.className = "newcard";
  add.innerHTML = `<span class="plus">＋</span>New list`;
  add.onclick = openListModal;
  grid.appendChild(add);

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus();
      try { el.setSelectionRange(keep.pos, keep.pos); } catch (e) {}
    }
  }
}

function listColumn(list) {
  const col = document.createElement("div");
  col.className = "listcol";
  const items = list.items || [];
  const open = items.filter((i) => i.status !== "completed");
  const done = items.filter((i) => i.status === "completed");

  const head = document.createElement("div");
  head.className = "lhead";
  head.innerHTML = `<b>${esc(list.name)}</b>
    <span class="cnt">${open.length} open</span>`;
  col.appendChild(head);

  if (list.error) {
    const er = document.createElement("div");
    er.className = "lerr";
    er.textContent = "Could not read this list: " + list.error;
    col.appendChild(er);
  }

  // add row
  const row = document.createElement("div");
  row.className = "addrow";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.id = addId(list.entity_id);
  inp.placeholder = "Add milk…";
  inp.maxLength = 200;
  inp.autocomplete = "off";
  const flash = document.createElement("span");
  flash.className = "okflash";
  flash.textContent = "✓";
  inp.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    flash.classList.remove("go");
    void flash.offsetWidth;               // restart the animation
    flash.classList.add("go");
    list.items.push({ uid: "tmp" + Date.now(), summary: text,
                      status: "needs_action", _tmp: true });
    renderLists();
    const el = document.getElementById(inp.id);
    if (el) el.focus();
    try { await api("POST", "/item", { entity_id: list.entity_id, summary: text }); }
    catch (err) { toast(err.message, true); }
    load();
  });
  row.appendChild(inp);
  row.appendChild(flash);
  col.appendChild(row);

  // open items
  const wrap = document.createElement("div");
  wrap.className = "items";
  if (!items.length && !list.error) {
    const e = document.createElement("div");
    e.style.cssText = "color:var(--mut);font-size:13px;padding:10px 4px;line-height:1.8";
    e.textContent = "Nothing here yet — type above and press Enter. 🥛 🍞 🥚";
    wrap.appendChild(e);
  }
  for (const it of open) wrap.appendChild(itemRow(list, it));
  col.appendChild(wrap);

  // completed items — collapsible
  if (done.length) {
    const isOpen = DONE_OPEN.has(list.entity_id);
    const dw = document.createElement("div");
    dw.className = "donewrap" + (isOpen ? " open" : "");
    const tog = document.createElement("button");
    tog.className = "dtog";
    tog.textContent = (isOpen ? "▾" : "▸") + ` Done (${done.length})`;
    tog.onclick = () => {
      if (DONE_OPEN.has(list.entity_id)) DONE_OPEN.delete(list.entity_id);
      else DONE_OPEN.add(list.entity_id);
      dw.classList.toggle("open");
      tog.textContent = (dw.classList.contains("open") ? "▾" : "▸") +
        ` Done (${done.length})`;
    };
    dw.appendChild(tog);
    const body = document.createElement("div");
    body.className = "dbody items";
    for (const it of done) body.appendChild(itemRow(list, it));
    dw.appendChild(body);
    col.appendChild(dw);

    const foot = document.createElement("div");
    foot.className = "lfoot";
    const clr = document.createElement("button");
    clr.className = "ghost";
    clr.innerHTML = `🧹 Clear completed`;
    clr.onclick = () => askConfirm("Clear completed?",
      `Permanently removes ${done.length} done item(s) from “${list.name}”.`,
      async () => {
        try {
          await api("POST", "/clear_completed", { entity_id: list.entity_id });
          toast("Completed items cleared");
        } catch (e) { toast(e.message, true); }
        load();
      });
    const hint = document.createElement("span");
    hint.className = "hint"; hint.dataset.tip = "clear"; hint.textContent = "?";
    foot.appendChild(clr);
    foot.appendChild(hint);
    col.appendChild(foot);
  }
  return col;
}

function itemRow(list, it) {
  const row = document.createElement("div");
  row.className = "item" + (it.status === "completed" ? " completed" : "");

  const cb = document.createElement("div");
  cb.className = "cb";
  cb.textContent = it.status === "completed" ? "✓" : "";
  cb.onclick = () => toggleItem(list, it, row);
  row.appendChild(cb);

  const sum = document.createElement("span");
  sum.className = "sum";
  sum.textContent = it.summary;
  // tap toggles; long-press starts a rename
  let lpTimer = null, lpFired = false;
  sum.addEventListener("pointerdown", () => {
    lpFired = false;
    lpTimer = setTimeout(() => { lpFired = true; startRename(list, it, row); }, 550);
  });
  const cancelLp = () => clearTimeout(lpTimer);
  sum.addEventListener("pointerup", cancelLp);
  sum.addEventListener("pointerleave", cancelLp);
  sum.addEventListener("click", () => { if (!lpFired) toggleItem(list, it, row); });
  row.appendChild(sum);

  const ed = document.createElement("button");
  ed.className = "iconbtn";
  ed.title = "Rename";
  ed.textContent = "✏️";
  ed.onclick = () => startRename(list, it, row);
  row.appendChild(ed);

  const del = document.createElement("button");
  del.className = "iconbtn danger";
  del.title = "Delete item";
  del.textContent = "✕";
  del.onclick = async () => {
    row.style.opacity = ".35";
    try { await api("POST", "/item/delete", { entity_id: list.entity_id, uid: it.uid }); }
    catch (e) { toast(e.message, true); }
    load();
  };
  row.appendChild(del);
  return row;
}

async function toggleItem(list, it, row) {
  if (it._tmp) return;                       // still being created
  const to = it.status === "completed" ? "needs_action" : "completed";
  it.status = to;                            // optimistic
  row.classList.toggle("completed", to === "completed");
  row.querySelector(".cb").textContent = to === "completed" ? "✓" : "";
  try {
    await api("POST", "/item/status",
              { entity_id: list.entity_id, uid: it.uid, status: to });
  } catch (e) { toast(e.message, true); }
  setTimeout(load, 350);                     // let the strike animation play
}

function startRename(list, it, row) {
  if (it._tmp || RENAMING) return;
  RENAMING = true;
  const sum = row.querySelector(".sum");
  const inp = document.createElement("input");
  inp.className = "rn";
  inp.type = "text";
  inp.value = it.summary;
  inp.maxLength = 200;
  sum.replaceWith(inp);
  inp.focus();
  inp.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    RENAMING = false;
    const name = inp.value.trim();
    if (save && name && name !== it.summary) {
      try {
        await api("POST", "/item/rename",
                  { entity_id: list.entity_id, uid: it.uid, name });
        toast("Renamed ✏️");
      } catch (e) { toast(e.message, true); }
    }
    load();
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  inp.addEventListener("blur", () => finish(true));
}

/* ---- new list modal ---- */

function openListModal() {
  $("#listName").value = "";
  $("#listErr").style.display = "none";
  openModal("#listModal");
  setTimeout(() => $("#listName").focus(), 50);
}
$("#listName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#listCreate").click();
});
$("#listCreate").onclick = async () => {
  const name = $("#listName").value.trim();
  const err = $("#listErr");
  err.style.display = "none";
  if (!name) { err.textContent = "Give the list a name first."; err.style.display = "block"; return; }
  const btn = $("#listCreate");
  btn.disabled = true;
  try {
    await api("POST", "/list", { name });
    closeModal("#listModal");
    toast(`List “${name}” created 🎉`);
    setTimeout(load, 1200);                  // let the entity appear
    setTimeout(load, 3500);
  } catch (e) {
    err.textContent = e.message;
    err.style.display = "block";
  }
  btn.disabled = false;
};

/* ============================================================ CHORES */

function daysLabel(days) {
  if (!days || !days.length) return "Every day";
  return WEEKDAYS.filter((d) => days.includes(d))
                 .map((d) => DAY_SHORT[d]).join(" · ");
}

function renderChores() {
  const grid = $("#choresGrid");
  grid.innerHTML = "";
  const chores = BOARD.chores || [];

  if (!chores.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.innerHTML = `<span class="big">🧹</span>
      <b>No chores yet.</b><br>
      Try <b>Dishes 🍽️</b> rotating between everyone, or
      <b>Take out trash 🗑️</b> every Tuesday.<br><br>`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "＋ New chore";
    btn.onclick = () => openChoreModal(null);
    d.appendChild(btn);
    grid.appendChild(d);
  } else {
    for (const ch of chores) grid.appendChild(choreCard(ch));
    const add = document.createElement("div");
    add.className = "newcard";
    add.innerHTML = `<span class="plus">＋</span>New chore`;
    add.onclick = () => openChoreModal(null);
    grid.appendChild(add);
  }

  // recent activity
  const act = $("#activity"), body = $("#actBody");
  const log = (BOARD.done_log || []).slice().reverse();
  act.style.display = log.length ? "block" : "none";
  body.innerHTML = "";
  for (const en of log) {
    const r = document.createElement("div");
    r.className = "actrow";
    r.innerHTML = `<span><b>${esc(en.by)}</b> did ${esc(en.chore)}</span>
      <span class="when">${esc(rel(en.ts))}</span>`;
    body.appendChild(r);
  }
}

function choreCard(ch) {
  const card = document.createElement("div");
  card.className = "chore" + (ch.due_today ? " due" : "");

  const top = document.createElement("div");
  top.className = "top";
  top.innerHTML = `<div class="cicon">${esc(ch.icon || "🧹")}</div>
    <div class="nm"><b>${esc(ch.name)}</b>
      <div class="sub">${esc(daysLabel(ch.days))}</div></div>`;
  const ed = document.createElement("button");
  ed.className = "iconbtn";
  ed.title = "Edit chore";
  ed.textContent = "✏️";
  ed.onclick = () => openChoreModal(ch);
  top.appendChild(ed);
  card.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "meta";
  if (ch.current_assignee)
    meta.insertAdjacentHTML("beforeend",
      `<span class="pill who">Today: ${esc(ch.current_assignee)}</span>`);
  if (ch.done_today)
    meta.insertAdjacentHTML("beforeend", `<span class="pill ok">Done ✓</span>`);
  else if (ch.due_today)
    meta.insertAdjacentHTML("beforeend", `<span class="pill due">Due today</span>`);
  else if (ch.next_due)
    meta.insertAdjacentHTML("beforeend",
      `<span class="pill">Next: ${esc(DAY_SHORT[ch.next_due] || ch.next_due)}</span>`);
  if (ch.streak > 0) {
    meta.insertAdjacentHTML("beforeend",
      `<span class="pill fire">🔥 ${Number(ch.streak)}</span>`);
    const h = document.createElement("span");
    h.className = "hint"; h.dataset.tip = "streak"; h.textContent = "?";
    meta.appendChild(h);
  }
  card.appendChild(meta);

  const btn = document.createElement("button");
  btn.className = "btn donebtn";
  if (ch.done_today) {
    btn.textContent = "Done for today ✓";
    btn.disabled = true;
  } else {
    btn.textContent = "Mark done";
    btn.onclick = async (e) => {
      burst(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2);
      btn.disabled = true;
      btn.textContent = "Nice! 🎉";
      try {
        const d = await api("POST", `/chore/${ch.id}/done`, {});
        const who = (d.chore || {}).current_assignee;
        toast(who ? `Done! Next up: ${who}` : "Chore done 🎉");
      } catch (err) { toast(err.message, true); }
      load();
    };
  }
  card.appendChild(btn);
  return card;
}

/* ---- chore modal ---- */

function renderAsgChips() {
  const wrap = $("#asgWrap");
  $$(".echip", wrap).forEach((c) => c.remove());
  const inp = $("#asgInput");
  for (let i = 0; i < ASG.length; i++) {
    const chip = document.createElement("span");
    chip.className = "echip";
    chip.textContent = ASG[i] + " ";
    const x = document.createElement("button");
    x.textContent = "✕";
    x.onclick = ((idx) => () => { ASG.splice(idx, 1); renderAsgChips(); })(i);
    chip.appendChild(x);
    wrap.insertBefore(chip, inp);
  }
}

function renderDayRow() {
  const row = $("#dayRow");
  row.innerHTML = "";
  for (const d of WEEKDAYS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "daypill" + (DAYS.has(d) ? " on" : "");
    b.textContent = DAY_SHORT[d];
    b.onclick = () => {
      if (DAYS.has(d)) DAYS.delete(d); else DAYS.add(d);
      b.classList.toggle("on");
    };
    row.appendChild(b);
  }
}

function renderEmojiRow(selected) {
  const row = $("#emojiRow");
  row.innerHTML = "";
  const free = document.createElement("input");
  free.type = "text";
  free.id = "choreIcon";
  free.maxLength = 8;
  free.value = selected || "🧹";
  free.title = "Or type any emoji";
  for (const e of EMOJIS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "em" + (e === free.value ? " on" : "");
    b.textContent = e;
    b.onclick = () => {
      free.value = e;
      $$(".em", row).forEach((x) => x.classList.toggle("on", x === b));
    };
    row.appendChild(b);
  }
  free.addEventListener("input",
    () => $$(".em", row).forEach((x) => x.classList.remove("on")));
  row.appendChild(free);
}

function openChoreModal(ch) {
  EDIT_CHORE = ch;
  ASG = ch ? (ch.assignees || []).slice() : [];
  DAYS = new Set(ch ? ch.days || [] : []);
  $("#choreTitle").textContent = ch ? "Edit chore" : "New chore";
  $("#choreName").value = ch ? ch.name : "";
  $("#choreErr").style.display = "none";
  $("#choreDelete").style.display = ch ? "inline-block" : "none";
  renderEmojiRow(ch ? ch.icon : "🧹");
  renderAsgChips();
  renderDayRow();
  openModal("#choreModal");
  setTimeout(() => $("#choreName").focus(), 50);
}

$("#asgWrap").addEventListener("click", () => $("#asgInput").focus());
$("#asgInput").addEventListener("keydown", (e) => {
  const inp = e.target;
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const name = inp.value.replace(/,/g, "").trim();
    if (name && !ASG.includes(name)) { ASG.push(name); renderAsgChips(); }
    inp.value = "";
  } else if (e.key === "Backspace" && !inp.value && ASG.length) {
    ASG.pop();
    renderAsgChips();
  }
});

$("#choreSave").onclick = async () => {
  const err = $("#choreErr");
  err.style.display = "none";
  const name = $("#choreName").value.trim();
  if (!name) { err.textContent = "Give the chore a name first."; err.style.display = "block"; return; }
  // a name still sitting in the chip input counts too
  const pending = $("#asgInput").value.replace(/,/g, "").trim();
  if (pending && !ASG.includes(pending)) ASG.push(pending);
  $("#asgInput").value = "";
  const body = {
    name,
    icon: ($("#choreIcon").value || "🧹").trim(),
    assignees: ASG,
    days: WEEKDAYS.filter((d) => DAYS.has(d)),
  };
  if (EDIT_CHORE) body.id = EDIT_CHORE.id;
  try {
    await api("POST", "/chore", body);
    closeModal("#choreModal");
    toast(EDIT_CHORE ? "Chore updated" : "Chore created 🎉");
    load();
  } catch (e) {
    err.textContent = e.message;
    err.style.display = "block";
  }
};

$("#choreDelete").onclick = () => {
  if (!EDIT_CHORE) return;
  const ch = EDIT_CHORE;
  askConfirm("Delete chore?",
    `“${ch.name}” and its streak will be gone. Past activity stays in the log.`,
    async () => {
      try {
        await api("DELETE", `/chore/${ch.id}`);
        closeModal("#choreModal");
        toast("Chore deleted");
      } catch (e) { toast(e.message, true); }
      load();
    });
};

/* ============================================================ NOTES */

function fit(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }

function renderNotes() {
  const grid = $("#notesGrid");
  if (typingInside(grid)) return;            // don't stomp an open note

  grid.innerHTML = "";
  const notes = (BOARD.notes || []).slice().reverse();

  if (NOTE_DRAFT) grid.appendChild(noteEl(null, NOTE_DRAFT.color, true));
  if (!notes.length && !NOTE_DRAFT) {
    grid.innerHTML = `<div class="empty" style="column-span:all">
      <span class="big">📌</span>
      <b>No notes yet.</b><br>
      Pin a reminder for everyone — like
      <b>“Grandma visits Sunday 🎂”</b> or <b>“Vet appointment Thu 5pm 🐕”</b>.<br>
      Tap <b>＋ Note</b> above to add one.</div>`;
    return;
  }
  for (const n of notes) grid.appendChild(noteEl(n, n.color, false));
  $$("textarea", grid).forEach(fit);
}

async function loadUsers() {
  try { USERS = (await api("GET", "/users")).users || []; }
  catch (e) { USERS = []; }
}

function audLabel(aud) {
  if (aud && aud.type === "users")
    return "👤 " + (aud.users || []).join(", ");
  return "🌍 Everyone";
}

function audienceRow(note, isDraft) {
  const key = isDraft ? "__draft__" : note.id;
  const aud = (isDraft ? NOTE_DRAFT.audience : note.audience) || { type: "all" };

  const row = document.createElement("div");
  row.className = "audwrap";

  const bar = document.createElement("div");
  bar.className = "audrow";
  const badge = document.createElement("button");
  badge.className = "audbadge";
  badge.type = "button";
  badge.textContent = audLabel(aud);
  badge.title = "Audience — who sees this note on dashboards";
  badge.onclick = () => {
    if (AUD_OPEN.has(key)) AUD_OPEN.delete(key); else AUD_OPEN.add(key);
    renderNotes();
  };
  bar.appendChild(badge);
  const h = document.createElement("span");
  h.className = "hint"; h.dataset.tip = "audience"; h.textContent = "?";
  bar.appendChild(h);
  row.appendChild(bar);

  if (!AUD_OPEN.has(key)) return row;

  // --- expanded editor ---
  const panel = document.createElement("div");
  panel.className = "audpanel";
  const isUsers = aud.type === "users";
  const sel = new Set(isUsers ? aud.users || [] : []);

  const mkRadio = (label, checked) => {
    const lab = document.createElement("label");
    lab.className = "au";
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "aud_" + key;
    r.checked = checked;
    lab.appendChild(r);
    lab.appendChild(document.createTextNode(" " + label));
    return [lab, r];
  };
  const [labAll, rAll] = mkRadio("🌍 Everyone", !isUsers);
  const [labUsr, rUsr] = mkRadio("👤 Specific users", isUsers);
  panel.appendChild(labAll);
  panel.appendChild(labUsr);

  const ulist = document.createElement("div");
  ulist.className = "ulist";
  if (!USERS.length) {
    const m = document.createElement("span");
    m.className = "umut";
    m.textContent = "No users found — add accounts in Hub → Users.";
    ulist.appendChild(m);
  }
  const boxes = [];
  for (const u of USERS) {
    const lab = document.createElement("label");
    lab.className = "au";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = sel.has(u.name);
    cb.disabled = !isUsers;
    cb.onchange = () => { rUsr.checked = true; rAll.checked = false; };
    boxes.push([cb, u.name]);
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(
      " " + u.name + (u.is_admin ? " (admin)" : "")));
    ulist.appendChild(lab);
  }
  panel.appendChild(ulist);
  const setMode = () => {
    const on = rUsr.checked;
    for (const [cb] of boxes) cb.disabled = !on;
  };
  rAll.onchange = setMode;
  rUsr.onchange = setMode;

  const arow = document.createElement("div");
  arow.className = "applyrow";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "audapply";
  apply.textContent = "Apply";
  apply.onclick = async () => {
    let next = { type: "all" };
    if (rUsr.checked) {
      const users = boxes.filter(([cb]) => cb.checked).map(([, n]) => n);
      if (!users.length) {
        toast("Pick at least one user, or choose Everyone.", true);
        return;
      }
      next = { type: "users", users };
    }
    AUD_OPEN.delete(key);
    if (isDraft) {
      NOTE_DRAFT.audience = next;
      renderNotes();
      const t = $("#notesGrid textarea");   // draft renders first — refocus
      if (t) t.focus();
      return;
    }
    try {
      await api("POST", "/note", { id: note.id, audience: next });
      toast("Audience updated 👤");
    } catch (e) { toast(e.message, true); }
    load();
  };
  arow.appendChild(apply);
  panel.appendChild(arow);
  row.appendChild(panel);
  return row;
}

function repliesBlock(note) {
  const wrap = document.createElement("div");
  wrap.className = "replies";
  for (const r of note.replies || []) {
    const row = document.createElement("div");
    row.className = "reply";
    row.innerHTML = `<b>${esc(r.user)}</b>
      <span class="rtext">${esc(r.text)}</span>
      <span class="rwhen">${esc(rel(r.ts))}</span>`;
    const del = document.createElement("button");
    del.className = "rdel";
    del.title = "Delete reply";
    del.textContent = "✕";
    del.onclick = async () => {
      try {
        await api("DELETE", "/reply", { note_id: note.id, reply_id: r.id });
      } catch (e) { toast(e.message, true); }
      load();
    };
    row.appendChild(del);
    wrap.appendChild(row);
  }

  const rrow = document.createElement("div");
  rrow.className = "replyrow";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.placeholder = "Reply…";
  inp.maxLength = 300;
  inp.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    try {
      await api("POST", "/reply", { note_id: note.id, text });
      toast("Reply sent 💬");
    } catch (err) { toast(err.message, true); }
    load();
  });
  rrow.appendChild(inp);
  wrap.appendChild(rrow);
  return wrap;
}

function noteEl(note, color, isDraft) {
  const el = document.createElement("div");
  el.className = "note n-" + (NOTE_COLORS.includes(color) ? color : "yellow");

  const ta = document.createElement("textarea");
  ta.value = note ? note.text : (NOTE_DRAFT && NOTE_DRAFT.text) || "";
  ta.placeholder = "Write a note…";
  ta.maxLength = 2000;
  ta.dataset.orig = note ? note.text : "";
  ta.addEventListener("input", () => {
    fit(ta);
    if (isDraft && NOTE_DRAFT) NOTE_DRAFT.text = ta.value;
  });
  ta.addEventListener("blur", async (e) => {
    // still fiddling with this note (audience picker, reply box) — not done
    if (isDraft && e.relatedTarget && el.contains(e.relatedTarget)) return;
    const text = ta.value.trim();
    if (isDraft) {
      const audience = (NOTE_DRAFT && NOTE_DRAFT.audience) || { type: "all" };
      NOTE_DRAFT = null;
      AUD_OPEN.delete("__draft__");
      if (!text) { renderNotes(); return; }
      try {
        await api("POST", "/note", { text, color, audience });
        toast("Note saved 📌");
      } catch (e) { toast(e.message, true); }
      load();
    } else if (text !== ta.dataset.orig.trim()) {
      try {
        await api("POST", "/note", { id: note.id, text });
        ta.dataset.orig = ta.value;
        toast("Note saved 📌");
      } catch (e) { toast(e.message, true); }
      load();
    }
  });
  el.appendChild(ta);

  el.appendChild(audienceRow(note, isDraft));
  if (note) el.appendChild(repliesBlock(note));

  const foot = document.createElement("div");
  foot.className = "nfoot";
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = note
    ? rel(note.created) + (note.author ? " · " + note.author : "")
    : "new";
  foot.appendChild(when);

  const swatch = { yellow:"#ffe9a3", pink:"#ffc9dc", blue:"#bfe0ff",
                   green:"#c9f2c9", orange:"#ffd9ae" };
  for (const c of NOTE_COLORS) {
    const dot = document.createElement("button");
    dot.className = "cdot";
    dot.style.background = swatch[c];
    dot.title = c;
    dot.onclick = async () => {
      if (isDraft) {
        NOTE_DRAFT.color = c;
        el.className = "note n-" + c;
        color = c;
        return;
      }
      try { await api("POST", "/note", { id: note.id, color: c }); }
      catch (e) { toast(e.message, true); }
      load();
    };
    foot.appendChild(dot);
  }

  const del = document.createElement("button");
  del.className = "ndel";
  del.title = "Delete note";
  del.textContent = "✕";
  del.onclick = () => {
    if (isDraft) { NOTE_DRAFT = null; renderNotes(); return; }
    askConfirm("Delete note?", "This sticky note will be removed for everyone.",
      async () => {
        try { await api("DELETE", `/note/${note.id}`); }
        catch (e) { toast(e.message, true); }
        load();
      });
  };
  foot.appendChild(del);

  el.appendChild(foot);
  return el;
}

$("#newNoteBtn").onclick = () => {
  NOTE_DRAFT = { color: NOTE_COLORS[(BOARD.notes || []).length % NOTE_COLORS.length],
                 audience: { type: "all" } };
  AUD_OPEN.delete("__draft__");
  setTab("notes");
  renderNotes();
  const ta = $("#notesGrid textarea");
  if (ta) ta.focus();
};

/* ------------------------------------------------------------ boot */

$("#learnBtn").onclick = () => openModal("#learnModal");

setTab("lists");

/* Both pollers stop while the tool is hidden, the tab is backgrounded or the
   tablet's screen is off, and resume with an immediate refresh — which is why
   the old visibilitychange handler is no longer needed. */
PMPoll.every(5000, () => load().then(() => {
  if (!LOAD_OK) throw new Error("board unavailable");
}), { el: document.body, name: "board" });

/* pick up new panel users */
PMPoll.every(60000, loadUsers, { el: document.body, name: "users" });
