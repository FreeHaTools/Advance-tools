/* System Center — frontend. Talks to /api/tools/system_center/*. */
"use strict";

const API = "/api/tools/system_center";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let OVERVIEW = null;
let INSPECT = null;        // last /import/inspect result
let IMPORT_MODE = "merge";

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
  setTimeout(() => el.remove(), bad ? 7000 : 3500);
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function fmtStamp(id) {
  // Restore-point ids look like 20260720-113000 (with an optional -N suffix).
  const m = String(id).match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/);
  if (!m) return String(id);
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

async function api(path, opts) {
  const r = await fetch(API + path, opts);
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

const postJSON = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function openModal(id) { $(id).classList.add("open"); }
function closeModals() { $$(".modal").forEach((m) => m.classList.remove("open")); }
$$("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => {
  if (e.target === m) closeModals();
}));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModals();
});

$("#helpBtn").addEventListener("click", () => openModal("#helpModal"));

/* ----------------------------------------------------------------- tabs */

const VIEWS = {
  bundle: "#viewBundle", export: "#viewExport",
  import: "#viewImport", rollback: "#viewRollback",
};

function showTab(name) {
  $$("nav.tabs button").forEach((b) =>
    b.classList.toggle("on", b.dataset.tab === name));
  Object.entries(VIEWS).forEach(([k, sel]) =>
    $(sel).classList.toggle("on", k === name));
  window.scrollTo(0, 0);
  if (name === "rollback") loadRollbacks();
  if (name === "export") refreshExportSize();
}

$$("nav.tabs button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ------------------------------------------------------------- overview */

async function loadOverview() {
  try {
    OVERVIEW = await api("/overview");
  } catch (e) {
    toast("Could not read the system overview: " + esc(e.message), true);
    return;
  }
  const o = OVERVIEW;
  $("#bundleStats").innerHTML = [
    ["Add-on", esc(o.app_version)],
    ["HA Core", esc(o.ha_version || "—")],
    ["Connected", o.connected ? "yes" : "NO"],
    ["Entities", o.entities],
    ["Dashboards", o.dashboards],
    ["Tools", o.tools],
  ].map(([k, v]) =>
    `<div class="stat"><b>${v}</b><small>${k}</small></div>`).join("");
  $("#importHint").innerHTML =
    `You are signed in as <b>${esc(o.me || "?")}</b>. This account is ` +
    "protected: an import can never delete it, demote it or change its " +
    "password.";
}

/* -------------------------------------------------------- support bundle */

async function loadBundlePreview() {
  const box = $("#bundleFiles");
  box.innerHTML =
    '<div class="empty"><span class="spinning">⏳</span> Building a preview…</div>';
  $("#bundleDownload").disabled = true;
  $("#bundleWarn").innerHTML = "";
  $("#bundleProblemsPanel").style.display = "none";

  let d;
  try {
    d = await api("/bundle/preview");
  } catch (e) {
    box.innerHTML = `<div class="badbox">Could not build the preview: ${
      esc(e.message)}</div>`;
    return;
  }

  box.innerHTML = (d.files || []).map((f) =>
    `<div class="row"><div class="nm"><b>${esc(f.name)}</b>
       <small>${esc(describeMember(f.name))}</small></div>
     <span class="sz">${fmtBytes(f.bytes)}</span></div>`).join("");

  const keys = (d.redacted_keys || []).slice(0, 40);
  $("#bundleWarn").innerHTML =
    `<div class="okbox"><b>${d.redactions} value(s) redacted</b> before this
       archive was written — they are replaced with
       <code>&lt;redacted&gt;</code> and cannot be recovered from the file.
       ${keys.length ? "Fields removed: " + keys.map(
          (k) => `<code>${esc(k)}</code>`).join(", ") : ""}
       ${(d.redacted_keys || []).length > keys.length ? " …" : ""}</div>` +
    (d.log_included ? "" :
      `<div class="warnbox">The add-on log could not be collected${
        d.log_error ? " (" + esc(d.log_error) + ")" : ""}. The bundle says so
        in <code>report.md</code>; you can paste the log from
        <b>Settings → Add-ons → Advance Tools → Log</b> instead.</div>`);

  if ((d.problems || []).length) {
    $("#bundleProblemsPanel").style.display = "";
    $("#bundleProblems").innerHTML =
      `<div class="warnbox"><ul>${d.problems.map(
        (p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
  }

  $("#bundleSize").innerHTML =
    `<b>${(d.files || []).length}</b> file(s) · ${fmtBytes(d.zip_bytes)} zipped`;
  $("#bundleDownload").disabled = false;
}

function describeMember(name) {
  if (name === "report.md") return "Human-readable summary — start here";
  if (name === "panel.json") return "Core store (users, dashboards, settings), redacted";
  if (name === "dashboards.json") return "Dashboard outline only — no designs";
  if (name === "environment.json") return "Versions and Supervisor/OS details, redacted";
  if (name === "logs/addon.log") return "Recent add-on log, redacted";
  if (name.startsWith("config/")) return "Tool configuration, redacted";
  return "";
}

$("#bundleRefresh").addEventListener("click", loadBundlePreview);
$("#bundleDownload").addEventListener("click", () => {
  toast("Building the bundle — your download will start in a moment…");
  window.location.href = API + "/bundle";
});

/* -------------------------------------------------------------- export */

function exportParts() {
  const parts = [];
  if ($("#exDash").checked) parts.push("dashboards");
  if ($("#exTools").checked) parts.push("tools");
  if ($("#exUsers").checked) parts.push("users");
  return parts;
}

function exportQuery() {
  const parts = exportParts();
  let q = "?include=" + encodeURIComponent(parts.join(","));
  if ($("#exCreds").checked) q += "&credentials=1";
  return q;
}

let exportTimer = null;

async function refreshExportSize() {
  const parts = exportParts();
  $("#exportBtn").disabled = parts.length === 0;
  if (!parts.length) {
    $("#exportSize").textContent = "Tick at least one thing to export.";
    $("#exportFiles").innerHTML = "";
    return;
  }
  $("#exportSize").innerHTML =
    '<span class="spinning">⏳</span> Estimating…';
  let d;
  try {
    d = await api("/export/preview" + exportQuery());
  } catch (e) {
    $("#exportSize").textContent = "Could not estimate: " + e.message;
    return;
  }
  const c = d.counts || {};
  const bits = [];
  if (parts.includes("dashboards"))
    bits.push(`${c.dashboards} dashboard(s), ${c.dashboard_files} file(s)`);
  if (parts.includes("tools")) bits.push(`${c.tools} setting file(s)`);
  if (parts.includes("users")) bits.push(`${c.users} account(s)`);
  $("#exportSize").innerHTML =
    `${esc(bits.join(" · "))} — about <b>${fmtBytes(d.zip_bytes)}</b>` +
    ($("#exCreds").checked
      ? ' · <span class="pill warn">contains password hashes</span>' : "");
  $("#exportFiles").innerHTML = (d.files || []).length
    ? `<div class="note">Archive contents: ${(d.files || []).map(
        (f) => `<code>${esc(f.name)}</code>`).join(", ")}</div>`
    : "";
}

function scheduleExportRefresh() {
  clearTimeout(exportTimer);
  exportTimer = setTimeout(refreshExportSize, 150);
}

["#exDash", "#exTools", "#exUsers", "#exCreds"].forEach((sel) =>
  $(sel).addEventListener("change", scheduleExportRefresh));

$("#exportBtn").addEventListener("click", () => {
  if (!exportParts().length) return;
  toast("Building your export…");
  window.location.href = API + "/export" + exportQuery();
});

/* -------------------------------------------------------------- import */

const drop = $("#drop");
const fileInput = $("#fileInput");

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("hot");
});
drop.addEventListener("dragleave", () => drop.classList.remove("hot"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("hot");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) inspectFile(f);
});
fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) inspectFile(f);
  fileInput.value = "";
});

async function inspectFile(file) {
  if (!/\.zip$/i.test(file.name)) {
    toast("That is not a .zip file.", true);
    return;
  }
  drop.innerHTML =
    `<div class="big"><span class="spinning">⏳</span></div>
     <p>Reading <b>${esc(file.name)}</b> — nothing is applied yet…</p>`;
  try {
    INSPECT = await api("/import/inspect", { method: "POST", body: file });
  } catch (e) {
    resetDrop();
    toast("This file was rejected: " + esc(e.message), true);
    $("#importHint").innerHTML =
      `<span style="color:var(--bad)">Rejected: ${esc(e.message)}</span>`;
    return;
  }
  resetDrop();
  renderInspect(file.name);
}

function resetDrop() {
  drop.innerHTML =
    `<div class="big">📦</div>
     <p><b>Drop an Advance Tools export here</b><br>
        or click to choose a <code>.zip</code> file</p>`;
}

function renderInspect(filename) {
  const d = INSPECT;
  $("#importDropPanel").style.display = "none";
  $("#importResult").style.display = "none";
  $("#importReview").style.display = "";

  const m = d.manifest || {};
  $("#importManifest").innerHTML =
    `<div class="row"><div class="nm">
        <b>${esc(filename)}</b>
        <small>Exported ${esc(m.exported || "?")} from Advance Tools
          ${esc(m.app_version || "?")} · archive format ${esc(m.format)}
          · includes ${esc((m.includes || []).join(", ") || "—")}</small>
      </div>
      ${m.credentials
        ? '<span class="pill warn">includes password hashes</span>'
        : '<span class="pill">no password hashes</span>'}</div>`;

  $("#importWarnings").innerHTML = (d.warnings || []).length
    ? `<div class="warnbox"><b>Please read:</b><ul>${
        d.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
    : "";

  renderSection("#impDashPanel", "#impDash", d.dashboards, (x) => ({
    key: x.slug,
    title: `${x.name} <code>${esc(x.slug)}</code>`,
    sub: `${x.mode} mode · ${x.files} file(s) in the archive`,
    exists: x.exists,
  }));
  renderSection("#impToolPanel", "#impTools", d.tools, (x) => ({
    key: x.file,
    title: esc(x.file),
    sub: fmtBytes(x.bytes),
    exists: x.exists,
  }));
  renderSection("#impUserPanel", "#impUsers", d.users, (x) => ({
    key: x.name,
    title: esc(x.name) + (x.is_admin ? ' <span class="pill">admin</span>' : ""),
    sub: (x.has_password
            ? "password hash included — the existing password keeps working"
            : "no password in the file — set one in the Hub afterwards")
       + " · " + (x.dashboards.length
          ? x.dashboards.length + " dashboard grant(s)" : "no dashboard grants")
       + (x.name === (OVERVIEW && OVERVIEW.me)
          ? " · this is your own account — it will be kept as an admin with "
            + "its current password"
          : ""),
    exists: x.exists,
  }));

  updateImportStat();
}

function renderSection(panelSel, bodySel, items, mapper) {
  const panel = $(panelSel);
  const body = $(bodySel);
  if (!items || !items.length) {
    panel.style.display = "none";
    body.innerHTML = "";
    return;
  }
  panel.style.display = "";
  body.innerHTML = items.map((raw) => {
    const x = mapper(raw);
    return `<label class="row ${x.exists ? "over" : "new"}">
        <input type="checkbox" data-key="${esc(x.key)}" checked>
        <div class="nm"><b>${x.title}</b><small>${x.sub}</small></div>
        <span class="pill ${x.exists ? "warn" : "on"}">${
          x.exists ? "will overwrite" : "new"}</span>
      </label>`;
  }).join("");
  body.querySelectorAll("input[type=checkbox]").forEach((c) =>
    c.addEventListener("change", () => {
      c.closest(".row").classList.toggle("off", !c.checked);
      updateImportStat();
    }));
}

function picked(bodySel) {
  return Array.from($(bodySel).querySelectorAll("input:checked"))
    .map((c) => c.dataset.key);
}

function updateImportStat() {
  const d = picked("#impDash"), t = picked("#impTools"), u = picked("#impUsers");
  const total = d.length + t.length + u.length;
  const over =
    (INSPECT.dashboards || []).filter((x) => x.exists && d.includes(x.slug)).length
    + (INSPECT.tools || []).filter((x) => x.exists && t.includes(x.file)).length
    + (INSPECT.users || []).filter((x) => x.exists && u.includes(x.name)).length;
  $("#importStat").innerHTML =
    `<b>${total}</b> item(s) selected` +
    (over ? ` · <span style="color:var(--warn)">${over} will overwrite
       something you already have</span>` : " · nothing existing is touched");
  $("#importApply").disabled = total === 0;
}

$$(".seg").forEach((s) => s.addEventListener("click", () => {
  $$(".seg").forEach((o) => o.classList.toggle("on", o === s));
  IMPORT_MODE = s.dataset.mode;
  updateImportStat();
}));

$("#importCancel").addEventListener("click", () => {
  INSPECT = null;
  $("#importReview").style.display = "none";
  $("#importDropPanel").style.display = "";
  loadOverview();
});

$("#importApply").addEventListener("click", () => {
  const d = picked("#impDash"), t = picked("#impTools"), u = picked("#impUsers");
  const lines = [];
  const push = (arr, existsOf, what) => {
    for (const key of arr) {
      const exists = existsOf(key);
      lines.push(`<li><b>${esc(key)}</b> — ${what}: ${
        exists
          ? (IMPORT_MODE === "replace"
              ? '<span style="color:var(--bad)">wiped and rewritten from the file</span>'
              : '<span style="color:var(--warn)">merged, imported values win</span>')
          : '<span style="color:var(--good)">created (new here)</span>'}</li>`);
    }
  };
  push(d, (k) => (INSPECT.dashboards.find((x) => x.slug === k) || {}).exists,
       "dashboard");
  push(t, (k) => (INSPECT.tools.find((x) => x.file === k) || {}).exists,
       "tool settings");
  push(u, (k) => (INSPECT.users.find((x) => x.name === k) || {}).exists,
       "account");

  const me = OVERVIEW && OVERVIEW.me;
  $("#confirmBody").innerHTML =
    `<div class="warnbox">Mode: <b>${
       IMPORT_MODE === "replace" ? "Replace" : "Merge"}</b>.
       A restore point is written before anything is changed, and you can undo
       all of this from the Rollback tab.</div>
     <ul style="padding-left:20px; font-size:13px; line-height:1.9;
                color:var(--mut)">${lines.join("")}</ul>` +
    (u.includes(me)
      ? `<div class="okbox">Your own account <b>${esc(me)}</b> is in the list.
           It will keep its current password and admin rights whatever the file
           says.</div>`
      : "");
  openModal("#confirmModal");
});

$("#confirmYes").addEventListener("click", async () => {
  closeModals();
  const body = {
    token: INSPECT.token,
    dashboards: picked("#impDash"),
    tools: picked("#impTools"),
    users: picked("#impUsers"),
    mode: IMPORT_MODE,
  };
  $("#importApply").disabled = true;
  let res;
  try {
    res = await api("/import/apply", postJSON(body));
  } catch (e) {
    $("#importApply").disabled = false;
    toast("Import refused: " + esc(e.message), true);
    return;
  }
  showImportResult(res);
});

function showImportResult(res) {
  $("#importReview").style.display = "none";
  $("#importResult").style.display = "";
  const rows = (res.results || []).map((r) =>
    `<div class="row ${r.ok ? "new" : ""}">
       <div class="nm"><b>${esc(r.item)}</b>
         <small>${esc(r.kind)} · ${esc(r.detail)}</small></div>
       <span class="pill ${r.ok ? "on" : "off"}">${r.ok ? "done" : "failed"}</span>
     </div>`).join("");
  $("#importResultBody").innerHTML =
    (res.failed
      ? `<div class="warnbox"><b>${res.applied} applied, ${res.failed} failed.</b>
           The failures are listed below — nothing else was affected.</div>`
      : `<div class="okbox"><b>${res.applied} item(s) imported.</b>
           A restore point was saved as
           <code>${esc(res.rollback)}</code> — use the Rollback tab if you want
           to undo this.</div>`)
    + rows;
  INSPECT = null;
  loadOverview();
  toast(`Import finished — ${res.applied} item(s) applied.`);
}

$("#importAgain").addEventListener("click", () => {
  $("#importResult").style.display = "none";
  $("#importDropPanel").style.display = "";
  resetDrop();
});
$("#importToRollback").addEventListener("click", () => showTab("rollback"));

/* ------------------------------------------------------------- rollback */

let rbTarget = null;

async function loadRollbacks() {
  const box = $("#rbList");
  box.innerHTML =
    '<div class="empty"><span class="spinning">⏳</span> Loading…</div>';
  let d;
  try {
    d = await api("/rollback");
  } catch (e) {
    box.innerHTML = `<div class="badbox">Could not load restore points: ${
      esc(e.message)}</div>`;
    return;
  }
  $("#rbKeep").textContent = d.keep;
  if (!(d.points || []).length) {
    box.innerHTML =
      '<div class="empty">No restore points yet.<br>' +
      "One is created automatically the first time you import something.</div>";
    return;
  }
  box.innerHTML = d.points.map((p, i) => {
    const bits = [];
    if (p.files.length) bits.push(`${p.files.length} config file(s)`);
    if (p.dashboards.length) bits.push(`${p.dashboards.length} dashboard(s)`);
    return `<div class="row">
      <div class="nm"><b>${esc(fmtStamp(p.id))}${
        i === 0 ? ' <span class="pill on">most recent</span>' : ""}</b>
        <small>${esc(p.reason || "restore point")} · ${
          esc(bits.join(" · ") || "nothing recorded")} · add-on
          ${esc(p.app_version || "?")}</small></div>
      <button class="ghost danger" data-rb="${esc(p.id)}">↩ Restore</button>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-rb]").forEach((b) =>
    b.addEventListener("click", () => askRollback(b.dataset.rb, d.points)));
}

function askRollback(id, points) {
  const p = points.find((x) => x.id === id) || {};
  rbTarget = id;
  const bits = [];
  if ((p.files || []).length)
    bits.push(p.files.map((f) => `<code>${esc(f)}</code>`).join(", "));
  if ((p.dashboards || []).length)
    bits.push("dashboards " + p.dashboards.map(
      (s) => `<code>${esc(s)}</code>`).join(", "));
  $("#rbSub").innerHTML =
    `Files saved on <b>${esc(fmtStamp(id))}</b> will be written back over the
     current ones: ${bits.join(" · ") || "nothing recorded"}.<br><br>
     A snapshot of the current state is taken first, so this is reversible.
     Anything you changed since that point in those files will be lost.`;
  openModal("#rbModal");
}

$("#rbYes").addEventListener("click", async () => {
  closeModals();
  try {
    const res = await api("/import/rollback", postJSON({ id: rbTarget }));
    toast(`Restored ${res.results.length} item(s) from ${esc(fmtStamp(rbTarget))}.`);
  } catch (e) {
    toast("Rollback refused: " + esc(e.message), true);
  }
  loadRollbacks();
  loadOverview();
});

/* ----------------------------------------------------------------- boot */

loadOverview();
loadBundlePreview();
refreshExportSize();
