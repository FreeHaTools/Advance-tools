/* Alert Maker — frontend. */
"use strict";

const API = "/api/tools/alert_maker";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let OPTIONS = {entities: [], notify_services: [], connected: false};
let RULES = [];
let editing = null;          // rule being edited (null = new)
let selType = null;          // selected type in the builder
let selEnts = new Set();
let selNotify = new Set();
let previewTimer = null;

/* ------------------------------------------------ type metadata */

const TYPES = {
  open_too_long: {
    icon: "🚪", title: "Left open / on",
    desc: "A door, window, lock, valve or switch stays open or on too long.",
    entLabel: "Doors, windows, locks, valves, switches to watch",
    defaults: {minutes: 10},
  },
  low_battery: {
    icon: "🪫", title: "Low battery",
    desc: "A battery level drops below your threshold.",
    entLabel: "Battery sensors to watch",
    defaults: {threshold: 15},
  },
  offline: {
    icon: "📵", title: "Went offline",
    desc: "A device becomes unavailable for a while.",
    entLabel: "Entities to watch for going offline",
    defaults: {minutes: 15},
  },
  numeric: {
    icon: "📊", title: "Value too high / low",
    desc: "A sensor value crosses a limit — temperature, humidity, moisture…",
    entLabel: "Numeric sensors to watch",
    defaults: {minutes: 0},
  },
  state: {
    icon: "🎯", title: "Enters a state",
    desc: "Any entity changes to a specific state you choose.",
    entLabel: "Entities to watch",
    defaults: {minutes: 0, state: ""},
  },
};

const TIPS = {
  type: {t: "Alert types", b: "Each type is a ready-made recipe. <b>Left open" +
    "</b> watches for things that stay open/on too long, <b>Low battery</b> " +
    "checks battery percentages, <b>Went offline</b> catches devices that " +
    "stop responding (state becomes <i>unavailable</i>), <b>Value</b> " +
    "compares a number against limits, and <b>Enters a state</b> is the " +
    "free-form option — any entity, any state."},
  name: {t: "Name", b: "A short label shown in this list and used in the " +
    "automation's name — e.g. <i>Front door left open</i> or <i>Litter-Robot " +
    "offline</i>."},
  entities: {t: "Entities", b: "Pick one or more. One rule watches all of " +
    "them and the notification always names the exact entity that caused " +
    "it. The list is pre-filtered to entities that make sense for this " +
    "alert type — tick <b>show all</b> to see everything."},
  notify: {t: "Notification targets", b: "<b>Notification in Home Assistant" +
    "</b> shows a message in HA's own notification drawer (the 🔔 icon). " +
    "The <i>notify.mobile_app_…</i> services push to the phones/tablets " +
    "that run the HA companion app. Pick as many as you like, then use " +
    "🧪 Test on the saved alert to check they work."},
  minutes: {t: "For how long", b: "The condition must stay true for this " +
    "many minutes before the alert fires — this avoids false alarms from " +
    "doors that open for a few seconds or devices that blink offline."},
  threshold: {t: "Battery threshold", b: "The alert fires when the battery " +
    "percentage drops below this value. It fires once per crossing — it " +
    "won't spam you while the battery stays low."},
  numeric: {t: "Limits", b: "Fill <b>above</b>, <b>below</b>, or both. The " +
    "alert fires when the value crosses into the range — e.g. below 20 for " +
    "dry soil moisture, above 30 for a hot room."},
  state: {t: "State to watch for", b: "The exact state text, e.g. <i>on</i>, " +
    "<i>open</i>, <i>unlocked</i>, <i>Error</i>. Check the entity's current " +
    "state in the picker for a hint of what its states look like."},
};

/* ------------------------------------------------ boot */

async function boot() {
  try {
    const [opt, rules] = await Promise.all([
      fetch(API + "/options").then(r => r.json()),
      fetch(API + "/rules").then(r => r.json()),
    ]);
    OPTIONS = opt;
    RULES = rules.rules || [];
    const dot = $("#connStat .dot");
    if (opt.connected) { dot.classList.add("ok");
      $("#connStat").innerHTML = '<span class="dot ok"></span>connected'; }
    else $("#connStat").innerHTML = '<span class="dot"></span>HA not connected';
    render();
  } catch (e) {
    toast("Could not load: " + e.message, true);
  }
}

async function reloadRules() {
  const r = await fetch(API + "/rules").then(r => r.json());
  RULES = r.rules || [];
  render();
}

/* ------------------------------------------------ list rendering */

function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}

function ruleSummary(r) {
  const n = r.entities.length;
  const first = friendly(r.entities[0]);
  const ents = n === 1 ? `<b>${esc(first)}</b>`
    : `<b>${esc(first)}</b> +${n - 1} more`;
  const p = r.params || {};
  const mins = m => m >= 60 && m % 60 === 0 ? (m / 60) + " h" : m + " min";
  switch (r.type) {
    case "open_too_long":
      return `${ents} stays open/on for <b>${mins(+p.minutes || 0)}</b>`;
    case "low_battery":
      return `${ents} battery below <b>${esc(p.threshold)}%</b>`;
    case "offline":
      return `${ents} offline for <b>${mins(+p.minutes || 0)}</b>`;
    case "numeric": {
      const c = [];
      if (p.above !== "" && p.above != null) c.push("above <b>" + esc(p.above) + "</b>");
      if (p.below !== "" && p.below != null) c.push("below <b>" + esc(p.below) + "</b>");
      return `${ents} goes ${c.join(" or ")}` +
        (+p.minutes ? ` for <b>${mins(+p.minutes)}</b>` : "");
    }
    case "state":
      return `${ents} becomes <b>${esc(p.state)}</b>` +
        (+p.minutes ? ` for <b>${mins(+p.minutes)}</b>` : "");
  }
  return "";
}

function render() {
  const day = 24 * 3600e3;
  const active = RULES.filter(r => r.enabled).length;
  const fired = RULES.filter(r => r.last_triggered &&
    Date.now() - new Date(r.last_triggered).getTime() < day).length;
  $("#stats").innerHTML = `
    <div class="statbox"><b>${RULES.length}</b><span>alerts</span></div>
    <div class="statbox"><b class="ok">${active}</b><span>active</span></div>
    <div class="statbox"><b class="${RULES.length - active ? "warn" : ""}">
      ${RULES.length - active}</b><span>paused</span></div>
    <div class="statbox"><b class="${fired ? "bad" : ""}">${fired}</b>
      <span>fired last 24 h</span></div>`;

  const q = $("#search").value.trim().toLowerCase();
  const list = RULES.filter(r => !q || r.name.toLowerCase().includes(q) ||
    r.entities.some(e => e.toLowerCase().includes(q) ||
      friendly(e).toLowerCase().includes(q)));

  if (!RULES.length) {
    $("#list").innerHTML = `<div class="empty"><div class="big">🚨</div>
      No alerts yet.<br>Create your first watchdog — e.g. <i>"tell me when a
      door stays open for 10 minutes"</i>.<br><br>
      <button class="btn" onclick="openBuilder()">➕ New alert</button></div>`;
    return;
  }
  if (!list.length) {
    $("#list").innerHTML = `<div class="empty">Nothing matches your search.</div>`;
    return;
  }
  $("#list").innerHTML = list.map(r => {
    const T = TYPES[r.type] || {icon: "🚨", title: r.type};
    const targets = (r.notify || []).map(t => t === "persistent"
      ? "🔔 HA notification" : "📱 " + t.replace("notify.", ""));
    return `<div class="rcard ${r.enabled ? "" : "off"}" data-id="${r.id}">
      <div class="top">
        <div class="ticon">${T.icon}</div>
        <div class="nm"><b>${esc(r.name)}</b>
          <small>${esc(T.title)} · last fired: ${ago(r.last_triggered)}</small></div>
        <button class="tgl ${r.enabled ? "on" : ""}" data-act="toggle"
          title="${r.enabled ? "Pause this alert" : "Enable this alert"}"></button>
      </div>
      <div class="detail">${ruleSummary(r)}</div>
      <div class="badges">${targets.map(t =>
        `<span class="tbadge">${esc(t)}</span>`).join("")}
        ${r.exists ? "" : `<span class="tbadge warnb">⚠ automation missing —
          re-save</span>`}</div>
      <div class="foot">
        <button class="iconbtn" data-act="test" title="Send a test notification">🧪 Test</button>
        <div class="sp"></div>
        <button class="iconbtn" data-act="edit" title="Edit">✏️ Edit</button>
        <button class="iconbtn danger" data-act="del" title="Delete">🗑</button>
      </div></div>`;
  }).join("");
}

function friendly(eid) {
  const e = OPTIONS.entities.find(x => x.id === eid);
  return e ? e.name : eid;
}

/* ------------------------------------------------ card actions */

$("#list").addEventListener("click", async ev => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const card = ev.target.closest(".rcard");
  const rule = RULES.find(r => r.id === card.dataset.id);
  if (!rule) return;
  const act = btn.dataset.act;

  if (act === "toggle") {
    const to = rule.enabled ? "off" : "on";
    const res = await post(`${API}/rules/${rule.id}/action`, {action: to});
    if (res.error) return toast(res.error, true);
    toast(to === "on" ? "Alert enabled ✅" : "Alert paused ⏸");
    reloadRules();
  } else if (act === "test") {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinning">🧪</span> Sending…';
    const res = await post(`${API}/rules/${rule.id}/action`, {action: "test"});
    btn.disabled = false;
    btn.innerHTML = "🧪 Test";
    if (res.error) return toast(res.error, true);
    toast("Test notification sent — check your devices 📱");
  } else if (act === "edit") {
    openBuilder(rule);
  } else if (act === "del") {
    $("#confirmSub").innerHTML = `<b>${esc(rule.name)}</b> and the automation
      behind it will be deleted. This cannot be undone.`;
    $("#confirmErr").style.display = "none";
    openModal("confirmModal");
    $("#confirmYes").onclick = async () => {
      const res = await fetch(`${API}/rules/${rule.id}`,
        {method: "DELETE"}).then(r => r.json());
      if (res.error) {
        const e = $("#confirmErr");
        e.textContent = res.error; e.style.display = "block";
        return;
      }
      closeModals();
      toast("Alert deleted 🗑");
      reloadRules();
    };
  }
});

$("#search").addEventListener("input", render);

/* ------------------------------------------------ builder */

function openBuilder(rule) {
  editing = rule || null;
  selType = rule ? rule.type : null;
  selEnts = new Set(rule ? rule.entities : []);
  selNotify = new Set(rule ? rule.notify : []);
  $("#buildTitle").textContent = rule ? "Edit alert" : "New alert";
  $("#buildIcon").textContent = rule ? (TYPES[rule.type] || {}).icon || "🚨" : "🚨";
  $("#ruleName").value = rule ? rule.name : "";
  $("#cusTitle").value = rule ? rule.title || "" : "";
  $("#cusMsg").value = rule ? rule.message || "" : "";
  $("#advBox").open = !!(rule && (rule.title || rule.message));
  $("#entShowAll").checked = false;
  $("#entSearch").value = "";
  $("#buildErr").style.display = "none";
  $("#previewBox").style.display = "none";
  $("#yamlPre").classList.remove("open");
  renderTypeTiles();
  if (selType) {
    $("#buildForm").style.display = "";
    renderParams(rule ? rule.params : null);
    renderEntList();
    renderNotifyList();
    schedulePreview();
  } else {
    $("#buildForm").style.display = "none";
  }
  openModal("buildModal");
}

function renderTypeTiles() {
  $("#typeTiles").innerHTML = Object.entries(TYPES).map(([k, T]) =>
    `<div class="ttile ${selType === k ? "on" : ""}" data-type="${k}">
      <span class="ti">${T.icon}</span><b>${T.title}</b>
      <small>${T.desc}</small></div>`).join("");
}

$("#typeTiles").addEventListener("click", ev => {
  const tile = ev.target.closest(".ttile");
  if (!tile) return;
  const t = tile.dataset.type;
  if (t === selType) return;
  selType = t;
  selEnts.clear();
  $("#buildIcon").textContent = TYPES[t].icon;
  $("#entShowAll").checked = false;
  $("#entSearch").value = "";
  renderTypeTiles();
  $("#buildForm").style.display = "";
  renderParams(null);
  renderEntList();
  renderNotifyList();
  schedulePreview();
});

/* ---- entity picker ---- */

const OPENABLE_BSDC = new Set(["door", "window", "opening", "garage_door", "lock"]);

function entityMatchesType(e) {
  switch (selType) {
    case "open_too_long":
      if (["cover", "lock", "valve", "switch", "input_boolean"].includes(e.domain))
        return true;
      return e.domain === "binary_sensor" && OPENABLE_BSDC.has(e.device_class);
    case "low_battery":
      return (e.device_class === "battery" && e.domain === "sensor") ||
        (e.unit === "%" && /batt/i.test(e.id + e.name));
    case "numeric":
      return ["sensor", "number", "input_number"].includes(e.domain) &&
        e.state !== "" && !isNaN(parseFloat(e.state));
    case "offline":
    case "state":
    default:
      return true;
  }
}

function renderEntList() {
  $("#entLabel").textContent = TYPES[selType].entLabel;
  const q = $("#entSearch").value.trim().toLowerCase();
  const showAll = $("#entShowAll").checked;
  const skip = new Set(["automation", "persistent_notification", "zone",
                        "scene", "script", "update", "tts", "conversation"]);
  let list = OPTIONS.entities.filter(e =>
    (showAll || entityMatchesType(e)) &&
    (showAll || !skip.has(e.domain)) &&
    (!q || e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)));
  // selected first, then alphabetical; cap the render for huge installs
  list.sort((a, b) => (selEnts.has(b.id) - selEnts.has(a.id)) ||
    a.name.localeCompare(b.name));
  const capped = list.slice(0, 250);
  $("#entCount").textContent = selEnts.size + " selected";
  if (!capped.length) {
    $("#entList").innerHTML = `<div class="picknone">No matching entities.
      ${showAll ? "" : "Tick <b>show all</b> to search every entity."}</div>`;
    return;
  }
  $("#entList").innerHTML = capped.map(e => `
    <label class="pickitem"><input type="checkbox" data-eid="${esc(e.id)}"
      ${selEnts.has(e.id) ? "checked" : ""}>
      <span class="pn">${esc(e.name)}<small>${esc(e.id)}</small></span>
      <span class="st">${esc(e.state)}${esc(e.unit ? " " + e.unit : "")}</span>
    </label>`).join("") +
    (list.length > 250 ? `<div class="picknone">…and ${list.length - 250}
      more — type to narrow down.</div>` : "");
}

$("#entSearch").addEventListener("input", renderEntList);
$("#entShowAll").addEventListener("change", renderEntList);
$("#entList").addEventListener("change", ev => {
  const cb = ev.target.closest("input[data-eid]");
  if (!cb) return;
  if (cb.checked) selEnts.add(cb.dataset.eid);
  else selEnts.delete(cb.dataset.eid);
  $("#entCount").textContent = selEnts.size + " selected";
  suggestName();
  schedulePreview();
});

function suggestName() {
  if ($("#ruleName").value.trim() || !selEnts.size || editing) return;
  const first = friendly([...selEnts][0]);
  const tail = selEnts.size > 1 ? ` (+${selEnts.size - 1})` : "";
  const map = {open_too_long: " left open", low_battery: " battery low",
    offline: " offline", numeric: " value alert", state: " state alert"};
  $("#ruleName").placeholder = first + (map[selType] || "") + tail;
}

/* ---- params ---- */

function renderParams(p) {
  p = p || TYPES[selType].defaults;
  let html = "";
  const num = (id, label, val, tip, extra) => `
    <div><label>${label}
      <button class="qmark" data-tip="${tip}">?</button></label>
      <input type="number" id="${id}" value="${esc(val ?? "")}" ${extra || ""}></div>`;
  if (selType === "open_too_long")
    html = `<div class="paramrow">${num("pMinutes",
      "Alert after (minutes)", p.minutes ?? 10, "minutes", 'min="1"')}</div>`;
  else if (selType === "low_battery")
    html = `<div class="paramrow">${num("pThreshold",
      "Battery below (%)", p.threshold ?? 15, "threshold", 'min="1" max="99"')}</div>`;
  else if (selType === "offline")
    html = `<div class="paramrow">${num("pMinutes",
      "Alert after (minutes)", p.minutes ?? 15, "minutes", 'min="1"')}</div>`;
  else if (selType === "numeric")
    html = `<div class="paramrow">
      ${num("pAbove", "Above (optional)", p.above, "numeric", 'step="any"')}
      ${num("pBelow", "Below (optional)", p.below, "numeric", 'step="any"')}
      ${num("pMinutes", "For at least (minutes, 0 = instantly)",
        p.minutes ?? 0, "minutes", 'min="0"')}</div>`;
  else if (selType === "state")
    html = `<div class="paramrow">
      <div><label>State to watch for
        <button class="qmark" data-tip="state">?</button></label>
        <input type="text" id="pState" value="${esc(p.state ?? "")}"
          placeholder="e.g. on / open / Error"></div>
      ${num("pMinutes", "For at least (minutes, 0 = instantly)",
        p.minutes ?? 0, "minutes", 'min="0"')}</div>`;
  $("#paramBox").innerHTML = html;
  $$("#paramBox input").forEach(i =>
    i.addEventListener("input", schedulePreview));
}

function collectParams() {
  const g = id => { const el = $("#" + id); return el ? el.value : ""; };
  switch (selType) {
    case "open_too_long": return {minutes: +g("pMinutes") || 0};
    case "low_battery": return {threshold: +g("pThreshold") || 0};
    case "offline": return {minutes: +g("pMinutes") || 0};
    case "numeric": return {above: g("pAbove"), below: g("pBelow"),
      minutes: +g("pMinutes") || 0};
    case "state": return {state: g("pState"), minutes: +g("pMinutes") || 0};
  }
  return {};
}

/* ---- notify picker ---- */

function renderNotifyList() {
  const items = [{id: "persistent",
    name: "Notification in Home Assistant (🔔 drawer)", sub: "always available"}]
    .concat(OPTIONS.notify_services.map(s => ({
      id: s, name: s.replace("notify.", ""), sub: s})));
  $("#notifyList").innerHTML = items.map(i => `
    <label class="pickitem"><input type="checkbox" data-nid="${esc(i.id)}"
      ${selNotify.has(i.id) ? "checked" : ""}>
      <span class="pn">${esc(i.name)}<small>${esc(i.sub)}</small></span>
    </label>`).join("") + (OPTIONS.notify_services.length ? "" :
    `<div class="picknone">No notify services found — install the HA
      companion app on a phone, or use the HA notification above.</div>`);
}

$("#notifyList").addEventListener("change", ev => {
  const cb = ev.target.closest("input[data-nid]");
  if (!cb) return;
  if (cb.checked) selNotify.add(cb.dataset.nid);
  else selNotify.delete(cb.dataset.nid);
  schedulePreview();
});

/* ---- preview ---- */

function collectRule() {
  return {
    id: editing ? editing.id : undefined,
    type: selType,
    name: $("#ruleName").value.trim() || $("#ruleName").placeholder || "",
    entities: [...selEnts],
    params: collectParams(),
    notify: [...selNotify],
    title: $("#cusTitle").value.trim(),
    message: $("#cusMsg").value.trim(),
  };
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 350);
}

async function updatePreview() {
  const body = collectRule();
  if (!body.type || !body.entities.length || !body.notify.length) {
    $("#previewBox").style.display = "none";
    return;
  }
  const res = await post(API + "/preview", body);
  if (res.error) { $("#previewBox").style.display = "none"; return; }
  const n = body.entities.length;
  const targets = body.notify.length;
  $("#previewText").innerHTML = `<b>✓ Ready:</b> watching
    <b>${n}</b> ${n === 1 ? "entity" : "entities"} → notifying
    <b>${targets}</b> ${targets === 1 ? "target" : "targets"}.
    The automation below is created and kept up to date for you.`;
  $("#yamlPre").textContent = toYaml(res.config, 0);
  $("#previewBox").style.display = "";
}

function toYaml(v, ind) {
  const pad = "  ".repeat(ind);
  if (Array.isArray(v)) {
    if (!v.length) return pad + "[]";
    return v.map(item => {
      const y = toYaml(item, ind + 1);
      return pad + "- " + y.slice((ind + 1) * 2).trimStart();
    }).join("\n");
  }
  if (v && typeof v === "object") {
    return Object.entries(v).map(([k, val]) => {
      if (val && typeof val === "object" &&
          (Array.isArray(val) ? val.length : Object.keys(val).length))
        return `${pad}${k}:\n${toYaml(val, ind + 1)}`;
      return `${pad}${k}: ${scalar(val)}`;
    }).join("\n");
  }
  return pad + scalar(v);
}

function scalar(v) {
  if (v == null) return "~";
  if (Array.isArray(v)) return "[]";
  if (typeof v === "object") return "{}";
  const s = String(v);
  return /[:#{}\[\]]|^\s|\s$/.test(s) && typeof v === "string"
    ? JSON.stringify(s) : s;
}

$("#yamlToggle").addEventListener("click", () =>
  $("#yamlPre").classList.toggle("open"));
["ruleName", "cusTitle", "cusMsg"].forEach(id =>
  $("#" + id).addEventListener("input", schedulePreview));

/* ---- save ---- */

$("#saveBtn").addEventListener("click", async () => {
  const body = collectRule();
  const err = $("#buildErr");
  err.style.display = "none";
  const fail = m => { err.textContent = m; err.style.display = "block"; };
  if (!body.type) return fail("Pick an alert type first.");
  if (!body.name) return fail("Give the alert a name.");
  if (!body.entities.length) return fail("Pick at least one entity to watch.");
  if (!body.notify.length) return fail("Pick at least one notification target.");
  $("#saveBtn").disabled = true;
  const res = await post(API + "/rules", body);
  $("#saveBtn").disabled = false;
  if (res.error) return fail(res.error);
  closeModals();
  toast(editing ? "Alert updated ✅" : "Alert created ✅ — use 🧪 Test to try it");
  reloadRules();
});

/* ------------------------------------------------ modals / tips / toasts */

function openModal(id) { $("#" + id).classList.add("open"); }
function closeModals() { $$(".modal").forEach(m => m.classList.remove("open")); }
document.addEventListener("click", ev => {
  if (ev.target.matches("[data-close]")) closeModals();
  if (ev.target.classList.contains("modal")) closeModals();
  const q = ev.target.closest(".qmark");
  if (q) {
    const tip = TIPS[q.dataset.tip];
    if (tip) {
      $("#tipTitle").textContent = tip.t;
      $("#tipBody").innerHTML = tip.b;
      openModal("tipModal");
    }
  }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") closeModals();
});

$("#newBtn").addEventListener("click", () => openBuilder());

async function post(url, body) {
  try {
    const r = await fetch(url, {method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)});
    return await r.json();
  } catch (e) {
    return {error: e.message};
  }
}

function toast(msg, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3500);
}

boot();
setInterval(reloadRules, 30000);
