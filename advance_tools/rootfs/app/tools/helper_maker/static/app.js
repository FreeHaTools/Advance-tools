/* Helper Maker — frontend logic.
 *
 * Talks to /api/tools/helper_maker/* (tool.py). All type knowledge
 * (forms, hints, learn content) comes from content.js.
 */
"use strict";

const API = "/api/tools/helper_maker";
const $  = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let ALL = [];            // flat helper list (storage + entries)
let STATES = {};         // entity_id -> {state, attributes, last_changed}
let CONNECTED = false;
let FILTER = "all";      // type key or "all"
let SEARCH = "";
let SORT = "name";
let SELECTED = new Set();  // bulk keys
let ENTITIES = null;       // cached /api/admin/entities
let FLOW = null;           // active config flow {mode, id, handler}
let FORM = null;           // active storage form {domain, itemId}
const CARDS = {};          // key -> card element

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
  if (d < 0 || isNaN(d)) return "";
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " h ago";
  return Math.floor(d / 86400) + " d ago";
}

function pretty(key) {
  return String(key).replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const keyOf = (h) => h.kind === "storage"
  ? `s:${h.domain}:${h.config.id}` : `e:${h.entry_id}`;

/* ------------------------------------------------------------ tooltip */

const tipbox = $("#tipbox");
document.addEventListener("mouseover", (e) => {
  const h = e.target.closest(".hint");
  if (!h) { tipbox.style.display = "none"; return; }
  const d = h._hint; if (!d) return;
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
});

function hintEl(hint) {
  if (!hint) return "";
  const s = document.createElement("span");
  s.className = "hint"; s.textContent = "?"; s._hint = hint;
  return s;
}

/* ------------------------------------------------------------ modals */

$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) closeModal(m);
  });
});
function openModal(id) { $(id).classList.add("open"); }
function closeModal(m) {
  if (typeof m === "string") m = $(m);
  m.classList.remove("open");
  if (m.id === "flowModal" && FLOW) abortFlow();
}

/* ------------------------------------------------------------ load + poll */

async function load() {
  try {
    const d = await api("GET", "/helpers");
    CONNECTED = d.connected;
    STATES = d.states || {};
    ALL = [];
    for (const [domain, items] of Object.entries(d.storage || {})) {
      for (const it of items)
        ALL.push({ kind: "storage", domain, config: it.config,
                   entity_id: it.entity_id, disabled: it.disabled });
    }
    for (const en of d.entries || [])
      ALL.push({ kind: "entry", domain: en.domain, entry_id: en.entry_id,
                 title: en.title, entities: en.entities,
                 entity_id: (en.entities[0] || {}).entity_id || "",
                 disabled: !!en.disabled_by,
                 supports_options: en.supports_options });
  } catch (e) {
    $("#list").innerHTML =
      `<div class="empty">Could not load helpers: ${esc(e.message)}</div>`;
    return;
  }
  renderAll();
}

async function poll() {
  const ids = Object.keys(STATES);
  for (const h of ALL) {
    if (h.entity_id) ids.push(h.entity_id);
    if (h.entities) h.entities.forEach((e) => ids.push(e.entity_id));
  }
  try {
    const d = await api("POST", "/states", { ids: [...new Set(ids)] });
    CONNECTED = d.connected;
    renderConn();
    for (const [eid, st] of Object.entries(d.states || {})) {
      const changed = !STATES[eid] ||
        STATES[eid].state !== st.state ||
        JSON.stringify(STATES[eid].attributes) !== JSON.stringify(st.attributes);
      STATES[eid] = st;
      if (changed) updateCardFor(eid);
    }
  } catch (e) {
    /* Transient for the UI (we keep the last render), but rethrow so PMPoll
       backs off instead of hammering a backend that is briefly down. */
    throw e;
  }
}

function updateCardFor(eid) {
  for (const h of ALL) {
    const hit = h.entity_id === eid ||
      (h.entities || []).some((e) => e.entity_id === eid);
    if (!hit) continue;
    const card = CARDS[keyOf(h)];
    if (!card) continue;
    const ctrl = $(".ctrl", card);
    if (ctrl && !ctrl.contains(document.activeElement))
      renderControls(h, ctrl);
    const last = $(".last", card);
    const st = STATES[h.entity_id];
    if (last && st) last.textContent = rel(st.last_changed);
  }
}

/* every second: tick running timers without a server round-trip.
   Local-only, so no focus backoff — but it still stops while hidden. */
PMPoll.every(1000, () => {
  $$("[data-finishes]").forEach((el) => {
    const left = Math.max(0,
      Math.round((new Date(el.dataset.finishes) - Date.now()) / 1000));
    el.textContent = fmtSecs(left);
  });
}, { el: document.body, name: "timer-tick", blurFactor: 1 });

function fmtSecs(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60),
        x = s % 60;
  return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" +
         String(x).padStart(2, "0");
}

/* ------------------------------------------------------------ header UI */

function renderConn() {
  $("#connStat").innerHTML =
    `<span class="dot ${CONNECTED ? "ok" : ""}"></span>` +
    (CONNECTED ? "connected to Home Assistant" : "not connected");
}

function renderStats() {
  const storage = ALL.filter((h) => h.kind === "storage").length;
  const entries = ALL.filter((h) => h.kind === "entry").length;
  const boxes = [
    [ALL.length, "helpers total"], [storage, "basic helpers"],
    [entries, "advanced helpers"],
    [Object.keys(HELPER_TYPES).length, "types available"],
  ];
  $("#stats").innerHTML = boxes.map(([n, l]) =>
    `<div class="statbox"><b>${n}</b><span>${l}</span></div>`).join("");
}

function renderChips() {
  const counts = {};
  for (const h of ALL) counts[h.domain] = (counts[h.domain] || 0) + 1;
  let html = `<span class="chip ${FILTER === "all" ? "on" : ""}"
      data-f="all">All <span class="n">${ALL.length}</span></span>`;
  for (const t of TYPE_ORDER) {
    if (!counts[t]) continue;
    const T = HELPER_TYPES[t] || { icon: "❔", name: t };
    html += `<span class="chip ${FILTER === t ? "on" : ""}" data-f="${t}">
      ${T.icon} ${esc(T.name)} <span class="n">${counts[t]}</span></span>`;
  }
  // domains we don't know (future helper types) still get a chip
  for (const d of Object.keys(counts)) {
    if (!TYPE_ORDER.includes(d))
      html += `<span class="chip ${FILTER === d ? "on" : ""}" data-f="${d}">
        ❔ ${esc(pretty(d))} <span class="n">${counts[d]}</span></span>`;
  }
  $("#chips").innerHTML = html;
  $$("#chips .chip").forEach((c) => c.onclick = () => {
    FILTER = c.dataset.f; renderAll();
  });
}

/* ------------------------------------------------------------ list */

function visible() {
  let list = ALL.filter((h) => FILTER === "all" || h.domain === FILTER);
  if (SEARCH) {
    const q = SEARCH.toLowerCase();
    list = list.filter((h) =>
      (h.config?.name || h.title || "").toLowerCase().includes(q) ||
      (h.entity_id || "").toLowerCase().includes(q) ||
      h.domain.includes(q));
  }
  const nameOf = (h) => (h.config?.name || h.title || "").toLowerCase();
  if (SORT === "name") list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (SORT === "type") list.sort((a, b) =>
    a.domain.localeCompare(b.domain) || nameOf(a).localeCompare(nameOf(b)));
  if (SORT === "changed") list.sort((a, b) =>
    new Date(STATES[b.entity_id]?.last_changed || 0) -
    new Date(STATES[a.entity_id]?.last_changed || 0));
  return list;
}

function renderAll() {
  renderConn(); renderStats(); renderChips();
  const list = visible();
  const box = $("#list");
  box.innerHTML = "";
  Object.keys(CARDS).forEach((k) => delete CARDS[k]);
  if (!list.length) {
    box.innerHTML = `<div class="empty">No helpers here yet.<br>
      Hit <b>＋ New Helper</b> to create your first one — every type comes
      with a built-in explanation.</div>`;
    return;
  }
  for (const h of list) box.appendChild(renderCard(h));
  updateBulkbar();
}

function renderCard(h) {
  const T = HELPER_TYPES[h.domain] || { icon: "❔", name: pretty(h.domain) };
  const key = keyOf(h);
  const st = STATES[h.entity_id];
  const name = h.config?.name || h.title || h.entity_id;
  const card = document.createElement("div");
  card.className = "hcard" + (h.disabled ? " disabled" : "") +
    (SELECTED.has(key) ? " selected" : "");
  card.innerHTML = `
    <div class="selbox">${SELECTED.has(key) ? "✓" : ""}</div>
    <div class="top">
      <div class="ticon">${T.icon}</div>
      <div class="nm"><b>${esc(name)}</b>
        <span class="eid" title="Click to copy">${esc(h.entity_id)}</span></div>
      <span class="tbadge" style="color:${T.color};border-color:${T.color}55">
        ${esc(T.name)}</span>
    </div>
    <div class="ctrl"></div>
    <div class="foot">
      <span class="last">${st ? esc(rel(st.last_changed)) : ""}</span>
      <button class="iconbtn" data-a="usage" title="Where is it used?">🔎</button>
      ${h.kind === "storage"
        ? `<button class="iconbtn" data-a="dup" title="Duplicate">⧉</button>`
        : `<button class="iconbtn" data-a="toggle-entry"
             title="${h.disabled ? "Enable" : "Disable"}">
             ${h.disabled ? "▶" : "⏸"}</button>`}
      <button class="iconbtn" data-a="edit" title="Edit">✏️</button>
      <button class="iconbtn danger" data-a="del" title="Delete">🗑</button>
    </div>`;
  renderControls(h, $(".ctrl", card));

  $(".selbox", card).onclick = () => {
    SELECTED.has(key) ? SELECTED.delete(key) : SELECTED.add(key);
    card.classList.toggle("selected", SELECTED.has(key));
    $(".selbox", card).textContent = SELECTED.has(key) ? "✓" : "";
    updateBulkbar();
  };
  $(".eid", card).onclick = () => {
    navigator.clipboard?.writeText(h.entity_id)
      .then(() => toast("Entity id copied: " + h.entity_id));
  };
  $('[data-a="usage"]', card).onclick = () => showUsage(h);
  $('[data-a="edit"]', card).onclick = () => editHelper(h);
  $('[data-a="del"]', card).onclick = () => confirmDelete([h]);
  const dup = $('[data-a="dup"]', card);
  if (dup) dup.onclick = () => duplicate(h);
  const tg = $('[data-a="toggle-entry"]', card);
  if (tg) tg.onclick = async () => {
    try {
      await api("POST", `/entry/${h.entry_id}/disable`,
                { disabled: !h.disabled });
      toast(h.disabled ? "Helper enabled" : "Helper disabled");
      load();
    } catch (e) { toast(e.message, true); }
  };
  CARDS[key] = card;
  return card;
}

/* ------------------------------------------------------------ quick controls */

async function svc(domain, service, entity_id, data) {
  try {
    await api("POST", "/service", { domain, service, entity_id,
                                    data: data || {} });
  } catch (e) { toast(e.message, true); }
}

function renderControls(h, box) {
  box.innerHTML = "";
  const st = STATES[h.entity_id];
  if (!st) {
    box.innerHTML = `<span class="stateval off">${
      h.kind === "entry" ? "no entity yet" : "unavailable"}</span>`;
    if (h.kind === "entry") renderEntryEntities(h, box);
    return;
  }
  const a = st.attributes || {};
  const d = h.domain, eid = h.entity_id;

  if (d === "input_boolean") {
    const sw = document.createElement("div");
    sw.className = "sw" + (st.state === "on" ? " on" : "");
    sw.onclick = () => { sw.classList.toggle("on");
                         svc(d, "toggle", eid); };
    box.append(sw, stateSpan(st.state === "on" ? "On" : "Off",
                             st.state !== "on"));

  } else if (d === "input_button") {
    const b = document.createElement("button");
    b.className = "pressbtn"; b.textContent = "Press";
    b.onclick = () => { svc(d, "press", eid); toast("Pressed " + eid); };
    box.append(b, stateSpan(st.state && st.state !== "unknown"
      ? "last press " + rel(st.state) : "never pressed", true));

  } else if (d === "input_number") {
    const min = isFinite(+a.min) ? +a.min : 0;
    const max = isFinite(+a.max) ? +a.max : 100;
    const step = +a.step || 1;
    const val = parseFloat(st.state);
    const unit = a.unit_of_measurement ? " " + a.unit_of_measurement : "";
    if (a.mode === "box") {
      const i = document.createElement("input");
      i.type = "number"; i.min = min; i.max = max; i.step = step;
      i.style.width = "110px";
      i.value = isNaN(val) ? "" : val;
      i.onkeydown = (e) => { if (e.key === "Enter") {
        svc(d, "set_value", eid, { value: +i.value }); i.blur(); } };
      i.onchange = () => svc(d, "set_value", eid, { value: +i.value });
      box.append(i, stateSpan(unit.trim(), true));
    } else {
      const out = stateSpan((isNaN(val) ? "?" : val) + unit);
      const r = document.createElement("input");
      r.type = "range"; r.className = "qr";
      r.min = min; r.max = max; r.step = step; r.value = isNaN(val) ? min : val;
      r.oninput = () => out.textContent = r.value + unit;
      r.onchange = () => svc(d, "set_value", eid, { value: +r.value });
      box.append(r, out);
    }

  } else if (d === "input_text") {
    const i = document.createElement("input");
    i.type = a.mode === "password" ? "password" : "text";
    i.style.flex = "1"; i.value = st.state === "unknown" ? "" : st.state;
    i.placeholder = "type + Enter to set";
    i.onkeydown = (e) => { if (e.key === "Enter") {
      svc(d, "set_value", eid, { value: i.value }); i.blur();
      toast("Text updated"); } };
    box.append(i);

  } else if (d === "input_select") {
    const s = document.createElement("select");
    s.style.flex = "1";
    for (const o of a.options || []) {
      const op = document.createElement("option");
      op.value = op.textContent = o;
      if (o === st.state) op.selected = true;
      s.appendChild(op);
    }
    s.onchange = () => svc(d, "select_option", eid, { option: s.value });
    box.append(s);

  } else if (d === "input_datetime") {
    const data = {};
    if (a.has_date) {
      const di = document.createElement("input");
      di.type = "date";
      di.value = st.state !== "unknown" ? (st.state.split(" ")[0] || "") : "";
      di.onchange = apply; box.append(di); data._d = di;
    }
    if (a.has_time) {
      const ti = document.createElement("input");
      ti.type = "time"; ti.step = 60;
      const raw = st.state.includes(" ") ? st.state.split(" ")[1] : st.state;
      ti.value = /^\d\d:\d\d/.test(raw || "") ? raw.slice(0, 5) : "";
      ti.onchange = apply; box.append(ti); data._t = ti;
    }
    function apply() {
      const p = {};
      if (data._d && data._d.value) p.date = data._d.value;
      if (data._t && data._t.value) p.time = data._t.value + ":00";
      if (Object.keys(p).length) svc(d, "set_datetime", eid, p);
    }

  } else if (d === "counter") {
    const stp = document.createElement("div");
    stp.className = "stepper";
    stp.innerHTML = `<button>−</button><span>${esc(st.state)}</span><button>＋</button>`;
    const [mi, pl] = $$("button", stp);
    mi.onclick = () => svc(d, "decrement", eid);
    pl.onclick = () => svc(d, "increment", eid);
    const rst = document.createElement("button");
    rst.className = "iconbtn"; rst.title = "Reset"; rst.textContent = "↺";
    rst.onclick = () => svc(d, "reset", eid);
    box.append(stp, rst);

  } else if (d === "timer") {
    const stateTxt = stateSpan(st.state, st.state === "idle");
    box.append(stateTxt);
    if (st.state === "active" && a.finishes_at) {
      const rem = stateSpan("");
      rem.dataset.finishes = a.finishes_at;
      box.append(rem);
    } else if (st.state === "paused" && a.remaining) {
      box.append(stateSpan("⏸ " + a.remaining, true));
    }
    const row = document.createElement("span");
    row.className = "timerrow"; row.style.marginLeft = "auto";
    const mk = (t, fn, title) => {
      const b = document.createElement("button");
      b.className = "iconbtn"; b.textContent = t; b.title = title;
      b.onclick = fn; row.append(b);
    };
    if (st.state === "active") {
      mk("⏸", () => svc(d, "pause", eid), "Pause");
      mk("⏹", () => svc(d, "cancel", eid), "Cancel");
      mk("⏭", () => svc(d, "finish", eid), "Finish now");
    } else {
      mk("▶", () => svc(d, "start", eid), "Start");
      if (st.state === "paused")
        mk("⏹", () => svc(d, "cancel", eid), "Cancel");
    }
    box.append(row);

  } else if (d === "schedule") {
    box.append(stateSpan(st.state === "on" ? "On (inside a block)" : "Off",
                         st.state !== "on"));
    if (a.next_event)
      box.append(stateSpan("next: " +
        new Date(a.next_event).toLocaleString([], {
          weekday: "short", hour: "2-digit", minute: "2-digit" }), true));

  } else {
    // config-entry helpers: primary state + unit
    box.append(stateSpan(st.state +
      (a.unit_of_measurement ? " " + a.unit_of_measurement : ""),
      ["off", "unknown", "unavailable"].includes(st.state)));
    renderEntryEntities(h, box);
  }
}

function renderEntryEntities(h, box) {
  const extra = (h.entities || []).slice(1, 4);
  for (const e of extra) {
    const st = STATES[e.entity_id];
    const c = document.createElement("span");
    c.className = "tbadge";
    c.title = e.entity_id;
    c.textContent = e.entity_id.split(".")[1]?.slice(0, 18) +
      (st ? ": " + st.state : "");
    box.append(c);
  }
}

function stateSpan(txt, off) {
  const s = document.createElement("span");
  s.className = "stateval" + (off ? " off" : "");
  s.textContent = txt;
  return s;
}

/* ------------------------------------------------------------ type picker */

$("#newBtn").onclick = showPicker;
function showPicker() {
  const grid = $("#pickGrid");
  const card = (t) => {
    const T = HELPER_TYPES[t];
    return `<div class="tpick" data-t="${t}">
      <span class="lrn" data-learn="${t}">Learn ↗</span>
      <div class="th"><span class="ti">${T.icon}</span><b>${esc(T.name)}</b></div>
      <p>${esc(T.short)}</p></div>`;
  };
  const storage = TYPE_ORDER.filter((t) => HELPER_TYPES[t]?.kind === "storage");
  const entry = TYPE_ORDER.filter((t) => HELPER_TYPES[t]?.kind === "entry");
  grid.innerHTML =
    `<div class="tsect">Basic helpers — instant, fully editable here</div>
     <div class="typegrid">${storage.map(card).join("")}</div>
     <div class="tsect">Advanced helpers — combine &amp; transform other entities</div>
     <div class="typegrid">${entry.map(card).join("")}</div>`;
  $$(".tpick", grid).forEach((el) => el.onclick = (e) => {
    const learn = e.target.closest("[data-learn]");
    if (learn) { showLearn(learn.dataset.learn, true); return; }
    closeModal("#pickModal");
    createHelper(el.dataset.t);
  });
  openModal("#pickModal");
}

function createHelper(type) {
  const T = HELPER_TYPES[type];
  if (T.kind === "storage") openForm(type, null);
  else startFlow(type);
}

/* ------------------------------------------------------------ learn panel */

let LEARN_TYPE = null;
function showLearn(type, offerCreate) {
  const T = HELPER_TYPES[type];
  if (!T || !T.learn) return;
  LEARN_TYPE = type;
  $("#learnIcon").textContent = T.icon;
  $("#learnTitle").textContent = T.name + " — what & why";
  const L = T.learn;
  $("#learnBody").innerHTML =
    `<h3>What it is</h3><p>${esc(L.what)}</p>
     <h3>Perfect for</h3><ul>${L.when.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
     ${L.tips ? `<h3>Pro tips</h3><ul>${
        L.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
     ${L.yaml ? `<h3>Example</h3><pre>${esc(L.yaml)}</pre>` : ""}`;
  $("#learnCreate").style.display = offerCreate === false ? "none" : "";
  openModal("#learnModal");
}
$("#learnCreate").onclick = () => {
  closeModal("#learnModal");
  if (LEARN_TYPE) createHelper(LEARN_TYPE);
};

/* ------------------------------------------------------------ storage form */

function openForm(domain, item) {
  const T = HELPER_TYPES[domain];
  FORM = { domain, itemId: item ? item.id : null };
  $("#formIcon").textContent = T.icon;
  $("#formTitle").textContent = (item ? "Edit " : "New ") + T.name;
  $("#formSub").textContent = T.short;
  $("#formLearn").onclick = () => showLearn(domain, false);
  $("#formErr").style.display = "none";
  const box = $("#formFields");
  box.innerHTML = "";
  for (const f of T.fields) box.appendChild(renderField(f, item));
  openModal("#formModal");
  const first = $("input, select, textarea", box);
  if (first) setTimeout(() => first.focus(), 60);
}

function renderField(f, item) {
  const wrap = document.createElement("div");
  const val = item ? item[f.key] : undefined;
  const lab = document.createElement("label");
  lab.append(f.label);
  if (f.required) {
    const r = document.createElement("span");
    r.className = "req"; r.textContent = "*"; lab.append(r);
  }
  if (f.hint) lab.append(hintEl(f.hint));

  if (f.type === "bool") {
    const row = document.createElement("div");
    row.className = "boolrow";
    const bl = document.createElement("span");
    bl.className = "bl"; bl.append(f.label);
    if (f.hint) bl.append(hintEl(f.hint));
    const sw = document.createElement("div");
    sw.className = "sw" + ((val ?? f.def) ? " on" : "");
    sw.onclick = () => sw.classList.toggle("on");
    sw.dataset.field = f.key; sw.dataset.ftype = "bool";
    row.append(bl, sw); wrap.append(row);
    return wrap;
  }

  wrap.append(lab);

  if (f.type === "select") {
    const s = document.createElement("select");
    s.dataset.field = f.key; s.dataset.ftype = "select";
    for (const c of f.choices) {
      const o = document.createElement("option");
      o.value = o.textContent = c;
      if ((val ?? f.def) === c) o.selected = true;
      s.appendChild(o);
    }
    wrap.append(s);

  } else if (f.type === "list") {
    const box = document.createElement("div");
    box.className = "optlist"; box.dataset.field = f.key;
    box.dataset.ftype = "list";
    const addRow = (v) => {
      const row = document.createElement("div");
      row.className = "orow";
      const i = document.createElement("input");
      i.type = "text"; i.value = v || ""; i.placeholder = "Option…";
      const rm = document.createElement("button");
      rm.className = "iconbtn danger"; rm.textContent = "✕";
      rm.onclick = () => row.remove();
      row.append(i, rm); box.insertBefore(row, add);
    };
    const add = document.createElement("span");
    add.className = "addline"; add.textContent = "＋ add option";
    add.onclick = () => addRow("");
    box.append(add);
    for (const v of (val && val.length ? val : ["", ""])) addRow(v);
    wrap.append(box);

  } else if (f.type === "duration") {
    const row = document.createElement("div");
    row.className = "durrow"; row.dataset.field = f.key;
    row.dataset.ftype = "duration";
    const parts = String(val ?? f.def ?? "00:05:00").split(":").map(Number);
    const mk = (v, l) => {
      const i = document.createElement("input");
      i.type = "number"; i.min = 0; i.value = v || 0;
      const sp = document.createElement("span"); sp.textContent = l;
      row.append(i, sp); return i;
    };
    mk(parts[0], "h"); mk(parts[1], "m"); mk(parts[2], "s");
    wrap.append(row);

  } else if (f.type === "schedule") {
    wrap.append(renderScheduleEditor(item));

  } else {
    const i = document.createElement("input");
    i.type = f.type === "number" ? "number" : "text";
    if (f.type === "number") i.step = "any";
    i.dataset.field = f.key;
    i.dataset.ftype = f.type === "number" ? "number" : "text";
    i.placeholder = f.ph || (f.type === "icon" ? "mdi:…" : "");
    if (val !== undefined && val !== null) i.value = val;
    else if (f.def !== undefined) i.value = f.def;
    wrap.append(i);
  }
  return wrap;
}

function renderScheduleEditor(item) {
  const box = document.createElement("div");
  box.dataset.field = "__week"; box.dataset.ftype = "schedule";
  for (const [key, label] of WEEKDAYS) {
    const day = document.createElement("div");
    day.className = "schedday"; day.dataset.day = key;
    const dn = document.createElement("div");
    dn.className = "dn"; dn.textContent = label;
    const blocks = document.createElement("div");
    blocks.className = "blocks";
    const addBlock = (from, to) => {
      const b = document.createElement("div");
      b.className = "schedblock";
      const f = document.createElement("input");
      f.type = "time"; f.value = (from || "08:00:00").slice(0, 5);
      const sp = document.createElement("span"); sp.textContent = "→";
      const t = document.createElement("input");
      t.type = "time"; t.value = (to || "17:00:00").slice(0, 5);
      const rm = document.createElement("button");
      rm.className = "iconbtn danger"; rm.textContent = "✕";
      rm.onclick = () => b.remove();
      b.append(f, sp, t, rm);
      blocks.insertBefore(b, add);
    };
    const add = document.createElement("span");
    add.className = "addline"; add.textContent = "＋ block";
    add.onclick = () => addBlock();
    blocks.append(add);
    for (const blk of (item && item[key]) || [])
      addBlock(blk.from, blk.to);
    day.append(dn, blocks);
    box.append(day);
  }
  return box;
}

function collectForm() {
  const T = HELPER_TYPES[FORM.domain];
  const cfg = {};
  for (const el of $$("[data-field]", $("#formFields"))) {
    const key = el.dataset.field, ft = el.dataset.ftype;
    if (ft === "bool") cfg[key] = el.classList.contains("on");
    else if (ft === "select") cfg[key] = el.value;
    else if (ft === "number") {
      if (el.value !== "") cfg[key] = parseFloat(el.value);
    } else if (ft === "list") {
      cfg[key] = $$(".orow input", el).map((i) => i.value.trim())
        .filter(Boolean);
    } else if (ft === "duration") {
      const [h, m, s] = $$("input", el).map((i) => parseInt(i.value) || 0);
      cfg[key] = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:` +
                 String(s).padStart(2, "0");
    } else if (ft === "schedule") {
      for (const day of $$(".schedday", el)) {
        const arr = [];
        for (const b of $$(".schedblock", day)) {
          const [f, t] = $$("input", b).map((i) => i.value);
          if (f && t) arr.push({ from: f + ":00", to: t + ":00" });
        }
        cfg[day.dataset.day] = arr;
      }
    } else {
      const v = el.value.trim();
      if (v !== "") cfg[key] = v;
    }
  }
  delete cfg.__week;
  // validations
  for (const f of T.fields)
    if (f.required && f.type !== "schedule" &&
        (cfg[f.key] === undefined || cfg[f.key] === "" ||
         (Array.isArray(cfg[f.key]) && !cfg[f.key].length)))
      throw new Error(`"${f.label}" is required.`);
  if (FORM.domain === "input_datetime" && !cfg.has_date && !cfg.has_time)
    throw new Error("Enable at least one of 'Has date' / 'Has time'.");
  if (FORM.domain === "input_number") {
    if (cfg.min >= cfg.max) throw new Error("Minimum must be below maximum.");
  }
  return cfg;
}

$("#formSave").onclick = async () => {
  let cfg;
  try { cfg = collectForm(); }
  catch (e) {
    const b = $("#formErr"); b.textContent = e.message; b.style.display = "block";
    return;
  }
  try {
    if (FORM.itemId)
      await api("PUT", `/storage/${FORM.domain}/${FORM.itemId}`, cfg);
    else
      await api("POST", `/storage/${FORM.domain}`, cfg);
    closeModal("#formModal");
    toast(FORM.itemId ? "Helper updated" : "Helper created 🎉");
    load();
  } catch (e) {
    const b = $("#formErr"); b.textContent = e.message; b.style.display = "block";
  }
};

/* ------------------------------------------------------------ edit / duplicate */

function editHelper(h) {
  if (h.kind === "storage") openForm(h.domain, h.config);
  else startOptionsFlow(h);
}

async function duplicate(h) {
  const cfg = { ...h.config };
  delete cfg.id;
  cfg.name = (cfg.name || "helper") + " copy";
  try {
    await api("POST", `/storage/${h.domain}`, cfg);
    toast("Duplicated as “" + cfg.name + "”");
    load();
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------ usage finder */

async function fetchUsage(h) {
  const ids = [h.entity_id,
               ...(h.entities || []).map((e) => e.entity_id)].filter(Boolean);
  const merged = {};
  for (const eid of ids) {
    try {
      const d = await api("GET", "/related/" + encodeURIComponent(eid));
      for (const [kind, items] of Object.entries(d.related || {})) {
        merged[kind] = merged[kind] || new Map();
        for (const it of items) merged[kind].set(it.id, it);
      }
    } catch (e) { /* per-entity */ }
  }
  return merged;
}

const KIND_LABEL = { automation: "Automations", script: "Scripts",
                     scene: "Scenes", group: "Groups",
                     entity: "Other entities" };

function usageHTML(merged) {
  const kinds = Object.keys(merged).filter((k) => merged[k].size);
  if (!kinds.length)
    return `<div class="relnone">✅ Not referenced by any automation, script
      or scene — safe to change or delete.</div>`;
  let html = "";
  for (const k of kinds) {
    html += `<div class="relgroup"><div class="rh">${KIND_LABEL[k] || k}
      (${merged[k].size})</div>`;
    for (const it of merged[k].values())
      html += `<div class="relitem"><span>${esc(it.name)}</span>
        <span class="rid">${esc(it.id)}</span></div>`;
    html += `</div>`;
  }
  return html;
}

async function showUsage(h) {
  $("#usageTitle").textContent = "Where is this used?";
  $("#usageSub").textContent = h.entity_id;
  $("#usageBody").innerHTML = `<div class="empty">Searching…</div>`;
  openModal("#usageModal");
  const merged = await fetchUsage(h);
  $("#usageBody").innerHTML = usageHTML(merged);
}

/* ------------------------------------------------------------ delete */

async function confirmDelete(list) {
  $("#confirmTitle").textContent = list.length === 1
    ? "Delete helper?" : `Delete ${list.length} helpers?`;
  $("#confirmSub").textContent = list.map((h) =>
    h.config?.name || h.title || h.entity_id).join(", ");
  $("#confirmBody").innerHTML = `<div class="empty">Checking usage…</div>`;
  openModal("#confirmModal");

  let used = 0, html = "";
  for (const h of list) {
    const merged = await fetchUsage(h);
    const n = Object.values(merged).reduce((s, m) => s + m.size, 0);
    if (n) { used += n; html += usageHTML(merged); }
  }
  $("#confirmBody").innerHTML = used
    ? `<div class="relwarn">⚠️ Still referenced in ${used} place(s).
        Deleting will break those automations/scripts:</div>` + html
    : `<div class="relnone">✅ Not used anywhere — safe to delete.</div>`;

  $("#confirmYes").onclick = async () => {
    let ok = 0, fail = 0;
    for (const h of list) {
      try {
        if (h.kind === "storage")
          await api("DELETE", `/storage/${h.domain}/${h.config.id}`);
        else
          await api("DELETE", `/entry/${h.entry_id}`);
        ok++;
      } catch (e) { fail++; }
    }
    closeModal("#confirmModal");
    toast(fail ? `Deleted ${ok}, failed ${fail}` : `Deleted ${ok} helper(s)`,
          !!fail);
    SELECTED.clear();
    load();
  };
}

/* ------------------------------------------------------------ config flows */

async function startFlow(type) {
  const T = HELPER_TYPES[type];
  FLOW = { mode: "flow", id: null, handler: type };
  $("#flowIcon").textContent = T.icon;
  $("#flowTitle").textContent = "New " + T.name;
  $("#flowSub").textContent = T.short;
  $("#flowLearn").onclick = () => showLearn(type, false);
  $("#flowErr").style.display = "none";
  $("#flowBody").innerHTML = `<div class="empty">Starting…</div>`;
  openModal("#flowModal");
  try {
    const d = await api("POST", "/flow", { handler: T.handler });
    FLOW.id = d.flow.flow_id;
    renderFlowStep(d.flow);
  } catch (e) { flowError(e.message); }
}

async function startOptionsFlow(h) {
  const T = HELPER_TYPES[h.domain] || { icon: "❔", name: pretty(h.domain),
                                        short: "" };
  if (!h.supports_options) {
    toast("This helper type has no editable options — delete and recreate it.",
          true);
    return;
  }
  FLOW = { mode: "options", id: null, handler: h.domain };
  $("#flowIcon").textContent = T.icon;
  $("#flowTitle").textContent = "Edit " + (h.title || T.name);
  $("#flowSub").textContent = T.short;
  $("#flowLearn").onclick = () => showLearn(h.domain, false);
  $("#flowErr").style.display = "none";
  $("#flowBody").innerHTML = `<div class="empty">Loading…</div>`;
  openModal("#flowModal");
  try {
    const d = await api("POST", "/options", { entry_id: h.entry_id });
    FLOW.id = d.flow.flow_id;
    renderFlowStep(d.flow);
  } catch (e) { flowError(e.message); }
}

function flowError(msg) {
  const b = $("#flowErr"); b.textContent = msg; b.style.display = "block";
}

async function abortFlow() {
  const f = FLOW; FLOW = null;
  if (!f || !f.id) return;
  const path = (f.mode === "options" ? "/options/" : "/flow/") + f.id;
  try { await api("DELETE", path); } catch (e) { /* already gone */ }
}

function renderFlowStep(flow) {
  const body = $("#flowBody");
  $("#flowErr").style.display = "none";
  const next = $("#flowNext");

  if (flow.type === "create_entry") {
    FLOW = null;
    closeModal("#flowModal");
    toast("Helper created 🎉");
    load();
    return;
  }
  if (flow.type === "abort") {
    FLOW = null;
    body.innerHTML = `<div class="flowdesc">Flow ended: ${
      esc(flow.reason || "aborted")}</div>`;
    next.style.display = "none";
    return;
  }

  if (flow.type === "menu") {
    let opts = flow.menu_options;
    if (Array.isArray(opts)) opts = Object.fromEntries(
      opts.map((o) => [o, pretty(o)]));
    body.innerHTML = `<div class="flowdesc">Choose a variant
      (step: ${esc(pretty(flow.step_id))})</div>`;
    for (const [key, label] of Object.entries(opts)) {
      const el = document.createElement("div");
      el.className = "menuopt";
      el.innerHTML = `<span>▸</span><span>${esc(
        typeof label === "string" ? label : pretty(key))}</span>`;
      el.onclick = () => submitFlow({ next_step_id: key });
      body.append(el);
    }
    next.style.display = "none";
    return;
  }

  // type === "form"
  next.style.display = "";
  next.textContent = flow.last_step === false ? "Next →" : "Save helper";
  body.innerHTML = "";
  if (flow.step_id && flow.step_id !== "init" && flow.step_id !== "user")
    body.innerHTML = `<div class="flowdesc">Step: ${
      esc(pretty(flow.step_id))}</div>`;
  const schema = flow.data_schema || [];
  if (!schema.length)
    body.innerHTML += `<div class="flowdesc">No options on this step —
      just continue.</div>`;
  for (const fieldDef of schema)
    body.appendChild(renderFlowField(fieldDef, flow.errors || {}));

  next.onclick = () => {
    let data;
    try { data = collectFlow(schema); }
    catch (e) { flowError(e.message); return; }
    submitFlow(data);
  };
}

async function submitFlow(data) {
  const path = (FLOW.mode === "options" ? "/options/" : "/flow/") + FLOW.id;
  try {
    const d = await api("POST", path, data);
    renderFlowStep(d.flow);
  } catch (e) { flowError(e.message); }
}

/* ---- flow field rendering (voluptuous-serialized selectors) ---- */

const FIELD_LABELS = {
  name: "Name", entities: "Entities", entity_id: "Source entity",
  hide_members: "Hide member entities", group_type: "Group type",
  all: "All members must be on", type: "Statistic type",
  round_digits: "Round to digits", source: "Source sensor",
  unit_time: "Per unit of time", unit_prefix: "Metric prefix",
  method: "Integration method", cycle: "Reset cycle",
  tariffs: "Tariffs", after_time: "On at", before_time: "Off at",
  invert: "Invert direction", sample_duration: "Sample window",
  max_samples: "Max samples", min_gradient: "Minimum gradient",
  min_samples: "Min samples", state_characteristic: "Characteristic",
  sampling_size: "Sampling size", max_age: "Max age of samples",
  lower: "Lower limit", upper: "Upper limit", hysteresis: "Hysteresis",
  time_window: "Time window", target_domain: "Show it as",
  device_class: "Device class", state_class: "State class",
  unit_of_measurement: "Unit", value_template: "State template",
  minimum: "Minimum", maximum: "Maximum", precision: "Precision",
  offset: "Offset", periodically_resetting: "Source resets periodically",
  net_consumption: "Net consumption", delta_values: "Source is a delta",
  always_available: "Always available", ignore_non_numeric:
  "Ignore non-numeric members",
};

function flowLabel(name) { return FIELD_LABELS[name] || pretty(name); }

function selectorOf(f) {
  if (f.selector) return f.selector;
  // legacy serialization fallback
  const t = f.type;
  if (t === "boolean") return { boolean: {} };
  if (t === "integer" || t === "float") return { number: {} };
  if (t === "select" && f.options)
    return { select: { options: f.options } };
  return { text: {} };
}

function renderFlowField(f, errors) {
  const wrap = document.createElement("div");
  wrap.dataset.flowfield = f.name;
  const sel = selectorOf(f);
  const kind = Object.keys(sel)[0];
  const cfg = sel[kind] || {};
  const def = f.description?.suggested_value ?? f.default;
  const lab = document.createElement("label");
  lab.append(flowLabel(f.name));
  if (f.required) {
    const r = document.createElement("span");
    r.className = "req"; r.textContent = "*"; lab.append(r);
  }

  const put = (el) => { wrap.append(lab, el); };

  if (kind === "boolean") {
    const row = document.createElement("div");
    row.className = "boolrow";
    const bl = document.createElement("span");
    bl.className = "bl"; bl.textContent = flowLabel(f.name);
    const sw = document.createElement("div");
    sw.className = "sw" + (def ? " on" : "");
    sw.onclick = () => sw.classList.toggle("on");
    sw.dataset.k = "bool";
    row.append(bl, sw); wrap.append(row);

  } else if (kind === "select") {
    let opts = cfg.options || [];
    opts = opts.map((o) => typeof o === "object"
      ? o : { value: o, label: pretty(String(o)) });
    if (cfg.multiple) {
      const box = document.createElement("div");
      box.dataset.k = "multiselect";
      for (const o of opts) {
        const row = document.createElement("div");
        row.className = "boolrow";
        const bl = document.createElement("span");
        bl.className = "bl"; bl.textContent = o.label ?? o.value;
        const sw = document.createElement("div");
        sw.className = "sw" +
          ((Array.isArray(def) && def.includes(o.value)) ? " on" : "");
        sw.dataset.value = o.value;
        sw.onclick = () => sw.classList.toggle("on");
        row.append(bl, sw); box.append(row);
      }
      put(box);
    } else {
      const s = document.createElement("select");
      s.dataset.k = "select";
      if (!f.required) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = "— none —";
        s.append(o);
      }
      for (const o of opts) {
        const op = document.createElement("option");
        op.value = o.value; op.textContent = o.label ?? o.value;
        if (def === o.value) op.selected = true;
        s.append(op);
      }
      put(s);
    }

  } else if (kind === "entity") {
    put(entityPicker(cfg, def));

  } else if (kind === "number") {
    const i = document.createElement("input");
    i.type = "number"; i.dataset.k = "number"; i.step = cfg.step ?? "any";
    if (cfg.min !== undefined) i.min = cfg.min;
    if (cfg.max !== undefined) i.max = cfg.max;
    if (def !== undefined && def !== null) i.value = def;
    if (cfg.unit_of_measurement) i.placeholder = cfg.unit_of_measurement;
    put(i);

  } else if (kind === "template") {
    const t = document.createElement("textarea");
    t.className = "mono"; t.dataset.k = "text";
    t.placeholder = "{{ states('sensor.example') }}";
    if (def) t.value = def;
    put(t);

  } else if (kind === "time") {
    const i = document.createElement("input");
    i.type = "time"; i.step = 1; i.dataset.k = "time";
    if (def) i.value = String(def).slice(0, 8);
    put(i);

  } else if (kind === "duration") {
    const row = document.createElement("div");
    row.className = "durrow"; row.dataset.k = "durobj";
    const dv = def || {};
    const mk = (v, l) => {
      const i = document.createElement("input");
      i.type = "number"; i.min = 0; i.value = v || 0;
      const sp = document.createElement("span"); sp.textContent = l;
      row.append(i, sp);
    };
    mk(dv.hours, "h"); mk(dv.minutes, "m"); mk(dv.seconds, "s");
    put(row);

  } else if (kind === "object") {
    const t = document.createElement("textarea");
    t.className = "mono"; t.dataset.k = "json";
    if (def !== undefined) t.value = JSON.stringify(def, null, 2);
    put(t);

  } else if (kind === "icon") {
    const i = document.createElement("input");
    i.type = "text"; i.dataset.k = "text"; i.placeholder = "mdi:…";
    if (def) i.value = def;
    put(i);

  } else {   // text, state, attribute, anything unknown
    const multiline = kind === "text" && cfg.multiline;
    const i = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) i.type = cfg.type === "password" ? "password" : "text";
    else i.className = "mono";
    i.dataset.k = "text";
    if (def !== undefined && def !== null) i.value = def;
    put(i);
  }

  if (errors[f.name]) {
    const e = document.createElement("div");
    e.className = "fielderr";
    e.textContent = "⚠ " + pretty(String(errors[f.name]));
    wrap.append(e);
  }
  return wrap;
}

function collectFlow(schema) {
  const out = {};
  for (const f of schema) {
    const wrap = $(`[data-flowfield="${CSS.escape(f.name)}"]`, $("#flowBody"));
    if (!wrap) continue;
    const el = $("[data-k]", wrap);
    if (!el) continue;
    const k = el.dataset.k;
    let v;
    if (k === "bool") v = el.classList.contains("on");
    else if (k === "multiselect")
      v = $$(".sw.on", el).map((s) => s.dataset.value);
    else if (k === "number") v = el.value === "" ? undefined : +el.value;
    else if (k === "time") v = el.value || undefined;
    else if (k === "durobj") {
      const [h, m, s] = $$("input", el).map((i) => parseInt(i.value) || 0);
      v = { hours: h, minutes: m, seconds: s };
    } else if (k === "json") {
      if (el.value.trim()) {
        try { v = JSON.parse(el.value); }
        catch (e) { throw new Error(`"${flowLabel(f.name)}": invalid JSON`); }
      }
    } else if (k === "entity-multi") v = el._get();
    else if (k === "entity") v = el._get();
    else v = el.value === "" ? undefined : el.value;

    if (f.required && (v === undefined || v === "" ||
        (Array.isArray(v) && !v.length)))
      throw new Error(`"${flowLabel(f.name)}" is required.`);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

/* ---- entity picker (single + multiple) ---- */

async function loadEntities() {
  if (ENTITIES) return ENTITIES;
  try {
    const r = await fetch("/api/admin/entities");
    const d = await r.json();
    ENTITIES = d.entities || [];
  } catch (e) { ENTITIES = []; }
  return ENTITIES;
}

function domainsOf(cfg) {
  let d = cfg.domain ?? cfg.filter?.domain ??
    (Array.isArray(cfg.filter) ? cfg.filter.map((x) => x.domain) : undefined);
  if (!d) return null;
  return (Array.isArray(d) ? d : [d]).flat().filter(Boolean);
}

function entityPicker(cfg, def) {
  const multiple = !!cfg.multiple;
  const domains = domainsOf(cfg);
  const wrap = document.createElement("div");
  wrap.className = "combo-wrap";
  wrap.dataset.k = multiple ? "entity-multi" : "entity";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search entities…" +
    (domains ? ` (${domains.join(", ")})` : "");
  const list = document.createElement("div");
  list.className = "combo-list";
  const chips = document.createElement("div");
  chips.className = "chipsline";
  let selected = multiple
    ? (Array.isArray(def) ? [...def] : def ? [def] : [])
    : (def || "");

  if (!multiple && selected) input.value = selected;

  function renderChips() {
    chips.innerHTML = "";
    if (!multiple) return;
    for (const eid of selected) {
      const c = document.createElement("span");
      c.className = "echip";
      c.innerHTML = `<span>${esc(eid)}</span>`;
      const rm = document.createElement("button");
      rm.textContent = "✕";
      rm.onclick = () => { selected = selected.filter((x) => x !== eid);
                           renderChips(); };
      c.append(rm); chips.append(c);
    }
  }
  renderChips();

  async function search() {
    const all = await loadEntities();
    const q = input.value.toLowerCase();
    const hits = all.filter((e) =>
      (!domains || domains.includes(e.domain)) &&
      (!q || e.id.toLowerCase().includes(q) ||
       e.name.toLowerCase().includes(q)) &&
      !(multiple && selected.includes(e.id))).slice(0, 40);
    list.innerHTML = hits.map((e) =>
      `<div class="combo-it" data-id="${esc(e.id)}">
        <span class="cn">${esc(e.name)}</span>
        <span class="cid">${esc(e.id)}</span></div>`).join("") ||
      `<div class="combo-it">no matches</div>`;
    list.classList.add("open");
    $$(".combo-it[data-id]", list).forEach((it) => it.onclick = () => {
      if (multiple) { selected.push(it.dataset.id); input.value = "";
                      renderChips(); }
      else { selected = it.dataset.id; input.value = selected; }
      list.classList.remove("open");
    });
  }
  input.oninput = search;
  input.onfocus = search;
  input.addEventListener("blur", () =>
    setTimeout(() => list.classList.remove("open"), 180));
  if (!multiple)
    input.addEventListener("change", () => { selected = input.value.trim(); });

  wrap._get = () => multiple ? selected : (input.value.trim() || undefined);
  wrap.append(input, list, chips);
  return wrap;
}

/* ------------------------------------------------------------ bulk */

$("#bulkToggle").onclick = () => {
  document.body.classList.toggle("bulk");
  $("#bulkToggle").classList.toggle("on");
  if (!document.body.classList.contains("bulk")) {
    SELECTED.clear(); renderAll();
  }
  updateBulkbar();
};

function updateBulkbar() {
  $("#bulkCount").textContent = SELECTED.size + " selected";
  $("#bulkDelete").disabled = !SELECTED.size;
  $("#bulkExport").disabled = !SELECTED.size;
}

const selectedHelpers = () => ALL.filter((h) => SELECTED.has(keyOf(h)));

$("#bulkAll").onclick = () => {
  visible().forEach((h) => SELECTED.add(keyOf(h)));
  renderAll();
};
$("#bulkNone").onclick = () => { SELECTED.clear(); renderAll(); };
$("#bulkDelete").onclick = () => {
  if (SELECTED.size) confirmDelete(selectedHelpers());
};

$("#bulkExport").onclick = () => {
  const items = selectedHelpers().filter((h) => h.kind === "storage");
  const skipped = SELECTED.size - items.length;
  if (!items.length) {
    toast("Only basic (storage) helpers can be exported.", true);
    return;
  }
  const payload = {
    app: "advance-tools-helper-maker", version: 1,
    exported: new Date().toISOString(),
    helpers: items.map((h) => {
      const cfg = { ...h.config }; delete cfg.id;
      return { domain: h.domain, config: cfg };
    }),
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)],
                                        { type: "application/json" }));
  a.download = "helpers-export.json";
  a.click();
  toast(`Exported ${items.length} helper(s)` +
        (skipped ? ` — ${skipped} advanced helper(s) skipped` : ""));
};

$("#bulkImport").onclick = () => $("#importFile").click();
$("#importFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch (err) { toast("Not a valid JSON file", true); return; }
  const items = payload.helpers || [];
  if (!items.length) { toast("No helpers found in this file", true); return; }
  let ok = 0, fail = 0;
  for (const it of items) {
    try {
      const cfg = { ...it.config }; delete cfg.id;
      await api("POST", `/storage/${it.domain}`, cfg);
      ok++;
    } catch (err) { fail++; }
  }
  toast(`Imported ${ok} helper(s)` + (fail ? `, ${fail} failed` : ""), !!fail);
  load();
};

/* ------------------------------------------------------------ toolbar events */

$("#search").oninput = (e) => { SEARCH = e.target.value.trim(); renderAll(); };
$("#sort").onchange = (e) => { SORT = e.target.value; renderAll(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.matches("input, textarea, select")) {
    e.preventDefault(); $("#search").focus();
  }
  if (e.key === "Escape")
    $$(".modal.open").forEach((m) => closeModal(m));
});

/* ------------------------------------------------------------ boot */

/* State poll: stops while hidden/backgrounded, resumes with an immediate
   refresh, never overlaps itself, and backs off if the backend goes away.
   Started after the first load() so the very first poll has a helper list to
   ask about, exactly as before. */
const startStatePoll = () => PMPoll.every(4000, poll, { el: document.body, name: "states" });
load().then(startStatePoll, startStatePoll);
/* end of app.js */
