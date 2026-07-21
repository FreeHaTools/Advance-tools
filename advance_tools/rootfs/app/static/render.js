/* Advance Tools — runtime renderer v1.0 (packs, all device types) */
(function () {
'use strict';
const slug = document.currentScript.dataset.dashboard;
const $ = s => document.querySelector(s);

/* ---------------- shared poller (static/poll.js) --------------------------
   The rendered dashboard page loads only this file, so we pull poll.js in
   ourselves rather than relying on a <script> tag. Everything that wants to
   poll goes through atEvery(), which hands the call straight to PMPoll when it
   is ready and otherwise queues it until the script lands (a few ms later).
   NOTE: live entity states arrive over the WebSocket in panel.js — that path
   is untouched. PMPoll only governs the HTTP pollers below. */
const atPollQueue = [];

(function loadPollJs() {
  if (window.PMPoll) return;
  const s = document.createElement('script');
  s.src = '/static/poll.js';
  s.onload = () => { while (atPollQueue.length) atPollQueue.shift()(); };
  s.onerror = () => {
    // Last resort: keep the dashboard live with plain intervals.
    window.PMPoll = { every(ms, fn) {
      fn();
      const id = setInterval(fn, ms);
      return { stop: () => clearInterval(id), runNow: fn, setInterval() {} };
    } };
    while (atPollQueue.length) atPollQueue.shift()();
  };
  document.head.appendChild(s);
})();

/* Returns a handle immediately, even before poll.js has finished loading. */
function atEvery(ms, fn, opts) {
  const h = { real: null, stopped: false, ms: ms,
    stop() { this.stopped = true; if (this.real) this.real.stop(); },
    runNow() { if (this.real) this.real.runNow(); else fn(); },
    setInterval(m) { this.ms = m; if (this.real) this.real.setInterval(m); } };
  const attach = () => {
    if (h.stopped) return;
    h.real = window.PMPoll.every(h.ms, fn, opts);
  };
  if (window.PMPoll) attach();
  else atPollQueue.push(attach);
  return h;
}

async function boot() {
  const design = await (await fetch(`/api/design?d=${encodeURIComponent(slug)}`)).json();
  window.AT_SET_CUSTOM_PACKS(design.custom_packs || []);
  const th = Object.assign({ accent:'#4f8cff', bg:'#0f1420', card:'#1a2233',
    text:'#e8edf7', radius:14, cardStyle:'glass' }, design.theme);
  const canvas = Object.assign({ w:1280, h:800 }, design.canvas);
  const logout = Object.assign({ hidden:false, zone:'top-right', taps:3 }, design.logout);
  const root = document.documentElement.style;
  root.setProperty('--accent', th.accent); root.setProperty('--bg', th.bg);
  root.setProperty('--card', th.card); root.setProperty('--text', th.text);
  root.setProperty('--radius', th.radius + 'px');
  document.title = design.title || 'Dashboard';
  window.AT_DEFAULT_CS = th.cardStyle;

  const styleEl = document.createElement('style');
  styleEl.textContent = window.AT_WIDGET_CSS + '\n' + window.AT_PACK_CSS() + '\n' +
    window.AT_ALL_STYLES().map(window.AT_COMPILE).join('\n');
  document.head.appendChild(styleEl);

  const cv = $('#cv'), stage = $('#stage');
  cv.style.width = canvas.w + 'px'; cv.style.height = canvas.h + 'px';
  // How the fixed design canvas maps onto the real screen. Everything (text,
  // icons, animations) scales together because we transform the whole stage.
  //   fit     → uniform min-scale: whole design visible, may letterbox (default)
  //   fill    → uniform max-scale: covers the screen, may crop the edges
  //   stretch → independent X/Y scale: fills exactly, may distort the aspect
  const fitMode = canvas.fit || 'fit';
  function fit() {
    const cw = canvas.w, ch = canvas.h;
    if (fitMode === 'stretch') {
      stage.style.transform = `scale(${innerWidth / cw}, ${innerHeight / ch})`;
      stage.style.left = '0px'; stage.style.top = '0px';
      return;
    }
    const s = fitMode === 'fill'
      ? Math.max(innerWidth / cw, innerHeight / ch)
      : Math.min(innerWidth / cw, innerHeight / ch);
    stage.style.transform = `scale(${s})`;
    stage.style.left = Math.round((innerWidth - cw * s) / 2) + 'px';
    stage.style.top = Math.round((innerHeight - ch * s) / 2) + 'px';
  }
  fit(); addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 150));

  let mi = 0;
  for (const w of design.widgets || []) {
    window.AT_MIGRATE_WIDGET(w);
    if (w.x == null) {
      const [dw, dh] = window.AT_DEFAULT_SIZE(w.type, w.skin);
      w.w = dw; w.h = dh;
      w.x = 20 + (mi % 5) * 245; w.y = 20 + Math.floor(mi / 5) * 135; mi++;
    }
  }

  const updaters = [];
  const els = [];
  const Z = { box: 1, line: 2, label: 2 };
  let entrance = 0;

  for (const w of design.widgets || []) {
    const el = document.createElement('div');
    el.className = 'el';
    Object.assign(el.style, { left: w.x + 'px', top: w.y + 'px',
      width: w.w + 'px', height: w.h + 'px', zIndex: Z[w.type] || 3,
      animationDelay: (entrance++ * 0.04) + 's' });
    el.innerHTML = window.AT_MARKUP(w, { name: '', val: '—' });
    cv.appendChild(el);
    els.push({ w, el });
    bind(w, el, updaters);
  }

  /* tabs */
  const tabs = design.tabs || [];
  if (tabs.length) {
    let active = tabs[0].id;
    const bar = $('#tabbar');
    bar.classList.add('show');
    const applyTab = () => els.forEach(({ w, el }) =>
      el.classList.toggle('hidden-by-tab', !!(w.tab && w.tab !== active)));
    const activate = id => {
      const t = [...bar.querySelectorAll('.tb')].find(x => x.dataset.tab === id);
      if (!t) return;
      active = id;
      bar.querySelectorAll('.tb').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      let i = 0;
      els.forEach(({ el }) => { el.style.animation = 'none'; void el.offsetWidth;
        el.style.animation = ''; el.style.animationDelay = (i++ * 0.03) + 's'; });
      applyTab();
    };
    for (const t of tabs) {
      const b = document.createElement('div');
      b.className = 'tb'; b.textContent = t.name; b.dataset.tab = t.id;
      b.onclick = () => activate(t.id);
      bar.appendChild(b);
    }
    bar.querySelector('.tb').classList.add('active');
    applyTab();
    // let navigation buttons switch tabs
    window.__atGotoTab = activate;
  }

  /* open another dashboard as a full-screen overlay (nav button → dashboard) */
  window.__atOpenDash = target => {
    if (document.querySelector('.at-navov')) return;   // one at a time
    const ov = document.createElement('div');
    ov.className = 'at-navov';
    ov.innerHTML =
      `<div class="at-navbar"><button class="at-navback">← Back</button></div>` +
      `<iframe src="/d/${encodeURIComponent(target)}/?embedded=1"></iframe>`;
    ov.querySelector('.at-navback').onclick = () => ov.remove();
    document.body.appendChild(ov);
  };

  /* embedded mode: this dashboard is shown inside another's overlay iframe —
     hide our own logout chrome (the overlay has its own Back). */
  const isEmbedded = new URLSearchParams(location.search).has('embedded');
  if (isEmbedded) logout.hidden = true;

  /* preview mode (opened from the Designer): escape hatch back, no kiosk traps */
  const isPreview = new URLSearchParams(location.search).has('preview');
  if (isPreview) {
    const back = document.createElement('a');
    back.textContent = '← Back to Designer';
    back.href = `/admin/designer?d=${encodeURIComponent(slug)}`;
    Object.assign(back.style, { position: 'fixed', top: '10px', left: '12px',
      zIndex: 70, background: 'rgba(10,14,24,.85)', color: '#8b98b8',
      border: '1px solid rgba(255,255,255,.2)', padding: '8px 14px',
      borderRadius: '8px', fontSize: '13px', textDecoration: 'none' });
    document.body.appendChild(back);
  }

  /* logout */
  async function doLogout() { await fetch('/api/logout', { method: 'POST' });
                              location.href = '/'; }
  if (!logout.hidden) {
    const b = $('#logoutbtn');
    b.style.display = 'block';
    b.onclick = () => $('#lo-overlay').classList.add('open');
  } else {
    /* Secret tap zone — document-level hit-test (robust against z-index and
       widgets sitting in the corner). Taps outside the zone reset the count. */
    const size = 150;
    const inZone = ev => {
      const x = ev.clientX, y = ev.clientY, w = innerWidth, h = innerHeight;
      switch (logout.zone) {
        case 'top-left': return x < size && y < size;
        case 'bottom-right': return x > w - size && y > h - size;
        case 'bottom-left': return x < size && y > h - size;
        case 'center': return Math.abs(x - w / 2) < size / 2 &&
                              Math.abs(y - h / 2) < size / 2;
        default: return x > w - size && y < size;      // top-right
      }
    };
    let taps = 0, timer = null;
    document.addEventListener('pointerdown', ev => {
      if (!inZone(ev)) { taps = 0; return; }
      taps++;
      clearTimeout(timer);
      timer = setTimeout(() => taps = 0, 2000);
      if (taps >= (logout.taps || 3)) {
        taps = 0;
        $('#lo-overlay').classList.add('open');
      }
    }, true);
  }
  $('#lo-yes').onclick = doLogout;
  $('#lo-no').onclick = () => $('#lo-overlay').classList.remove('open');

  /* live state */
  HAPanel.ready(() => {
    const apply = eid => {
      const st = HAPanel.state(eid);
      updaters.filter(u => u.entity === eid).forEach(u => u.fn(st));
      atClearFor(eid);   // device responded → release any "waiting" widgets
    };
    new Set(updaters.map(u => u.entity).filter(Boolean)).forEach(eid => {
      apply(eid);
      HAPanel.on(eid, () => apply(eid));
    });
  });
  setInterval(() => {
    $('#conn').textContent = HAPanel.connected ? '' : '⚠ reconnecting…';
  }, 3000);
}

/* ---------------- helpers ---------------- */
const label = (w, st) => w.label ||
  (st && st.attributes && st.attributes.friendly_name) ||
  (w.entity || '').split('.')[1] || '';

function setTxt(el, sel, txt) {
  const n = el.querySelector(sel);
  if (n && n.textContent !== txt) n.textContent = txt;
}
function flash(el) {
  const v = el.querySelector('.at-val');
  if (!v) return;
  v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash');
}
function onBtn(el, sel, fn) {
  const b = el.querySelector(sel);
  if (b) b.onclick = ev => { ev.stopPropagation(); fn(); };
}
const skinEl = el => el.querySelector('.at-skin');

/* ---- "waiting" state: after a tap, show a spinner + block further taps until
   the device confirms (its entity state updates) or a fallback timeout fires.
   Stops the "did my tap register?" double-tapping that breaks slow devices. ---- */
const atWaiting = new Map();   // entity -> Set(widget outer el) currently waiting
function atBusy(el, entity, ms) {
  const r = skinEl(el);
  if (!r) return;
  r.classList.add('at-busy');
  clearTimeout(r._atb);
  r._atb = setTimeout(() => {
    r.classList.remove('at-busy');
    if (entity && atWaiting.has(entity)) atWaiting.get(entity).delete(el);
  }, ms || 6000);
  if (entity) {
    if (!atWaiting.has(entity)) atWaiting.set(entity, new Set());
    atWaiting.get(entity).add(el);
  }
}
function atClearFor(entity) {   // a fresh device state arrived → stop waiting
  const set = atWaiting.get(entity);
  if (!set) return;
  set.forEach(el => {
    const r = skinEl(el);
    if (r) { r.classList.remove('at-busy'); clearTimeout(r._atb); }
  });
  set.clear();
}

/* Render a history series into whatever chart element the skin provides
   (.at-line polyline, .at-area polygon, .at-bars group). Uses a 300x90 or the
   svg's own viewBox coordinate space. */
function drawChart(el, points) {
  const empty = el.querySelector('.at-empty');
  const svg = el.querySelector('.at-chart') ||
              (el.querySelector('.at-line') || {}).ownerSVGElement;
  if (points.length < 2) { if (empty) { empty.style.display = 'block';
    empty.textContent = 'no data'; } return; }
  if (empty) empty.style.display = 'none';
  const vb = (svg && svg.getAttribute('viewBox') || '0 0 300 90').split(/\s+/).map(Number);
  const W = vb[2] || 300, H = vb[3] || 90, pad = 4;
  const vs = points.map(p => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (max === min) { max += 1; min -= 1; }
  const n = points.length;
  const x = i => (i / (n - 1)) * W;
  const y = v => H - pad - ((v - min) / (max - min)) * (H - 2 * pad);

  const line = el.querySelector('.at-line');
  if (line) line.setAttribute('points',
    points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '));

  const area = el.querySelector('.at-area');
  if (area) area.setAttribute('points',
    `0,${H} ` + points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ') +
    ` ${W},${H}`);

  const bars = el.querySelector('.at-bars');
  if (bars) {
    // aggregate into up to 24 buckets (average per bucket)
    const B = Math.min(24, n);
    const buckets = Array.from({ length: B }, () => []);
    points.forEach((p, i) => buckets[Math.floor(i / n * B)].push(p.v));
    const avg = buckets.map(b => b.length ? b.reduce((s, v) => s + v, 0) / b.length : min);
    const bw = W / B * 0.7, gap = W / B;
    bars.innerHTML = avg.map((v, i) => {
      const h = Math.max(1, ((v - min) / (max - min)) * (H - 2 * pad));
      return `<rect x="${(i * gap + (gap - bw) / 2).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" ` +
             `width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`;
    }).join('');
  }
}

/* ---------------- Home Life helpers (family board / energy / intercom) ---- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function timeAgo(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts * (ts < 2e10 ? 1000 : 1) : Date.parse(ts);
  if (isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* per-element polling that survives re-renders: stops the old poller if the
   element is bound again, so re-created widgets never leak timers.
   Same signature as before — widget code needs no changes. Passing the widget
   element to PMPoll means a widget on a hidden dashboard tab, or scrolled off
   screen, stops polling entirely and refreshes the moment it comes back. */
function atPoll(el, fn, ms) {
  if (el._atPoll) el._atPoll.stop();
  el._atPoll = atEvery(ms, fn, { el: el, name: 'widget' });
}

const jsonFetch = (url, method, body) => fetch(url, {
  method: method || 'GET',
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
}).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json()
  .catch(() => ({})); });

/* one shared poller for the family board — every fbnotes/fblist widget
   subscribes here, so N widgets still mean one request every 12 s */
const atFB = {
  subs: new Set(), data: null, timer: null,
  sub(fn) {
    this.subs.add(fn);
    if (this.data) fn(this.data);
    if (!this.timer) {
      /* No opts.el: this one poller feeds every fbnotes/fblist widget on the
         page, so it is governed by page visibility/focus only. */
      this.timer = atEvery(12000, () => this.refresh(), { name: 'family-board' });
    }
  },
  async refresh() {
    try {
      this.data = await jsonFetch(
        `/api/dash/family_board/board?d=${encodeURIComponent(slug)}`);
      this.subs.forEach(fn => { try { fn(this.data); } catch (e) {} });
    } catch (e) {
      this.subs.forEach(fn => { try { fn({ error: true }); } catch (e2) {} });
    }
  },
};

/* fullscreen overlays (notes / intercom): injected once, reused, kiosk-safe —
   ✕ top-right, Escape closes, tap on the dimmed backdrop closes */
function atCloseOverlay(ov) {
  if (ov._atCleanup) { try { ov._atCleanup(); } catch (e) {} ov._atCleanup = null; }
  ov.classList.remove('open');
}
function atOverlay(id, html) {
  let ov = document.getElementById(id);
  if (!ov) {
    ov = document.createElement('div');
    ov.id = id; ov.className = 'at-fsov';
    ov.addEventListener('click', ev => { if (ev.target === ov) atCloseOverlay(ov); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = html;
  ov.classList.add('open');
  const x = ov.querySelector('.at-fsx');
  if (x) x.onclick = () => atCloseOverlay(ov);
  return ov;
}
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape')
    document.querySelectorAll('.at-fsov.open').forEach(atCloseOverlay);
});

/* ---- Family Notes: fullscreen note + replies thread ---- */
function atOpenNote(noteId) {
  const ov = atOverlay('at-noteov', `
    <div class="at-fspanel">
      <div class="at-fshead"><span>📝 Note</span><button class="at-fsx">✕</button></div>
      <div class="at-fsbody">
        <div class="at-nov-text"></div>
        <div class="at-nov-meta"></div>
        <div class="at-nov-replies"></div>
      </div>
      <div class="at-fsrow">
        <input class="at-fsinput" placeholder="Write a reply…" maxlength="300">
        <button class="at-fsbtn at-nov-send">Send</button>
      </div>
    </div>`);
  const findNote = () =>
    (((atFB.data || {}).notes) || []).find(n => String(n.id) === String(noteId));
  const paint = () => {
    const data = atFB.data || {};
    const n = findNote();
    if (!n) { atCloseOverlay(ov); return; }
    ov.querySelector('.at-nov-text').textContent = n.text || '';
    ov.querySelector('.at-nov-meta').textContent =
      [n.author, timeAgo(n.created)].filter(Boolean).join(' · ');
    ov.querySelector('.at-nov-replies').innerHTML = (n.replies || []).map(r => `
      <div class="rp"><div class="rphead"><b>${esc(r.user)}</b>
        <span>${timeAgo(r.ts)}</span>
        ${r.user === data.user
          ? `<button class="rpdel" data-rid="${esc(r.id)}">✕</button>` : ''}</div>
      <div class="rptext">${esc(r.text)}</div></div>`).join('') ||
      '<div class="at-fbempty">No replies yet</div>';
  };
  paint();
  const input = ov.querySelector('.at-fsinput');
  const send = async () => {
    const text = input.value.trim();
    const n = findNote();
    if (!text || !n) return;
    input.value = '';
    try {
      await jsonFetch('/api/dash/family_board/reply', 'POST',
        { d: slug, note_id: n.id, text });
    } catch (e) {}
    await atFB.refresh();
    if (ov.classList.contains('open')) paint();
  };
  ov.querySelector('.at-nov-send').onclick = send;
  input.onkeydown = ev => { if (ev.key === 'Enter') send(); };
  ov.querySelector('.at-nov-replies').onclick = async ev => {
    const b = ev.target.closest('.rpdel');
    const n = findNote();
    if (!b || !n) return;
    const rep = (n.replies || []).find(r => String(r.id) === String(b.dataset.rid));
    try {
      await jsonFetch('/api/dash/family_board/reply', 'DELETE',
        { d: slug, note_id: n.id, reply_id: rep ? rep.id : b.dataset.rid });
    } catch (e) {}
    await atFB.refresh();
    if (ov.classList.contains('open')) paint();
  };
}

/* ---- Intercom: fullscreen announce panel (targets, quick msgs, TTS, voice) */
function atOpenIntercom(w) {
  const ov = atOverlay('at-icov', `
    <div class="at-fspanel">
      <div class="at-fshead"><span>📢 ${esc(w.label || 'Announce')}</span>
        <button class="at-fsx">✕</button></div>
      <div class="at-fsbody">
        <div class="at-icsec">Where</div>
        <div class="at-icareas"><span class="at-fbempty">Loading…</span></div>
        <div class="at-icvols"></div>
        <div class="at-icsec at-icvsec" style="display:none">Voice</div>
        <div class="at-icvoices" style="display:none"></div>
        <div class="at-icsec">Quick messages</div>
        <div class="at-icquick"><span class="at-fbempty">—</span></div>
        <div class="at-icmiczone">
          <button class="at-iccancel" style="display:none">✕</button>
          <button class="at-icmic"><span class="mic">🎤</span>
            <span class="mlbl">Hold to talk</span></button>
        </div>
        <div class="at-icnote" style="display:none">Voice needs the HTTPS address</div>
        <div class="at-icstatus"></div>
      </div>
      <div class="at-fsrow">
        <input class="at-fsinput" placeholder="Type an announcement…" maxlength="300">
        <button class="at-fsbtn at-icsend">Send</button>
      </div>
    </div>`);
  const $o = s => ov.querySelector(s);
  const status = (msg, ok) => {
    const st = $o('.at-icstatus');
    if (!st) return;
    st.textContent = msg || '';
    st.className = 'at-icstatus' + (ok === false ? ' bad' : ok ? ' good' : '');
    clearTimeout(st._t);
    if (msg) st._t = setTimeout(() => { st.textContent = ''; }, 3500);
  };

  let areas = [], others = [], quick = [], voice = false, sel = [];
  const LS = 'pm_ic_sel_' + slug;
  const saveSel = () => { try { localStorage.setItem(LS, JSON.stringify(sel)); }
                          catch (e) {} };
  const loadSel = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); }
                          catch (e) { return []; } };
  /* dead = gone from HA (never selectable); off = powered down (warn) */
  const pDead = p => !p || !p.state ||
    p.state === 'unavailable' || p.state === 'unknown';
  const pOff = p => p && (p.state === 'off' || p.state === 'standby');
  const liveOf = list => (list || []).filter(p => !pDead(p));
  const groupOf = id => id === '__other__'
    ? { players: others } : areas.find(a => a.id === id);
  const selGroups = () => {
    const all = sel.includes('all');
    const gs = [];
    areas.forEach(a => { if (all || sel.includes(a.id)) gs.push(a); });
    if (all || sel.includes('__other__')) gs.push({ players: others });
    return gs;
  };
  const selPlayers = () => {          // live player OBJECTS in selection
    const seen = new Set(), out = [];
    selGroups().forEach(g => liveOf(g.players).forEach(p => {
      if (!seen.has(p.entity_id)) { seen.add(p.entity_id); out.push(p); }
    }));
    return out;
  };
  const players = () => selPlayers().map(p => p.entity_id);
  const chipFor = (id, label, list) => {
    const live = liveOf(list);
    const on = live.filter(p => !pOff(p)).length;
    const dim = !live.length;
    const mark = dim ? ' · ✕' : on ? '' : ' · ⏻ off';
    return `<button class="at-icchip${sel.includes(id) ? ' on' : ''}` +
      `${dim ? ' dim' : ''}" data-id="${esc(id)}">${esc(label)}` +
      `<small>${live.length ? ' ' + on + '/' + live.length : ''}${mark}</small></button>`;
  };
  const paintAreas = () => {
    const allLive = [];
    areas.forEach(a => allLive.push(...liveOf(a.players)));
    allLive.push(...liveOf(others));
    $o('.at-icareas').innerHTML =
      `<button class="at-icchip${sel.includes('all') ? ' on' : ''}` +
      `${allLive.length ? '' : ' dim'}" data-id="all">🏠 Everywhere</button>` +
      areas.map(a => chipFor(a.id, a.name || a.id, a.players)).join('') +
      (others.length ? chipFor('__other__', '📦 Other speakers', others) : '');
  };
  $o('.at-icareas').onclick = ev => {
    const c = ev.target.closest('.at-icchip');
    if (!c) return;
    const id = c.dataset.id;
    if (c.classList.contains('dim')) {
      status('No working speaker there — it is off the network', false);
      return;
    }
    if (id === 'all') sel = ['all'];
    else {
      sel = sel.filter(x => x !== 'all');
      sel = sel.includes(id) ? sel.filter(x => x !== id) : sel.concat(id);
      if (!sel.length) sel = ['all'];
    }
    saveSel(); paintAreas(); paintVols();
  };

  /* --- volume sliders for the selected speakers --- */
  const VOL_SET = 4;                       // media_player VOLUME_SET feature
  const volTimers = {};
  const sendVol = (eid, v) => {
    clearTimeout(volTimers[eid]);
    volTimers[eid] = setTimeout(() => {
      jsonFetch('/api/dash/announce_center/volume', 'POST',
        { d: slug, entity_id: eid, volume_level: v })
        .catch(() => status('Volume change failed', false));
    }, 300);
  };
  const paintVols = () => {
    const box = $o('.at-icvols');
    if (!box) return;
    const objs = selPlayers()
      .filter(p => (p.supported_features & VOL_SET) && !pOff(p));
    if (!objs.length) { box.innerHTML = ''; return; }
    let html = '<div class="at-icsec">Volume</div>';
    if (objs.length > 1)
      html += `<div class="at-icvol master"><span class="vn">🔉 All selected</span>
        <input type="range" class="at-icrange" data-eid="__all__"
               min="0" max="1" step="0.02" value="0.5"></div>`;
    html += objs.map(p => {
      const v = typeof p.volume_level === 'number' ? p.volume_level : 0.5;
      return `<div class="at-icvol"><span class="vn">${esc(p.name)}</span>
        <input type="range" class="at-icrange" data-eid="${esc(p.entity_id)}"
               min="0" max="1" step="0.02" value="${v}">
        <span class="vp">${Math.round(v * 100)}%</span></div>`;
    }).join('');
    box.innerHTML = html;
    box.querySelectorAll('input.at-icrange').forEach(r => {
      r.addEventListener('input', () => {
        const v = parseFloat(r.value);
        if (r.dataset.eid === '__all__') {
          box.querySelectorAll('input.at-icrange').forEach(o => {
            if (o.dataset.eid === '__all__') return;
            o.value = v;
            const pct = o.parentElement.querySelector('.vp');
            if (pct) pct.textContent = Math.round(v * 100) + '%';
            const p = selPlayers().find(x => x.entity_id === o.dataset.eid);
            if (p) p.volume_level = v;
            sendVol(o.dataset.eid, v);
          });
          return;
        }
        const pct = r.parentElement.querySelector('.vp');
        if (pct) pct.textContent = Math.round(v * 100) + '%';
        const p = selPlayers().find(x => x.entity_id === r.dataset.eid);
        if (p) p.volume_level = v;   // keep repaints from snapping back
        sendVol(r.dataset.eid, v);
      });
    });
  };
  /* --- voice / language chips (Edge TTS & Google Translate engines) --- */
  let icVoice = null;
  const VLS = 'pm_ic_voice_' + slug;
  const icVoicePresets = engineId => {
    const id = (engineId || '').toLowerCase();
    if (id.includes('edge')) return [
      { label: 'Default', v: null },
      { label: '🇮🇷 فارسی', v: 'fa-IR-FaridNeural' },
      { label: '🇺🇸 English', v: 'en-US-JennyNeural' },
    ];
    if (id.includes('google_translate')) return [
      { label: 'Default', v: null },
      { label: '🇺🇸 English', v: 'en' },
    ];
    return [];
  };
  const paintVoices = engineId => {
    const presets = icVoicePresets(engineId);
    const secEl = $o('.at-icvsec'), box = $o('.at-icvoices');
    if (!box || presets.length < 2) return;
    let saved = null;
    try { saved = localStorage.getItem(VLS) || null; } catch (e) {}
    if (!presets.some(p => (p.v || '') === (saved || '')))
      saved = (engineId || '').toLowerCase().includes('edge')
        ? 'en-US-JennyNeural' : null;
    icVoice = saved;
    secEl.style.display = ''; box.style.display = '';
    box.className = 'at-icvoices at-icareas';   // reuse chip row layout
    box.innerHTML = presets.map(p =>
      `<button class="at-icchip${(p.v || '') === (icVoice || '') ? ' on' : ''}"` +
      ` data-v="${esc(p.v || '')}">${esc(p.label)}</button>`).join('');
    box.onclick = ev => {
      const c = ev.target.closest('.at-icchip');
      if (!c) return;
      icVoice = c.dataset.v || null;
      try { localStorage.setItem(VLS, icVoice || ''); } catch (e) {}
      paintVoices(engineId);
    };
  };
  const announce = async message => {
    const objs = selPlayers();
    const pl = objs.map(p => p.entity_id);
    if (!message) return;
    if (!pl.length) { status('No speakers in the selected area', false); return; }
    if (objs.every(pOff)) {
      status('Those speakers are off — turn one on first', false);
      return;
    }
    status('Sending…');
    try {
      const body = { d: slug, message, players: pl };
      if (icVoice) body.language = icVoice;
      await jsonFetch('/api/dash/announce_center/announce', 'POST', body);
      status('Sent ✓', true);
    } catch (e) { status('Failed to send ✗', false); }
  };
  const qtext = m => typeof m === 'string' ? m : (m && (m.text || m.message)) || '';
  $o('.at-icquick').onclick = ev => {
    const c = ev.target.closest('.at-icchip');
    if (c) announce(qtext(quick[+c.dataset.i]));
  };
  const input = $o('.at-fsinput');
  const sendTxt = () => { const t = input.value.trim();
    if (!t) return; input.value = ''; announce(t); };
  $o('.at-icsend').onclick = sendTxt;
  input.onkeydown = ev => { if (ev.key === 'Enter') sendTxt(); };

  /* --- hold-to-talk voice (MediaRecorder → POST raw blob) --- */
  let rec = null, chunks = [], recStart = 0, recTimer = null, recStopTo = null,
      cancelFlag = false, stream = null;
  function recUiOff() {
    clearInterval(recTimer); clearTimeout(recStopTo);
    const mic = $o('.at-icmic'), cancel = $o('.at-iccancel');
    if (mic) { mic.classList.remove('rec');
      const l = mic.querySelector('.mlbl'); if (l) l.textContent = 'Hold to talk'; }
    if (cancel) cancel.style.display = 'none';
  }
  function stopRec(cancelled) {
    if (cancelled) cancelFlag = true;
    if (rec && rec.state !== 'inactive') rec.stop();
    else recUiOff();
  }
  async function onRecStop() {
    recUiOff();
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    const blob = chunks.length
      ? new Blob(chunks, { type: (rec && rec.mimeType) || 'audio/webm' }) : null;
    const dur = (Date.now() - recStart) / 1000;
    rec = null; chunks = [];
    if (cancelFlag) { status('Cancelled'); return; }
    if (!blob || blob.size < 200 || dur < 0.4) {
      status('Hold the button to record', false); return; }
    const pl = players();
    if (!pl.length) { status('No speakers in the selected area', false); return; }
    status('Sending voice…');
    try {
      const r = await fetch(`/api/dash/announce_center/voice` +
        `?d=${encodeURIComponent(slug)}&players=${encodeURIComponent(pl.join(','))}`,
        { method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
      if (!r.ok) throw new Error();
      status('Announcement sent ✓', true);
    } catch (e) { status('Voice send failed ✗', false); }
  }
  function onRecRelease(ev) {
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    stopRec(!!(t && t.closest && t.closest('.at-iccancel')));
  }
  async function startRec(ev) {
    ev.preventDefault();
    if (rec) return;
    cancelFlag = false;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { status('Microphone blocked', false); return; }
    const mime = window.MediaRecorder &&
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    try { rec = new MediaRecorder(stream, { mimeType: mime }); }
    catch (e) { try { rec = new MediaRecorder(stream); }
      catch (e2) { status('Recording not supported', false);
        stream.getTracks().forEach(t => t.stop()); stream = null; return; } }
    chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = onRecStop;
    rec.start();
    recStart = Date.now();
    const mic = $o('.at-icmic'), cancel = $o('.at-iccancel');
    mic.classList.add('rec');
    cancel.style.display = '';
    const lbl = mic.querySelector('.mlbl');
    lbl.textContent = '0s';
    recTimer = setInterval(() => {
      lbl.textContent = Math.floor((Date.now() - recStart) / 1000) + 's';
    }, 250);
    recStopTo = setTimeout(() => stopRec(false), 20000);   // 20 s max
    document.addEventListener('pointerup', onRecRelease, { once: true });
  }
  function setupVoice() {
    const zone = $o('.at-icmiczone'), mic = $o('.at-icmic'),
          note = $o('.at-icnote');
    if (!voice) { zone.style.display = 'none'; return; }
    zone.style.display = 'flex';
    const secure = location.protocol === 'https:' ||
                   location.hostname === 'localhost';
    const usable = secure && navigator.mediaDevices &&
                   navigator.mediaDevices.getUserMedia && window.MediaRecorder;
    if (!usable) {
      mic.classList.add('off'); mic.disabled = true;
      if (!secure) note.style.display = '';
      return;
    }
    mic.addEventListener('pointerdown', startRec);
    $o('.at-iccancel').addEventListener('pointerdown', () => stopRec(true));
  }
  $o('.at-icmiczone').style.display = 'none';
  ov._atCleanup = () => stopRec(true);

  jsonFetch(`/api/dash/announce_center/targets?d=${encodeURIComponent(slug)}`)
    .then(t => {
      areas = t.areas || [];
      others = t.other_players || [];
      quick = t.quick_messages || t.messages || [];
      voice = !!t.voice_available;
      const stored = loadSel().filter(id =>
        id === 'all' || id === '__other__' ||
        areas.some(a => a.id === id));
      sel = stored.length ? stored
        : (w.defaultArea && areas.some(a => a.id === w.defaultArea))
          ? [w.defaultArea] : ['all'];
      paintAreas(); paintVols();
      paintVoices(t.engine_id || '');
      $o('.at-icquick').innerHTML = quick.length
        ? quick.map((m, i) =>
            `<button class="at-icchip" data-i="${i}">${esc(qtext(m))}</button>`).join('')
        : '<span class="at-fbempty">No quick messages</span>';
      setupVoice();
    })
    .catch(() => {
      $o('.at-icareas').innerHTML =
        '<span class="at-fbempty">Announce Center isn\'t set up yet</span>';
      $o('.at-icquick').innerHTML = '<span class="at-fbempty">—</span>';
    });
}

/* ---- Security keypad: arm/disarm with a PIN, no admin login needed ----
   The same controller drives the always-on pad skin and the fullscreen overlay
   used by the compact skins; parts the host skin does not have are skipped. */
const SK_MODES = { home: 'Home', away: 'Away', night: 'Night' };
const SK_INFO = {
  disarmed:    ['sk-disarmed',  'Disarmed'],
  arming:      ['sk-arming',    'Arming — leave now'],
  armed_home:  ['sk-armed',     'Armed · Home'],
  armed_away:  ['sk-armed',     'Armed · Away'],
  armed_night: ['sk-armed',     'Armed · Night'],
  pending:     ['sk-pending',   'Enter your code'],
  triggered:   ['sk-triggered', 'ALARM'],
};
const SK_CLS = ['sk-disarmed', 'sk-arming', 'sk-armed', 'sk-pending',
                'sk-triggered', 'sk-off'];
const SK_OFF_MSG = 'The keypad is disabled by the administrator';

/* like jsonFetch, but keeps the status + error body so we can tell a wrong PIN
   from a keypad the admin switched off (both answer 403) */
function atSecApi(path, method, body) {
  return fetch('/api/dash/security_center' + path, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json().catch(() => ({}))
    .then(d => ({ ok: r.ok, status: r.status, data: d || {} })));
}

function atSecPad(w, host, opts) {
  opts = opts || {};
  const stateEl = opts.stateEl || host;
  const modes = ['home', 'away', 'night'].filter(m =>
    !Array.isArray(w.modes) || !w.modes.length || w.modes.includes(m));
  const q = s => host.querySelector(s);
  let pin = '', cur = null, cd = null, cdAt = 0, busy = false, off = false;

  stateEl.classList.add('at-skst');

  const grid = q('.at-skgrid');
  if (grid) grid.innerHTML =
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']
      .map(k => `<button class="at-skkey" type="button" data-k="${k}">${
        k === 'clear' ? 'C' : k === 'back' ? '⌫' : k}</button>`).join('');
  const acts = q('.at-skacts');
  if (acts) acts.innerHTML =
    modes.map(m => `<button class="at-skbtn arm" type="button" ` +
      `data-mode="${m}">🔒 ${esc(SK_MODES[m])}</button>`).join('') +
    '<button class="at-skbtn dis wide" type="button" data-mode="disarm">' +
    '🔓 Disarm</button>';

  const msg = (t, kind, sticky) => {
    const m = q('.at-skmsg');
    if (!m) return;
    m.textContent = t || '';
    m.className = 'at-skmsg' + (kind ? ' ' + kind : '');
    clearTimeout(m._t);
    if (t && !sticky) m._t = setTimeout(() => {
      m.textContent = ''; m.className = 'at-skmsg'; }, 4000);
  };
  const remaining = () =>
    cd ? Math.max(0, (+cd.remaining || 0) - (Date.now() - cdAt) / 1000) : 0;
  const fmt = s => {
    s = Math.max(0, Math.round(s));
    return s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
                   : s + 's';
  };
  const paintDots = () => {
    const d = q('.at-skdots');
    if (!d) return;
    const n = Math.max(4, pin.length);
    if (d.children.length !== n) d.innerHTML = new Array(n).fill('<i></i>').join('');
    for (let i = 0; i < d.children.length; i++)
      d.children[i].classList.toggle('on', i < pin.length);
  };
  const shake = () => {
    const d = q('.at-skdots');
    if (!d) return;
    d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
  };
  const paint = () => {
    const info = SK_INFO[cur] || ['sk-disarmed', cur ? String(cur) : '…'];
    SK_CLS.forEach(c => stateEl.classList.remove(c));
    stateEl.classList.add(off ? 'sk-off' : info[0]);
    const lb = q('.at-sklb');
    if (lb) lb.textContent = off ? 'Keypad disabled' : info[1];
    const c = q('.at-skcd');
    if (c) c.textContent = (!off && cd && remaining() > 0) ? fmt(remaining()) : '';
  };
  const tick = () => {
    if (off || !cd) return;
    const c = q('.at-skcd');
    const left = remaining();
    if (c) c.textContent = left > 0 ? fmt(left) : '';
    if (left <= 0) cd = null;
  };

  const refresh = () => atSecApi(`/state?d=${encodeURIComponent(slug)}`)
    .then(r => {
      if (!r.ok) {
        if (r.status === 403) {
          if (!off) { off = true; msg(SK_OFF_MSG, 'bad', true); }
          paint();
          return;
        }
        throw new Error('HTTP ' + r.status);
      }
      if (off) { off = false; msg(''); }
      cur = r.data.state || 'disarmed';
      cd = (r.data.countdown && r.data.countdown.remaining != null)
        ? r.data.countdown : null;
      cdAt = Date.now();
      const nm = q('.at-name');
      if (nm && !w.label && r.data.name) nm.textContent = r.data.name;
      paint();
    })
    .catch(() => {
      if (cur) return;                       // keep the last known state visible
      const lb = q('.at-sklb');
      if (lb) lb.textContent = 'Offline';
    });

  const submit = mode => {
    if (busy || off) return;
    const code = pin;                        // take it, then forget it at once
    pin = ''; paintDots();
    if (!code) { shake(); msg('Enter your code first'); return; }
    busy = true;
    const body = mode === 'disarm' ? { d: slug, pin: code }
                                   : { d: slug, mode: mode, pin: code };
    atSecApi(mode === 'disarm' ? '/disarm' : '/arm', 'POST', body)
      .then(r => {
        const err = r.data.error;
        if (r.ok) {
          cur = r.data.state || cur;
          cd = (r.data.countdown && r.data.countdown.remaining != null)
            ? r.data.countdown : null;
          cdAt = Date.now();
          paint();
          msg(mode === 'disarm' ? 'Disarmed'
                                : 'Armed · ' + SK_MODES[mode], 'good');
          if (opts.onDone) opts.onDone();
        } else if (err === 'wrong_pin') {
          shake(); msg('Wrong code — try again', 'bad');
        } else if (err === 'no_pin') {
          msg('No PIN set yet — set one in Security Center', 'bad');
        } else if (r.status === 403) {
          off = true; msg(SK_OFF_MSG, 'bad', true); paint();
        } else {
          msg(r.data.message || 'Something went wrong', 'bad');
        }
      })
      .catch(() => msg('No connection to the alarm', 'bad'))
      .then(() => { busy = false; refresh(); });
  };

  if (grid) grid.onclick = ev => {
    const b = ev.target.closest('.at-skkey');
    if (!b || off) return;
    ev.stopPropagation();
    const k = b.dataset.k;
    if (k === 'clear') pin = '';
    else if (k === 'back') pin = pin.slice(0, -1);
    else if (pin.length < 12) pin += k;
    paintDots();
  };
  if (acts) acts.onclick = ev => {
    const b = ev.target.closest('.at-skbtn');
    if (!b) return;
    ev.stopPropagation();
    submit(b.dataset.mode);
  };

  if (host._skTick) clearInterval(host._skTick);
  host._skTick = setInterval(tick, 1000);
  paintDots(); paint();

  return {
    refresh: refresh,
    destroy: () => {
      pin = '';
      if (host._skTick) { clearInterval(host._skTick); host._skTick = null; }
    },
  };
}

/* fullscreen keypad used by the compact skins (sk-shield / sk-bar) */
function atOpenSecKeypad(w) {
  const prev = document.getElementById('at-skov');
  if (prev && prev.classList.contains('open')) atCloseOverlay(prev);
  const ov = atOverlay('at-skov', `
    <div class="at-fspanel at-skpanel">
      <div class="at-fshead"><span>🔐 ${esc(w.label || 'Security')}</span>
        <button class="at-fsx">✕</button></div>
      <div class="at-fsbody">
        <div class="at-skbadge"><i class="at-skdot"></i>
          <span class="at-sklb">…</span><b class="at-skcd"></b></div>
        <div class="at-skdots"></div>
        <div class="at-skmsg"></div>
        <div class="at-skgrid"></div>
        <div class="at-skacts"></div>
      </div>
    </div>`);
  const panel = ov.querySelector('.at-fspanel');
  const pad = atSecPad(w, panel, { stateEl: panel, onDone: () => setTimeout(() => {
    if (ov.classList.contains('open')) atCloseOverlay(ov); }, 1200) });
  atPoll(ov, pad.refresh, 3000);
  ov._atCleanup = () => {
    if (ov._atPoll) { clearInterval(ov._atPoll); ov._atPoll = null; }
    pad.destroy();
  };
}

/* ---------------- per-type behavior ---------------- */
function bind(w, el, updaters) {
  const call = (domain, service, data) => {
    atBusy(el, w.entity);   // waiting + block repeat taps until w.entity updates
    return HAPanel.call(domain, service, Object.assign({ entity_id: w.entity }, data));
  };
  const domain = () => (w.entity || '').split('.')[0];

  if (w.type === 'nav') {
    el.classList.add('tap');
    el.onclick = () => {
      if (w.navType === 'tab' && w.navTab && window.__atGotoTab)
        window.__atGotoTab(w.navTab);
      else if (w.navType === 'dash' && w.navDash && window.__atOpenDash)
        window.__atOpenDash(w.navDash);
    };
    return;   // no entity, no live updates
  }

  if (w.type === 'toggle') {
    el.classList.add('tap');
    el.onclick = () => w.entity && call(domain(), 'toggle');
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      r.classList.toggle('on', st.state === 'on');
      r.classList.toggle('unavail', st.state === 'unavailable');
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', st.state === 'on' ? 'On'
        : st.state === 'off' ? 'Off' : st.state);
    }});
  }

  if (w.type === 'light') {
    // dedicated power toggle button, or tap-anywhere for simple skins
    const power = el.querySelector('.at-power');
    if (power) power.onclick = ev => { ev.stopPropagation();
      w.entity && call('light', 'toggle'); };
    const main = el.querySelector('.at-main');
    if (main) main.onclick = ev => { ev.stopPropagation();
      w.entity && call('light', 'toggle'); };
    else if (!power && !el.querySelector('.at-bri') && !el.querySelector('.at-hue')
             && !el.querySelector('.at-expand')) {
      el.classList.add('tap'); el.onclick = () => w.entity && call('light','toggle'); }
    // expandable settings drawer (.at-expand button toggles .expanded on wrapper)
    const exp = el.querySelector('.at-expand');
    if (exp) exp.onclick = ev => { ev.stopPropagation();
      skinEl(el).classList.toggle('expanded'); };
    const bri = el.querySelector('.at-bri');
    if (bri) {
      bri.addEventListener('input', () =>
        skinEl(el).style.setProperty('--pct', bri.value));
      bri.addEventListener('change', () =>
        w.entity && call('light', 'turn_on', { brightness_pct: +bri.value }));
      bri.addEventListener('pointerdown', ev => ev.stopPropagation());
    }
    // color preset swatches (data-rgb="r,g,b")
    el.querySelectorAll('.at-swatch').forEach(s => s.onclick = ev => {
      ev.stopPropagation();
      const rgb = (s.dataset.rgb || '').split(',').map(Number);
      if (rgb.length === 3 && w.entity) call('light', 'turn_on', { rgb_color: rgb });
    });
    // hue slider (0-360) → full-saturation color
    const hue = el.querySelector('.at-hue');
    if (hue) {
      const send = () => w.entity &&
        call('light', 'turn_on', { hs_color: [+hue.value, 100] });
      hue.addEventListener('pointerdown', ev => ev.stopPropagation());
      hue.addEventListener('change', send);
    }
    const rgbToStr = rgb => rgb && rgb.length === 3 ? `rgb(${rgb.join(',')})` : null;
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      const a = st.attributes || {};
      const pct = st.state === 'on'
        ? Math.round((a.brightness != null ? a.brightness / 255 : 1) * 100) : 0;
      r.classList.toggle('on', st.state === 'on');
      r.classList.toggle('unavail', st.state === 'unavailable');
      r.style.setProperty('--pct', pct);
      // reflect the light's current colour as the accent, so bulbs/glows match
      const col = rgbToStr(a.rgb_color);
      if (col && st.state === 'on') r.style.setProperty('--accent', col);
      else r.style.removeProperty('--accent');
      if (bri && document.activeElement !== bri) bri.value = pct;
      if (hue && document.activeElement !== hue && a.hs_color)
        hue.value = Math.round(a.hs_color[0]);
      // highlight the active swatch
      el.querySelectorAll('.at-swatch').forEach(s => {
        const rgb = (s.dataset.rgb || '').split(',').map(Number);
        s.classList.toggle('active', a.rgb_color &&
          rgb[0] === a.rgb_color[0] && rgb[1] === a.rgb_color[1] && rgb[2] === a.rgb_color[2]);
      });
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', st.state === 'on' ? pct + '%' : 'Off');
    }});
  }

  if (w.type === 'sensor') {
    let last = null;
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      r.classList.toggle('unavail', st.state === 'unavailable');
      r.classList.toggle('on', st.state === 'on');       // binary sensors / LED skin
      const a = st.attributes || {};
      const unit = w.unit || a.unit_of_measurement || '';
      const num = parseFloat(st.state);
      const min = w.min != null ? w.min : 0;
      const max = w.max != null ? w.max : 100;
      if (!isNaN(num)) {
        const pct = Math.max(0, Math.min(100, ((num - min) / (max - min)) * 100));
        r.style.setProperty('--pct', Math.round(pct));
        r.classList.toggle('low', pct <= 15);
      }
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', `${st.state}${unit ? ' ' + unit : ''}`);
      if (last !== null && last !== st.state) flash(el);
      last = st.state;
    }});
  }

  if (w.type === 'button') {
    el.classList.add('tap');
    el.onclick = () => {
      if (!w.entity) return;
      const d = domain();
      if (d === 'button' || d === 'input_button') call(d, 'press');
      else if (d === 'scene' || d === 'script') call(d, 'turn_on');
      else if (d === 'automation') call(d, 'trigger');
      else call(d, 'toggle');
      const r = skinEl(el);
      r.classList.add('on'); setTimeout(() => r.classList.remove('on'), 450);
    };
    updaters.push({ entity: w.entity, fn: st => setTxt(el, '.at-name', label(w, st)) });
  }

  if (w.type === 'select') {
    const send = option => w.entity &&
      call(domain(), 'select_option', { option });
    // segmented / chip skins: delegate taps on generated .at-opt buttons
    el.addEventListener('click', ev => {
      const b = ev.target.closest('.at-opt');
      if (b && b.dataset.opt != null) send(b.dataset.opt);
    });
    // dropdown skin: native <select class="at-optsel">
    const nativeSel = el.querySelector('.at-optsel');
    if (nativeSel) {
      nativeSel.addEventListener('pointerdown', ev => ev.stopPropagation());
      nativeSel.addEventListener('change', () => send(nativeSel.value));
    }
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      r.classList.toggle('unavail', st.state === 'unavailable');
      const opts = (st.attributes && st.attributes.options) || [];
      const key = opts.join('|');
      const seg = el.querySelector('.at-opts');
      if (seg && seg.dataset.built !== key) {
        seg.innerHTML = opts.map(o =>
          `<button class="at-opt" data-opt="${o}">${o}</button>`).join('');
        seg.dataset.built = key;
      }
      el.querySelectorAll('.at-opt').forEach(b =>
        b.classList.toggle('active', b.dataset.opt === st.state));
      if (nativeSel && nativeSel.dataset.built !== key) {
        nativeSel.innerHTML = opts.map(o =>
          `<option value="${o}">${o}</option>`).join('');
        nativeSel.dataset.built = key;
      }
      if (nativeSel && document.activeElement !== nativeSel) nativeSel.value = st.state;
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', st.state);
    }});
  }

  if (w.type === 'litterbox') {
    // all-in-one Litter-Robot card: one vacuum entity + sibling sensors/button.
    const r0 = skinEl(el);
    const clean = el.querySelector('.at-clean');
    if (clean) clean.onclick = ev => { ev.stopPropagation();
      if (!w.entity) return;
      call('vacuum', 'start');
      r0.classList.add('justclean');
      setTimeout(() => r0.classList.remove('justclean'), 2000); };
    const stop = el.querySelector('.at-stopcycle');
    if (stop) stop.onclick = ev => { ev.stopPropagation();
      w.entity && call('vacuum', 'stop'); };
    const reset = el.querySelector('.at-reset');
    if (reset) reset.onclick = ev => { ev.stopPropagation();
      if (!w.resetEntity) return;
      const d = w.resetEntity.split('.')[0];
      HAPanel.call(d, 'press', { entity_id: w.resetEntity });
      atBusy(el, w.drawerEntity, 4000);   // clears when the drawer % refreshes
      r0.classList.add('justreset');
      setTimeout(() => r0.classList.remove('justreset'), 1400); };

    // primary vacuum: cleaning + availability + name
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      r.classList.toggle('cleaning', st.state === 'cleaning');
      r.classList.toggle('unavail',
        st.state === 'unavailable' || st.state === 'offline');
      setTxt(el, '.at-name', label(w, st));
    }});
    // status code → cat-detected / drawer-full / friendly text
    const STXT = { rdy:'Ready', ccp:'Clean cycle…', ccc:'Cycle complete',
      cd:'Cat detected', csi:'Cat interrupt', cst:'Cat using…',
      df1:'Drawer full', df2:'Drawer full', dfs:'Drawer full!', sdf:'Drawer full',
      p:'Paused', pd:'Paused', off:'Off', offline:'Offline', br:'Bonnet off',
      pwru:'Powering up', pwrd:'Powering down', ec:'Empty cycle' };
    if (w.statusEntity) updaters.push({ entity: w.statusEntity, fn: st => {
      if (!st) return;
      const r = skinEl(el), c = st.state;
      r.classList.toggle('catin', ['cd','csi','cst'].includes(c));
      r.classList.toggle('statusfull', ['df1','df2','dfs','sdf'].includes(c));
      setTxt(el, '.at-lrstatus', STXT[c] || c);
    }});
    // waste drawer %
    if (w.drawerEntity) updaters.push({ entity: w.drawerEntity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      const p = Math.max(0, Math.min(100, parseFloat(st.state) || 0));
      r.style.setProperty('--drawer', Math.round(p));
      r.classList.toggle('drawerfull', p >= 90);
      r.classList.toggle('drawerhi', p >= 70);
      setTxt(el, '.at-drawerval', Math.round(p) + '%');
    }});
    // litter level — HA's sensor reads higher as the litter gets LOWER, so we
    // show "litter remaining" (100 − raw): 90 raw → 10% left (needs refill).
    if (w.litterEntity) updaters.push({ entity: w.litterEntity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      const raw = Math.max(0, Math.min(100, parseFloat(st.state) || 0));
      const left = w.litterInvert === false ? raw : 100 - raw;
      r.style.setProperty('--litter', Math.round(left));
      r.classList.toggle('litterlow', left <= 20);
      setTxt(el, '.at-litterval', Math.round(left) + '%');
    }});
    // pet weight (show — when the scale has no reading yet, no ugly "unavailable")
    if (w.weightEntity) updaters.push({ entity: w.weightEntity, fn: st => {
      if (!st) return;
      const a = st.attributes || {};
      const bad = ['unavailable', 'unknown', 'none', ''].includes(st.state);
      const u = a.unit_of_measurement || '';
      setTxt(el, '.at-weightval', bad ? '—' : `${st.state}${u ? ' ' + u : ''}`);
    }});
    return;
  }

  if (w.type === 'climate') {
    // A climate entity has ONE setpoint (heat/cool/off with .temperature) or a
    // RANGE (heat_cool with target_temp_low/high). The big number is always the
    // setpoint the user controls — never the current room temperature.
    let target = null;      // single setpoint (optimistic)
    let low = null, high = null;   // heat_cool range
    let range = false;
    let userEditAt = 0;     // ignore incoming state right after a local change
    let sendTimer = null;

    const stepFor = a => {
      if (a.target_temp_step) return a.target_temp_step;
      const mx = a.max_temp != null ? a.max_temp : 35;
      return mx > 45 ? 1 : 0.5;         // Fahrenheit vs Celsius heuristic
    };
    const round = (v, s) => Math.round(v / s) * s;

    function push() {
      const st = HAPanel.state(w.entity);
      const a = (st && st.attributes) || {};
      const data = range
        ? { target_temp_low: low, target_temp_high: high }
        : { temperature: target };
      call('climate', 'set_temperature', data);
    }
    function bump(d) {
      const st = HAPanel.state(w.entity);
      if (!st || !w.entity) return;
      const a = st.attributes || {};
      const s = w.step || stepFor(a);
      const min = a.min_temp != null ? a.min_temp : 7;
      const max = a.max_temp != null ? a.max_temp : 35;
      const clamp = v => Math.min(max, Math.max(min, round(v, s)));
      if (range) {                       // adjust both ends together
        if (low != null) low = clamp(low + s * d);
        if (high != null) high = clamp(high + s * d);
      } else if (target != null) {
        target = clamp(target + s * d);
      } else return;
      userEditAt = Date.now();
      paint(st, true);
      clearTimeout(sendTimer);
      sendTimer = setTimeout(push, 500);   // debounce rapid taps into one call
    }
    onBtn(el, '.at-minus', () => bump(-1));
    onBtn(el, '.at-plus', () => bump(1));

    // mode buttons (heat/cool/heat_cool/off)
    el.querySelectorAll('.at-mode').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      if (w.entity) call('climate', 'set_hvac_mode', { hvac_mode: b.dataset.mode });
    });
    // eco preset toggle
    onBtn(el, '.at-eco', () => {
      const a = (HAPanel.state(w.entity) || {}).attributes || {};
      const eco = a.preset_mode === 'eco';
      call('climate', 'set_preset_mode', { preset_mode: eco ? 'none' : 'eco' });
    });
    // fan toggle
    onBtn(el, '.at-fan', () => {
      const a = (HAPanel.state(w.entity) || {}).attributes || {};
      const on = a.fan_mode === 'on';
      call('climate', 'set_fan_mode', { fan_mode: on ? 'off' : 'on' });
    });

    // temperature history sparkline (best-effort)
    const spark = el.querySelector('.at-sparkline');
    if (spark && w.entity) {
      fetch(`/api/history?d=${encodeURIComponent(slug)}` +
            `&entity=${encodeURIComponent(w.entity)}&hours=24`)
        .then(r => r.json()).then(d => {
          const pts = (d.points || []).filter(p => typeof p.v === 'number');
          if (pts.length < 2) return;
          const vs = pts.map(p => p.v);
          const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
          const n = pts.length;
          const coords = pts.map((p, i) =>
            `${(i / (n - 1) * 280).toFixed(1)},${(42 - (p.v - min) / span * 38).toFixed(1)}`);
          spark.setAttribute('points', coords.join(' '));
        }).catch(() => {});
    }

    const paint = (st, local) => {
      if (!st) return;
      const a = st.attributes || {};
      range = a.temperature == null &&
              (a.target_temp_low != null || a.target_temp_high != null);
      // sync from HA unless the user just changed it (avoid snap-back)
      if (!local && Date.now() - userEditAt > 1500) {
        if (range) { low = a.target_temp_low; high = a.target_temp_high; }
        else target = a.temperature;
      }
      const r = skinEl(el);
      const heating = st.state === 'heat' || a.hvac_action === 'heating';
      const cooling = st.state === 'cool' || a.hvac_action === 'cooling';
      r.classList.toggle('heat', heating);
      r.classList.toggle('cool', cooling);
      r.classList.toggle('off', st.state === 'off');
      r.classList.toggle('idle', a.hvac_action === 'idle');
      r.classList.toggle('unavail', st.state === 'unavailable');

      const min = a.min_temp != null ? a.min_temp : 7;
      const max = a.max_temp != null ? a.max_temp : 35;
      const setTxtVal = range
        ? (low != null && high != null ? `${low}–${high}°` : '—')
        : (target != null ? target + '°' : (st.state === 'off' ? 'Off' : '—'));
      const arcVal = range ? high : target;   // arc tracks the upper bound
      const pct = arcVal == null ? 0 :
        Math.max(0, Math.min(1, (arcVal - min) / (max - min)));

      const arc = el.querySelector('.at-arc');
      if (arc) arc.setAttribute('stroke-dashoffset', 100 - pct * 100);

      const cur = a.current_temperature;
      const act = st.state === 'off' ? 'Off'
        : a.hvac_action ? a.hvac_action
        : st.state;
      setTxt(el, '.at-set', setTxtVal);
      setTxt(el, '.at-cur', cur != null ? `Now ${cur}°` : 'Now —');
      setTxt(el, '.at-act', act);
      setTxt(el, '.at-nm', label(w, st));
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-hum', a.current_humidity != null ? `💧 ${a.current_humidity}%` : '');

      // mode buttons: show only supported, highlight active
      const modes = a.hvac_modes || [];
      el.querySelectorAll('.at-mode').forEach(b => {
        b.classList.toggle('hide', modes.length > 0 && !modes.includes(b.dataset.mode));
        b.classList.toggle('active', st.state === b.dataset.mode);
      });
      const eco = el.querySelector('.at-eco');
      if (eco) {
        eco.classList.toggle('hide', !(a.preset_modes || []).includes('eco'));
        eco.classList.toggle('active', a.preset_mode === 'eco');
      }
      const fan = el.querySelector('.at-fan');
      if (fan) {
        fan.classList.toggle('hide', !(a.fan_modes || []).length);
        fan.classList.toggle('active', a.fan_mode === 'on' || a.fan_mode === 'auto');
      }
    };
    updaters.push({ entity: w.entity, fn: st => paint(st, false) });
  }

  if (w.type === 'chart') {
    const hours = w.hours || 24;
    let liveBuf = [];        // fallback: values collected while the panel is open
    let haveHistory = false;
    // live current value + ring gauge + live buffer
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const a = st.attributes || {};
      const unit = w.unit || a.unit_of_measurement || '';
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', `${st.state}${unit ? ' ' + unit : ''}`);
      const num = parseFloat(st.state);
      if (!isNaN(num)) {
        const min = w.min != null ? w.min : 0;
        const max = w.max != null ? w.max : 100;
        const pct = Math.max(0, Math.min(1, (num - min) / (max - min)));
        const ring = el.querySelector('.at-ring');
        if (ring) ring.setAttribute('stroke-dashoffset', (100 - pct * 100).toFixed(1));
        // keep a rolling live buffer; draw it if history was unavailable
        liveBuf.push({ t: Date.now(), v: num });
        if (liveBuf.length > 200) liveBuf.shift();
        if (!haveHistory && liveBuf.length >= 2) drawChart(el, liveBuf);
      }
    }});
    // history graph (refreshes every 5 min); falls back to the live buffer
    const draw = () => {
      if (!w.entity) return;
      fetch(`/api/history?d=${encodeURIComponent(slug)}` +
            `&entity=${encodeURIComponent(w.entity)}&hours=${hours}`)
        .then(r => r.json())
        .then(d => {
          const pts = (d.points || []).filter(p => typeof p.v === 'number');
          if (pts.length >= 2) { haveHistory = true; drawChart(el, pts); }
          else if (liveBuf.length >= 2) drawChart(el, liveBuf);
          else {
            const empty = el.querySelector('.at-empty');
            if (empty) { empty.style.display = 'block';
              empty.textContent = 'no history — collecting live…'; }
          }
        })
        .catch(() => { if (liveBuf.length >= 2) drawChart(el, liveBuf); });
    };
    atPoll(el, draw, 5 * 60 * 1000);
  }

  if (w.type === 'camera') {
    const img = el.querySelector('.at-cam');
    const ph = el.querySelector('.at-camph');
    if (img && w.entity) {
      const refresh = () => {
        img.src = `/api/camera?d=${encodeURIComponent(slug)}` +
          `&entity=${encodeURIComponent(w.entity)}&_=${Date.now()}`;
      };
      img.onload = () => { img.style.opacity = 1; if (ph) ph.style.display = 'none'; };
      img.onerror = () => { img.style.opacity = 0; if (ph) ph.style.display = 'flex'; };
      // Camera snapshots are the heaviest poller on a dashboard (2 s by
      // default): stop them dead when the widget is off screen or hidden.
      atPoll(el, refresh, Math.max(500, (w.refresh || 2) * 1000));
      // tap to go fullscreen
      el.classList.add('tap');
      el.onclick = () => {
        const t = el;
        (t.requestFullscreen || t.webkitRequestFullscreen || (() => {})).call(t)
          ?.catch?.(() => {});
      };
    }
    const tm = el.querySelector('.at-time');
    if (tm) { const tick = () => tm.textContent =
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      tick(); setInterval(tick, 1000); }
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-state', st.state);
    }});
  }

  if (w.type === 'vacuum') {
    onBtn(el, '.at-start', () => call('vacuum', 'start'));
    onBtn(el, '.at-pause', () => call('vacuum', 'pause'));
    onBtn(el, '.at-stop', () => call('vacuum', 'stop'));
    onBtn(el, '.at-dock', () => call('vacuum', 'return_to_base'));
    onBtn(el, '.at-locate', () => call('vacuum', 'locate'));
    onBtn(el, '.at-spot', () => call('vacuum', 'clean_spot'));
    // fan speed cycle through the entity's fan_speed_list
    onBtn(el, '.at-fanspeed', () => {
      const a = (HAPanel.state(w.entity) || {}).attributes || {};
      const list = a.fan_speed_list || [];
      if (!list.length) return;
      const i = list.indexOf(a.fan_speed);
      call('vacuum', 'set_fan_speed', { fan_speed: list[(i + 1) % list.length] });
    });

    // live map image (Roborock etc.) from a camera/image entity
    const mapImg = el.querySelector('.at-map');
    if (mapImg && w.mapEntity) {
      const refresh = () => {
        mapImg.src = `/api/camera?d=${encodeURIComponent(slug)}` +
          `&entity=${encodeURIComponent(w.mapEntity)}&_=${Date.now()}`;
      };
      mapImg.onerror = () => { mapImg.style.display = 'none';
        const ph = el.querySelector('.at-mapph'); if (ph) ph.style.display = 'flex'; };
      mapImg.onload = () => { mapImg.style.display = ''; };
      // Roborock polls ~30 s; refresh a bit faster while the map is visible.
      atPoll(el, refresh, 8000);
    }

    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      const a = st.attributes || {};
      for (const s of ['cleaning','docked','returning','paused','idle','error'])
        r.classList.toggle(s, st.state === s);
      r.classList.toggle('unavail', st.state === 'unavailable');
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', st.state);
      setTxt(el, '.at-bat', a.battery_level != null ? `🔋 ${a.battery_level}%` : '');
      setTxt(el, '.at-fan', a.fan_speed != null ? `${a.fan_speed}` : '');
      if (a.status) setTxt(el, '.at-status', a.status);
    }});
  }

  if (w.type === 'cover') {
    onBtn(el, '.at-up', () => call('cover', 'open_cover'));
    onBtn(el, '.at-stop', () => call('cover', 'stop_cover'));
    onBtn(el, '.at-down', () => call('cover', 'close_cover'));
    // tap-to-toggle skins (e.g. garage tile) have no buttons
    if (!el.querySelector('.at-up')) {
      el.classList.add('tap');
      el.onclick = () => {
        if (!w.entity) return;
        const st = HAPanel.state(w.entity);
        const closed = st && (st.state === 'closed' || st.state === 'off');
        call('cover', closed ? 'open_cover' : 'close_cover');
      };
    }
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      for (const c of ['open','closed','opening','closing'])
        r.classList.toggle(c, st.state === c);
      r.classList.toggle('unavail', st.state === 'unavailable');
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', st.state);
    }});
  }

  if (w.type === 'valve') {
    el.classList.add('tap');
    el.onclick = () => {
      if (!w.entity) return;
      const st = HAPanel.state(w.entity);
      if (domain() === 'valve')
        call('valve', st && st.state === 'open' ? 'close_valve' : 'open_valve');
      else call(domain(), 'toggle');
    };
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      const open = ['open','on'].includes(st.state);
      r.classList.toggle('open', open);
      r.classList.toggle('closed', !open);
      r.classList.toggle('unavail', st.state === 'unavailable');
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-val', st.state);
    }});
  }

  if (w.type === 'media') {
    onBtn(el, '.at-play', () => call('media_player', 'media_play_pause'));
    onBtn(el, '.at-prev', () => call('media_player', 'media_previous_track'));
    onBtn(el, '.at-next', () => call('media_player', 'media_next_track'));
    onBtn(el, '.at-vup', () => call('media_player', 'volume_up'));
    onBtn(el, '.at-vdn', () => call('media_player', 'volume_down'));
    updaters.push({ entity: w.entity, fn: st => {
      if (!st) return;
      const r = skinEl(el);
      const a = st.attributes || {};
      r.classList.toggle('playing', st.state === 'playing');
      r.classList.toggle('unavail', st.state === 'unavailable');
      setTxt(el, '.at-name', label(w, st));
      setTxt(el, '.at-title', a.media_title
        ? `${a.media_title}${a.media_artist ? ' — ' + a.media_artist : ''}`
        : st.state);
    }});
  }

  if (w.type === 'clock') {
    const tick = () => {
      setTxt(el, '.at-val', new Date().toLocaleTimeString([], { hour: '2-digit',
                                                                minute: '2-digit' }));
      setTxt(el, '.at-name', new Date().toLocaleDateString([], { weekday: 'long',
                                          day: 'numeric', month: 'long' }));
    };
    tick(); setInterval(tick, 5000);
  }

  if (w.type === 'fbnotes') {
    const wrap = el.querySelector('.at-fbwrap');
    setTxt(el, '.at-name', w.label || 'Family notes');
    let painted = false;
    // stable pseudo-random tilt per note (sticky skin uses --rot, feed ignores)
    const rot = id => {
      let h = 0; const s = String(id);
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return (((h % 7) + 7) % 7 - 3) * 1.1;
    };
    atFB.sub(data => {
      if (!wrap) return;
      if (data.error) {
        if (!painted) wrap.innerHTML =
          '<div class="at-fbempty">Family Board isn\'t available</div>';
        return;
      }
      painted = true;
      const notes = data.notes || [];
      if (!notes.length) {
        wrap.innerHTML = '<div class="at-fbempty">No notes right now 📝</div>';
        return;
      }
      wrap.innerHTML = notes.map(n => {
        const nr = (n.replies || []).length;
        return `<div class="note" data-id="${esc(n.id)}" style="--nc:${
          esc(n.color || '#ffd76e')};--rot:${rot(n.id).toFixed(1)}deg">` +
          `<div class="ntext">${esc(n.text)}</div>` +
          `<div class="nfoot"><span class="nauthor">${esc(n.author || '')}</span>` +
          `<span class="ntime">${timeAgo(n.created)}</span>` +
          `${nr ? `<span class="nre">💬 ${nr}</span>` : ''}</div></div>`;
      }).join('');
    });
    el.addEventListener('click', ev => {
      const n = ev.target.closest('.note');
      if (n && n.dataset.id != null) atOpenNote(n.dataset.id);
    });
  }

  if (w.type === 'fblist') {
    const wrap = el.querySelector('.at-fblwrap');
    setTxt(el, '.at-name', w.label || 'List');
    let painted = false;
    const post = body => jsonFetch('/api/dash/family_board/item', 'POST',
      Object.assign({ d: slug, entity_id: w.entity }, body))
      .catch(() => {}).then(() => atFB.refresh());
    atFB.sub(data => {
      if (data.error) {
        if (!painted && wrap) wrap.innerHTML =
          '<div class="at-fbempty">Family Board isn\'t available</div>';
        return;
      }
      painted = true;
      const list = (data.lists || []).find(l => l.entity_id === w.entity) || {};
      if (!w.label && list.name) setTxt(el, '.at-name', list.name);
      const items = list.items || [];
      const todo = items.filter(i => i.status !== 'completed');
      const done = items.filter(i => i.status === 'completed');
      setTxt(el, '.at-fblcount', String(todo.length));
      const row = (i, d) =>
        `<div class="li${d ? ' done' : ''}" data-uid="${esc(i.uid)}"` +
        ` data-st="${d ? 'completed' : 'needs_action'}">` +
        `<button class="ck"></button><span class="tx">${esc(i.summary)}</span></div>`;
      if (wrap) wrap.innerHTML = items.length
        ? todo.map(i => row(i, false)).join('') + done.map(i => row(i, true)).join('')
        : '<div class="at-fbempty">Nothing here 🎉</div>';
    });
    el.addEventListener('click', ev => {
      if (!w.entity) return;
      const ck = ev.target.closest('.ck');
      if (ck) {
        const li = ck.closest('.li');
        const goingDone = li.dataset.st !== 'completed';
        li.classList.toggle('done', goingDone);             // optimistic
        li.dataset.st = goingDone ? 'completed' : 'needs_action';
        post({ action: 'toggle', uid: li.dataset.uid,
               status: goingDone ? 'completed' : 'needs_action' });
        return;
      }
      if (ev.target.closest('.at-fbladdbtn')) { addItem(); return; }
      const clr = ev.target.closest('.at-fblclear');
      if (clr) {                                            // two-tap confirm
        if (clr.classList.contains('arm')) {
          clr.classList.remove('arm');
          clr.textContent = 'Clear done';
          post({ action: 'remove_completed' });
        } else {
          clr.classList.add('arm');
          clr.textContent = 'Sure?';
          clearTimeout(clr._t);
          clr._t = setTimeout(() => { clr.classList.remove('arm');
            clr.textContent = 'Clear done'; }, 2600);
        }
      }
    });
    const addInp = el.querySelector('.at-fbladd');
    function addItem() {
      if (!addInp || !w.entity) return;
      const summary = addInp.value.trim();
      if (!summary) return;
      addInp.value = '';
      post({ action: 'add', summary });
    }
    if (addInp) {
      addInp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') addItem(); });
      addInp.addEventListener('pointerdown', ev => ev.stopPropagation());
    }
  }

  if (w.type === 'energysum') {
    const range = w.range || 'today';
    setTxt(el, '.at-name', w.label || 'Energy');
    setTxt(el, '.at-enrange',
      { today: 'today', yesterday: 'yesterday', week: 'this week',
        month: 'this month' }[range] || range);
    let painted = false;
    const clear = () => {
      setTxt(el, '.at-enkwh', '—'); setTxt(el, '.at-encost', '');
      const b = el.querySelector('.at-enbars'); if (b) b.innerHTML = '';
      const t = el.querySelector('.at-entop'); if (t) t.innerHTML = '';
    };
    const draw = () => jsonFetch(`/api/dash/energy_center/summary` +
      `?d=${encodeURIComponent(slug)}&range=${encodeURIComponent(range)}`)
      .then(d => {
        const r = skinEl(el);
        if (!r) return;
        if (d.unconfigured) { r.classList.add('encfg'); return; }
        r.classList.remove('encfg');
        painted = true;
        setTxt(el, '.at-enkwh',
          d.total_kwh != null ? (+d.total_kwh).toFixed(1) : '—');
        setTxt(el, '.at-encost', d.total_cost != null
          ? `${(+d.total_cost).toFixed(2)} ${d.currency || ''}`.trim() : '');
        const bars = el.querySelector('.at-enbars');
        if (bars) {
          const s = d.series || [];
          const max = Math.max(0.001, ...s.map(x => +x.kwh || 0));
          bars.innerHTML = s.map(x =>
            `<div class="eb" style="--pct:${
              Math.round((+x.kwh || 0) / max * 100)}"><i></i>` +
            `<span>${esc(x.label)}</span></div>`).join('');
        }
        const top = el.querySelector('.at-entop');
        if (top) top.innerHTML = (d.top || []).slice(0, 6).map((t, i) =>
          `<div class="er"><span class="rk">${i + 1}</span>` +
          `<span class="nm">${esc(t.name)}</span>` +
          `<i class="bar" style="--pct:${
            Math.max(0, Math.min(100, Math.round(+t.pct || 0)))}"></i>` +
          `<b class="kw">${(+t.kwh || 0).toFixed(1)}</b></div>`).join('');
      })
      .catch(() => { if (!painted) clear(); });
    atPoll(el, draw, 60000);
  }

  if (w.type === 'intercom') {
    el.classList.add('tap');
    setTxt(el, '.at-name', w.label || 'Announce');
    el.onclick = () => atOpenIntercom(w);
  }

  if (w.type === 'seckeypad') {
    setTxt(el, '.at-name', w.label || 'Security');
    const pad = atSecPad(w, el, { stateEl: skinEl(el) || el });
    if (!el.querySelector('.at-skgrid')) {   // compact skins open the overlay
      el.classList.add('tap');
      el.onclick = () => atOpenSecKeypad(w);
    }
    atPoll(el, pad.refresh, 3000);
  }
}

boot();
})();
