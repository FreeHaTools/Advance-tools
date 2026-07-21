/* Starter Templates — frontend. Talks to /api/tools/starter_templates/*. */
"use strict";

const API = "/api/tools/starter_templates";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const SLUG_RE = /^[a-z0-9_]{1,40}$/;

let TEMPLATES = [];
let CURRENT = null;        // { template, slots, ready, missing }
let MAPPING = {};          // slot key -> entity_id | null
let STATES = {};           // entity_id -> { name, state, area } (for display)
let pickKey = null;        // slot key the picker is editing
let pickList = [];         // entities offered by the picker
let slugTouched = false;

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

function show(view) {
  $$(".view").forEach((v) => v.classList.remove("on"));
  $(view).classList.add("on");
  $("#backBtn").style.display = view === "#viewGallery" ? "none" : "inline-block";
  window.scrollTo(0, 0);
}

/* Turn a display name into a legal slug. */
function slugify(name) {
  return String(name || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/* A short, human description of a live state. */
function stateChip(state) {
  const s = String(state || "");
  if (!s) return '<span class="pill">no state</span>';
  if (s === "unavailable" || s === "unknown")
    return `<span class="pill off">${esc(s)}</span>`;
  const on = ["on", "open", "home", "playing", "heat", "cool", "cleaning"];
  return `<span class="pill${on.includes(s) ? " on" : ""}">${esc(s)}</span>`;
}

/* ---------------------------------------------------------------- gallery */

async function loadGallery() {
  const box = $("#gallery");
  box.innerHTML = '<div class="empty"><span class="spinning">⏳</span> Loading…</div>';
  try {
    const d = await api("/list");
    TEMPLATES = d.templates || [];
  } catch (e) {
    box.innerHTML = "";
    $("#galleryEmpty").style.display = "block";
    $("#galleryEmpty").textContent = "Could not load templates: " + e.message;
    return;
  }
  box.innerHTML = "";
  $("#galleryEmpty").style.display = TEMPLATES.length ? "none" : "block";

  for (const t of TEMPLATES) {
    const card = document.createElement("div");
    card.className = "tcard";
    card.innerHTML =
      `<div class="top">
         <div class="tico">${esc(t.icon)}</div>
         <div>
           <h3>${esc(t.name)}</h3>
           <div class="dims">${t.canvas.w} × ${t.canvas.h} · ${
             t.widget_count} elements · ${t.slot_count} entities</div>
         </div>
       </div>
       <div class="desc">${esc(t.description)}</div>
       ${(t.summary || []).length
          ? `<ul>${t.summary.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
          : ""}
       <div class="tags">${(t.tags || [])
          .map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
       <div class="foot"><div class="sp"></div>
         <span class="btn sm">Use this template →</span></div>`;
    card.addEventListener("click", () => openTemplate(t.id));
    box.appendChild(card);
  }
}

/* ---------------------------------------------------------------- review */

async function openTemplate(id, silent) {
  if (!silent) toast("Matching your entities…");
  try {
    CURRENT = await api("/preview", postJSON({ template_id: id }));
  } catch (e) {
    toast("Preview failed: " + esc(e.message), true);
    return;
  }
  MAPPING = {};
  STATES = {};
  for (const s of CURRENT.slots) {
    MAPPING[s.key] = s.chosen || null;
    for (const m of s.matches) STATES[m.entity_id] = m;
  }

  const t = CURRENT.template;
  $("#revIcon").textContent = t.icon;
  $("#revName").textContent = t.name;
  $("#revDesc").textContent = t.description;

  if (!silent) {
    slugTouched = false;
    $("#dashName").value = t.name;
    $("#dashSlug").value = slugify(t.name);
  }
  validateSlug();
  renderSlots();
  show("#viewReview");
}

function renderSlots() {
  const box = $("#slots");
  box.innerHTML = "";

  for (const s of CURRENT.slots) {
    const eid = MAPPING[s.key];
    const info = eid ? (STATES[eid] || { name: eid, state: "", area: "" }) : null;
    const missing = s.required && !eid;

    const row = document.createElement("div");
    row.className = "slot" + (missing ? " miss" : "");
    row.innerHTML =
      `<div class="sl">
         <b>${esc(s.label)}<span class="req${s.required ? " on" : ""}">${
           s.required ? "required" : "optional"}</span></b>
         ${s.hint ? `<small>${esc(s.hint)}</small>` : ""}
       </div>
       <div class="match">
         ${eid
            ? `<div class="mn">${esc(info.name)}${stateChip(info.state)}</div>
               <div class="mid">${esc(eid)}${
                 info.area ? " · " + esc(info.area) : ""}</div>`
            : `<div class="none${s.required ? "" : " opt"}">${
                 s.required
                   ? "⚠ Nothing matched — please choose one"
                   : "Not used — this widget will be left out"}</div>
               <div class="mid">${esc(s.domain)}${
                 s.device_class ? " · " + esc(s.device_class) : ""}</div>`}
       </div>
       <div class="acts">
         <button class="ghost" data-pick="${esc(s.key)}">${
           eid ? "Change" : "Choose"}</button>
       </div>`;
    box.appendChild(row);
  }

  box.querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", () => openPicker(b.dataset.pick)));

  updateApply();
}

function updateApply() {
  const missing = CURRENT.slots
    .filter((s) => s.required && !MAPPING[s.key])
    .map((s) => s.label);
  const used = Object.values(MAPPING).filter(Boolean).length;

  const mb = $("#missBox");
  mb.innerHTML = missing.length
    ? `<div class="warnbox">Still needed before this can be built:
         <b>${missing.map(esc).join("</b>, <b>")}</b>.</div>`
    : `<div class="okbox">Everything required is matched — you are good to go.
         Optional slots left empty are simply removed from the layout.</div>`;

  const slugOk = validateSlug();
  $("#applyBtn").disabled = missing.length > 0 || !slugOk;
  $("#applyStat").innerHTML =
    `<b>${used}</b> of ${CURRENT.slots.length} slots mapped` +
    (missing.length ? ` · <span style="color:var(--warn)">${
       missing.length} required missing</span>` : "");
}

/* ---------------------------------------------------------------- picker */

async function openPicker(key) {
  const slot = CURRENT.slots.find((s) => s.key === key);
  if (!slot) return;
  pickKey = key;

  $("#pickTitle").textContent = "Choose: " + slot.label;
  $("#pickSub").innerHTML =
    `Only <b>${esc(slot.domain)}</b> entities can go here` +
    (slot.device_class
      ? `, ideally with device class <b>${esc(slot.device_class)}</b>` : "") +
    ". Best guesses are listed first.";
  $("#pickSearch").value = "";
  $("#pickBody").innerHTML =
    '<div class="empty"><span class="spinning">⏳</span> Loading entities…</div>';
  openModal("#pickModal");
  setTimeout(() => $("#pickSearch").focus(), 60);

  let all = [];
  try {
    const d = await api("/entities?domain=" + encodeURIComponent(slot.domain));
    all = d.entities || [];
  } catch (e) {
    $("#pickBody").innerHTML =
      `<div class="empty">Could not load entities: ${esc(e.message)}</div>`;
    return;
  }
  for (const e of all) if (!STATES[e.entity_id]) STATES[e.entity_id] = e;

  // Suggestions first (in match order), then everything else alphabetically.
  const rank = new Map(slot.matches.map((m, i) => [m.entity_id, i]));
  all.sort((a, b) => {
    const ra = rank.has(a.entity_id) ? rank.get(a.entity_id) : 9999;
    const rb = rank.has(b.entity_id) ? rank.get(b.entity_id) : 9999;
    return ra - rb || a.name.localeCompare(b.name);
  });
  pickList = all.map((e) => Object.assign({
    suggested: rank.has(e.entity_id),
  }, e));
  drawPicker("");
}

function drawPicker(query) {
  const q = query.trim().toLowerCase();
  const body = $("#pickBody");
  const hits = pickList.filter((e) =>
    !q || e.entity_id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));

  if (!hits.length) {
    body.innerHTML = '<div class="empty">Nothing matches that search.</div>';
    return;
  }

  const groups = [
    ["Best guesses", hits.filter((e) => e.suggested)],
    ["All " + (pickKey && CURRENT.slots.find((s) => s.key === pickKey).domain)
      + " entities", hits.filter((e) => !e.suggested)],
  ];
  const chosen = MAPPING[pickKey];

  body.innerHTML = groups.map(([title, list]) => !list.length ? "" :
    `<div class="pgroup">${esc(title)} · ${list.length}</div>` +
    list.slice(0, 400).map((e) =>
      `<div class="prow${e.entity_id === chosen ? " on" : ""}"
            data-eid="${esc(e.entity_id)}">
         <div class="pn"><b>${esc(e.name)}</b><small>${esc(e.entity_id)}${
           e.area ? " · " + esc(e.area) : ""}</small></div>
         ${stateChip(e.state)}
         ${e.score != null ? `<span class="sc">${esc(e.score)}</span>` : ""}
       </div>`).join("")).join("");

  body.querySelectorAll("[data-eid]").forEach((r) =>
    r.addEventListener("click", () => {
      MAPPING[pickKey] = r.dataset.eid;
      closeModals();
      renderSlots();
      toast(`Set <b>${esc(CURRENT.slots.find((s) => s.key === pickKey).label)}</b>`);
    }));
}

$("#pickSearch").addEventListener("input", (e) => drawPicker(e.target.value));
$("#pickClear").addEventListener("click", () => {
  if (!pickKey) return;
  MAPPING[pickKey] = null;
  closeModals();
  renderSlots();
});

/* ---------------------------------------------------------------- slug */

function validateSlug() {
  const el = $("#dashSlug");
  const note = $("#slugNote");
  const v = el.value.trim();
  let ok = true, msg = "";

  if (!v) { ok = false; msg = "Pick an address for this dashboard."; }
  else if (!SLUG_RE.test(v)) {
    ok = false;
    msg = "Only lowercase letters, numbers and _ — up to 40 characters.";
  } else {
    msg = `The tablet will open <b>/d/${esc(v)}/</b>`;
  }

  el.classList.toggle("bad", !ok);
  note.classList.toggle("bad", !ok);
  note.innerHTML = msg;
  return ok;
}

$("#dashName").addEventListener("input", () => {
  if (!slugTouched) $("#dashSlug").value = slugify($("#dashName").value);
  if (CURRENT) updateApply();
});
$("#dashSlug").addEventListener("input", () => {
  slugTouched = true;
  $("#dashSlug").value = $("#dashSlug").value.toLowerCase();
  if (CURRENT) updateApply();
});

/* ---------------------------------------------------------------- apply */

async function apply(overwrite) {
  if (!CURRENT) return;
  const btn = $("#applyBtn");
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinning">⏳</span> Building…';

  const mapping = {};
  for (const [k, v] of Object.entries(MAPPING)) if (v) mapping[k] = v;

  try {
    const res = await api("/apply", postJSON({
      template_id: CURRENT.template.id,
      slug: $("#dashSlug").value.trim(),
      name: $("#dashName").value.trim() || CURRENT.template.name,
      mapping,
      overwrite: !!overwrite,
    }));
    showDone(res);
  } catch (e) {
    if (e.status === 409) {
      $("#confirmSub").innerHTML =
        `A dashboard already lives at <b>/d/${esc($("#dashSlug").value.trim())}/</b>. ` +
        "Replacing it overwrites its layout — every widget you placed there by " +
        "hand is lost. Its users and permissions stay as they are.";
      openModal("#confirmModal");
    } else {
      toast("Could not build it: " + esc(e.message), true);
    }
  } finally {
    btn.innerHTML = label;
    updateApply();
  }
}

function showDone(res) {
  $("#doneTitle").textContent = res.replaced
    ? "Your dashboard was rebuilt"
    : "Your dashboard is ready";
  $("#doneBody").innerHTML =
    `<b>${esc(CURRENT.template.name)}</b> built <b>${res.widgets}</b> elements ` +
    `around <b>${res.entities}</b> of your entities. ` +
    "It is a normal Dashboard Maker dashboard now — open it in the visual " +
    "designer any time to move things around, restyle them or add more.";
  $("#doneUrl").textContent = location.origin + res.url;
  $("#doneOpen").href = res.url;
  show("#viewDone");
  toast(`Built <b>${esc(res.slug)}</b> — ${res.widgets} elements`);
}

/* ---------------------------------------------------------------- wiring */

$("#applyBtn").addEventListener("click", () => apply(false));
$("#confirmYes").addEventListener("click", () => { closeModals(); apply(true); });
$("#cancelBtn").addEventListener("click", () => show("#viewGallery"));
$("#backBtn").addEventListener("click", () => show("#viewGallery"));
$("#doneAgain").addEventListener("click", () => { CURRENT = null; show("#viewGallery"); });
$("#helpBtn").addEventListener("click", () => openModal("#helpModal"));
$("#rematchBtn").addEventListener("click", () => {
  if (CURRENT) openTemplate(CURRENT.template.id, true).then(
    () => toast("Re-matched against your current entities"));
});

loadGallery();
