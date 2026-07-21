/* Security Center — frontend (vanilla JS, no build step).
 *
 * Talks to /api/tools/security_center/*. Polls /overview every 3s and updates
 * the status hero in place. Editors (sensors, cameras, actions, alerts,
 * timings) keep a local draft; while a draft is dirty the poll never
 * overwrites it, and nothing is sent until the matching Save button is used.
 */
"use strict";

const API = "/api/tools/security_center";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const POLL_MS = 3000;
const CAM_MS = 10000;

let OV = null;                 // last /overview payload
let confirmAction = null;      // () => void, used by the confirm modal
let lbEid = null;              // camera shown in the lightbox

/* Local drafts + dirty flags — one per editor. */
const draft = {
  sensors: {},                 // entity_id -> {use, delay, modes:[]}
  cameras: new Set(),
  actions: null,               // {sirens:[],lights:[],...,snapshot,tts:{}}
  delays: { exit: 45, entry: 30, siren: 180 },
  channels: new Set(),
};
const dirty = {
  sensors: false, cameras: false, actions: false, timings: false,
  channels: false,
};

/* ---------------------------------------------------------------- utils */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function toast(msg, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3800);
}

async function api(path, opts) {
  const res = await fetch(API + path, Object.assign({
    headers: { "Content-Type": "application/json" },
  }, opts || {}));
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty or non-JSON body */ }
  if (!res.ok) {
    const err = new Error(data.message || data.error || ("HTTP " + res.status));
    err.status = res.status;
    err.code = typeof data.error === "string" ? data.error : "";
    throw err;
  }
  return data;
}

function ago(ts) {
  if (!ts) return "";
  const ms = ts > 1e11 ? ts : ts * 1000;
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}

function absTime(ts) {
  const ms = ts > 1e11 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
}

function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

/* Group items may arrive as plain entity ids or as objects — accept both. */
function normItem(raw) {
  if (typeof raw === "string") return { entity_id: raw };
  return raw && raw.entity_id ? raw : { entity_id: String(raw) };
}

/* ---------------------------------------------------------------- hints */

function showTip(el) {
  const box = $("#tipbox");
  const title = el.dataset.title || "";
  const tip = el.dataset.tip || "";
  const ex = el.dataset.ex || "";
  box.innerHTML = (title ? '<b class="t">' + esc(title) + "</b>" : "")
    + esc(tip) + (ex ? '<div class="ex">' + esc(ex) + "</div>" : "");
  box.style.display = "block";
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  let x = Math.min(r.left, window.innerWidth - w - 10);
  let y = r.bottom + 8;
  if (y + h > window.innerHeight - 8) y = r.top - h - 8;
  box.style.left = Math.max(8, x) + "px";
  box.style.top = Math.max(8, y) + "px";
}
document.addEventListener("mouseover", (e) => {
  const h = e.target.closest(".hint");
  if (h) showTip(h);
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest(".hint")) $("#tipbox").style.display = "none";
});
document.addEventListener("click", (e) => {
  const h = e.target.closest(".hint");
  if (h) { e.preventDefault(); e.stopPropagation(); showTip(h); }
  else if (!e.target.closest("#tipbox")) $("#tipbox").style.display = "none";
}, true);

/* ---------------------------------------------------------------- modals */

function openModal(sel) { $(sel).classList.add("open"); }
function closeModal(sel) { $(sel).classList.remove("open"); }
$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) {
      m.classList.remove("open");
    }
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $$(".modal.open").forEach((m) => m.classList.remove("open"));
});

function askConfirm(title, sub, yesLabel, fn) {
  $("#confirmTitle").textContent = title;
  $("#confirmSub").textContent = sub;
  $("#confirmYes").textContent = yesLabel;
  confirmAction = fn;
  openModal("#confirmModal");
}
$("#confirmYes").addEventListener("click", () => {
  const fn = confirmAction;
  confirmAction = null;
  closeModal("#confirmModal");
  if (fn) fn();
});

/* ---------------------------------------------------------------- tabs */

$("#tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  $$("#tabbar button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".pane").forEach((p) => p.classList.toggle("on", p.id === "pane-" + b.dataset.tab));
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------------------------------------------------------------- hero */

const STATE_UI = {
  disarmed:   { cls: "s-disarmed", icon: "🛡️", title: "Disarmed",
    sub: "The alarm is off. Sensors are still watched for the log, but nothing will fire." },
  arming:     { cls: "s-arming", icon: "⏳", title: "Arming…",
    sub: "Exit delay running — leave now, the system starts watching when it reaches zero." },
  pending:    { cls: "s-arming", icon: "⚠️", title: "Entry delay",
    sub: "A delayed sensor was opened. Type your PIN and press Disarm before the countdown ends." },
  armed_home: { cls: "s-armed", icon: "🏠", title: "Armed · Home",
    sub: "Your Home-mode sensors are being watched." },
  armed_away: { cls: "s-armed", icon: "🚗", title: "Armed · Away",
    sub: "Your Away-mode sensors are being watched." },
  armed_night:{ cls: "s-armed", icon: "🌙", title: "Armed · Night",
    sub: "Your Night-mode sensors are being watched." },
  triggered:  { cls: "s-triggered", icon: "🚨", title: "ALARM TRIGGERED",
    sub: "Everything on the Actions tab is running and your alerts have been sent." },
};

const CD_UI = {
  exit:  ["Exit delay", "leave through the door you marked as delayed"],
  entry: ["Entry delay — disarm now!", "type your PIN and press Disarm"],
  siren: ["Siren running", "sirens switch themselves off at zero"],
};

let cd = null;   // {kind, total, endsAt}

function renderHero() {
  const st = (OV && OV.state) || "disarmed";
  const ui = STATE_UI[st] || STATE_UI.disarmed;
  const hero = $("#hero");
  hero.className = "hero " + ui.cls;
  $("#heroIcon").textContent = ui.icon;
  $("#heroState").textContent = ui.title;

  const conn = OV && OV.connected
    ? '<span class="dot ok"></span>Home Assistant connected'
    : '<span class="dot"></span>Home Assistant not connected';
  $("#heroSub").innerHTML = conn + " · " + esc(ui.sub);

  /* what set the alarm off */
  if (st === "triggered") {
    const alert = (OV.events || []).find((e) => e.alert);
    $("#heroCause").textContent = alert
      ? "🚨 Triggered by: " + alert.name + " (" + alert.entity_id + ") — "
        + alert.event + ", " + ago(alert.ts)
      : "🚨 Triggered — see the Log tab for the sensor that caused it.";
  }
  $("#heroDisarm").style.display = st === "disarmed" ? "none" : "block";

  const mode = OV && OV.armed_mode;
  $("#armHome").classList.toggle("on", mode === "home");
  $("#armAway").classList.toggle("on", mode === "away");
  $("#armNight").classList.toggle("on", mode === "night");

  $("#pinCta").classList.toggle("on", !!OV && !OV.has_pin);
}

function syncCountdown() {
  const c = OV && OV.countdown;
  if (c && c.remaining > 0) {
    cd = { kind: c.kind, total: c.total || c.remaining,
           endsAt: Date.now() + c.remaining * 1000 };
  } else {
    cd = null;
  }
  tickCountdown();
}

function tickCountdown() {
  const box = $("#cdBox");
  if (!cd) { box.classList.remove("on"); return; }
  const left = (cd.endsAt - Date.now()) / 1000;
  if (left <= 0) { box.classList.remove("on"); cd = null; return; }
  box.classList.add("on");
  const ui = CD_UI[cd.kind] || ["Countdown", ""];
  $("#cdLabel").textContent = ui[0];
  $("#cdHint").textContent = ui[1];
  $("#cdTime").textContent = mmss(left);
  const pct = cd.total > 0 ? Math.max(0, Math.min(100, (left / cd.total) * 100)) : 0;
  $("#cdBar").style.width = pct + "%";
}
/* Local-only ticker: no network, but it still stops while the tool is hidden
   so a background tab does not burn CPU on a wall tablet. */
PMPoll.every(250, tickCountdown, { el: document.body, name: "countdown", blurFactor: 1 });

/* ---------------------------------------------------------------- keypad */

let code = "";

function renderCode() {
  const dots = $("#kpDots");
  dots.innerHTML = "";
  const n = Math.max(4, code.length);
  for (let i = 0; i < n; i++) {
    const d = document.createElement("i");
    if (i < code.length) d.className = "on";
    dots.appendChild(d);
  }
}

function codeError(msg) {
  $("#kpErr").textContent = msg;
  code = "";
  renderCode();
  const pad = $("#kpPad");
  pad.classList.remove("shake");
  void pad.offsetWidth;                 // restart the animation
  pad.classList.add("shake");
}

$("#kpPad").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  $("#kpErr").textContent = "";
  if (b.dataset.d != null) {
    if (code.length < 8) { code += b.dataset.d; renderCode(); }
  } else if (b.hasAttribute("data-del")) {
    code = code.slice(0, -1); renderCode();
  } else if (b.hasAttribute("data-clear")) {
    code = ""; renderCode();
  }
});

document.addEventListener("keydown", (e) => {
  if ($$(".modal.open").length) return;
  if (!$("#pane-status").classList.contains("on")) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  if (/^[0-9]$/.test(e.key)) {
    if (code.length < 8) { code += e.key; renderCode(); $("#kpErr").textContent = ""; }
  } else if (e.key === "Backspace") {
    e.preventDefault(); code = code.slice(0, -1); renderCode();
  } else if (e.key === "Enter") {
    doDisarm();
  }
});

async function doArm(mode) {
  if (!OV) return;
  if (!OV.has_pin) { openPinModal(); return; }
  if (code.length < 4) return codeError("Enter your PIN first");
  try {
    const r = await api("/arm", { method: "POST",
      body: JSON.stringify({ mode, pin: code }) });
    code = ""; renderCode(); $("#kpErr").textContent = "";
    toast("Arming · " + mode + " 🛡️");
    if (r && r.countdown) {
      cd = { kind: r.countdown.kind, total: r.countdown.total || r.countdown.remaining,
             endsAt: Date.now() + r.countdown.remaining * 1000 };
      tickCountdown();
    }
    load();
  } catch (err) {
    if (err.code === "no_pin") { openPinModal(); codeError(err.message); }
    else codeError(err.message || "Could not arm");
  }
}

async function doDisarm() {
  if (!OV) return;
  if (!OV.has_pin) { openPinModal(); return; }
  if (code.length < 4) return codeError("Enter your PIN first");
  try {
    await api("/disarm", { method: "POST", body: JSON.stringify({ pin: code }) });
    code = ""; renderCode(); $("#kpErr").textContent = "";
    cd = null; tickCountdown();
    toast("Disarmed 🔕");
    load();
  } catch (err) {
    if (err.code === "no_pin") { openPinModal(); codeError(err.message); }
    else codeError(err.message || "Could not disarm");
  }
}

$("#armHome").addEventListener("click", () => doArm("home"));
$("#armAway").addEventListener("click", () => doArm("away"));
$("#armNight").addEventListener("click", () => doArm("night"));
$("#disarmBtn").addEventListener("click", doDisarm);
$("#heroDisarm").addEventListener("click", () => {
  $$("#tabbar button").forEach((x) => x.classList.toggle("on", x.dataset.tab === "status"));
  $$(".pane").forEach((p) => p.classList.toggle("on", p.id === "pane-status"));
  if (code.length >= 4) doDisarm();
  else { $("#kpErr").textContent = "Enter your PIN, then press Disarm"; $("#kpPad").scrollIntoView({ behavior: "smooth", block: "center" }); }
});

$("#panicBtn").addEventListener("click", () => {
  askConfirm("Trigger the alarm now?",
    "This fires everything immediately — sirens, lights, snapshots and every "
    + "alert you configured. There is no delay and no PIN needed. Use it when "
    + "you actually need help.",
    "🚨 Trigger the alarm", async () => {
      try {
        await api("/panic", { method: "POST", body: "{}" });
        toast("Panic alarm triggered 🚨", true);
        load();
      } catch (err) { toast(err.message, true); }
    });
});

/* ---------------------------------------------------------------- PIN modal */

function openPinModal() {
  const has = !!(OV && OV.has_pin);
  $("#pinHead").textContent = has ? "Change your PIN" : "Create a PIN";
  $("#pinMsub").textContent = has
    ? "Enter your current PIN, then choose a new one (4 to 8 digits)."
    : "Choose 4 to 8 digits. You will need this code to arm and disarm the alarm.";
  $("#pinOldWrap").style.display = has ? "block" : "none";
  $("#pinOld").value = ""; $("#pinNew").value = ""; $("#pinNew2").value = "";
  $("#pinErr2").style.display = "none";
  openModal("#pinModal");
  setTimeout(() => (has ? $("#pinOld") : $("#pinNew")).focus(), 60);
}
$("#pinBtn").addEventListener("click", openPinModal);
$("#changePinBtn").addEventListener("click", openPinModal);
$("#pinCtaBtn").addEventListener("click", openPinModal);

function pinErr(msg) {
  const e = $("#pinErr2");
  e.textContent = msg;
  e.style.display = "block";
}

$("#pinSave").addEventListener("click", async () => {
  const has = !!(OV && OV.has_pin);
  const oldPin = $("#pinOld").value.trim();
  const a = $("#pinNew").value.trim();
  const b = $("#pinNew2").value.trim();
  $("#pinErr2").style.display = "none";
  if (!/^[0-9]{4,8}$/.test(a)) return pinErr("The PIN must be 4 to 8 digits, numbers only.");
  if (a !== b) return pinErr("The two new PINs do not match.");
  if (has && !oldPin) return pinErr("Enter your current PIN first.");
  try {
    await api("/pin", { method: "POST",
      body: JSON.stringify({ old: oldPin, new: a }) });
    closeModal("#pinModal");
    toast(has ? "PIN changed ✓" : "PIN created ✓");
    load();
  } catch (err) { pinErr(err.message || "Could not save the PIN"); }
});
$$("#pinModal input").forEach((inp) => {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#pinSave").click(); });
});

/* ---------------------------------------------------------------- switches */

function bindSwitch(sel, onChange) {
  $(sel).addEventListener("click", () => {
    const el = $(sel);
    el.classList.toggle("on");
    onChange(el.classList.contains("on"));
  });
}

bindSwitch("#allowDash", async (on) => {
  try {
    await api("/settings", { method: "POST",
      body: JSON.stringify({ allow_dashboards: on }) });
    toast(on ? "Dashboard keypad allowed ✓" : "Dashboard keypad blocked ✓");
  } catch (err) {
    $("#allowDash").classList.toggle("on", !on);
    toast(err.message, true);
  }
});
bindSwitch("#actSnapshot", (on) => {
  if (draft.actions) draft.actions.snapshot = on;
  markDirty("actions");
});
bindSwitch("#ttsEnabled", (on) => {
  if (draft.actions) draft.actions.tts.enabled = on;
  $("#ttsBox").style.opacity = on ? "1" : ".5";
  markDirty("actions");
});

/* ---------------------------------------------------------------- dirty */

const DIRTY_UI = {
  sensors:  ["#senDirty", "#senSave"],
  cameras:  ["#camDirty", "#camSave"],
  actions:  ["#actDirty", "#actSave"],
  timings:  ["#timDirty", "#timSave"],
  channels: ["#chanDirty", "#chanSave"],
};

function setDirty(key, on) {
  dirty[key] = on;
  const [tag, btn] = DIRTY_UI[key];
  $(tag).classList.toggle("on", on);
  $(btn).disabled = !on;
}
function markDirty(key) { setDirty(key, true); }

/* ---------------------------------------------------------------- sensors */

const GROUPS = [
  ["doors",   "🚪", "Doors"],
  ["windows", "🪟", "Windows"],
  ["motion",  "🚶", "Motion"],
  ["locks",   "🔒", "Locks"],
  ["other",   "🧩", "Other sensors"],
];
const MODES = [["home", "🏠 Home"], ["away", "🚗 Away"], ["night", "🌙 Night"]];

function sensorList() {
  const out = [];
  const seen = new Set();
  const groups = (OV && OV.groups) || {};
  const sensors = (OV && OV.sensors) || {};
  GROUPS.forEach(([key]) => {
    (groups[key] || []).forEach((raw) => {
      const it = normItem(raw);
      if (!it.entity_id || seen.has(it.entity_id)) return;
      seen.add(it.entity_id);
      const cfg = sensors[it.entity_id] || {};
      out.push({
        eid: it.entity_id,
        group: key,
        name: it.name || cfg.name || it.entity_id,
        state: it.state != null ? it.state : (cfg.state || ""),
        auto: !!cfg.auto,
      });
    });
  });
  /* Anything configured but not present in a group still deserves a row. */
  Object.keys(sensors).forEach((eid) => {
    if (seen.has(eid)) return;
    seen.add(eid);
    const cfg = sensors[eid];
    out.push({ eid, group: "other", name: cfg.name || eid,
               state: cfg.state || "", auto: !!cfg.auto });
  });
  return out;
}

function cfgFor(eid) {
  if (!draft.sensors[eid]) {
    draft.sensors[eid] = { use: false, delay: false, modes: ["home", "away", "night"] };
  }
  return draft.sensors[eid];
}

function buildSensorDraft() {
  draft.sensors = {};
  const sensors = (OV && OV.sensors) || {};
  sensorList().forEach((s) => {
    const c = sensors[s.eid];
    draft.sensors[s.eid] = c
      ? { use: !!c.use, delay: !!c.delay,
          modes: Array.isArray(c.modes) ? c.modes.slice() : ["home", "away", "night"] }
      : { use: false, delay: false, modes: ["home", "away", "night"] };
  });
}

function stateBadge(group, state) {
  const s = String(state || "").toLowerCase();
  if (group === "locks") {
    if (s === "locked") return ["ok", "locked"];
    if (s === "unlocked") return ["open", "unlocked"];
  } else if (group === "motion") {
    if (s === "on") return ["open", "detected"];
    if (s === "off") return ["ok", "clear"];
  } else {
    if (s === "on") return ["open", "open"];
    if (s === "off") return ["ok", "closed"];
  }
  return ["", s || "unknown"];
}

/* ---- multi-select state ----------------------------------------------
 * `picked` holds the entity ids the user ticked. Bulk actions apply to
 * exactly those rows, so you can e.g. drop 3 sensors out of a group
 * without touching the rest. `shownOrder` is the flat, currently visible
 * row order — shift-click selects a range inside it. */
const picked = new Set();
let shownOrder = [];
let lastPicked = null;

function pickedRows() {
  return sensorList().filter((s) => picked.has(s.eid));
}

function renderBulkBar() {
  const bar = $("#senBulk");
  const n = picked.size;
  bar.classList.toggle("on", n > 0);
  $("#senBulkCount").textContent =
    n + (n === 1 ? " sensor selected" : " sensors selected");
}

function applyBulk(action) {
  const rows = pickedRows();
  if (!rows.length) return;
  rows.forEach((s) => {
    const c = cfgFor(s.eid);
    if (action === "use") {
      c.use = true;
      if (!c.modes.length) c.modes = ["home", "away", "night"];
    } else if (action === "unuse") {
      c.use = false;
    } else if (action === "delayed" || action === "instant") {
      c.delay = action === "delayed";
    } else if (action.indexOf("mode-") === 0) {
      const m = action.slice(5);
      // Toggle as a group: if every picked row already has the mode, remove
      // it from all of them; otherwise add it to all of them.
      const everyHas = rows.every((r) => cfgFor(r.eid).modes.indexOf(m) >= 0);
      const i = c.modes.indexOf(m);
      if (everyHas) { if (i >= 0) c.modes.splice(i, 1); }
      else if (i < 0) { c.modes.push(m); c.use = true; }
    }
  });
  markDirty("sensors");
  renderSensors();
  toast(rows.length + (rows.length === 1 ? " sensor" : " sensors")
        + " updated — press Save sensors to keep it");
}

function renderSensors() {
  const box = $("#senGroups");
  const all = sensorList();
  const q = $("#senSearch").value.trim().toLowerCase();
  const items = q
    ? all.filter((s) => s.name.toLowerCase().includes(q) || s.eid.toLowerCase().includes(q))
    : all;
  shownOrder = [];

  const used = all.filter((s) => cfgFor(s.eid).use).length;
  $("#senCount").textContent = all.length
    ? used + " of " + all.length + " sensors in use"
    : "";

  if (!all.length) {
    box.innerHTML = '<div class="empty">No sensors detected yet.<br>'
      + "Give your binary sensors a <b>device class</b> in Home Assistant "
      + "(door, window, motion, occupancy…) and they appear here automatically.</div>";
    return;
  }
  if (!items.length) {
    box.innerHTML = '<div class="empty">Nothing matches “' + esc(q) + '”.</div>';
    return;
  }

  let html = "";
  GROUPS.forEach(([key, icon, label]) => {
    const rows = items.filter((s) => s.group === key);
    if (!rows.length) return;
    const allPicked = rows.every((s) => picked.has(s.eid));
    html += '<div class="sect">' + icon + " " + esc(label)
      + ' <span class="n">' + rows.length + "</span>"
      + '<span class="sp"></span>'
      + '<button class="ghost selbtn" data-pick="' + key + '">'
      + (allPicked ? "☐ Deselect group" : "☑ Select group") + "</button>"
      + '<button class="ghost selbtn" data-all="' + key + '">Use all</button>'
      + '<button class="ghost selbtn" data-none="' + key + '">Use none</button></div>';
    rows.forEach((s) => {
      const c = cfgFor(s.eid);
      const [bcls, btxt] = stateBadge(s.group, s.state);
      const sel = picked.has(s.eid);
      shownOrder.push(s.eid);
      html += '<div class="srow' + (c.use ? "" : " off") + (sel ? " picked" : "")
        + '" data-eid="' + esc(s.eid) + '">'
        + '<span class="spick" data-pick-row title="Select this sensor">'
        + (sel ? "✓" : "") + "</span>"
        + '<span class="sicon">' + icon + "</span>"
        + '<div class="smain"><b>' + esc(s.name) + "</b>"
        + '<div class="sid">' + esc(s.eid) + "</div></div>"
        + '<span class="sbadge ' + bcls + '">' + esc(btxt) + "</span>"
        + (s.auto ? '<span class="sbadge auto" title="Automatic default — change anything and your choice takes over">auto</span>' : "")
        + '<div class="chips">'
        + '<span class="chip' + (c.use ? " on" : "") + '" data-use>'
        + (c.use ? "✓ In use" : "Not used") + "</span>"
        + MODES.map(([m, lbl]) =>
            '<span class="chip blue' + (c.use && c.modes.indexOf(m) >= 0 ? " on" : "")
            + '" data-mode="' + m + '">' + lbl + "</span>").join("")
        + '</div>'
        + '<div class="seg">'
        + '<button class="' + (c.delay ? "on" : "") + '" data-delay="1">⏳ Delayed</button>'
        + '<button class="' + (c.delay ? "" : "on inst") + '" data-delay="0">⚡ Instant</button>'
        + "</div></div>";
    });
  });
  box.innerHTML = html;
  renderBulkBar();
}

/* Refresh only the live state badges — used while the draft is dirty so the
 * user's unsaved choices are never thrown away by a poll. */
function refreshSensorStates() {
  sensorList().forEach((s) => {
    const row = $('#senGroups .srow[data-eid="' + CSS.escape(s.eid) + '"]');
    if (!row) return;
    const badge = row.querySelector(".sbadge");
    if (!badge) return;
    const [bcls, btxt] = stateBadge(s.group, s.state);
    badge.className = "sbadge " + bcls;
    badge.textContent = btxt;
  });
}

$("#senSearch").addEventListener("input", renderSensors);

function shownInGroup(key) {
  const q = $("#senSearch").value.trim().toLowerCase();
  return sensorList().filter((s) => s.group === key && (!q ||
    s.name.toLowerCase().includes(q) || s.eid.toLowerCase().includes(q)));
}

$("#senGroups").addEventListener("click", (e) => {
  const pickBtn = e.target.closest("[data-pick]");
  if (pickBtn) {
    const rows = shownInGroup(pickBtn.dataset.pick);
    const allPicked = rows.every((s) => picked.has(s.eid));
    rows.forEach((s) => {
      if (allPicked) picked.delete(s.eid); else picked.add(s.eid);
    });
    return renderSensors();
  }
  // group shortcuts live in the section header, not in a row
  const allBtn = e.target.closest("[data-all]");
  const noneBtn = e.target.closest("[data-none]");
  if (allBtn || noneBtn) {
    const key = (allBtn || noneBtn).dataset.all || (allBtn || noneBtn).dataset.none;
    shownInGroup(key).forEach((s) => { cfgFor(s.eid).use = !!allBtn; });
    markDirty("sensors");
    return renderSensors();
  }

  const row = e.target.closest(".srow");
  if (!row) return;

  // selection checkbox (with shift-click range select)
  if (e.target.closest("[data-pick-row]")) {
    const eid = row.dataset.eid;
    if (e.shiftKey && lastPicked && lastPicked !== eid) {
      const a = shownOrder.indexOf(lastPicked);
      const b = shownOrder.indexOf(eid);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const add = !picked.has(eid);
        for (let i = lo; i <= hi; i++) {
          if (add) picked.add(shownOrder[i]); else picked.delete(shownOrder[i]);
        }
      }
    } else if (picked.has(eid)) {
      picked.delete(eid);
    } else {
      picked.add(eid);
    }
    lastPicked = eid;
    return renderSensors();
  }

  const c = cfgFor(row.dataset.eid);
  if (e.target.closest("[data-use]")) {
    c.use = !c.use;
    if (c.use && !c.modes.length) c.modes = ["home", "away", "night"];
  } else if (e.target.closest("[data-mode]")) {
    const m = e.target.closest("[data-mode]").dataset.mode;
    if (!c.use) c.use = true;
    const i = c.modes.indexOf(m);
    if (i >= 0) c.modes.splice(i, 1); else c.modes.push(m);
  } else if (e.target.closest("[data-delay]")) {
    c.delay = e.target.closest("[data-delay]").dataset.delay === "1";
  } else {
    return;
  }
  markDirty("sensors");
  renderSensors();
});

$("#senBulk").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-bulk]");
  if (!btn) return;
  const action = btn.dataset.bulk;
  if (action === "clear") {
    picked.clear();
    lastPicked = null;
    return renderSensors();
  }
  applyBulk(action);
});

$("#senPickShown").addEventListener("click", () => {
  shownOrder.forEach((eid) => picked.add(eid));
  renderSensors();
});
$("#senPickNone").addEventListener("click", () => {
  picked.clear();
  lastPicked = null;
  renderSensors();
});

$("#senSave").addEventListener("click", async () => {
  const btn = $("#senSave");
  btn.disabled = true;
  try {
    await api("/settings", { method: "POST",
      body: JSON.stringify({ sensors: draft.sensors }) });
    setDirty("sensors", false);
    toast("Sensor setup saved ✓");
    load();
  } catch (err) { btn.disabled = false; toast(err.message, true); }
});

/* ---------------------------------------------------------------- cameras */

function camURL(eid) {
  return API + "/camera/" + encodeURIComponent(eid) + "?t=" + Date.now();
}

function camItems() {
  const groups = (OV && OV.groups) || {};
  return (groups.cameras || []).map(normItem).map((it) => ({
    eid: it.entity_id, name: it.name || it.entity_id,
  }));
}

function renderCameras() {
  const box = $("#camList");
  const items = camItems();
  if (!items.length) {
    box.innerHTML = '<div class="empty" style="grid-column:1/-1">No cameras found.'
      + "<br>Every <b>camera.*</b> entity in Home Assistant shows up here.</div>";
    box.dataset.sig = "__empty__";
    return;
  }
  const sig = items.map((i) => i.eid).join(",");
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.innerHTML = items.map((it) =>
      '<div class="cam" data-eid="' + esc(it.eid) + '">'
      + '<img alt="" loading="lazy">'
      + '<div class="unav">📷 no image right now</div>'
      + '<div class="pick">✓</div>'
      + '<div class="cn">' + esc(it.name)
      + '<span class="cid">' + esc(it.eid) + "</span></div></div>").join("");
    box.querySelectorAll(".cam").forEach((el) => {
      const img = el.querySelector("img");
      img.addEventListener("error", () => el.classList.add("broken"));
      img.addEventListener("load", () => el.classList.remove("broken"));
      img.src = camURL(el.dataset.eid);
    });
  }
  box.querySelectorAll(".cam").forEach((el) => {
    el.classList.toggle("on", draft.cameras.has(el.dataset.eid));
  });
}

function refreshCamImages() {
  $$("#camList .cam").forEach((el) => {
    const img = el.querySelector("img");
    if (img && el.dataset.eid) img.src = camURL(el.dataset.eid);
  });
}

$("#camList").addEventListener("click", (e) => {
  const cam = e.target.closest(".cam");
  if (!cam) return;
  const eid = cam.dataset.eid;
  if (e.target.tagName === "IMG") {
    lbEid = eid;
    $("#lbName").textContent = cam.querySelector(".cn").textContent;
    $("#lbImg").src = camURL(eid);
    return openModal("#lightbox");
  }
  if (draft.cameras.has(eid)) draft.cameras.delete(eid);
  else draft.cameras.add(eid);
  markDirty("cameras");
  renderCameras();
});

$("#lbRefresh").addEventListener("click", () => {
  if (lbEid) $("#lbImg").src = camURL(lbEid);
});

$("#camSave").addEventListener("click", async () => {
  const btn = $("#camSave");
  btn.disabled = true;
  try {
    await api("/settings", { method: "POST",
      body: JSON.stringify({ cameras: Array.from(draft.cameras) }) });
    setDirty("cameras", false);
    toast("Cameras saved ✓");
    load();
  } catch (err) { btn.disabled = false; toast(err.message, true); }
});

/* ---------------------------------------------------------------- actions */

const PICKERS = [
  ["sirens",  "#pickSirens",  "No siren.* entities found in Home Assistant."],
  ["lights",  "#pickLights",  "No lights found."],
  ["switches", "#pickSwitches", "No switches found."],
  ["locks",   "#pickLocks",   "No locks found."],
  ["scenes",  "#pickScenes",  "No scenes found."],
  ["scripts", "#pickScripts", "No scripts found. Create one in Home Assistant and it appears here."],
];

function blankActions() {
  return { sirens: [], lights: [], switches: [], locks: [], scenes: [],
           scripts: [], snapshot: false,
           tts: { enabled: false, targets: [], message: "" } };
}

function buildActionDraft() {
  const a = (OV && OV.actions) || {};
  const d = blankActions();
  Object.keys(d).forEach((k) => {
    if (k === "snapshot" || k === "tts") return;
    if (Array.isArray(a[k])) d[k] = a[k].slice();
  });
  d.snapshot = !!a.snapshot;
  const t = a.tts || {};
  d.tts = { enabled: !!t.enabled,
            targets: Array.isArray(t.targets) ? t.targets.slice() : [],
            message: t.message || "" };
  draft.actions = d;
}

function renderPicker(sel, choices, selectedArr, emptyMsg) {
  const box = $(sel);
  if (!choices.length) {
    box.innerHTML = '<div class="pnone">' + esc(emptyMsg) + "</div>";
    return;
  }
  box.innerHTML = choices.map((c) =>
    '<label class="prow"><input type="checkbox" data-eid="' + esc(c.entity_id) + '"'
    + (selectedArr.indexOf(c.entity_id) >= 0 ? " checked" : "") + ">"
    + '<span class="pn">' + esc(c.name || c.entity_id) + "</span>"
    + '<span class="pid">' + esc(c.entity_id) + "</span></label>").join("");
}

function bindPicker(sel, getArr) {
  $(sel).addEventListener("change", (e) => {
    const cb = e.target.closest("input[type=checkbox]");
    if (!cb) return;
    const arr = getArr();
    const i = arr.indexOf(cb.dataset.eid);
    if (cb.checked && i < 0) arr.push(cb.dataset.eid);
    if (!cb.checked && i >= 0) arr.splice(i, 1);
    markDirty("actions");
    renderActionSummary();
  });
}

function choicesFor(key) {
  const ch = (OV && OV.action_choices) || {};
  return (ch[key] || []).map((c) => (typeof c === "string"
    ? { entity_id: c, name: c } : c));
}

function renderActions() {
  const d = draft.actions || blankActions();
  PICKERS.forEach(([key, sel, msg]) =>
    renderPicker(sel, choicesFor(key), d[key], msg));
  renderPicker("#pickMedia", choicesFor("media"), d.tts.targets,
    "No media players found. Add a speaker (Google Nest, Sonos, Alexa…) to Home Assistant first.");
  $("#actSnapshot").classList.toggle("on", d.snapshot);
  $("#ttsEnabled").classList.toggle("on", d.tts.enabled);
  $("#ttsBox").style.opacity = d.tts.enabled ? "1" : ".5";
  if ($("#ttsMessage") !== document.activeElement) $("#ttsMessage").value = d.tts.message;
  renderActionSummary();
}

function renderActionSummary() {
  const d = draft.actions || blankActions();
  const bits = [];
  if (d.sirens.length) bits.push("sound <b>" + plural(d.sirens.length, "siren") + "</b>");
  if (d.lights.length) bits.push("turn on <b>" + plural(d.lights.length, "light") + "</b>");
  if (d.switches.length) {
    bits.push("switch on <b>" + d.switches.length
      + (d.switches.length === 1 ? " switch" : " switches") + "</b>");
  }
  if (d.locks.length) bits.push("lock <b>" + plural(d.locks.length, "door") + "</b>");
  if (d.scenes.length) bits.push("activate <b>" + plural(d.scenes.length, "scene") + "</b>");
  if (d.scripts.length) bits.push("run <b>" + plural(d.scripts.length, "script") + "</b>");
  if (d.snapshot) bits.push("take a <b>camera snapshot</b>");
  if (d.tts.enabled && d.tts.targets.length) {
    bits.push("announce on <b>" + plural(d.tts.targets.length, "speaker") + "</b>");
  }
  const chans = draft.channels.size;
  const alerts = chans ? " " + plural(chans, "alert service") + " will also be notified." : "";
  $("#actSummary").innerHTML = bits.length
    ? "When triggered: " + bits.join(", ") + "." + alerts
    : "When triggered: <b>nothing happens yet</b> — pick some actions below so the "
      + "alarm actually does something." + alerts;
}

PICKERS.forEach(([key, sel]) => bindPicker(sel, () => draft.actions[key]));
bindPicker("#pickMedia", () => draft.actions.tts.targets);

$("#ttsMessage").addEventListener("input", () => {
  if (draft.actions) draft.actions.tts.message = $("#ttsMessage").value;
  markDirty("actions");
});

$("#actSave").addEventListener("click", async () => {
  const btn = $("#actSave");
  btn.disabled = true;
  try {
    await api("/settings", { method: "POST",
      body: JSON.stringify({ actions: draft.actions }) });
    setDirty("actions", false);
    toast("Actions saved ✓");
    load();
  } catch (err) { btn.disabled = false; toast(err.message, true); }
});

/* ---------------------------------------------------------------- timings */

function renderTimings() {
  $("#delExit").value = draft.delays.exit;
  $("#delEntry").value = draft.delays.entry;
  $("#delSiren").value = draft.delays.siren;
}

[["#delExit", "exit"], ["#delEntry", "entry"], ["#delSiren", "siren"]]
  .forEach(([sel, key]) => {
    $(sel).addEventListener("input", () => {
      draft.delays[key] = parseInt($(sel).value, 10) || 0;
      markDirty("timings");
    });
  });

$("#timSave").addEventListener("click", async () => {
  const btn = $("#timSave");
  btn.disabled = true;
  try {
    await api("/settings", { method: "POST",
      body: JSON.stringify({ delays: draft.delays }) });
    setDirty("timings", false);
    toast("Timings saved ✓");
    load();
  } catch (err) { btn.disabled = false; toast(err.message, true); }
});

/* ---------------------------------------------------------------- alerts */

function renderChannels() {
  const box = $("#chanList");
  const choices = (OV && OV.channel_choices) || [];
  const all = choices.slice();
  draft.channels.forEach((c) => { if (all.indexOf(c) < 0) all.push(c); });
  if (!all.length) {
    box.innerHTML = '<div class="pnone">No notify services exist in Home Assistant '
      + "yet. Install the Home Assistant companion app on your phone and "
      + "<b>notify.mobile_app_…</b> appears here automatically.</div>";
    return;
  }
  box.innerHTML = all.map((svc) => {
    const missing = choices.indexOf(svc) < 0;
    return '<label class="prow"><input type="checkbox" data-svc="' + esc(svc) + '"'
      + (draft.channels.has(svc) ? " checked" : "") + ">"
      + '<span class="pn">' + esc(svc) + (missing ? " (not found any more)" : "") + "</span>"
      + '<span class="pid">' + esc(channelHint(svc)) + "</span></label>";
  }).join("");
}

function channelHint(svc) {
  if (svc.indexOf("mobile_app") >= 0) return "phone push";
  if (svc.indexOf("persistent_notification") >= 0) return "HA sidebar only";
  if (/smtp|mail/.test(svc)) return "email";
  if (/sms|twilio|clicksend/.test(svc)) return "SMS";
  if (/telegram|whatsapp|signal|discord|slack/.test(svc)) return "messaging";
  return "notify service";
}

$("#chanList").addEventListener("change", (e) => {
  const cb = e.target.closest("input[type=checkbox]");
  if (!cb) return;
  if (cb.checked) draft.channels.add(cb.dataset.svc);
  else draft.channels.delete(cb.dataset.svc);
  markDirty("channels");
  renderActionSummary();
});

$("#chanSave").addEventListener("click", async () => {
  const btn = $("#chanSave");
  btn.disabled = true;
  try {
    await api("/settings", { method: "POST",
      body: JSON.stringify({ channels: Array.from(draft.channels) }) });
    setDirty("channels", false);
    toast("Alert services saved ✓");
    load();
  } catch (err) { btn.disabled = false; toast(err.message, true); }
});

$("#testBtn").addEventListener("click", async () => {
  const btn = $("#testBtn");
  const out = $("#testOut");
  btn.disabled = true;
  out.innerHTML = '<div class="tline">Sending a test message…</div>';
  try {
    const r = await api("/test", { method: "POST", body: "{}" });
    const sent = r.sent || [];
    const errs = r.errors || [];
    let html = "";
    sent.forEach((s) => { html += '<div class="tline ok">✅ ' + esc(s) + " — delivered</div>"; });
    errs.forEach((e) => {
      html += '<div class="tline bad">❌ ' + esc(e.service || "?") + " — "
        + esc(e.error || "failed") + "</div>";
    });
    if (!html) {
      html = '<div class="tline">Nothing was sent — tick at least one service '
        + "above and press <b>Save alerts</b> first.</div>";
    }
    out.innerHTML = html;
  } catch (err) {
    out.innerHTML = '<div class="tline bad">❌ ' + esc(err.message) + "</div>";
  }
  btn.disabled = false;
});

/* ---------------------------------------------------------------- events */

const EV_ICON = {
  opened: "🚪", closed: "✅", motion: "🚶", cleared: "✅", locked: "🔒",
  unlocked: "🔓", jammed: "⚠️", arrived: "🏠", left: "👋", armed: "🛡️",
  armed_home: "🏠", armed_away: "🚗", armed_night: "🌙", arming: "⏳",
  pending: "⚠️", disarmed: "🔕", triggered: "🚨", panic: "🚨",
  test: "📨", snapshot: "📸",
};
const EV_TEXT = {
  opened: "opened", closed: "closed", motion: "motion detected",
  cleared: "cleared", locked: "locked", unlocked: "unlocked",
  jammed: "jammed", arrived: "arrived home", left: "left home",
  armed: "armed", armed_home: "armed · Home", armed_away: "armed · Away",
  armed_night: "armed · Night", arming: "arming started",
  pending: "entry delay started", disarmed: "disarmed",
  triggered: "TRIGGERED THE ALARM", panic: "panic button pressed",
  test: "test alert sent", snapshot: "snapshot taken",
};

function renderEvents(list) {
  const box = $("#events");
  const evs = list || (OV && OV.events) || [];
  if (!evs.length) {
    box.innerHTML = '<div class="empty" style="border:0;background:none">'
      + "Nothing logged yet.<br>Open a door or arm the alarm — everything "
      + "shows up here.</div>";
    return;
  }
  box.innerHTML = evs.map((ev) => {
    const icon = ev.alert ? "🚨" : (EV_ICON[ev.event] || "•");
    const what = EV_TEXT[ev.event] || ev.event || "";
    const head = ev.alert
      ? "<b>ALERT — " + esc(ev.name || ev.entity_id) + " " + esc(what) + "</b>"
      : "<b>" + esc(ev.name || ev.entity_id || "System") + "</b> " + esc(what);
    return '<div class="ev' + (ev.alert ? " alert" : "") + '">'
      + '<span class="ei">' + icon + "</span>"
      + '<div class="eb">' + head
      + '<small title="' + esc(absTime(ev.ts)) + '">' + esc(ago(ev.ts))
      + (ev.mode ? " · mode " + esc(ev.mode) : "")
      + (ev.entity_id ? " · " + esc(ev.entity_id) : "")
      + "</small></div></div>";
  }).join("");
}

$("#logRefresh").addEventListener("click", async () => {
  try {
    const r = await api("/events");
    renderEvents(r.events || []);
    toast("Log refreshed ✓");
  } catch (err) { toast(err.message, true); }
});

$("#helpBtn").addEventListener("click", () => openModal("#helpModal"));

/* ---------------------------------------------------------------- polling */

function pollPaused() {
  /* Never clobber a PIN the user is typing. */
  return $("#pinModal").classList.contains("open");
}

/* Set by load(); the poller reads it to drive PMPoll's error backoff without
   making the many direct load() callers deal with a rejected promise. */
let loadOk = true;

async function load() {
  if (pollPaused()) return;
  try {
    OV = await api("/overview");
    loadOk = true;
  } catch (err) {
    loadOk = false;
    $("#heroSub").innerHTML = '<span class="dot"></span>' + esc(err.message);
    return;
  }

  renderHero();
  syncCountdown();

  if (!dirty.sensors) { buildSensorDraft(); renderSensors(); }
  else refreshSensorStates();

  if (!dirty.cameras) draft.cameras = new Set(OV.cameras || []);
  renderCameras();

  if (!dirty.actions) { buildActionDraft(); renderActions(); }

  if (!dirty.timings) {
    const d = OV.delays || {};
    draft.delays = { exit: d.exit != null ? d.exit : 45,
                     entry: d.entry != null ? d.entry : 30,
                     siren: d.siren != null ? d.siren : 180 };
    renderTimings();
  }

  if (!dirty.channels) { draft.channels = new Set(OV.channels || []); renderChannels(); }

  $("#allowDash").classList.toggle("on", !!OV.allow_dashboards);
  renderEvents();
  renderActionSummary();
}

renderCode();

/* Both pollers stop while the tool is hidden behind another tool, while the
   tab is backgrounded and while the tablet's screen is off, and resume with an
   immediate refresh. load() still returns early on its own while a PIN modal
   or a dirty draft is open, so unsaved edits are never clobbered. */
PMPoll.every(POLL_MS, () => load().then(() => {
  if (!loadOk) throw new Error("overview unavailable");
}), { el: document.body, name: "overview" });

PMPoll.every(CAM_MS, refreshCamImages, { el: document.body, name: "cameras" });
