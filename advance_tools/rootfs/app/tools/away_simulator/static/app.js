/* Away Simulator — frontend logic.
 *
 * Talks to /api/tools/away_simulator/* (tool.py). Polls /data every 10 s and
 * saves settings instantly; the backend rebuilds today's plan on each change.
 */
"use strict";

const API = "/api/tools/away_simulator";
const $  = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let DATA = null;          // last /data payload
let SAVING = false;       // a config POST is in flight
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday",
                  "Friday","Saturday"];

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

function rel(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(d)) return "";
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " h ago";
  return Math.floor(d / 86400) + " d ago";
}

const toMin = (t) => {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const entIcon = (id) => id.startsWith("switch.") ? "🔌" : "💡";

function entName(id) {
  const e = (DATA?.entities || []).find((x) => x.id === id);
  return e ? e.name : id;
}

function refDayLabel(refDate) {
  if (!refDate) return "";
  const d = new Date(refDate + "T12:00:00");
  if (isNaN(d)) return refDate;
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  const wd = WEEKDAYS[d.getDay()];
  if (days <= 1) return "yesterday";
  if (days < 7) return `last ${wd} (${refDate})`;
  if (days === 7) return `last ${wd} (${refDate})`;
  return `${wd} ${refDate}`;
}

/* ------------------------------------------------------------ tooltip */

const tipbox = $("#tipbox");
document.addEventListener("mouseover", (e) => {
  const h = e.target.closest(".hint");
  if (!h) { tipbox.style.display = "none"; return; }
  tipbox.innerHTML = `<b class="t">${esc(h.dataset.t)}</b>${esc(h.dataset.b)}` +
    (h.dataset.ex ? `<div class="ex">${esc(h.dataset.ex)}</div>` : "");
  tipbox.style.display = "block";
  const r = h.getBoundingClientRect(), tw = tipbox.offsetWidth;
  let x = Math.min(r.left, innerWidth - tw - 10);
  let y = r.bottom + 8;
  if (y + tipbox.offsetHeight > innerHeight - 8)
    y = r.top - tipbox.offsetHeight - 8;
  tipbox.style.left = Math.max(8, x) + "px";
  tipbox.style.top = Math.max(8, y) + "px";
});

/* ------------------------------------------------------------ modal */

$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]"))
      m.classList.remove("open");
  });
});
$("#learnBtn").onclick = () => $("#learnModal").classList.add("open");

/* ------------------------------------------------------------ data flow */

async function refresh() {
  try {
    DATA = await api("GET", "/data");
    render();
  } catch (e) {
    $("#connStat").innerHTML = `<span class="dot"></span>${esc(e.message)}`;
  }
}

function applyResponse(d) {
  // config/enable/rebuild responses carry config+plan+status — merge them.
  if (!DATA) { refresh(); return; }
  DATA.config = d.config; DATA.plan = d.plan; DATA.status = d.status;
  DATA.connected = d.connected;
  render();
}

async function saveConfig(partial) {
  SAVING = true;
  try {
    const d = await api("POST", "/config", partial);
    applyResponse(d);
    if (d.error) toast("Saved, but plan build failed: " + d.error, true);
  } catch (e) {
    toast(e.message, true);
    refresh();                       // resync UI with server truth
  } finally { SAVING = false; }
}

/* ------------------------------------------------------------ render */

function render() {
  if (!DATA) return;
  const conn = DATA.connected;
  $("#connStat").innerHTML =
    `<span class="dot ${conn ? "ok" : ""}"></span>${conn ? "connected" : "no HA connection"}`;
  renderHero();
  renderChips();
  renderCombo();
  renderSettings();
  renderPersons();
  renderPlan();
  renderLog();
}

function renderHero() {
  const cfg = DATA.config, plan = DATA.plan || {};
  const hero = $("#hero"), sw = $("#mainSwitch"),
        title = $("#statusTitle"), sub = $("#statusSub");
  hero.className = "card"; sw.className = "bigsw"; title.className = "";
  const left = (plan.actions || []).filter((a) => !a.done).length;
  const refTxt = plan.ref_date
    ? `Replaying <b>${esc(refDayLabel(plan.ref_date))}</b> with ±${cfg.jitter_min} min randomness.`
    : "";

  if (!cfg.enabled) {
    title.className = "c-mut";
    title.textContent = "Simulation is off";
    sub.innerHTML = cfg.entities.length
      ? "Flip the switch before you leave — the house will keep living without you. " + refTxt
      : "Pick a few lights or switches below, then flip the switch before you leave.";
  } else if (DATA.status === "paused_home") {
    hero.classList.add("st-paused"); sw.classList.add("on", "paused");
    title.className = "c-warn";
    title.textContent = "Someone is home — paused";
    sub.innerHTML = "The simulation resumes automatically when everyone leaves. " + refTxt;
  } else if (DATA.status === "no_plan") {
    hero.classList.add("st-warn"); sw.classList.add("on");
    title.className = "c-bad";
    title.textContent = "Enabled, but no plan for today";
    sub.innerHTML = plan.error
      ? "Plan build failed: " + esc(plan.error)
      : "No usable history was found for the reference day — try a different \"days back\" or other entities.";
  } else {
    hero.classList.add("st-active"); sw.classList.add("on");
    title.className = "c-good";
    title.textContent = `Simulating presence — ${left} action${left === 1 ? "" : "s"} left today`;
    sub.innerHTML = refTxt;
  }
}

$("#mainSwitch").onclick = async () => {
  if (!DATA) return;
  try {
    const d = await api("POST", "/enable", { enabled: !DATA.config.enabled });
    applyResponse(d);
    toast(d.config.enabled ? "Simulation enabled — enjoy your trip!" : "Simulation disabled");
    if (d.error) toast("Plan build failed: " + d.error, true);
  } catch (e) { toast(e.message, true); }
};

/* ------------------------------------------------------------ entity picker */

function renderChips() {
  const box = $("#entChips");
  box.innerHTML = "";
  const cfg = DATA.config;
  if (!cfg.entities.length) {
    box.innerHTML = `<div class="empty" style="padding:16px 6px;width:100%">
      <span class="big">🛋️</span>No entities yet — search above and add the lights
      you use every evening.<br>Living room, kitchen and porch make the most
      convincing "someone's home" picture.</div>`;
    return;
  }
  for (const id of cfg.entities) {
    const e = (DATA.entities || []).find((x) => x.id === id);
    const chip = document.createElement("span");
    chip.className = "echip";
    chip.innerHTML =
      `<span class="sdot ${e && e.state === "on" ? "on" : ""}"></span>` +
      `<span>${entIcon(id)}</span>` +
      `<span class="nm" title="${esc(id)}">${esc(e ? e.name : id)}</span>` +
      `<button class="zap" title="Blink test — turn on for 1.5 s">⚡</button>` +
      `<button class="rm" title="Remove">✕</button>`;
    chip.querySelector(".zap").onclick = () => blink(id, chip);
    chip.querySelector(".rm").onclick = () =>
      saveConfig({ entities: cfg.entities.filter((x) => x !== id) });
    box.appendChild(chip);
  }
}

async function blink(id, chip) {
  const btn = chip.querySelector(".zap");
  btn.disabled = true;
  try {
    await api("POST", "/test", { entity_id: id });
    toast(`${entName(id)} blinked — control works`);
  } catch (e) { toast(e.message, true); }
  btn.disabled = false;
}

const search = $("#entSearch"), comboList = $("#entList");

function renderCombo() {
  const q = search.value.trim().toLowerCase();
  const chosen = new Set(DATA?.config.entities || []);
  const pool = (DATA?.entities || []).filter((e) => !chosen.has(e.id) &&
    (!q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)));
  comboList.innerHTML = "";
  if (document.activeElement !== search || (!q && !pool.length)) {
    comboList.classList.remove("open");
    return;
  }
  if (!pool.length) {
    comboList.innerHTML = `<div class="combo-it"><span class="cn" style="color:var(--mut)">No matching lights or switches</span></div>`;
  }
  for (const e of pool.slice(0, 40)) {
    const it = document.createElement("div");
    it.className = "combo-it";
    it.innerHTML = `<span>${entIcon(e.id)}</span>` +
      `<span class="cn">${esc(e.name)}</span><span class="cid">${esc(e.id)}</span>`;
    it.onmousedown = (ev) => {          // mousedown so blur doesn't close first
      ev.preventDefault();
      saveConfig({ entities: [...DATA.config.entities, e.id] });
      search.value = "";
      comboList.classList.remove("open");
    };
    comboList.appendChild(it);
  }
  comboList.classList.add("open");
}

search.addEventListener("input", renderCombo);
search.addEventListener("focus", renderCombo);
search.addEventListener("blur", () =>
  setTimeout(() => comboList.classList.remove("open"), 150));

/* ------------------------------------------------------------ settings */

function renderSettings() {
  const cfg = DATA.config;
  $$("#daysSeg button").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.v) === cfg.days_back));
  const j = $("#jitter");
  if (document.activeElement !== j) j.value = cfg.jitter_min;
  $("#jitterLabel").textContent = `±${j.value} min`;
  const wf = $("#winFrom"), wt = $("#winTo");
  if (document.activeElement !== wf) wf.value = cfg.window.from;
  if (document.activeElement !== wt) wt.value = cfg.window.to;
  $("#pauseSw").classList.toggle("on", !!cfg.pause_when_home);
}

function renderPersons() {
  const line = $("#personLine");
  const ps = DATA.persons || [];
  if (!ps.length) {
    line.innerHTML = `No person entities found — "pause when home" will never trigger.`;
    return;
  }
  line.innerHTML = ps.map((p) =>
    `<span class="p ${p.state === "home" ? "home" : ""}">👤 ${esc(p.name)} · ${esc(p.state)}</span>`
  ).join("");
}

$$("#daysSeg button").forEach((b) =>
  b.onclick = () => saveConfig({ days_back: Number(b.dataset.v) }));

let jitterTimer = null;
$("#jitter").addEventListener("input", () => {
  $("#jitterLabel").textContent = `±${$("#jitter").value} min`;
  clearTimeout(jitterTimer);
  jitterTimer = setTimeout(() =>
    saveConfig({ jitter_min: Number($("#jitter").value) }), 500);
});

function saveWindow() {
  const from = $("#winFrom").value, to = $("#winTo").value;
  if (from && to) saveConfig({ window: { from, to } });
}
$("#winFrom").addEventListener("change", saveWindow);
$("#winTo").addEventListener("change", saveWindow);

$("#pauseSw").onclick = () =>
  saveConfig({ pause_when_home: !DATA.config.pause_when_home });

/* ------------------------------------------------------------ plan */

function renderPlan() {
  const body = $("#planBody"), meta = $("#planMeta");
  const cfg = DATA.config, plan = DATA.plan || {};
  const acts = plan.actions || [];
  meta.textContent = plan.built_at
    ? `built ${rel(plan.built_at)} · replaying ${plan.ref_date || "?"}` : "";

  if (!cfg.entities.length) {
    body.innerHTML = `<div class="empty"><span class="big">📅</span>
      The plan appears here once you've picked some entities.<br>
      Each one gets a 24-hour timeline of the on/off actions it will replay today.</div>`;
    return;
  }
  if (!plan.date) {
    body.innerHTML = `<div class="empty"><span class="big">🗓️</span>
      No plan built yet — hit <b>↻ Rebuild</b> or enable the simulation.</div>`;
    return;
  }

  body.innerHTML = "";

  // --- timeline: one 24h bar per entity
  const wrap = document.createElement("div");
  wrap.className = "tlwrap";
  const nm = nowMin();
  for (const eid of cfg.entities) {
    const mine = acts.filter((a) => a.entity_id === eid)
                     .sort((a, b) => toMin(a.t) - toMin(b.t));
    const row = document.createElement("div");
    row.className = "tlrow";
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.title = eid;
    lbl.textContent = `${entIcon(eid)} ${entName(eid)}`;
    const bar = document.createElement("div");
    bar.className = "tlbar";

    // ON segments from on/off pairs
    const segs = [];
    let open = mine.length && mine[0].action === "off" ? 0 : null;
    for (const a of mine) {
      const m = toMin(a.t);
      if (a.action === "on") { if (open === null) open = m; }
      else if (open !== null) { segs.push([open, m]); open = null; }
    }
    if (open !== null) segs.push([open, 1440]);
    for (const [s, e] of segs) {
      const d = document.createElement("div");
      d.className = "tlseg";
      d.style.left = (s / 1440 * 100) + "%";
      d.style.width = (Math.max(e - s, 4) / 1440 * 100) + "%";
      d.title = `ON ${fmt(s)} → ${e >= 1440 ? "24:00" : fmt(e)}`;
      bar.appendChild(d);
    }
    // action markers
    for (const a of mine) {
      const mk = document.createElement("div");
      mk.className = "tlmk" + (a.done ? (a.missed ? " missed" : " done") : "");
      mk.style.left = (toMin(a.t) / 1440 * 100) + "%";
      mk.title = `${a.t} — turn ${a.action.toUpperCase()}` +
        (a.done ? (a.missed ? " (missed)" : " ✓ done") : " · upcoming");
      bar.appendChild(mk);
    }
    // "now" line
    const nl = document.createElement("div");
    nl.className = "tlnow";
    nl.style.left = (nm / 1440 * 100) + "%";
    nl.title = "now";
    bar.appendChild(nl);

    row.append(lbl, bar);
    wrap.appendChild(row);
  }
  const scale = document.createElement("div");
  scale.className = "tlscale";
  scale.innerHTML = "<span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>";
  body.append(wrap, scale);

  // --- chronological list
  if (acts.length) {
    const list = document.createElement("div");
    list.className = "plist";
    for (const a of acts) {
      const it = document.createElement("div");
      it.className = "pitem" + (a.done ? " dim" : "");
      const status = a.done
        ? (a.missed ? `<span class="ps missed">skipped (past)</span>`
                    : `<span class="ps done">✓ done</span>`)
        : `<span class="ps up">· upcoming</span>`;
      it.innerHTML = `<span class="pt">${esc(a.t)}</span>` +
        `<span>${entIcon(a.entity_id)}</span>` +
        `<span class="pn" title="${esc(a.entity_id)}">${esc(entName(a.entity_id))}</span>` +
        `<span class="pa ${a.action}">${a.action.toUpperCase()}</span>` + status;
      list.appendChild(it);
    }
    body.appendChild(list);
  } else if (!plan.error) {
    body.insertAdjacentHTML("beforeend",
      `<div class="empty">No actions today — the reference day had no on/off
       activity inside your window.<br>Try more days back, a wider window, or
       other entities.</div>`);
  }

  if ((plan.skipped || []).length) {
    body.insertAdjacentHTML("beforeend",
      `<div class="skipnote">⚠ No history on ${esc(plan.ref_date || "the reference day")} for: ` +
      plan.skipped.map((e) => esc(entName(e))).join(", ") +
      `. Recorder may not keep data that far back for these.</div>`);
  }
  if (plan.error) {
    body.insertAdjacentHTML("beforeend",
      `<div class="errnote">Plan build error: ${esc(plan.error)}</div>`);
  }
}

const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

$("#rebuildBtn").onclick = async () => {
  try {
    const d = await api("POST", "/rebuild");
    applyResponse(d);
    if (d.error) toast("Plan build failed: " + d.error, true);
    else toast(`Plan rebuilt — ${(d.plan.actions || []).length} actions`);
  } catch (e) { toast(e.message, true); }
};

/* ------------------------------------------------------------ log */

function renderLog() {
  const body = $("#logBody");
  const log = (DATA.log || []).slice().reverse();
  if (!log.length) {
    body.innerHTML = `<div class="empty">Nothing yet — once the simulation runs,
      every switch flip lands here.</div>`;
    return;
  }
  body.innerHTML = log.map((l) =>
    `<div class="logline ${l.ok === false ? "bad" : ""}">
       <span class="lt">${esc(rel(l.ts))}</span>
       <span class="lx">${esc(l.text)}</span></div>`).join("");
}

/* ------------------------------------------------------------ boot */

refresh();
setInterval(() => { if (!SAVING) refresh(); }, 10000);
