/* Announce & Intercom — frontend logic.
 * Talks to /api/tools/announce_center/* (tool.py).
 */
"use strict";

const API = "/api/tools/announce_center";
const $  = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let PLAYERS = [];          // live media_player list from /setup
let ENGINES = [];
let NOTIFY = [];
let CONFIG = { default_players: [], default_engine: null, quick_messages: [] };
let HISTORY = [];
let CONNECTED = false;
let PUBLIC_BASE = "";

let SELECTED = new Set();      // selected speaker entity_ids
let NOTIFY_SEL = new Set();    // selected notify service ids
let FIRST_LOAD = true;
let SENDING = false;
let SM = null;                 // staged settings while the modal is open

const VOL_TIMERS = {};         // entity_id -> debounce timer
const VOL_LOCAL = {};          // entity_id -> ts of last local slider change
let MASTER_TIMER = null;

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
  const d = Date.now() / 1000 - ts;
  if (isNaN(d) || d < 0) return "";
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " h ago";
  return Math.floor(d / 86400) + " d ago";
}

function playerName(eid) {
  const p = PLAYERS.find((x) => x.entity_id === eid);
  if (p) return p.name;
  if (eid.startsWith("notify.")) {
    const svc = eid.slice(7);
    const n = NOTIFY.find((x) => x.id === svc);
    return "📱 " + (n ? n.name : svc);
  }
  return eid;
}

const VOLUME_SET = 4;   // media_player supported_features bit

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
  const s = document.createElement("span");
  s.className = "hint"; s.textContent = "?"; s._hint = hint;
  return s;
}

const HINTS = {
  msg: { t: "The announcement",
    b: "Whatever you type here is converted to speech and played on the " +
       "selected speakers. Emojis are fine in phone pings but are skipped " +
       "by most TTS voices.",
    ex: "Dinner is ready! Come downstairs." },
  spk: { t: "Speakers = media_player entities",
    b: "Every device Home Assistant can play audio on (Nest, Sonos, TVs, " +
       "Alexa via integrations…) shows up here. Tap tiles to choose where " +
       "the announcement plays; the badge shows the live state." },
  mvol: { t: "Master volume",
    b: "Drag to set the same volume on every SELECTED speaker right away — " +
       "handy before a loud announcement. Each tile also has its own " +
       "slider for a single room." },
  eng: { t: "TTS engine",
    b: "The voice service that turns text into audio. Add one for free in " +
       "HA: Settings → Devices & Services → Add integration → " +
       "“Google Translate text-to-speech”. Nabu Casa Cloud and " +
       "Piper (local) sound even better. See 📖 Learn." },
  ph: { t: "Phone notifications",
    b: "Sends the same message as a push notification via HA's notify " +
       "services (Companion app devices show as mobile_app_…). Works with " +
       "or without speakers — great for family members who are out." },
  hist: { t: "History",
    b: "Your last announcements. Tap ↻ to re-send one — it selects the " +
       "same speakers and sends with the current engine. Announcements " +
       "made from dashboards show the dashboard user's name." },
  dash: { t: "Dashboard intercom",
    b: "When enabled, logged-in dashboard users can send announcements and " +
       "record voice clips from their tablets. Speakers download voice " +
       "clips from the base URL shown — it comes from the add-on's DOMAIN " +
       "option (or this page's address) and must be reachable by the " +
       "speakers. Note: browsers only allow voice recording on secure " +
       "pages, so tablets should use the https domain — plain-HTTP tablets " +
       "still get text and quick-message TTS." },
};

/* ------------------------------------------------------------ modals */

$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]"))
      m.classList.remove("open");
  });
});

/* ------------------------------------------------------------ load + poll */

async function load(first) {
  let d;
  try {
    d = await api("GET", "/setup");
  } catch (e) {
    if (first) toast("Failed to load: " + e.message, true);
    return;
  }
  CONNECTED = d.connected;
  PLAYERS = d.players || [];
  ENGINES = d.engines || [];
  NOTIFY = d.notify_services || [];
  CONFIG = d.config || CONFIG;
  HISTORY = d.history || [];
  PUBLIC_BASE = d.public_base || "";
  $("#dashBase").textContent = PUBLIC_BASE
    ? PUBLIC_BASE + "/api/tools/announce_center/clip/…" : "—";

  const cs = $("#connStat");
  cs.innerHTML = CONNECTED
    ? '<span class="dot ok"></span>connected to Home Assistant'
    : '<span class="dot"></span>not connected to Home Assistant';

  if (FIRST_LOAD) {
    FIRST_LOAD = false;
    // apply saved defaults — only speakers that exist AND are ready to
    // play right now (off / unavailable ones would just fail the send)
    (CONFIG.default_players || []).forEach((p) => {
      const pl = PLAYERS.find((x) => x.entity_id === p);
      if (pl && isReady(pl)) SELECTED.add(p);
    });
    renderEngines();
    if (CONFIG.default_engine &&
        ENGINES.some((e) => e.id === CONFIG.default_engine))
      $("#engine").value = CONFIG.default_engine;
    renderVoices();
    attachHints();
  } else {
    renderEngines();   // keeps the current choice when list is unchanged
    if ($("#voiceRow").childElementCount === 0) renderVoices();
  }
  renderQuick();
  renderSpeakers();
  renderNotify();
  renderHistory();
}

function attachHints() {
  $("#msgHint").replaceChildren(hintEl(HINTS.msg));
  $("#spkHint").replaceChildren(hintEl(HINTS.spk));
  $("#mvolHint").replaceChildren(hintEl(HINTS.mvol));
  $("#engHint").replaceChildren(hintEl(HINTS.eng));
  $("#phHint").replaceChildren(hintEl(HINTS.ph));
  $("#histHint").replaceChildren(hintEl(HINTS.hist));
  $("#dashHint").replaceChildren(hintEl(HINTS.dash));
}

setInterval(() => {
  if (!SENDING && !$("#settingsModal").classList.contains("open"))
    load(false);
}, 10000);

/* ------------------------------------------------------------ quick chips */

function renderQuick() {
  const box = $("#quickChips");
  box.replaceChildren();
  (CONFIG.quick_messages || []).forEach((m) => {
    const c = document.createElement("div");
    c.className = "qchip";
    c.innerHTML = `<span>${esc(m)}</span>`;
    c.addEventListener("click", () => {
      $("#msg").value = m;
      c.classList.remove("pop");
      void c.offsetWidth;          // restart the animation
      c.classList.add("pop");
    });
    box.appendChild(c);
  });
  if (!(CONFIG.quick_messages || []).length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.style.padding = "8px";
    e.textContent = "No quick messages yet — add some in ⚙ Settings.";
    box.appendChild(e);
  }
}

/* ------------------------------------------------------------ speakers */

/* speaker readiness: dead = gone from HA, off = powered down (needs a
 * manual wake before it can play anything) */
const isDead = (s) => s === "unavailable" || s === "unknown" || !s;
const isOff = (s) => s === "off" || s === "standby";
const isReady = (p) => !isDead(p.state) && !isOff(p.state);

function stateBadge(state) {
  const cls = state === "playing" ? "playing"
    : (state === "unavailable" || state === "unknown") ? "unavailable"
    : (state === "off" || state === "standby") ? "off" : "on";
  return `<span class="badge ${cls}">${esc(state || "?")}</span>`;
}

function renderSpeakers() {
  const grid = $("#speakerGrid");
  grid.replaceChildren();
  if (!PLAYERS.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = CONNECTED
      ? "No speakers found.<br>Speakers are <b>media_player</b> entities — " +
        "Google/Nest speakers, Sonos, TVs, Alexa (via an integration)… " +
        "Add one in HA under <b>Settings → Devices &amp; Services</b> and " +
        "it appears here automatically."
      : "Waiting for the Home Assistant connection…";
    grid.appendChild(e);
    return;
  }
  // drop selections for players that disappeared or died
  SELECTED.forEach((eid) => {
    const pl = PLAYERS.find((p) => p.entity_id === eid);
    if (!pl || isDead(pl.state)) SELECTED.delete(eid);
  });

  // ready speakers first, then off, then unavailable
  const rank = (p) => (isReady(p) ? 0 : isOff(p.state) ? 1 : 2);
  const ordered = [...PLAYERS].sort((a, b) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name));

  for (const p of ordered) {
    const dead = isDead(p.state), off = isOff(p.state);
    const t = document.createElement("div");
    t.className = "tile" + (SELECTED.has(p.entity_id) ? " sel" : "") +
      (dead ? " dead" : off ? " offst" : "");
    t.dataset.eid = p.entity_id;
    const canVol = !dead && !off &&
      (p.supported_features & VOLUME_SET) !== 0;
    const vol = typeof p.volume_level === "number" ? p.volume_level : 0.5;
    t.innerHTML =
      `<div class="check">✓</div>
       <div class="trow"><span class="ticon">${dead ? "🔇" : "🔊"}</span>
         <span class="tname" title="${esc(p.entity_id)}">${esc(p.name)}</span>
       </div>
       ${stateBadge(p.state)}` +
      (dead
        ? `<div class="tilenote">not in Home Assistant anymore — clean it
             up with Entity Doctor</div>`
        : off
          ? `<div class="tilenote">off — turn it on first, then it can
               speak</div>`
          : "") +
      (canVol
        ? `<div class="volrow"><span class="vi">🔉</span>
             <input type="range" class="vol" min="0" max="1" step="0.01"
                    value="${vol}"></div>`
        : "");
    t.addEventListener("click", (e) => {
      if (e.target.closest("input")) return;      // slider, not selection
      if (dead) {
        toast(p.name + " is unavailable — it can't play anything. " +
              "Remove it with Entity Doctor if it's a leftover.", true);
        return;
      }
      if (SELECTED.has(p.entity_id)) SELECTED.delete(p.entity_id);
      else {
        SELECTED.add(p.entity_id);
        if (off) toast(p.name + " is off — the announcement will only " +
                       "play if it wakes up.", true);
      }
      t.classList.toggle("sel", SELECTED.has(p.entity_id));
    });
    const slider = $("input.vol", t);
    if (slider) {
      // keep freshly-dragged values from being overwritten by the poll
      const loc = VOL_LOCAL[p.entity_id];
      if (loc && Date.now() - loc.ts < 4000) slider.value = loc.v;
      slider.addEventListener("input", () => {
        const v = parseFloat(slider.value);
        VOL_LOCAL[p.entity_id] = { ts: Date.now(), v };
        setVolumeDebounced(p.entity_id, v);
      });
    }
    grid.appendChild(t);
  }
}

function setVolumeDebounced(eid, vol) {
  clearTimeout(VOL_TIMERS[eid]);
  VOL_TIMERS[eid] = setTimeout(async () => {
    try {
      await api("POST", "/volume", { entity_id: eid, volume_level: vol });
    } catch (e) {
      toast(playerName(eid) + ": " + e.message, true);
    }
  }, 300);
}

$("#selAll").addEventListener("click", () => {
  const skipped = PLAYERS.length -
    PLAYERS.filter(isReady).length;
  PLAYERS.filter(isReady).forEach((p) => SELECTED.add(p.entity_id));
  renderSpeakers();
  if (skipped) toast(skipped + " speaker(s) skipped (off or unavailable)");
});
$("#selNone").addEventListener("click", () => {
  SELECTED.clear();
  renderSpeakers();
});

/* master volume */
const masterVol = $("#masterVol");
masterVol.addEventListener("input", () => {
  const v = parseFloat(masterVol.value);
  $("#masterVolVal").textContent = Math.round(v * 100) + "%";
  const targets = SELECTED.size
    ? [...SELECTED]
    : PLAYERS.map((p) => p.entity_id);
  // move the visible tile sliders along
  targets.forEach((eid) => {
    const s = $(`.tile[data-eid="${CSS.escape(eid)}"] input.vol`);
    if (s) { s.value = v; VOL_LOCAL[eid] = { ts: Date.now(), v }; }
  });
  clearTimeout(MASTER_TIMER);
  MASTER_TIMER = setTimeout(() => {
    targets.forEach((eid) => setVolumeDebounced(eid, v));
  }, 250);
});

/* ------------------------------------------------------------ engines */

let ENGINE_SIG = "";
function renderEngines() {
  const sel = $("#engine");
  const sig = JSON.stringify(ENGINES.map((e) => e.id));
  const empty = !ENGINES.length;
  $("#engineEmpty").style.display = empty ? "" : "none";
  sel.style.display = empty ? "none" : "";
  if (sig === ENGINE_SIG) return;      // keep the user's current choice
  ENGINE_SIG = sig;
  const prev = sel.value;
  sel.replaceChildren();
  ENGINES.forEach((e) => {
    const o = document.createElement("option");
    o.value = e.id; o.textContent = e.name;
    sel.appendChild(o);
  });
  if (prev && ENGINES.some((e) => e.id === prev)) sel.value = prev;
}

/* ---- voice / language presets per engine family ----
 * Passed to tts.speak as "language": Edge TTS accepts full voice names,
 * Google Translate accepts 2-letter language codes. */
function voicePresets(engineId) {
  const id = (engineId || "").toLowerCase();
  if (id.includes("edge")) return [
    { label: "Engine default", v: null },
    { label: "🇮🇷 فارسی — Farid", v: "fa-IR-FaridNeural" },
    { label: "🇮🇷 فارسی — Dilara", v: "fa-IR-DilaraNeural" },
    { label: "🇺🇸 English — Jenny", v: "en-US-JennyNeural" },
    { label: "🇺🇸 English — Guy", v: "en-US-GuyNeural" },
    { label: "🇬🇧 English — Sonia", v: "en-GB-SoniaNeural" },
  ];
  if (id.includes("google_translate")) return [
    { label: "Engine default", v: null },
    { label: "🇺🇸 English", v: "en" },
    { label: "🇩🇪 Deutsch", v: "de" },
    { label: "🇫🇷 Français", v: "fr" },
    { label: "🇪🇸 Español", v: "es" },
    { label: "🇸🇦 العربية", v: "ar" },
    { label: "🇹🇷 Türkçe", v: "tr" },
  ];
  return [{ label: "Engine default", v: null }];
}

let VOICE = null;    // language/voice sent with the announcement
function renderVoices() {
  const row = $("#voiceRow");
  const eng = $("#engine").value || "";
  const presets = voicePresets(eng);
  if (presets.length <= 1 || !ENGINES.length) {
    row.style.display = "none"; VOICE = null; return;
  }
  row.style.display = "";
  let raw = null;
  try { raw = localStorage.getItem("ac_voice_" + eng); } catch (e) {}
  let saved = raw === "" ? null : raw;
  if (raw === null) {
    // never chosen before — Edge ships with a Chinese factory default,
    // so start on English instead of "Engine default"
    saved = eng.toLowerCase().includes("edge") ? "en-US-JennyNeural" : null;
  } else if (!presets.some((p) => (p.v || "") === (saved || ""))) {
    saved = null;
  }
  VOICE = saved;
  row.replaceChildren();
  for (const p of presets) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vchip" + ((p.v || "") === (VOICE || "") ? " on" : "");
    b.textContent = p.label;
    b.addEventListener("click", () => {
      VOICE = p.v;
      try { localStorage.setItem("ac_voice_" + eng, p.v || ""); }
      catch (e) { /* private mode */ }
      renderVoices();
    });
    row.appendChild(b);
  }
}
$("#engine").addEventListener("change", renderVoices);

/* ------------------------------------------------------------ notify */

function renderNotify() {
  const box = $("#notifyChips");
  box.replaceChildren();
  if (!NOTIFY.length) {
    const e = document.createElement("div");
    e.className = "empty"; e.style.padding = "6px";
    e.textContent = "No notify services found — install the HA Companion " +
      "app on a phone to get one.";
    box.appendChild(e);
    return;
  }
  NOTIFY_SEL.forEach((id) => {
    if (!NOTIFY.some((n) => n.id === id)) NOTIFY_SEL.delete(id);
  });
  NOTIFY.forEach((n) => {
    const c = document.createElement("div");
    c.className = "nchip" + (NOTIFY_SEL.has(n.id) ? " on" : "");
    c.textContent = (n.mobile ? "📱 " : "🔔 ") + n.name;
    c.title = "notify." + n.id;
    c.addEventListener("click", () => {
      if (NOTIFY_SEL.has(n.id)) NOTIFY_SEL.delete(n.id);
      else NOTIFY_SEL.add(n.id);
      c.classList.toggle("on", NOTIFY_SEL.has(n.id));
    });
    box.appendChild(c);
  });
}

/* ------------------------------------------------------------ history */

function renderHistory() {
  const box = $("#history");
  box.replaceChildren();
  if (!HISTORY.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No announcements yet — your sent messages will show " +
      "up here with a one-tap re-send.";
    box.appendChild(e);
    return;
  }
  HISTORY.forEach((h) => {
    const row = document.createElement("div");
    row.className = "hitem";
    const targets = (h.players || []).length
      ? (h.players.length === 1 ? playerName(h.players[0])
         : h.players.length + " speakers")
      : "phones only";
    const src = h.source && h.source !== "admin"
      ? "📟 " + h.source : "🛠 admin";
    row.innerHTML =
      `<span class="hmark">${h.ok ? "✅" : "⚠️"}</span>
       <span class="hmsg" title="${esc(h.message)}">${esc(h.message)}</span>
       <span class="hmeta">${esc(targets)}<br>${esc(src)} · ${esc(rel(h.ts))}</span>`;
    const btn = document.createElement("button");
    btn.className = "iconbtn"; btn.textContent = "↻";
    btn.title = "Re-send this announcement";
    btn.addEventListener("click", () => resend(h));
    row.appendChild(btn);
    box.appendChild(row);
  });
}

function resend(h) {
  $("#msg").value = h.message;
  SELECTED = new Set((h.players || []).filter((p) => {
    const pl = PLAYERS.find((x) => x.entity_id === p);
    return pl && !isDead(pl.state);
  }));
  renderSpeakers();
  send();
}

/* ------------------------------------------------------------ send */

const sendBtn = $("#sendBtn");

function ripple(e) {
  const r = sendBtn.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement("span");
  s.className = "ripple";
  s.style.width = s.style.height = d + "px";
  s.style.left = ((e ? e.clientX - r.left : r.width / 2) - d / 2) + "px";
  s.style.top = ((e ? e.clientY - r.top : r.height / 2) - d / 2) + "px";
  sendBtn.appendChild(s);
  setTimeout(() => s.remove(), 600);
}

async function send(clickEvent) {
  if (SENDING) return;
  const message = $("#msg").value.trim();
  const players = [...SELECTED];
  const notify = [...NOTIFY_SEL];
  const engine = $("#engine").value || null;

  if (!message) { toast("Type a message first ✍️", true); return; }
  if (!players.length && !notify.length) {
    toast("Pick at least one speaker or phone 🔊", true); return;
  }
  if (players.length && !engine) {
    toast("No TTS engine available — open 📖 Learn to add one", true);
    return;
  }

  SENDING = true;
  sendBtn.disabled = true;
  const label = sendBtn.textContent;
  sendBtn.textContent = "⏳ Sending…";
  ripple(clickEvent);
  try {
    const d = await api("POST", "/announce",
      { message, players, engine, also_notify: notify,
        language: VOICE || undefined });
    const bad = (d.results || []).filter((r) => !r.ok);
    if (!bad.length) {
      sendBtn.classList.remove("boom");
      void sendBtn.offsetWidth;
      sendBtn.classList.add("boom");
      toast("✅ Announcement sent");
    } else {
      bad.slice(0, 4).forEach((r) =>
        toast(`⚠️ ${playerName(r.target)}: ${r.error || "failed"}`, true));
      if (bad.length < (d.results || []).length)
        toast("Sent to the remaining targets ✅");
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    SENDING = false;
    sendBtn.disabled = false;
    sendBtn.textContent = label;
    load(false);
  }
}

sendBtn.addEventListener("click", (e) => send(e));
$("#msg").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(); }
});

/* ------------------------------------------------------------ settings */

$("#settingsBtn").addEventListener("click", () => {
  SM = {
    quick: [...(CONFIG.quick_messages || [])],
    dp: [...(CONFIG.default_players || [])],
    de: CONFIG.default_engine || null,
    dash: CONFIG.allow_dashboards !== false,
  };
  renderQmList();
  renderDefSummary();
  renderDashToggle();
  $("#settingsModal").classList.add("open");
});

function renderDashToggle() {
  const b = $("#dashToggle");
  b.textContent = SM.dash ? "✅ Enabled" : "🚫 Disabled";
  b.title = "Click to " + (SM.dash ? "disable" : "enable") +
    " announcements from dashboards";
}

$("#dashToggle").addEventListener("click", () => {
  SM.dash = !SM.dash;
  renderDashToggle();
});

function renderQmList() {
  const box = $("#qmList");
  box.replaceChildren();
  SM.quick.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "qrow";
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = m; inp.maxLength = 200;
    inp.addEventListener("input", () => { SM.quick[i] = inp.value; });
    row.appendChild(inp);
    const mk = (txt, title, fn) => {
      const b = document.createElement("button");
      b.className = "iconbtn"; b.textContent = txt; b.title = title;
      b.addEventListener("click", fn);
      row.appendChild(b);
    };
    mk("↑", "Move up", () => {
      if (i > 0) {
        [SM.quick[i - 1], SM.quick[i]] = [SM.quick[i], SM.quick[i - 1]];
        renderQmList();
      }
    });
    mk("↓", "Move down", () => {
      if (i < SM.quick.length - 1) {
        [SM.quick[i + 1], SM.quick[i]] = [SM.quick[i], SM.quick[i + 1]];
        renderQmList();
      }
    });
    mk("✕", "Remove", () => { SM.quick.splice(i, 1); renderQmList(); });
    box.appendChild(row);
  });
}

$("#qmAdd").addEventListener("click", () => {
  if (SM.quick.length >= 30) { toast("Max 30 quick messages", true); return; }
  SM.quick.push("");
  renderQmList();
  const inputs = $$("#qmList input");
  if (inputs.length) inputs[inputs.length - 1].focus();
});

function renderDefSummary() {
  const el = $("#defSummary");
  const eng = ENGINES.find((e) => e.id === SM.de);
  if (!SM.dp.length && !SM.de) {
    el.textContent = "No defaults saved.";
  } else {
    el.innerHTML = `Default speakers: <b>${SM.dp.length || "none"}</b> · ` +
      `Default engine: <b>${esc(eng ? eng.name : (SM.de || "none"))}</b>`;
  }
}

$("#defCapture").addEventListener("click", () => {
  SM.dp = [...SELECTED];
  SM.de = $("#engine").value || null;
  renderDefSummary();
  toast("Captured current selection 📌");
});
$("#defClear").addEventListener("click", () => {
  SM.dp = []; SM.de = null;
  renderDefSummary();
});

$("#settingsSave").addEventListener("click", async () => {
  try {
    const d = await api("POST", "/config", {
      quick_messages: SM.quick.map((m) => m.trim()).filter(Boolean),
      default_players: SM.dp,
      default_engine: SM.de,
      allow_dashboards: SM.dash,
    });
    CONFIG = { ...CONFIG, ...(d.config || {}) };
    renderQuick();
    $("#settingsModal").classList.remove("open");
    toast("💾 Settings saved");
  } catch (e) {
    toast(e.message, true);
  }
});

/* ------------------------------------------------------------ learn */

$("#learnBtn").addEventListener("click", () =>
  $("#learnModal").classList.add("open"));

/* ------------------------------------------------------------ boot */

load(true);
