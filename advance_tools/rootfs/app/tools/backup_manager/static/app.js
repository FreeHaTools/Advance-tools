/* Backup Manager — Advance Tools */
(() => {
"use strict";

const API = "/api/tools/backup_manager";
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

let DATA = null;          // last /overview payload
let ADDONS = [];          // [{slug,name,version}]
let FOLDERS = [];         // [{id,name}]
let jobTimer = null;
let wasRunning = false;

/* ---------------------------------------------------------------- tips */

const TIPS = {
  type: ["Full or partial?",
    "A <b>full backup</b> contains everything: Home Assistant, all add-ons " +
    "and all folders. It is the safe choice and the one you want before " +
    "updates.<br><br>A <b>partial backup</b> lets you pick exactly what to " +
    "include — for example only your configuration, which is small and fast. " +
    "Great for a nightly schedule."],
  name: ["Backup name",
    "Anything that helps future-you recognize it, e.g. " +
    "<b>Before update 2026.8</b>. Left empty, today's date is used."],
  ha: ["Home Assistant settings",
    "Your configuration, automations, dashboards, users, history database — " +
    "the heart of your setup. Almost always keep this checked."],
  addons: ["Add-ons",
    "Each selected add-on is backed up <b>with its data</b>. Example: " +
    "backing up a music server add-on includes its library settings."],
  password: ["Backup password",
    "The backup file is encrypted with this password. You will need it to " +
    "restore! <b>If you lose the password the backup is useless</b> — " +
    "write it down somewhere safe."],
  nodb: ["Exclude the database",
    "The history database is often the biggest part of a backup but only " +
    "contains sensor history graphs — not your configuration. Excluding it " +
    "makes backups much smaller, and you lose nothing but old graphs if " +
    "you ever restore."],
  stime: ["Schedule time",
    "Pick a quiet moment — e.g. <b>03:00</b> at night. Making a backup can " +
    "slow the system down for a few minutes."],
  keep: ["Automatic cleanup",
    "Keeps only the newest N backups <b>created by this schedule</b> and " +
    "deletes its older ones. Backups you made by hand are never touched. " +
    "<b>0</b> = never delete anything."],
  days: ["Days",
    "Choose the weekdays the backup should run. Selecting nothing means " +
    "<b>every day</b>. A common choice: every night partial + Sunday full."],
};

$$("#tipModal, #createModal, #schedModal, #confirmModal, #detailModal")
  .forEach(m => m.addEventListener("click", e => {
    if (e.target === m || e.target.closest("[data-close]"))
      m.classList.remove("open");
  }));

document.addEventListener("click", e => {
  const q = e.target.closest(".qmark");
  if (!q) return;
  const tip = TIPS[q.dataset.tip];
  if (!tip) return;
  $("#tipTitle").textContent = tip[0];
  $("#tipBody").innerHTML = tip[1];
  $("#tipModal").classList.add("open");
});

/* ---------------------------------------------------------------- utils */

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.innerHTML = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), bad ? 7000 : 4000);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function fmtSize(mb) {
  if (mb == null) return "?";
  if (mb >= 1024) return (mb / 1024).toFixed(2) + " GB";
  if (mb >= 1) return mb.toFixed(1) + " MB";
  return Math.max(1, Math.round(mb * 1024)) + " KB";
}

function fmtDate(iso) {
  if (!iso) return "?";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined,
    {year:"numeric", month:"short", day:"numeric"}) + " " +
    d.toLocaleTimeString(undefined, {hour:"2-digit", minute:"2-digit"});
}

function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  if (s < 129600) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " days ago";
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function api(path, opts) {
  const r = await fetch(API + path, opts);
  let d = {};
  try { d = await r.json(); } catch (e) { /* streams etc. */ }
  if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
  return d;
}

/* ---------------------------------------------------------------- overview */

async function refresh() {
  try {
    DATA = await api("/overview");
  } catch (e) {
    $("#connStat").innerHTML = '<span class="dot"></span>' + esc(e.message);
    return;
  }
  $("#connStat").innerHTML = DATA.connected
    ? '<span class="dot ok"></span>connected'
    : '<span class="dot"></span>HA disconnected';
  renderStats();
  renderSchedule();
  renderList();
  renderJob();
}

function renderStats() {
  const bks = DATA.backups || [];
  const total = bks.reduce((a, b) => a + (b.size || 0), 0);
  const latest = bks[0];
  const stale = DATA.days_until_stale;
  let latestCls = "ok", latestTxt = latest ? ago(latest.date) : "never";
  if (!latest) latestCls = "bad";
  else {
    const days = (Date.now() - new Date(latest.date).getTime()) / 86400e3;
    if (stale && days > stale) latestCls = "bad";
    else if (days > 7) latestCls = "warn";
  }
  const nxt = DATA.next_run ? fmtDate(DATA.next_run) : "—";
  $("#stats").innerHTML = `
    <div class="statbox"><b>${bks.length}</b><span>backups</span></div>
    <div class="statbox"><b>${fmtSize(total)}</b><span>total size</span></div>
    <div class="statbox"><b class="${latestCls}">${esc(latestTxt)}</b>
      <span>latest backup</span></div>
    <div class="statbox"><b class="${DATA.schedule.enabled ? "acc" : ""}">
      ${DATA.schedule.enabled ? esc(nxt) : "off"}</b><span>next scheduled</span></div>`;
}

function renderSchedule() {
  const s = DATA.schedule;
  $("#schedTgl").classList.toggle("on", !!s.enabled);
  let txt;
  if (!s.enabled) {
    txt = "Off — turn it on and this tool backs your system up automatically.";
  } else {
    const days = (s.weekdays && s.weekdays.length)
      ? s.weekdays.map(d => DAY_NAMES[d]).join(", ") : "every day";
    txt = `<b>${s.type === "full" ? "Full" : "Partial"}</b> backup, ` +
      `<b>${esc(days)}</b> at <b>${esc(s.time)}</b>` +
      (s.keep ? `, keeping the last <b>${s.keep}</b>` : ", keeping everything") +
      (DATA.next_run ? ` — next run ${esc(fmtDate(DATA.next_run))}` : "");
  }
  $("#schedText").innerHTML = txt;
}

function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const auto = new Set(DATA.auto_slugs || []);
  const bks = (DATA.backups || []).filter(b =>
    !q || (b.name || "").toLowerCase().includes(q) ||
    (b.slug || "").includes(q));
  const list = $("#list");
  if (!bks.length) {
    list.innerHTML = `<div class="empty"><div class="big">💾</div>
      ${q ? "No backups match your search." :
      "No backups yet.<br>Make your first one — future-you says thanks."}</div>`;
    return;
  }
  list.innerHTML = bks.map(b => {
    const c = b.content || {};
    const badges = [];
    badges.push(`<span class="tbadge ${b.type === "full" ? "full" : ""}">
      ${b.type === "full" ? "🗄️ Full" : "🧩 Partial"}</span>`);
    if (b.protected) badges.push('<span class="tbadge warnb">🔒 password</span>');
    if (auto.has(b.slug)) badges.push('<span class="tbadge goodb">🗓️ scheduled</span>');
    if (b.type !== "full") {
      if (c.homeassistant) badges.push('<span class="tbadge">HA config</span>');
      if ((c.addons || []).length)
        badges.push(`<span class="tbadge">${c.addons.length} add-on${c.addons.length > 1 ? "s" : ""}</span>`);
      if ((c.folders || []).length)
        badges.push(`<span class="tbadge">${c.folders.length} folder${c.folders.length > 1 ? "s" : ""}</span>`);
    }
    return `<div class="bcard" data-slug="${b.slug}">
      <div class="top">
        <div class="ticon">${b.type === "full" ? "🗄️" : "🧩"}</div>
        <div class="nm"><b title="${esc(b.name)}">${esc(b.name || b.slug)}</b>
          <small>${esc(fmtDate(b.date))} · ${esc(ago(b.date))} · ${fmtSize(b.size)}</small>
        </div>
      </div>
      <div class="badges">${badges.join("")}</div>
      <div class="foot">
        <button class="iconbtn" data-act="info" title="Details">🔎</button>
        <a class="iconbtn" href="${API}/backups/${b.slug}/download"
           title="Download .tar" download>⬇️</a>
        <div class="sp"></div>
        <button class="iconbtn danger" data-act="del" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join("");
}

$("#search").addEventListener("input", () => DATA && renderList());

$("#list").addEventListener("click", e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const slug = btn.closest(".bcard").dataset.slug;
  const b = (DATA.backups || []).find(x => x.slug === slug);
  if (!b) return;
  if (btn.dataset.act === "info") openDetails(b);
  if (btn.dataset.act === "del") confirmDelete(b);
});

/* ---------------------------------------------------------------- job */

function renderJob() {
  const j = DATA && DATA.job;
  const running = !!(j && j.running);
  $("#jobBanner").classList.toggle("open", running);
  if (running) {
    $("#jobText").innerHTML =
      `Creating <b>${esc(j.name)}</b> (${j.type})… this can take several ` +
      "minutes. You can keep using Home Assistant meanwhile.";
    if (!jobTimer) jobTimer = PMPoll.every(4000, pollJob, {el: document.body, name: "job"});
  } else if (jobTimer) {
    jobTimer.stop(); jobTimer = null;
  }
  if (wasRunning && !running && j) {
    if (j.error) toast("Backup failed: " + esc(j.error), true);
    else toast("✅ Backup <b>" + esc(j.name) + "</b> created.");
  }
  wasRunning = running;
}

async function pollJob() {
  try {
    const d = await api("/job");
    if (!d.job.running) refresh();     // re-render everything once done
    else { DATA.job = d.job; renderJob(); }
  } catch (e) {
    throw e;                           // transient for the UI; lets PMPoll back off
  }
}

/* ---------------------------------------------------------------- pickers */

function renderFolderList(el, selected) {
  el.innerHTML = FOLDERS.map(f => `
    <label class="pickitem"><input type="checkbox" value="${f.id}"
      ${selected.includes(f.id) ? "checked" : ""}>
      <span class="pn">${esc(f.name)}<small>${esc(f.id)}</small></span></label>`
  ).join("");
}

function renderAddonList(el, cntEl, searchEl, selected) {
  const q = (searchEl.value || "").trim().toLowerCase();
  const sel = new Set(selected);
  const items = ADDONS.filter(a =>
    !q || a.name.toLowerCase().includes(q) || a.slug.includes(q));
  el.innerHTML = items.length ? items.map(a => `
    <label class="pickitem"><input type="checkbox" value="${esc(a.slug)}"
      ${sel.has(a.slug) ? "checked" : ""}>
      <span class="pn">${esc(a.name)}<small>${esc(a.slug)}</small></span>
      <span class="st">${esc(a.version)}</span></label>`).join("")
    : '<div class="picknone">No add-ons match.</div>';
  cntEl.textContent = selected.length + " selected";
}

function pickedValues(el) {
  return $$("input:checked", el).map(i => i.value);
}

async function loadAddons() {
  if (ADDONS.length) return;
  try {
    const d = await api("/addons");
    ADDONS = d.addons || [];
    FOLDERS = d.folders || [];
  } catch (e) {
    toast("Could not load the add-on list: " + esc(e.message), true);
  }
}

/* ---------------------------------------------------------------- create */

let createType = "full";

$("#newBtn").addEventListener("click", async () => {
  if (DATA && DATA.job && DATA.job.running)
    return toast("A backup is already being created — wait for it to finish.",
                 true);
  await loadAddons();
  createType = "full";
  $$("#typeTiles .ttile").forEach(t =>
    t.classList.toggle("on", t.dataset.type === "full"));
  $("#partialBox").style.display = "none";
  $("#bkName").value = "";
  $("#bkPass").value = "";
  $("#bkNoDb").checked = false;
  $("#pHA").checked = true;
  $("#addonSearch").value = "";
  renderFolderList($("#folderList"), ["homeassistant"]);
  renderAddonList($("#addonList"), $("#addonCount"), $("#addonSearch"), []);
  $("#createErr").style.display = "none";
  $("#createModal").classList.add("open");
});

$("#typeTiles").addEventListener("click", e => {
  const t = e.target.closest(".ttile");
  if (!t) return;
  createType = t.dataset.type;
  $$("#typeTiles .ttile").forEach(x =>
    x.classList.toggle("on", x === t));
  $("#partialBox").style.display = createType === "partial" ? "" : "none";
});

$("#addonSearch").addEventListener("input", () =>
  renderAddonList($("#addonList"), $("#addonCount"), $("#addonSearch"),
                  pickedValues($("#addonList"))));
$("#addonList").addEventListener("change", () =>
  $("#addonCount").textContent =
    pickedValues($("#addonList")).length + " selected");

$("#createGo").addEventListener("click", async () => {
  const body = {
    type: createType,
    name: $("#bkName").value.trim(),
    password: $("#bkPass").value,
    exclude_database: $("#bkNoDb").checked,
  };
  if (createType === "partial") {
    body.homeassistant = $("#pHA").checked;
    body.folders = pickedValues($("#folderList"));
    body.addons = pickedValues($("#addonList"));
  }
  const err = $("#createErr");
  err.style.display = "none";
  $("#createGo").disabled = true;
  try {
    await api("/create", {method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)});
    $("#createModal").classList.remove("open");
    toast("💾 Backup started — it will appear in the list when done.");
    setTimeout(refresh, 800);
  } catch (e) {
    err.textContent = e.message; err.style.display = "block";
  } finally {
    $("#createGo").disabled = false;
  }
});

/* ---------------------------------------------------------------- schedule */

let schedType = "full";

function openSchedule() {
  const s = DATA.schedule;
  schedType = s.type || "full";
  $("#sEnabled").checked = !!s.enabled;
  $("#sTime").value = s.time || "03:00";
  $("#sKeep").value = s.keep ?? 5;
  $("#dayChips").innerHTML = DAY_NAMES.map((n, i) =>
    `<span class="day ${(s.weekdays || []).includes(i) ? "on" : ""}"
       data-d="${i}">${n}</span>`).join("");
  $$("#sTypeTiles .ttile").forEach(t =>
    t.classList.toggle("on", t.dataset.type === schedType));
  $("#sPartialBox").style.display = schedType === "partial" ? "" : "none";
  $("#sHA").checked = s.homeassistant !== false;
  $("#sAddonSearch").value = "";
  renderFolderList($("#sFolderList"), s.folders || []);
  renderAddonList($("#sAddonList"), $("#sAddonCount"), $("#sAddonSearch"),
                  s.addons || []);
  $("#sPrefix").value = s.name_prefix || "";
  $("#sPass").value = "";
  $("#sPass").placeholder = s.has_password
    ? "a password is saved — type to replace it"
    : "leave empty for no password";
  $("#sClearPass").checked = false;
  $("#sNoDb").checked = !!s.exclude_database;
  $("#schedErr").style.display = "none";
  $("#schedModal").classList.add("open");
}

$("#schedBtn").addEventListener("click", async () => {
  await loadAddons(); openSchedule();
});

$("#schedTgl").addEventListener("click", async () => {
  const s = DATA.schedule;
  try {
    const d = await api("/schedule", {method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({...s, enabled: !s.enabled, password: null})});
    toast(!s.enabled
      ? "🗓️ Schedule is on — next run " + esc(fmtDate(d.next_run))
      : "Schedule turned off.");
    refresh();
  } catch (e) { toast(esc(e.message), true); }
});

$("#dayChips").addEventListener("click", e => {
  const d = e.target.closest(".day");
  if (d) d.classList.toggle("on");
});

$("#sTypeTiles").addEventListener("click", e => {
  const t = e.target.closest(".ttile");
  if (!t) return;
  schedType = t.dataset.type;
  $$("#sTypeTiles .ttile").forEach(x => x.classList.toggle("on", x === t));
  $("#sPartialBox").style.display = schedType === "partial" ? "" : "none";
});

$("#sAddonSearch").addEventListener("input", () =>
  renderAddonList($("#sAddonList"), $("#sAddonCount"), $("#sAddonSearch"),
                  pickedValues($("#sAddonList"))));
$("#sAddonList").addEventListener("change", () =>
  $("#sAddonCount").textContent =
    pickedValues($("#sAddonList")).length + " selected");

$("#schedGo").addEventListener("click", async () => {
  const body = {
    enabled: $("#sEnabled").checked,
    time: $("#sTime").value || "03:00",
    weekdays: $$("#dayChips .day.on").map(d => +d.dataset.d),
    type: schedType,
    homeassistant: $("#sHA").checked,
    folders: pickedValues($("#sFolderList")),
    addons: pickedValues($("#sAddonList")),
    keep: +$("#sKeep").value,
    name_prefix: $("#sPrefix").value.trim(),
    exclude_database: $("#sNoDb").checked,
    password: $("#sPass").value ? $("#sPass").value : null,
    clear_password: $("#sClearPass").checked,
  };
  const err = $("#schedErr");
  err.style.display = "none";
  $("#schedGo").disabled = true;
  try {
    const d = await api("/schedule", {method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)});
    $("#schedModal").classList.remove("open");
    toast(body.enabled
      ? "🗓️ Schedule saved — next run " + esc(fmtDate(d.next_run))
      : "Schedule saved (currently off).");
    refresh();
  } catch (e) {
    err.textContent = e.message; err.style.display = "block";
  } finally {
    $("#schedGo").disabled = false;
  }
});

/* ---------------------------------------------------------------- details */

async function openDetails(b) {
  $("#detailTitle").textContent = b.name || b.slug;
  $("#detailSub").textContent = "slug " + b.slug;
  $("#detailBody").innerHTML = "Loading…";
  $("#detailModal").classList.add("open");
  try {
    const d = await api(`/backups/${b.slug}/info`);
    const i = d.info || {};
    const rows = [];
    const row = (k, v) => rows.push(
      `<div class="drow"><span>${k}</span><span>${v}</span></div>`);
    row("Created", esc(fmtDate(i.date)) + " · " + esc(ago(i.date)));
    row("Type", i.type === "full" ? "🗄️ Full" : "🧩 Partial");
    row("Size", fmtSize(i.size));
    row("Password", i.protected ? "🔒 yes — needed to restore" : "no");
    if (i.location) row("Location", esc(i.location));
    if (i.homeassistant)
      row("Home Assistant", "✓ included (core " + esc(i.homeassistant) + ")");
    const addons = (i.addons || []).map(a =>
      `${esc(a.name || a.slug)} <b>${esc(a.version || "")}</b>`).join(", ");
    row("Add-ons", addons || "—");
    const folders = (i.folders || []).map(esc).join(", ");
    row("Folders", folders || "—");
    $("#detailBody").innerHTML = rows.join("");
  } catch (e) {
    $("#detailBody").innerHTML =
      '<span style="color:var(--bad)">' + esc(e.message) + "</span>";
  }
}

/* ---------------------------------------------------------------- delete */

function confirmDelete(b) {
  $("#confirmSub").innerHTML =
    `<b>${esc(b.name || b.slug)}</b> (${fmtSize(b.size)}, ` +
    `${esc(ago(b.date))}) will be removed from the disk. ` +
    "This cannot be undone.";
  $("#confirmErr").style.display = "none";
  const modal = $("#confirmModal");
  modal.classList.add("open");
  $("#confirmYes").onclick = async () => {
    $("#confirmYes").disabled = true;
    try {
      await api(`/backups/${b.slug}`, {method: "DELETE"});
      modal.classList.remove("open");
      toast("🗑️ Backup deleted.");
      refresh();
    } catch (e) {
      const err = $("#confirmErr");
      err.textContent = e.message; err.style.display = "block";
    } finally {
      $("#confirmYes").disabled = false;
    }
  };
}

/* ---------------------------------------------------------------- misc */

$("#refreshBtn").addEventListener("click", async () => {
  try {
    await api("/reload", {method: "POST"});
    await refresh();
    toast("🔄 Backup list reloaded.");
  } catch (e) { toast(esc(e.message), true); }
});

/* Background list refresh. PMPoll already skips it while the tool is hidden,
   backgrounded or the screen is off; we still skip it while a backup job is
   running because the 4 s job poller is driving the UI in that case. */
PMPoll.every(30000, () => {
  if (DATA && DATA.job && DATA.job.running) return;
  return refresh();
}, {el: document.body, name: "list"});

})();
