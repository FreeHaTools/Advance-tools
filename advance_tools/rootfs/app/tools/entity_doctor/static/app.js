/* Entity Doctor — frontend. Talks to /api/tools/entity_doctor/*. */
"use strict";

const API = "/api/tools/entity_doctor";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const CATS = {
  unavailable: { icon: "🔌", label: "Unavailable", cls: "bad",
    desc: "Entities whose integration reports them as unavailable right now." },
  unknown:     { icon: "❓", label: "Unknown", cls: "warn",
    desc: "Entities stuck in the 'unknown' state — often a bad restart or a broken integration." },
  battery:     { icon: "🪫", label: "Low battery", cls: "warn",
    desc: "Battery sensors at or below the threshold, and binary low-battery alerts." },
  orphaned:    { icon: "👻", label: "Orphaned", cls: "bad",
    desc: "Registry leftovers: restored entities, entities whose device was removed, or entries that never load. Safe to remove." },
  stale:       { icon: "🕸️", label: "Stale", cls: "warn",
    desc: "Entities that have not changed state for a long time — possibly dead hardware." },
  duplicate:   { icon: "👯", label: "Duplicate names", cls: "warn",
    desc: "Two or more entities sharing the same friendly name — confusing in pickers and voice assistants. Rename them." },
  disabled:    { icon: "⏻", label: "Disabled", cls: "info",
    desc: "Entities currently disabled in the registry." },
  hidden:      { icon: "🙈", label: "Hidden", cls: "info",
    desc: "Entities hidden from dashboards and pickers." },
  no_area:     { icon: "📍", label: "No area", cls: "info",
    desc: "Device-bound entities whose device is not assigned to any area." },
};
const PROBLEM_CATS = ["unavailable", "orphaned", "battery", "unknown", "stale"];
const REPAIRABLE = {
  duplicate:   "Keeps the healthy entity, renames living twins apart by " +
               "area/device, and clears dead leftovers.",
  orphaned:    "Removes registry leftovers that no integration provides " +
               "anymore. Live entities are never touched.",
  unavailable: "Groups entities by integration and reloads those " +
               "integrations — the most common fix.",
  unknown:     "Groups entities by integration and reloads those " +
               "integrations — the most common fix.",
};
const OPS = {
  rename: { icon: "✏️", label: "rename" },
  hide:   { icon: "🙈", label: "hide" },
  remove: { icon: "🗑", label: "remove" },
  reload: { icon: "🔄", label: "reload" },
  keep:   { icon: "✅", label: "keep" },
};
const ORDER = ["unavailable", "orphaned", "battery", "unknown", "stale",
               "duplicate", "disabled", "hidden", "no_area"];

let DATA = null;
let cat = "problems";           // "problems" | "devices" | one of ORDER
let domain = "", sortBy = "sev";
let selected = new Set();
let confirmAction = null;       // () => Promise
let renameTarget = null;
let deviceTarget = null;        // dead-device shown in the device modal

const settings = {
  battery: parseFloat(localStorage.getItem("ed_battery")) || 20,
  stale: parseFloat(localStorage.getItem("ed_stale")) || 7,
};

/* "Keep" decisions from the triage board, remembered across scans. */
const keepStore = {
  ids: new Set(JSON.parse(localStorage.getItem("ed_keep") || "[]")),
  save() { localStorage.setItem("ed_keep", JSON.stringify([...this.ids])); },
};

/* ---------------------------------------------------------------- utils */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
              "'": "&#39;" }[c]));
}

function toast(msg, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.innerHTML = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3500);
}

async function api(path, opts) {
  const r = await fetch(API + path, opts);
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function openModal(id) { $(id).classList.add("open"); }
function closeModals() { $$(".modal").forEach((m) => m.classList.remove("open")); }
$$("[data-close]").forEach((b) =>
  b.addEventListener("click", closeModals));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => {
  if (e.target === m) closeModals();
}));

function copyEid(eid) {
  (navigator.clipboard ? navigator.clipboard.writeText(eid)
    : Promise.reject()).then(
      () => toast(`Copied <b>${esc(eid)}</b>`),
      () => toast("Could not copy", true));
}

/* ---------------------------------------------------------------- scan */

async function scan(silent) {
  const btn = $("#scanBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinning">🔄</span> Scanning…';
  try {
    DATA = await api(`/scan?battery=${settings.battery}` +
                     `&stale_days=${settings.stale}`);
    if (!DATA.connected) {
      $("#connStat").innerHTML = '<span class="dot"></span>not connected to HA';
      $("#list").innerHTML =
        '<div class="empty">Not connected to Home Assistant.<br>' +
        "The add-on needs the Supervisor connection — check the logs.</div>";
      return;
    }
    selected.clear();
    render();
    if (!silent) toast(`Scan finished — <b>${DATA.problems}</b> problem ` +
                       `entit${DATA.problems === 1 ? "y" : "ies"} found`);
  } catch (e) {
    toast("Scan failed: " + esc(e.message), true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "🔄 Re-scan";
  }
}

/* ---------------------------------------------------------------- render */

function scoreColor(score) {
  return score >= 90 ? "var(--good)" : score >= 70 ? "var(--warn)"
       : "var(--bad)";
}

function renderBanner() {
  $("#banner").style.display = "flex";
  const score = DATA.score;
  const col = scoreColor(score);
  $("#ring").style.background =
    `conic-gradient(${col} ${score * 3.6}deg, var(--line) 0deg)`;
  $("#scoreVal").textContent = score;
  $("#scoreVal").style.color = col;
  const s = DATA.summary;
  $("#bannerTitle").textContent =
    DATA.problems === 0 ? "Everything looks healthy!"
      : `${DATA.problems} entit${DATA.problems === 1 ? "y needs" : "ies need"} attention`;
  $("#bannerSub").innerHTML =
    `Scanned <b>${DATA.total}</b> entities (${DATA.active} active) — ` +
    `<b>${s.dead_device || 0}</b> dead devices, ` +
    `<b>${s.unavailable}</b> unavailable, <b>${s.battery}</b> low battery, ` +
    `<b>${s.orphaned}</b> orphaned, <b>${s.unknown}</b> unknown, ` +
    `<b>${s.stale}</b> stale, <b>${s.duplicate}</b> duplicate-named. ` +
    `New here? Press <b>❓ How it works</b>.`;
  const t = new Date(DATA.generated * 1000);
  $("#connStat").innerHTML =
    `<span class="dot ok"></span>${DATA.total} entities · scanned ` +
    t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderStats() {
  const s = DATA.summary;
  const probs = PROBLEM_CATS.reduce((n, k) => n + s[k], 0);
  const dead = s.dead_device || 0;
  let html = `
    <div class="statbox ${cat === "problems" ? "on" : ""}" data-cat="problems">
      <b class="${probs ? "bad" : "ok"}">${probs}</b><span>⚡ all problems</span>
    </div>
    <div class="statbox ${cat === "devices" ? "on" : ""} ${dead ? "" : "zero"}"
         data-cat="devices" title="Devices whose entities are ALL dead — the
device itself is probably gone. Remove it to clear the clutter.">
      <b class="${dead ? "bad" : "ok"}">${dead}</b><span>💀 dead devices</span>
    </div>`;
  for (const k of ORDER) {
    const c = CATS[k];
    html += `
      <div class="statbox ${cat === k ? "on" : ""} ${s[k] ? "" : "zero"}"
           data-cat="${k}" title="${esc(c.desc)}">
        <b class="${s[k] ? c.cls : "ok"}">${s[k]}</b>
        <span>${c.icon} ${c.label}</span>
      </div>`;
  }
  $("#stats").innerHTML = html;
  $$("#stats .statbox").forEach((b) => b.addEventListener("click", () => {
    cat = b.dataset.cat;
    render();
  }));
}

function renderDomains() {
  const seen = new Set();
  for (const k of ORDER) for (const it of DATA.issues[k]) seen.add(it.domain);
  const cur = domain;
  $("#domainSel").innerHTML = '<option value="">All domains</option>' +
    Array.from(seen).sort().map((d) =>
      `<option value="${d}" ${d === cur ? "selected" : ""}>${d}</option>`)
      .join("");
}

function filterItems(items) {
  const q = $("#search").value.trim().toLowerCase();
  let out = items.filter((it) =>
    (!domain || it.domain === domain) &&
    (!q || it.entity_id.toLowerCase().includes(q) ||
      String(it.name).toLowerCase().includes(q)));
  if (sortBy === "name") {
    out = out.slice().sort((a, b) => String(a.name).localeCompare(b.name));
  } else if (sortBy === "domain") {
    out = out.slice().sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  }
  return out;                    // "sev" keeps server order
}

function cardHtml(it, k) {
  const c = CATS[k];
  const badges = [
    `<span class="tbadge">${esc(it.domain)}</span>`,
    it.platform ? `<span class="tbadge">🧩 ${esc(it.platform)}</span>` : "",
    it.area ? `<span class="tbadge">📍 ${esc(it.area)}</span>` : "",
    it.device ? `<span class="tbadge">🖥 ${esc(it.device)}</span>` : "",
    it.state != null ? `<span class="tbadge">state: ${esc(it.state)}</span>` : "",
    it.hidden && k !== "hidden" ? '<span class="tbadge">hidden</span>' : "",
  ].join("");
  const reg = it.registry;
  const orphan = k === "orphaned";
  const dis = it.disabled, hid = it.hidden;
  const sel = selected.has(it.entity_id) ? "selected" : "";
  return `
  <div class="ecard ${sel}" data-eid="${esc(it.entity_id)}" data-cat="${k}">
    <div class="selbox" data-act="select">${sel ? "✓" : ""}</div>
    <div class="top">
      <div class="ticon">${c.icon}</div>
      <div class="nm">
        <b title="${esc(it.name)}">${esc(it.name)}</b>
        <div class="eid" data-act="copy" title="Click to copy">
          ${esc(it.entity_id)}</div>
      </div>
    </div>
    ${it.detail ? `<div class="detail ${c.cls === "info" ? "" : c.cls}">
      ${c.icon} ${esc(it.detail)}</div>` : ""}
    <div class="badges">${badges}</div>
    <div class="foot">
      <button class="iconbtn" data-act="rename" title="Rename"
        ${reg ? "" : "disabled"}>✏️</button>
      <button class="iconbtn" data-act="usage" title="Where is it used?">🔎</button>
      ${(k === "unavailable" || k === "unknown") && it.config_entry_id
        ? `<button class="iconbtn" data-act="reload"
             title="Reload this integration (${esc(it.platform || "")})">🔄</button>`
        : ""}
      <div class="sp"></div>
      <button class="iconbtn" data-act="${hid ? "unhide" : "hide"}"
        title="${hid ? "Unhide" : "Hide from dashboards"}"
        ${reg ? "" : "disabled"}>${hid ? "👁" : "🙈"}</button>
      <button class="iconbtn" data-act="${dis ? "enable" : "disable"}"
        title="${dis ? "Enable" : "Disable (stops updates)"}"
        ${reg ? "" : "disabled"}>${dis ? "✅" : "⏻"}</button>
      ${orphan || dis ? `<button class="iconbtn danger" data-act="remove"
        title="Remove from the registry">🗑</button>` : ""}
    </div>
  </div>`;
}

function deviceCardHtml(d) {
  const days = d.since_days
    ? `<span class="tbadge">💀 dead for ${d.since_days >= 2
        ? Math.round(d.since_days) + " days" : "≥1 day"}</span>` : "";
  const chips = d.entities.slice(0, 5).map((e) =>
    `<span class="echip" title="${esc(e.state ?? "never loaded")}">
       ${esc(e.entity_id)}</span>`).join("") +
    (d.entities.length > 5
      ? `<span class="echip">+${d.entities.length - 5} more</span>` : "");
  return `
  <div class="dcard" data-did="${esc(d.device_id)}">
    <div class="top">
      <div class="ticon">💀</div>
      <div class="nm">
        <b title="${esc(d.name)}">${esc(d.name)}</b>
        <div class="sub">${esc([d.manufacturer, d.model]
          .filter(Boolean).join(" · ") || "unknown hardware")}</div>
      </div>
    </div>
    <div class="detail bad">💀 ${esc(d.reason)} — the device is probably
      unplugged, broken or gone from your home</div>
    <div class="badges">
      ${d.integration ? `<span class="tbadge">🧩 ${esc(d.integration)}</span>` : ""}
      ${d.area ? `<span class="tbadge">📍 ${esc(d.area)}</span>` : ""}
      <span class="tbadge">${d.entities.length}
        entit${d.entities.length === 1 ? "y" : "ies"}</span>
      ${days}
    </div>
    <div class="echips">${chips}</div>
    <div class="foot">
      <button class="iconbtn" data-dact="details"
        title="Entities &amp; references">🔎 Details</button>
      <div class="sp"></div>
      <button class="iconbtn danger" data-dact="remove"
        title="Remove this device and all its leftovers">🗑 Remove</button>
    </div>
  </div>`;
}

function filterDevices(devs) {
  const q = $("#search").value.trim().toLowerCase();
  return devs.filter((d) => !q ||
    d.name.toLowerCase().includes(q) ||
    (d.integration || "").toLowerCase().includes(q) ||
    d.entities.some((e) => e.entity_id.includes(q)));
}

function render() {
  renderBanner();
  renderStats();
  renderDomains();

  let html = "", shown = 0;

  // Dead devices — shown on the overview and on their own tab.
  if (cat === "problems" || cat === "devices") {
    const devs = filterDevices(DATA.dead_devices || []);
    if (devs.length) {
      shown += devs.length;
      html += `<div class="sect">💀 Dead devices
        <span class="n">${devs.length}</span>
        <button class="ghost repbtn" id="triageFromList"
          title="Open the drag &amp; drop cleanup board">🗂 Triage all</button>
        </div>
        <div class="cards">${devs.map(deviceCardHtml).join("")}</div>`;
    } else if (cat === "devices") {
      html += `<div class="allgood"><div class="big">💪</div>
        <p>No dead devices — every device has at least one living entity.</p>
        </div>`;
      shown += 1;                      // suppress the generic empty message
    }
  }

  const cats = cat === "problems" ? PROBLEM_CATS
             : cat === "devices" ? [] : [cat];
  for (const k of cats) {
    const items = filterItems(DATA.issues[k]);
    if (!items.length) continue;
    shown += items.length;
    const rep = REPAIRABLE[k]
      ? `<button class="ghost repbtn" data-repair="${k}"
           title="${esc(REPAIRABLE[k])}">🔧 Repair</button>` : "";
    html += `<div class="sect">${CATS[k].icon} ${CATS[k].label}
      <span class="n">${items.length}</span>${rep}</div>
      <div class="cards">${items.map((it) => cardHtml(it, k)).join("")}</div>`;
  }
  if (!shown) {
    html = cat === "problems" && !$("#search").value && !domain
      ? `<div class="allgood"><div class="big">🎉</div>
         <p>No problems found — your ${DATA.total} entities are healthy.<br>
         Check the info categories above (disabled, hidden, no area) for
         housekeeping.</p></div>`
      : '<div class="empty">Nothing matches the current filter.</div>';
  }
  $("#list").innerHTML = html;
  $("#bulkCount").textContent = `${selected.size} selected`;
}

/* ---------------------------------------------------------------- actions */

function findItem(eid) {
  for (const k of ORDER)
    for (const it of DATA.issues[k]) if (it.entity_id === eid) return it;
  return null;
}

async function doUpdate(eid, patch, okMsg) {
  try {
    const r = await api("/update", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: eid, ...patch }),
    });
    toast(okMsg + (r.require_restart ? " — <b>HA restart required</b>" : ""));
    await scan(true);
  } catch (e) {
    toast(esc(e.message), true);
  }
}

function askConfirm(title, sub, fn) {
  $("#confirmTitle").textContent = title;
  $("#confirmSub").innerHTML = sub;
  $("#confirmErr").style.display = "none";
  confirmAction = fn;
  openModal("#confirmModal");
}

$("#confirmYes").addEventListener("click", async () => {
  if (!confirmAction) return;
  const btn = $("#confirmYes");
  btn.disabled = true;
  try {
    await confirmAction();
    closeModals();
  } catch (e) {
    const el = $("#confirmErr");
    el.textContent = e.message;
    el.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

function openRename(it) {
  renameTarget = it;
  $("#renameSub").innerHTML = `Current ID: <b>${esc(it.entity_id)}</b>`;
  $("#renameName").value = it.name === it.entity_id ? "" : it.name;
  $("#renameEid").value = it.entity_id;
  $("#renameErr").style.display = "none";
  openModal("#renameModal");
  $("#renameName").focus();
}

$("#renameSave").addEventListener("click", async () => {
  if (!renameTarget) return;
  const body = {
    entity_id: renameTarget.entity_id,
    name: $("#renameName").value,
  };
  const newEid = $("#renameEid").value.trim();
  if (newEid && newEid !== renameTarget.entity_id) body.new_entity_id = newEid;
  try {
    const r = await api("/update", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    closeModals();
    toast(`Renamed <b>${esc(r.entity_id)}</b>` +
          (r.require_restart ? " — <b>HA restart required</b>" : ""));
    await scan(true);
  } catch (e) {
    const el = $("#renameErr");
    el.textContent = e.message;
    el.style.display = "block";
  }
});

async function openUsage(it) {
  $("#usageTitle").textContent = "Where is this used?";
  $("#usageSub").innerHTML = `<b>${esc(it.name)}</b> — ${esc(it.entity_id)}`;
  $("#usageBody").innerHTML = '<div class="empty">Searching…</div>';
  openModal("#usageModal");
  try {
    const r = await api(`/related/${encodeURIComponent(it.entity_id)}`);
    const rel = r.related || {};
    const kinds = Object.keys(rel);
    if (!kinds.length) {
      $("#usageBody").innerHTML = '<div class="relnone">✅ Not referenced by ' +
        "any automation, script, scene or group — safe to hide, disable " +
        "or remove.</div>";
      return;
    }
    let html = '<div class="relwarn">⚠ This entity is still referenced — ' +
      "fix these first if you plan to remove or rename it.</div>";
    const label = { automation: "Automations", script: "Scripts",
                    scene: "Scenes", group: "Groups", entity: "Entities" };
    for (const kind of kinds) {
      html += `<div class="relgroup"><div class="rh">${label[kind] || kind}
        (${rel[kind].length})</div>` +
        rel[kind].map((x) => `<div class="relitem">${esc(x.name)}
          <span class="rid">${esc(x.id)}</span></div>`).join("") + "</div>";
    }
    $("#usageBody").innerHTML = html;
  } catch (e) {
    $("#usageBody").innerHTML =
      `<div class="relwarn">Search failed: ${esc(e.message)}</div>`;
  }
}

$("#list").addEventListener("click", (e) => {
  if (e.target.closest("#triageFromList")) { openTriage(); return; }
  const dbtn = e.target.closest("[data-dact]");
  if (dbtn) {
    const did = e.target.closest(".dcard").dataset.did;
    const dev = (DATA.dead_devices || []).find((d) => d.device_id === did);
    if (!dev) return;
    if (dbtn.dataset.dact === "details") openDevice(dev);
    else if (dbtn.dataset.dact === "remove") confirmDeviceRemove(dev);
    return;
  }
  const rep = e.target.closest("[data-repair]");
  if (rep) { openRepair(rep.dataset.repair); return; }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const card = e.target.closest(".ecard");
  const eid = card.dataset.eid;
  const it = findItem(eid);
  if (!it) return;
  const act = btn.dataset.act;

  if (act === "select") {
    if (selected.has(eid)) selected.delete(eid); else selected.add(eid);
    card.classList.toggle("selected", selected.has(eid));
    card.querySelector(".selbox").textContent = selected.has(eid) ? "✓" : "";
    $("#bulkCount").textContent = `${selected.size} selected`;
  } else if (act === "copy") {
    copyEid(eid);
  } else if (act === "rename") {
    openRename(it);
  } else if (act === "usage") {
    openUsage(it);
  } else if (act === "reload") {
    (async () => {
      try {
        await api("/repair/apply", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: [{ op: "reload",
            entry_id: it.config_entry_id }] }),
        });
        toast(`Reloading <b>${esc(it.platform || "integration")}</b> — ` +
              "re-scan in a few seconds");
      } catch (err) {
        toast(esc(err.message), true);
      }
    })();
  } else if (act === "hide") {
    doUpdate(eid, { hidden: true }, `Hidden <b>${esc(eid)}</b>`);
  } else if (act === "unhide") {
    doUpdate(eid, { hidden: false }, `Unhidden <b>${esc(eid)}</b>`);
  } else if (act === "enable") {
    doUpdate(eid, { disabled: false }, `Enabled <b>${esc(eid)}</b>`);
  } else if (act === "disable") {
    askConfirm("Disable entity?",
      `<b>${esc(it.name)}</b> (${esc(eid)}) will stop updating and disappear ` +
      "from dashboards until you enable it again.",
      async () => {
        await api("/update", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity_id: eid, disabled: true }),
        });
        toast(`Disabled <b>${esc(eid)}</b>`);
        await scan(true);
      });
  } else if (act === "remove") {
    askConfirm("Remove from registry?",
      `<b>${esc(it.name)}</b> (${esc(eid)}) will be deleted from the entity ` +
      "registry. If its integration ever provides it again it will come " +
      "back as a fresh entity. This cannot be undone.",
      async () => {
        await api("/remove", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity_id: eid }),
        });
        toast(`Removed <b>${esc(eid)}</b>`);
        await scan(true);
      });
  }
});

/* ---------------------------------------------------------------- repair */

let repairPlan = [];        // actions from the server, in row order

function repairRow(a, i) {
  const op = OPS[a.op] || OPS.keep;
  const isKeep = a.op === "keep";
  const title = a.op === "rename"
    ? `${esc(a.name)} <span class="arrow">→</span> ${esc(a.new_name)}`
    : a.op === "reload"
      ? `${esc(a.name)} <span class="arrow">(${a.entities.length}
         entit${a.entities.length === 1 ? "y" : "ies"})</span>`
      : esc(a.name || a.entity_id);
  const sub = a.op === "reload"
    ? esc(a.entities.slice(0, 4).join(", ")) +
      (a.entities.length > 4 ? ` +${a.entities.length - 4} more` : "")
    : esc(a.entity_id || "");
  return `
  <div class="repitem ${isKeep ? "off" : ""}">
    <input type="checkbox" data-idx="${i}" ${a.checked ? "checked" : ""}
      ${isKeep ? "disabled" : ""}>
    <span class="ropic">${op.icon}</span>
    <div class="rmain">
      <div class="rtitle">${title}</div>
      ${sub ? `<div class="rid">${sub}</div>` : ""}
      <div class="rwhy">${esc(a.reason)}</div>
    </div>
    <span class="ropbadge ${a.op}">${op.label}</span>
  </div>`;
}

function refreshRepairCount() {
  const n = $$("#repairList input[type=checkbox]:checked:not(:disabled)").length;
  const btn = $("#repairApply");
  btn.textContent = `Apply ${n} action${n === 1 ? "" : "s"}`;
  btn.disabled = !n;
}

async function openRepair(cat) {
  $("#repairTitle").textContent = `Repair: ${CATS[cat].label}`;
  $("#repairSub").textContent = REPAIRABLE[cat] || "";
  $("#repairList").innerHTML = '<div class="empty">Building a safe plan…</div>';
  $("#repairErr").style.display = "none";
  $("#repairApply").disabled = true;
  repairPlan = [];
  openModal("#repairModal");
  try {
    const r = await api(`/repair/plan?category=${cat}` +
      `&battery=${settings.battery}&stale_days=${settings.stale}`);
    repairPlan = r.actions || [];
    if (!repairPlan.length) {
      $("#repairList").innerHTML =
        '<div class="empty">Nothing to repair here 🎉</div>';
      return;
    }
    $("#repairList").innerHTML = repairPlan.map(repairRow).join("");
    refreshRepairCount();
  } catch (e) {
    $("#repairList").innerHTML =
      `<div class="empty">Could not build a plan: ${esc(e.message)}</div>`;
  }
}

$("#repairList").addEventListener("change", refreshRepairCount);
$("#repairAll").addEventListener("click", () => {
  $$("#repairList input[type=checkbox]:not(:disabled)")
    .forEach((c) => { c.checked = true; });
  refreshRepairCount();
});
$("#repairNone").addEventListener("click", () => {
  $$("#repairList input[type=checkbox]")
    .forEach((c) => { c.checked = false; });
  refreshRepairCount();
});

$("#repairApply").addEventListener("click", async () => {
  const picked = $$("#repairList input[type=checkbox]:checked:not(:disabled)")
    .map((c) => repairPlan[+c.dataset.idx])
    .filter((a) => a && a.op !== "keep");
  if (!picked.length) return;
  const btn = $("#repairApply");
  btn.disabled = true;
  btn.textContent = "Applying…";
  try {
    // The server accepts at most 200 actions per call — send in chunks.
    const r = { done: [], errors: [] };
    for (let i = 0; i < picked.length; i += 200) {
      btn.textContent = `Applying… ${Math.min(i + 200, picked.length)}` +
                        `/${picked.length}`;
      const part = await api("/repair/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: picked.slice(i, i + 200) }),
      });
      r.done.push(...part.done);
      r.errors.push(...part.errors);
    }
    closeModals();
    const failed = r.errors.length;
    toast(`Repair done: <b>${r.done.length}</b> action` +
          `${r.done.length === 1 ? "" : "s"} applied` +
          (failed ? `, <b>${failed}</b> failed` : ""), !!failed);
    if (picked.some((a) => a.op === "reload")) {
      toast("Integrations are reloading — re-scan in a few seconds to see " +
            "what came back.");
    }
    await scan(true);
  } catch (e) {
    const el = $("#repairErr");
    el.textContent = e.message;
    el.style.display = "block";
    refreshRepairCount();
  }
});

/* ---------------------------------------------------------------- devices */

function deviceRow(e) {
  const dead = e.state == null || e.state === "unavailable" ||
               e.state === "unknown";
  return `
  <div class="repitem">
    <span class="ropic">${e.disabled ? "⏻" : dead ? "💀" : "🟢"}</span>
    <div class="rmain">
      <div class="rtitle">${esc(e.name)}</div>
      <div class="rid">${esc(e.entity_id)}</div>
    </div>
    <span class="ropbadge ${dead ? "remove" : "keep"}">
      ${esc(e.disabled ? "disabled" : e.state ?? "never loaded")}</span>
  </div>`;
}

function openDevice(dev) {
  deviceTarget = dev;
  $("#deviceTitle").textContent = dev.name;
  $("#deviceSub").innerHTML =
    `${esc([dev.manufacturer, dev.model].filter(Boolean).join(" · ") ||
      "unknown hardware")}` +
    (dev.integration ? ` — integration: <b>${esc(dev.integration)}</b>` : "") +
    (dev.area ? ` — area: <b>${esc(dev.area)}</b>` : "") +
    `<br>${esc(dev.reason)}` +
    (dev.since_days ? ` — dead for ~${Math.round(dev.since_days)} day` +
      (Math.round(dev.since_days) === 1 ? "" : "s") : "");
  $("#deviceBody").innerHTML = dev.entities.length
    ? dev.entities.map(deviceRow).join("")
    : '<div class="empty">This device has no entities at all.</div>';
  $("#deviceErr").style.display = "none";
  openModal("#deviceModal");
}

$("#deviceRefs").addEventListener("click", async () => {
  if (!deviceTarget) return;
  const btn = $("#deviceRefs");
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    const refs = {};
    for (const e of deviceTarget.entities.slice(0, 25)) {
      const r = await api(`/related/${encodeURIComponent(e.entity_id)}`);
      for (const [kind, list] of Object.entries(r.related || {})) {
        if (kind === "entity") continue;
        for (const x of list) refs[`${kind}: ${x.name}`] = true;
      }
    }
    const names = Object.keys(refs);
    $("#deviceBody").insertAdjacentHTML("afterbegin", names.length
      ? `<div class="relwarn">⚠ Referenced by: ${esc(names.join(", "))} —
         these will have missing entities after removal. Fix them first.</div>`
      : `<div class="relnone">✅ No automation, script or scene references any
         entity of this device — removing it breaks nothing.</div>`);
  } catch (e) {
    toast(esc(e.message), true);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔎 Check references";
  }
});

async function removeDevices(devs) {
  const r = await api("/devices/remove", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_ids: devs.map((d) => d.device_id) }),
  });
  const bad = (r.results || []).filter((x) => !x.ok);
  const good = (r.results || []).length - bad.length;
  if (good) toast(`Removed <b>${good}</b> device${good === 1 ? "" : "s"} 🎉`);
  for (const b of bad) {
    toast(`<b>${esc(b.name || b.device_id)}</b>: ` +
          esc((b.errors && b.errors[0]) || b.error || "failed"), true);
  }
  return r;
}

function confirmDeviceRemove(dev) {
  askConfirm("Remove dead device?",
    `<b>${esc(dev.name)}</b> and its ${dev.entities.length}
     entit${dev.entities.length === 1 ? "y" : "ies"} will be removed from
     Home Assistant. ${esc(dev.reason)}. This cannot be undone — but it is
     written to the 📜 Log.`,
    async () => {
      await removeDevices([dev]);
      closeModals();
      await scan(true);
    });
}

$("#deviceRemove").addEventListener("click", () => {
  if (deviceTarget) confirmDeviceRemove(deviceTarget);
});

/* ---------------------------------------------------------------- triage */

/* Board items: dead devices + cleanup-relevant problem entities.
   Entities that belong to a dead device are folded into the device card. */

let triageItems = [];            // {id, kind, icon, name, sub, why, ref, col}

function triageCandidates() {
  const items = [];
  const deadEids = new Set();
  for (const d of DATA.dead_devices || []) {
    for (const e of d.entities) deadEids.add(e.entity_id);
    items.push({
      id: "dev:" + d.device_id, kind: "device", icon: "💀",
      name: d.name,
      sub: `${d.entities.length} entit${d.entities.length === 1 ? "y" : "ies"}`
           + (d.integration ? ` · ${d.integration}` : ""),
      why: d.reason + (d.since_days
        ? ` · ~${Math.round(d.since_days)}d` : ""),
      ref: d,
    });
  }
  for (const k of ["orphaned", "unavailable", "unknown", "stale"]) {
    for (const it of DATA.issues[k]) {
      if (deadEids.has(it.entity_id)) continue;
      items.push({
        id: "ent:" + it.entity_id, kind: k,
        icon: CATS[k].icon, name: it.name, sub: it.entity_id,
        why: it.detail || CATS[k].label, ref: it,
      });
    }
  }
  for (const it of items) {
    it.col = keepStore.ids.has(it.id) ? "keep" : "inbox";
  }
  return items;
}

function triageCardHtml(it) {
  return `
  <div class="tcard" draggable="true" data-tid="${esc(it.id)}">
    <span class="tic">${it.icon}</span>
    <div class="tmain">
      <div class="tname" title="${esc(it.name)}">${esc(it.name)}</div>
      <div class="tsub">${esc(it.sub)}</div>
      <div class="twhy">${esc(it.why)}</div>
    </div>
    <div class="tbtns">
      ${it.col !== "keep" ? `<button data-move="keep" title="Keep">✅</button>` : ""}
      ${it.col !== "kill" ? `<button data-move="kill" title="Clean up">🗑</button>` : ""}
      ${it.col !== "inbox" ? `<button data-move="inbox" title="Back to review">↩</button>` : ""}
    </div>
  </div>`;
}

function renderTriage() {
  const q = $("#triageSearch").value.trim().toLowerCase();
  const match = (it) => !q || it.name.toLowerCase().includes(q) ||
                        it.sub.toLowerCase().includes(q);
  const cols = { inbox: [], keep: [], kill: [] };
  for (const it of triageItems) if (match(it)) cols[it.col].push(it);
  const empt = {
    inbox: "Nothing to review — enjoy the silence 🎉",
    keep: "Drop cards here to remember them as fine.",
    kill: "Drop cards here to queue them for cleanup.",
  };
  for (const [col, list] of Object.entries(cols)) {
    const el = $("#col" + col[0].toUpperCase() + col.slice(1));
    el.innerHTML = list.length ? list.map(triageCardHtml).join("")
      : `<div class="tempty">${empt[col]}</div>`;
  }
  $("#nInbox").textContent = triageItems.filter((i) => i.col === "inbox").length;
  $("#nKeep").textContent = triageItems.filter((i) => i.col === "keep").length;
  const kills = triageItems.filter((i) => i.col === "kill").length;
  $("#nKill").textContent = kills;
  const btn = $("#triageApply");
  btn.disabled = !kills;
  btn.textContent = `Apply cleanup (${kills})`;
}

function moveTriage(tid, col) {
  const it = triageItems.find((i) => i.id === tid);
  if (!it || it.col === col) return;
  it.col = col;
  if (col === "keep") keepStore.ids.add(tid);
  else keepStore.ids.delete(tid);
  keepStore.save();
  renderTriage();
}

function openTriage() {
  if (!DATA) return;
  triageItems = triageCandidates();
  $("#triageSearch").value = "";
  renderTriage();
  $("#triage").classList.add("open");
}

$("#triageBtn").addEventListener("click", openTriage);
$("#triageClose").addEventListener("click", () =>
  $("#triage").classList.remove("open"));
$("#triageSearch").addEventListener("input", renderTriage);
$("#triageReset").addEventListener("click", () => {
  for (const it of triageItems) {
    it.col = "inbox";
    keepStore.ids.delete(it.id);
  }
  keepStore.save();
  renderTriage();
});

/* click-to-move buttons (also the touch fallback) */
$$(".tcol .tbody").forEach((body) => body.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-move]");
  if (!btn) return;
  moveTriage(e.target.closest(".tcard").dataset.tid, btn.dataset.move);
}));

/* HTML5 drag & drop */
let dragTid = null;
document.addEventListener("dragstart", (e) => {
  const card = e.target.closest && e.target.closest(".tcard");
  if (!card) return;
  dragTid = card.dataset.tid;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", dragTid); } catch (_) {}
});
document.addEventListener("dragend", (e) => {
  const card = e.target.closest && e.target.closest(".tcard");
  if (card) card.classList.remove("dragging");
  $$(".tcol").forEach((c) => c.classList.remove("dragover"));
});
$$(".tcol").forEach((col) => {
  col.addEventListener("dragover", (e) => {
    if (!dragTid) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    col.classList.add("dragover");
  });
  col.addEventListener("dragleave", () => col.classList.remove("dragover"));
  col.addEventListener("drop", (e) => {
    e.preventDefault();
    col.classList.remove("dragover");
    if (dragTid) moveTriage(dragTid, col.dataset.col);
    dragTid = null;
  });
});

/* ---- apply: review first, then run ---- */

function cleanupPlan() {
  const kills = triageItems.filter((i) => i.col === "kill");
  const plan = { devices: [], remove: [], disable: [], rows: [] };
  for (const it of kills) {
    if (it.kind === "device") {
      plan.devices.push(it.ref);
      plan.rows.push({ icon: "💀", op: "remove", name: it.name,
        sub: it.sub, why: "device + all its registry entities are deleted" });
    } else if (it.kind === "orphaned") {
      plan.remove.push(it.ref.entity_id);
      plan.rows.push({ icon: "👻", op: "remove", name: it.name,
        sub: it.ref.entity_id, why: "orphaned registry entry — deleted" });
    } else {
      plan.disable.push(it.ref.entity_id);
      plan.rows.push({ icon: it.icon, op: "hide", name: it.name,
        sub: it.ref.entity_id,
        why: "still provided by its integration — disabled only (reversible)" });
    }
  }
  return plan;
}

$("#triageApply").addEventListener("click", () => {
  const plan = cleanupPlan();
  if (!plan.rows.length) return;
  $("#reviewList").innerHTML = plan.rows.map((r) => `
    <div class="repitem">
      <span class="ropic">${r.icon}</span>
      <div class="rmain">
        <div class="rtitle">${esc(r.name)}</div>
        <div class="rid">${esc(r.sub)}</div>
        <div class="rwhy">${esc(r.why)}</div>
      </div>
      <span class="ropbadge ${r.op}">${r.op === "remove" ? "delete" : "disable"}</span>
    </div>`).join("");
  $("#reviewErr").style.display = "none";
  openModal("#reviewModal");
});

$("#reviewGo").addEventListener("click", async () => {
  const plan = cleanupPlan();
  const btn = $("#reviewGo");
  btn.disabled = true;
  btn.textContent = "Cleaning…";
  try {
    if (plan.devices.length) await removeDevices(plan.devices);
    for (const [action, ids] of [["remove", plan.remove],
                                 ["disable", plan.disable]]) {
      for (let i = 0; i < ids.length; i += 400) {
        const r = await api("/bulk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, entity_ids: ids.slice(i, i + 400) }),
        });
        if (r.errors.length) {
          toast(`${action}: <b>${r.errors.length}</b> skipped/failed`, true);
        }
      }
    }
    for (const it of triageItems) {
      if (it.col === "kill") keepStore.ids.delete(it.id);
    }
    keepStore.save();
    closeModals();
    $("#triage").classList.remove("open");
    toast("Cleanup finished — re-scanning…");
    await scan(true);
  } catch (e) {
    const el = $("#reviewErr");
    el.textContent = e.message;
    el.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Yes, clean up";
  }
});

/* ---------------------------------------------------------------- log */

$("#trashBtn").addEventListener("click", async () => {
  $("#trashBody").innerHTML = '<div class="empty">Loading…</div>';
  openModal("#trashModal");
  try {
    const r = await api("/trash");
    const items = r.items || [];
    if (!items.length) {
      $("#trashBody").innerHTML =
        '<div class="empty">Nothing was ever deleted by this tool. 🕊</div>';
      return;
    }
    $("#trashBody").innerHTML = items.map((t) => {
      const when = new Date(t.ts * 1000).toLocaleString([], {
        year: "2-digit", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit" });
      const failed = t.kind === "device" && t.gone === false;
      const sub = t.kind === "device"
        ? `device ${esc(t.device_id || "")}` +
          (t.entities && t.entities.length
            ? ` · ${t.entities.length} entities` : "")
        : esc(t.entity_id || "");
      return `
      <div class="trashitem ${failed ? "failed" : ""}">
        <span class="tic">${t.kind === "device" ? "💀" : "👻"}</span>
        <div class="tmain">
          <div>${esc(t.name || "")} ${failed
            ? '<b style="color:var(--bad)">(removal failed)</b>' : ""}</div>
          <div class="tid">${sub}</div>
        </div>
        <span class="twhen">${when}</span>
      </div>`;
    }).join("");
  } catch (e) {
    $("#trashBody").innerHTML =
      `<div class="empty">Could not load the log: ${esc(e.message)}</div>`;
  }
});

/* ---------------------------------------------------------------- help */

$("#helpBtn").addEventListener("click", () => openModal("#helpModal"));

/* ---------------------------------------------------------------- bulk */

$("#bulkToggle").addEventListener("click", () => {
  document.body.classList.toggle("bulk");
  $("#bulkToggle").classList.toggle("on");
  if (!document.body.classList.contains("bulk")) {
    selected.clear();
    render();
  }
});

$("#bulkAll").addEventListener("click", () => {
  $$("#list .ecard").forEach((c) => selected.add(c.dataset.eid));
  render();
});
$("#bulkNone").addEventListener("click", () => { selected.clear(); render(); });

$$("#bulkbar [data-bulk]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const action = btn.dataset.bulk;
    if (!selected.size) { toast("Nothing selected", true); return; }
    const run = async () => {
      const r = await api("/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, entity_ids: [...selected] }),
      });
      const failed = r.errors.length;
      toast(`Bulk ${action}: <b>${r.done.length}</b> done` +
            (failed ? `, <b>${failed}</b> skipped/failed` : ""), !!failed);
      selected.clear();
      await scan(true);
    };
    if (action === "remove" || action === "disable") {
      askConfirm(`Bulk ${action}?`,
        `Apply <b>${action}</b> to <b>${selected.size}</b> selected ` +
        "entities?" + (action === "remove"
          ? " Only orphaned entities are removed — live ones are skipped."
          : ""), run);
    } else {
      run().catch((e) => toast(esc(e.message), true));
    }
  }));

/* ---------------------------------------------------------------- settings */

$("#settingsBtn").addEventListener("click", () => {
  $("#setBattery").value = settings.battery;
  $("#setStale").value = settings.stale;
  openModal("#settingsModal");
});

$("#settingsSave").addEventListener("click", () => {
  settings.battery = Math.min(99, Math.max(1,
    parseFloat($("#setBattery").value) || 20));
  settings.stale = Math.min(365, Math.max(1,
    parseFloat($("#setStale").value) || 7));
  localStorage.setItem("ed_battery", settings.battery);
  localStorage.setItem("ed_stale", settings.stale);
  closeModals();
  scan();
});

/* ---------------------------------------------------------------- wiring */

$("#scanBtn").addEventListener("click", () => scan());
$("#search").addEventListener("input", () => render());
$("#domainSel").addEventListener("change", (e) => {
  domain = e.target.value;
  render();
});
$("#sort").addEventListener("change", (e) => {
  sortBy = e.target.value;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key === "Escape") {
    if ($$(".modal.open").length) closeModals();
    else $("#triage").classList.remove("open");
  }
});

scan(true);
