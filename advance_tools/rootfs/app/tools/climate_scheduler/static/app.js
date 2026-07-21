/* Climate Scheduler — frontend logic.
   Vanilla JS, no dependencies. Talks to /api/tools/climate_scheduler/*.
   Editor keeps blocks in minutes internally; the API uses "HH:MM" strings. */
'use strict';

const API = '/api/tools/climate_scheduler';
const DKEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday',
               'saturday', 'sunday'];
const DSHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
         "'": '&#39;'}[c]));

let DATA = { connected: false, schedules: {}, climates: [], log: [] };
let ED = null;       // editor state (null when the editor is closed)
let CELLS = null;    // 7x48 grid cell element refs
let PAINT = null;    // active drag {d0,c0,d1,c1,moved}
let SEL = null;      // selected block {day, from, to} (minutes)
let CONFIRM = null;  // sid pending deletion

// ---------------------------------------------------------------- utilities

const toMin = hhmm => {
  const p = String(hhmm).split(':');
  return (+p[0]) * 60 + (+p[1] || 0);
};
const toHM = min => String(Math.floor(min / 60)).padStart(2, '0') + ':' +
                    String(min % 60).padStart(2, '0');
const fmtTemp = t => String(Math.round(t * 10) / 10);
const clim = id => DATA.climates.find(c => c.entity_id === id);

function tempColor(t) {
  // cold blue (~15°) -> warm red (~27°)
  const r = Math.max(0, Math.min(1, (t - 15) / 12));
  const hue = 210 - r * 205;
  return `hsl(${Math.round(hue)},72%,${Math.round(46 + r * 10)}%)`;
}

async function api(path, opts = {}) {
  const r = await fetch(API + path,
    Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  let body = {};
  try { body = await r.json(); } catch (e) { /* non-JSON error page */ }
  if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
  return body;
}

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3500);
}

function relTime(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function openModal(sel) { $(sel).classList.add('open'); }
function closeModal(sel) { $(sel).classList.remove('open'); }

// ---------------------------------------------------------------- hints

const HINTS = {
  name: { t: 'Schedule name',
    b: 'A label so you can tell your schedules apart. It only lives in this tool and does not change anything in Home Assistant.',
    ex: 'Living room weekly heating' },
  entity: { t: 'Climate entity',
    b: 'The thermostat this schedule controls. Only entities from the climate domain are listed, each with its current state and measured temperature. One schedule controls exactly one entity — avoid pointing two schedules at the same thermostat.',
    ex: 'climate.living_room' },
  palette: { t: 'Temperature palette',
    b: 'Pick a temperature chip, then drag across the grid to paint blocks with it. Chip steps follow the thermostat\'s own step size (default 0.5°). Colors run from cool blue to warm red so the whole week is readable at a glance. Use the Erase chip to remove painted cells, or type any value in Custom.',
    ex: 'Select 21° → drag Mon 06:30–08:30' },
  grid: { t: 'Weekly grid',
    b: 'Each row is a day, each cell is 30 minutes (midnight on the left, midnight on the right). Press and drag to paint a block with the selected temperature — drag vertically to cover several days in one stroke. Painting over an existing block replaces those cells; touching blocks with the same temperature merge into one. Click a block to select it and fine-tune exact times below the grid.',
    ex: 'Drag from the 17:00 cell to the 21:30 cell on Fri' },
  copy: { t: 'Copy Monday to…',
    b: 'Copies all of Monday\'s blocks onto other days, replacing whatever they had. Handy workflow: design Monday first, copy it to the weekdays, then adjust the weekend by hand.',
    ex: 'Tue–Fri → Monday\'s blocks appear on Tue, Wed, Thu and Fri' },
  outside: { t: 'Outside blocks',
    b: 'What happens whenever the current time is not inside any painted block:\n• Turn off — switches the thermostat off (typical for heating schedules).\n• Keep at fallback — keeps it running at a lower temperature (night setback / frost protection).\n• Do nothing — the scheduler only acts inside blocks and never touches the thermostat in between, so manual changes stick.',
    ex: 'Keep at fallback 17° = classic night setback' },
  block: { t: 'Block details',
    b: 'Fine-tune the selected block: exact minutes (not just half-hours) and temperature. The +/− buttons follow the thermostat\'s step size. Changes replace any blocks they now overlap.',
    ex: '06:45–08:15 → 21.5°' },
  log: { t: 'Activity log',
    b: 'The last 50 actions the scheduler performed: turning thermostats on or off and setting target temperatures, with the reason. If a minute passes and nothing was wrong, nothing is logged — the scheduler only acts when the live state differs from the schedule.',
    ex: 'set_temperature · climate.living_room — 21° — block 06:30–08:30' },
};

document.addEventListener('mouseover', e => {
  const h = e.target.closest ? e.target.closest('.hint') : null;
  if (!h) return;
  const d = HINTS[h.dataset.hint];
  if (!d) return;
  const tip = $('#tipbox');
  tip.innerHTML = '<b class="t">' + esc(d.t) + '</b>' +
    esc(d.b).replace(/\n/g, '<br>') +
    (d.ex ? '<div class="ex">' + esc(d.ex) + '</div>' : '');
  tip.style.display = 'block';
  const r = h.getBoundingClientRect();
  const w = Math.min(window.innerWidth * 0.92, 360);
  tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
  tip.style.top = (r.bottom + 8) + 'px';
  const th = tip.offsetHeight;
  if (r.bottom + 8 + th > window.innerHeight - 8) {
    tip.style.top = Math.max(8, r.top - th - 8) + 'px';
  }
});
document.addEventListener('mouseout', e => {
  if (e.target.closest && e.target.closest('.hint')) {
    $('#tipbox').style.display = 'none';
  }
});

// ---------------------------------------------------------------- main view

function renderConn() {
  const n = DATA.climates.length;
  $('#connStat').innerHTML =
    '<span class="dot ' + (DATA.connected ? 'ok' : '') + '"></span>' +
    (DATA.connected ? 'connected to Home Assistant' : 'not connected to Home Assistant') +
    ' · ' + n + ' climate ' + (n === 1 ? 'entity' : 'entities');
}

function stripGrad(blocks) {
  const base = 'var(--input)';
  const sorted = (blocks || []).slice()
    .sort((a, b) => toMin(a.from) - toMin(b.from));
  if (!sorted.length) return base;
  const stops = ['var(--input) 0%'];
  for (const b of sorted) {
    const p1 = (toMin(b.from) / 1440 * 100).toFixed(2);
    const p2 = (toMin(b.to) / 1440 * 100).toFixed(2);
    const col = tempColor(+b.temp);
    stops.push(`${base} ${p1}%`, `${col} ${p1}%`, `${col} ${p2}%`,
               `${base} ${p2}%`);
  }
  stops.push('var(--input) 100%');
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function nowInfo(s) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;             // Mon = 0
  const cur = now.getHours() * 60 + now.getMinutes();
  const blocks = (s.blocks && s.blocks[DKEYS[day]]) || [];
  for (const b of blocks) {
    if (cur >= toMin(b.from) && cur < toMin(b.to)) {
      return 'Now: ' + fmtTemp(+b.temp) + '° until ' + b.to;
    }
  }
  const outside = s.outside === 'off' ? 'off'
    : s.outside === 'temp' ? fmtTemp(+s.outside_temp) + '°' : 'untouched';
  const next = blocks.filter(b => toMin(b.from) > cur)
    .sort((a, b) => toMin(a.from) - toMin(b.from))[0];
  return 'Outside blocks → ' + outside +
    (next ? ' · next: ' + fmtTemp(+next.temp) + '° at ' + next.from : '');
}

function emptyHTML() {
  const noClim = !DATA.climates.length;
  return '<div class="empty">' +
    '<div style="font-size:42px;line-height:1.4">🗓️</div>' +
    '<b>No schedules yet</b><br>' +
    'A schedule paints your week with target temperatures — for example ' +
    '<i>"Mon–Fri: 06:30–08:30 → 21°, 17:00–22:00 → 21.5°, off in between"</i> ' +
    'as colored blocks on a 7-day grid.<br>' +
    'The add-on applies it to your thermostat every minute. No HA automations, ' +
    'nothing to maintain.<br><br>' +
    (noClim
      ? '<span style="color:var(--warn)">No climate entities were found in Home ' +
        'Assistant — add a thermostat / TRV integration first, then come back.</span>'
      : '<button class="btn" onclick="openEditor(null)">＋ Create your first schedule</button>' +
        ' <button class="ghost" style="margin-left:8px" onclick="openModal(\'#learnModal\')">📖 Learn how it works</button>') +
    '</div>';
}

function renderCards() {
  const wrap = $('#cards');
  const entries = Object.entries(DATA.schedules)
    .sort((a, b) => String(a[1].name || '').localeCompare(String(b[1].name || '')));
  if (!entries.length) { wrap.innerHTML = emptyHTML(); return; }
  wrap.innerHTML = entries.map(([sid, s]) => {
    const c = clim(s.entity_id);
    const cname = c ? c.name : s.entity_id + ' (not found)';
    const curT = c && c.current_temperature != null
      ? fmtTemp(+c.current_temperature) + '°' : '—';
    const tgtT = c && c.temperature != null ? fmtTemp(+c.temperature) + '°' : '—';
    const stateTxt = c ? c.state : 'missing';
    const strip = DKEYS.map((k, i) =>
      `<div class="srow" title="${DSHORT[i]}" style="background:${stripGrad((s.blocks || {})[k])}"></div>`
    ).join('');
    return `<div class="scard ${s.enabled ? '' : 'disabled'}" data-sid="${esc(sid)}">
      <div class="top">
        <div class="ticon">🌡️</div>
        <div class="nm"><b>${esc(s.name)}</b>
          <span class="eid" title="${esc(s.entity_id)}">${esc(cname)} · ${esc(stateTxt)} ·
            <span class="tval">${curT} → ${tgtT}</span></span></div>
        <div class="sw ${s.enabled ? 'on' : ''}" data-act="toggle"
          title="${s.enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}"></div>
      </div>
      <div class="strip">${strip}</div>
      <div class="nowline">${esc(nowInfo(s))}${s.enabled ? '' : ' · schedule paused'}</div>
      <div class="foot">
        <span class="last">${esc(s.entity_id)}</span>
        <button class="iconbtn" data-act="edit" title="Edit schedule">✏️</button>
        <button class="iconbtn" data-act="apply" title="Apply now">▶</button>
        <button class="iconbtn danger" data-act="del" title="Delete schedule">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function renderLog() {
  const rows = (DATA.log || []).slice().reverse();
  $('#logBody').innerHTML = rows.length
    ? rows.map(l => `<div class="logrow">
        <span class="lt">${esc(relTime(l.ts))}</span>
        <span class="la ${l.action === 'turn_off' ? 'off' : ''}">${esc(l.action)}</span>
        <span class="ld">${esc(l.entity_id)} — ${esc(l.detail)}</span>
      </div>`).join('')
    : '<div class="lognone">No actions yet. When the scheduler turns a ' +
      'thermostat on/off or changes its target temperature, it shows up here ' +
      'with the reason.</div>';
}

async function refresh() {
  try {
    DATA = await api('/data');
    renderConn(); renderCards(); renderLog();
  } catch (e) {
    $('#connStat').innerHTML = '<span class="dot"></span>' + esc(e.message);
  }
}

// card actions (event delegation)
$('#cards').addEventListener('click', async e => {
  const card = e.target.closest('.scard');
  if (!card) return;
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const sid = card.dataset.sid;
  const s = DATA.schedules[sid];
  if (!s) return;
  const a = act.dataset.act;
  if (a === 'edit') { openEditor(sid); return; }
  if (a === 'toggle') {
    try {
      await api(`/schedule/${sid}/enable`,
        { method: 'POST', body: JSON.stringify({ enabled: !s.enabled }) });
      s.enabled = !s.enabled;
      renderCards();
      toast(s.enabled ? 'Schedule enabled' : 'Schedule paused');
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (a === 'apply') {
    act.disabled = true;
    try {
      const r = await api(`/schedule/${sid}/apply`, { method: 'POST', body: '{}' });
      if (r.skipped) toast('Skipped: ' + r.skipped, true);
      else if (!(r.actions || []).length) toast('Already in the right state — nothing to do');
      else toast('Applied: ' + r.actions.map(x => x.action + ' (' + x.detail + ')').join(', '));
      refresh();
    } catch (err) { toast(err.message, true); }
    act.disabled = false;
    return;
  }
  if (a === 'del') {
    CONFIRM = sid;
    $('#confirmSub').textContent = 'Delete "' + s.name + '"? The thermostat ' +
      'keeps its current setting — the add-on just stops managing it.';
    openModal('#confirmModal');
  }
});

$('#confirmYes').addEventListener('click', async () => {
  if (!CONFIRM) return;
  try {
    await api('/schedule/' + CONFIRM, { method: 'DELETE' });
    toast('Schedule deleted');
    closeModal('#confirmModal');
    refresh();
  } catch (e) { toast(e.message, true); }
  CONFIRM = null;
});

// ---------------------------------------------------------------- editor

function entStep() {
  const c = clim(ED.entity_id);
  const s = c && +c.target_temp_step;
  return (s && s > 0 && s <= 5) ? s : 0.5;
}

function entClamp(t) {
  const c = clim(ED.entity_id);
  if (c && c.min_temp != null) t = Math.max(t, +c.min_temp);
  if (c && c.max_temp != null) t = Math.min(t, +c.max_temp);
  return Math.round(t * 10) / 10;
}

function openEditor(sid) {
  const s = sid ? DATA.schedules[sid] : null;
  ED = {
    sid: sid || null,
    entity_id: s ? s.entity_id
      : (DATA.climates[0] ? DATA.climates[0].entity_id : ''),
    enabled: s ? !!s.enabled : true,
    outside: s ? s.outside : 'off',
    outside_temp: s ? +s.outside_temp : 17,
    blocks: {},
    temp: 21,
    erase: false,
  };
  for (const k of DKEYS) {
    ED.blocks[k] = ((s && s.blocks && s.blocks[k]) || [])
      .map(b => ({ from: toMin(b.from), to: toMin(b.to), temp: +b.temp }));
  }
  SEL = null;
  PAINT = null;
  $('#edTitle').textContent = sid ? 'Edit Schedule' : 'New Schedule';
  $('#edName').value = s ? s.name : '';
  $('#edOutTemp').value = ED.outside_temp;
  $('#edErr').style.display = 'none';
  setEntity(ED.entity_id);
  renderOutside();
  buildGrid();
  renderLegend();
  repaintGrid();
  renderBlockPanel();
  renderSummary();
  openModal('#edModal');
}

// -- entity combo

function setEntity(id) {
  ED.entity_id = id || '';
  const c = clim(id);
  $('#edEntity').value = c ? c.name : (id || '');
  $('#edEntityList').classList.remove('open');
  renderPalette();
}

function renderEntityList(q) {
  const list = $('#edEntityList');
  const ql = (q || '').toLowerCase();
  const items = DATA.climates.filter(c => !ql ||
    c.name.toLowerCase().includes(ql) || c.entity_id.includes(ql));
  list.innerHTML = items.length
    ? items.map(c => `<div class="combo-it" data-id="${esc(c.entity_id)}">
        <span class="cn">${esc(c.name)}
          <small style="color:var(--mut)">· ${esc(c.state)}${
            c.current_temperature != null
              ? ' · ' + fmtTemp(+c.current_temperature) + '°' : ''}</small></span>
        <span class="cid">${esc(c.entity_id)}</span></div>`).join('')
    : '<div class="combo-it" style="cursor:default;color:var(--mut)">No climate entities match</div>';
  list.classList.add('open');
}

$('#edEntity').addEventListener('focus', () => renderEntityList(''));
$('#edEntity').addEventListener('input',
  e => renderEntityList(e.target.value));
$('#edEntityList').addEventListener('mousedown', e => {
  const it = e.target.closest('.combo-it[data-id]');
  if (!it) return;
  e.preventDefault();
  setEntity(it.dataset.id);
});
document.addEventListener('mousedown', e => {
  if (!e.target.closest || !e.target.closest('.combo-wrap')) {
    $('#edEntityList').classList.remove('open');
  }
});

// -- palette + legend

function renderPalette() {
  if (!ED) return;
  const step = entStep();
  const temps = [];
  for (let t = 16; t <= 24.0001; t += step) temps.push(Math.round(t * 10) / 10);
  $('#edPalette').innerHTML =
    temps.map(t =>
      `<button type="button" class="tchip ${!ED.erase && Math.abs(ED.temp - t) < 0.001 ? 'on' : ''}"
        data-t="${t}" style="--tc:${tempColor(t)}">${fmtTemp(t)}°</button>`).join('') +
    `<span class="custom">Custom
      <input type="number" id="edCustom" step="${step}" value="${fmtTemp(ED.temp)}">°</span>` +
    `<button type="button" class="tchip erase ${ED.erase ? 'on' : ''}" data-erase="1">⌫ Erase</button>`;
  const c = clim(ED.entity_id);
  $('#edRange').textContent = c && c.min_temp != null && c.max_temp != null
    ? `entity range ${c.min_temp}–${c.max_temp}°, step ${step}` : '';
}

function renderLegend() {
  const stops = [];
  for (let i = 0; i <= 8; i++) {
    stops.push(`${tempColor(16 + i)} ${(i / 8 * 100).toFixed(0)}%`);
  }
  $('#edLegend').innerHTML =
    `<div class="lbar" style="background:linear-gradient(to right, ${stops.join(',')})"></div>
     <div class="llab"><span>16° cooler</span><span>20°</span><span>24° warmer</span></div>`;
}

$('#edPalette').addEventListener('click', e => {
  const chip = e.target.closest('.tchip');
  if (!chip) return;
  if (chip.dataset.erase) { ED.erase = true; }
  else { ED.temp = +chip.dataset.t; ED.erase = false; }
  renderPalette();
});
$('#edPalette').addEventListener('change', e => {
  if (e.target.id !== 'edCustom') return;
  const v = parseFloat(e.target.value);
  if (!isNaN(v)) { ED.temp = entClamp(v); ED.erase = false; renderPalette(); }
});

// -- weekly grid

function buildGrid() {
  const g = $('#edGrid');
  g.innerHTML = '';
  CELLS = [];
  for (let d = 0; d < 7; d++) {
    const lab = document.createElement('div');
    lab.className = 'daylab';
    lab.textContent = DSHORT[d];
    g.appendChild(lab);
    CELLS[d] = [];
    for (let c = 0; c < 48; c++) {
      const el = document.createElement('div');
      el.className = 'cell' + (c % 2 === 0 ? ' hr' : '');
      el.dataset.d = d;
      el.dataset.c = c;
      el.title = DSHORT[d] + ' ' + toHM(c * 30) + '–' + toHM(c * 30 + 30);
      g.appendChild(el);
      CELLS[d][c] = el;
    }
  }
  $('#edHours').innerHTML = '<div></div>' +
    Array.from({ length: 8 },
      (_, i) => `<div>${String(i * 3).padStart(2, '0')}:00</div>`).join('');
}

function blockAt(d, minute) {
  return ED.blocks[DKEYS[d]].find(b => minute >= b.from && minute < b.to) || null;
}

function cutRange(list, a, b) {
  const out = [];
  for (const bl of list) {
    if (bl.to <= a || bl.from >= b) { out.push(bl); continue; }
    if (bl.from < a) out.push({ from: bl.from, to: a, temp: bl.temp });
    if (bl.to > b) out.push({ from: b, to: bl.to, temp: bl.temp });
  }
  return out;
}

function paintRange(d, a, b, temp) {
  const key = DKEYS[d];
  let list = cutRange(ED.blocks[key], a, b);
  if (temp != null) list.push({ from: a, to: b, temp: temp });
  list.sort((x, y) => x.from - y.from);
  const merged = [];
  for (const bl of list) {
    const last = merged[merged.length - 1];
    if (last && last.to === bl.from && Math.abs(last.temp - bl.temp) < 0.001) {
      last.to = bl.to;
    } else {
      merged.push({ from: bl.from, to: bl.to, temp: bl.temp });
    }
  }
  ED.blocks[key] = merged;
}

function normRect(p) {
  return { d1: Math.min(p.d0, p.d1), d2: Math.max(p.d0, p.d1),
           c1: Math.min(p.c0, p.c1), c2: Math.max(p.c0, p.c1) };
}

function repaintGrid() {
  if (!ED || !CELLS) return;
  const pv = PAINT && PAINT.moved ? normRect(PAINT) : null;
  for (let d = 0; d < 7; d++) {
    for (let c = 0; c < 48; c++) {
      const el = CELLS[d][c];
      const m = c * 30 + 15;
      let col = '';
      const inPv = pv && d >= pv.d1 && d <= pv.d2 && c >= pv.c1 && c <= pv.c2;
      if (inPv) {
        col = ED.erase ? '' : tempColor(ED.temp);
      } else {
        const b = blockAt(d, m);
        if (b) col = tempColor(b.temp);
      }
      el.style.background = col;
      el.classList.toggle('pv', !!inPv);
      el.classList.toggle('sel',
        !!(SEL && SEL.day === d && m >= SEL.from && m < SEL.to));
    }
  }
}

$('#edGrid').addEventListener('mousedown', e => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  e.preventDefault();
  PAINT = { d0: +cell.dataset.d, c0: +cell.dataset.c,
            d1: +cell.dataset.d, c1: +cell.dataset.c, moved: false };
});

$('#edGrid').addEventListener('mousemove', e => {
  if (!PAINT) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const d = +cell.dataset.d, c = +cell.dataset.c;
  if (d !== PAINT.d1 || c !== PAINT.c1) {
    PAINT.d1 = d;
    PAINT.c1 = c;
    PAINT.moved = PAINT.moved || d !== PAINT.d0 || c !== PAINT.c0;
    repaintGrid();
  }
});

document.addEventListener('mouseup', () => {
  if (!PAINT) return;
  const p = PAINT;
  PAINT = null;
  if (!p.moved) {
    const d = p.d0, m = p.c0 * 30 + 15;
    const b = blockAt(d, m);
    if (b && !ED.erase) {                       // click on a block = select it
      SEL = { day: d, from: b.from, to: b.to };
      renderBlockPanel();
      repaintGrid();
      return;
    }
    paintRange(d, p.c0 * 30, p.c0 * 30 + 30, ED.erase ? null : ED.temp);
  } else {
    const r = normRect(p);
    for (let d = r.d1; d <= r.d2; d++) {
      paintRange(d, r.c1 * 30, (r.c2 + 1) * 30, ED.erase ? null : ED.temp);
    }
  }
  SEL = null;
  renderBlockPanel();
  repaintGrid();
  renderSummary();
});

// -- selected block panel

function selBlock() {
  if (!SEL) return null;
  return ED.blocks[DKEYS[SEL.day]]
    .find(b => b.from === SEL.from && b.to === SEL.to) || null;
}

function renderBlockPanel() {
  const panel = $('#edBlockPanel');
  const b = selBlock();
  if (!b) { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  $('#bpDay').textContent = DSHORT[SEL.day];
  $('#bpFrom').value = toHM(b.from);
  $('#bpTo').value = toHM(b.to);
  $('#bpTemp').textContent = fmtTemp(b.temp) + '°';
}

function bpUpdate(newTemp) {
  const b = selBlock();
  if (!b) return;
  const fv = $('#bpFrom').value, tv = $('#bpTo').value;
  const f = fv ? toMin(fv) : b.from;
  const t = tv ? toMin(tv) : b.to;
  if (!(f < t)) {
    toast('"From" must be earlier than "To"', true);
    renderBlockPanel();
    return;
  }
  const temp = newTemp != null ? entClamp(newTemp) : b.temp;
  const day = SEL.day, key = DKEYS[day];
  ED.blocks[key] = cutRange(ED.blocks[key], b.from, b.to);
  paintRange(day, f, t, temp);
  const nb = ED.blocks[key].find(x => f >= x.from && f < x.to);
  SEL = nb ? { day: day, from: nb.from, to: nb.to } : null;
  renderBlockPanel();
  repaintGrid();
  renderSummary();
}

$('#bpFrom').addEventListener('change', () => bpUpdate());
$('#bpTo').addEventListener('change', () => bpUpdate());
$('#bpMinus').addEventListener('click', () => {
  const b = selBlock();
  if (b) bpUpdate(Math.round((b.temp - entStep()) * 10) / 10);
});
$('#bpPlus').addEventListener('click', () => {
  const b = selBlock();
  if (b) bpUpdate(Math.round((b.temp + entStep()) * 10) / 10);
});
$('#bpDelete').addEventListener('click', () => {
  const b = selBlock();
  if (!b) return;
  const key = DKEYS[SEL.day];
  ED.blocks[key] = cutRange(ED.blocks[key], b.from, b.to);
  SEL = null;
  renderBlockPanel();
  repaintGrid();
  renderSummary();
});

// -- copy Monday

$$('.copyrow [data-copy]').forEach(btn => btn.addEventListener('click', () => {
  const mode = btn.dataset.copy;
  const targets = mode === 'weekdays' ? [1, 2, 3, 4]
    : mode === 'weekend' ? [5, 6] : [1, 2, 3, 4, 5, 6];
  for (const d of targets) {
    ED.blocks[DKEYS[d]] = ED.blocks.monday.map(b => ({
      from: b.from, to: b.to, temp: b.temp }));
  }
  SEL = null;
  renderBlockPanel();
  repaintGrid();
  renderSummary();
  toast('Copied Monday to ' + (mode === 'weekdays' ? 'Tue–Fri'
    : mode === 'weekend' ? 'Sat–Sun' : 'all days'));
}));

// -- outside blocks

function renderOutside() {
  $$('#edOutRow .ochip').forEach(ch =>
    ch.classList.toggle('on', ch.dataset.out === ED.outside));
  $('#edOutTempWrap').style.display =
    ED.outside === 'temp' ? 'inline-flex' : 'none';
}

$$('#edOutRow .ochip').forEach(ch => ch.addEventListener('click', () => {
  ED.outside = ch.dataset.out;
  renderOutside();
  renderSummary();
}));
$('#edOutTemp').addEventListener('input', () => renderSummary());

// -- natural-language summary

function dayDesc(d) {
  return ED.blocks[DKEYS[d]].slice()
    .sort((a, b) => a.from - b.from)
    .map(b => `${toHM(b.from)}–${toHM(b.to)} → ${fmtTemp(b.temp)}°`)
    .join(', ');
}

function renderSummary() {
  if (!ED) return;
  const descs = [];
  for (let d = 0; d < 7; d++) descs.push(dayDesc(d));
  const parts = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && descs[j + 1] === descs[i]) j++;
    const label = i === j ? DSHORT[i] : DSHORT[i] + '–' + DSHORT[j];
    parts.push('<b>' + label + '</b>: ' + (descs[i] ? esc(descs[i]) : '<i>no blocks</i>'));
    i = j + 1;
  }
  const fallback = parseFloat($('#edOutTemp').value);
  const outside = ED.outside === 'off' ? 'otherwise <b>off</b>'
    : ED.outside === 'temp'
      ? 'otherwise <b>' + fmtTemp(isNaN(fallback) ? ED.outside_temp : fallback) + '°</b>'
      : 'otherwise <b>untouched</b>';
  $('#edSummary').innerHTML = '🗒 ' + parts.join('; ') + '; ' + outside;
}

// -- save

$('#edSave').addEventListener('click', async () => {
  const err = $('#edErr');
  err.style.display = 'none';
  const fail = m => { err.textContent = m; err.style.display = 'block'; };
  const name = $('#edName').value.trim();
  if (!name) { fail('Give the schedule a name.'); return; }
  if (!ED.entity_id) { fail('Pick a climate entity.'); return; }
  const blocks = {};
  for (let d = 0; d < 7; d++) {
    blocks[DKEYS[d]] = ED.blocks[DKEYS[d]].slice()
      .sort((a, b) => a.from - b.from)
      .map(b => ({ from: toHM(b.from), to: toHM(b.to), temp: b.temp }));
  }
  const fallback = parseFloat($('#edOutTemp').value);
  const schedule = {
    name: name,
    entity_id: ED.entity_id,
    enabled: ED.enabled,
    blocks: blocks,
    outside: ED.outside,
    outside_temp: isNaN(fallback) ? 17 : fallback,
  };
  const btn = $('#edSave');
  btn.disabled = true;
  try {
    await api('/schedule', { method: 'POST',
      body: JSON.stringify({ sid: ED.sid, schedule: schedule }) });
    closeModal('#edModal');
    ED = null;
    toast('Schedule saved');
    await refresh();
  } catch (e) {
    fail(e.message);
  }
  btn.disabled = false;
});

// ---------------------------------------------------------------- wiring

$$('.modal [data-close]').forEach(b => b.addEventListener('click',
  () => b.closest('.modal').classList.remove('open')));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $$('.modal.open').forEach(m => m.classList.remove('open'));
    $('#tipbox').style.display = 'none';
  }
});

$('#newBtn').addEventListener('click', () => {
  if (!DATA.climates.length) {
    toast('No climate entities found — connect a thermostat to Home Assistant first.', true);
    return;
  }
  openEditor(null);
});
$('#learnBtn').addEventListener('click', () => openModal('#learnModal'));
$('#edLearn').addEventListener('click', () => openModal('#learnModal'));
$('#learnCreate').addEventListener('click', () => {
  closeModal('#learnModal');
  if (DATA.climates.length) openEditor(null);
});

refresh();
setInterval(refresh, 15000);
