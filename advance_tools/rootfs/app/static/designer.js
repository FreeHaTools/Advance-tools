/* Advance Tools — freeform designer v1.0 (packs, skin library, all device types) */
'use strict';
const SLUG = new URLSearchParams(location.search).get('d');
const $ = s => document.querySelector(s);
const SNAP = 10;

let DESIGN = null;
let ENTITIES = [];
let DASHBOARDS = {};
let SELECTED = null;
let ACTIVE_TAB = null;
let SCALE = 1;
let uid = 0;

const DOMAINS = {
  toggle: ['light','switch','fan','input_boolean','outlet'],
  light: ['light'],
  climate: ['climate'],
  button: ['button','input_button','scene','script','automation',
           'light','switch','fan','input_boolean'],
  vacuum: ['vacuum'],
  cover: ['cover'],
  valve: ['valve','switch'],
  media: ['media_player'],
  select: ['select','input_select'],
  litterbox: ['vacuum'],
  fblist: ['todo'],
  sensor: null,
  chart: null,
  camera: ['camera','image'],
};
const CONTROL_Z = { box: 1, line: 2, label: 2 };

/* gallery section order: General · … blocks first, then device/brand sections.
   Unknown categories (custom packs) fall to the end, alphabetically. */
const CATEGORY_ORDER = ['General · Basics','General · Lights','General · RGB Lights',
  'General · Switches','General · Buttons','General · Sockets','General · Sensors',
  'General · Gauges','General · Climate','General · Covers','General · Garage',
  'General · Valves','General · Media','General · Controls','General · Charts',
  'General · Cameras','General · Navigation','Home Life','Robot Vacuum',
  'Litter-Robot','PetLibro'];
const catRank = c => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 999 : i; };

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2600);
}
async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}
const entName = id => (ENTITIES.find(e => e.id === id) || {}).name || id || '';
const snap = v => Math.round(v / SNAP) * SNAP;

/* ---------------- load ---------------- */
async function load() {
  if (!SLUG) { document.body.innerHTML = '<p style="padding:40px">Missing ?d=slug</p>'; return; }
  $('#preview').href = `/d/${SLUG}/?preview=1`;
  let cfg, dz, ents, pk;
  try {
    [cfg, dz, ents, pk] = await Promise.all([
      api('/api/admin/config'), api(`/api/admin/dashboards/${SLUG}/design`),
      api('/api/admin/entities'), api('/api/admin/packs'),
    ]);
  } catch (e) {
    await ATDialog.alert('Dashboard not found',
      `"${SLUG}" doesn't exist (or couldn't be loaded: ${e.message}).
       You'll be taken back to the admin panel.`, { danger: true, icon: '🔍' });
    location.href = '/admin';
    return;
  }
  ENTITIES = ents.entities;
  window.AT_SET_CUSTOM_PACKS(pk.packs);
  DASHBOARDS = cfg.dashboards || {};
  const dashCfg = cfg.dashboards[SLUG] || {};
  $('#dashname').textContent = dashCfg.name || SLUG;

  DESIGN = dz.design || {};
  DESIGN.title = DESIGN.title || dashCfg.name || SLUG;
  DESIGN.theme = Object.assign({ accent:'#4f8cff', bg:'#0f1420', card:'#1a2233',
    text:'#e8edf7', radius:14, cardStyle:'glass' }, DESIGN.theme);
  DESIGN.canvas = Object.assign({ w:1280, h:800 }, DESIGN.canvas);
  DESIGN.logout = Object.assign({ hidden:false, zone:'top-right', taps:3 }, DESIGN.logout);
  DESIGN.tabs = DESIGN.tabs || [];
  DESIGN.widgets = DESIGN.widgets || [];

  let mi = 0;
  for (const w of DESIGN.widgets) {
    window.AT_MIGRATE_WIDGET(w);
    if (w.x == null) {
      const [dw, dh] = window.AT_DEFAULT_SIZE(w.type, w.skin);
      w.w = dw; w.h = dh;
      w.x = 20 + (mi % 5) * 245; w.y = 20 + Math.floor(mi / 5) * 135; mi++;
    }
    delete w.span;
  }
  uid = DESIGN.widgets.reduce((m, w) => Math.max(m, +String(w.id).replace(/\D/g,'') || 0), 0);
  window.AT_DEFAULT_CS = DESIGN.theme.cardStyle;
  injectCss();
  renderTabs(); render();
  window.addEventListener('resize', updateScale);
  if (new URLSearchParams(location.search).has('setup')) openSettings();
}

function injectCss() {
  let el = $('#at-css');
  if (!el) { el = document.createElement('style'); el.id = 'at-css';
             document.head.appendChild(el); }
  el.textContent = window.AT_WIDGET_CSS + '\n' + window.AT_PACK_CSS() + '\n' +
    window.AT_ALL_STYLES().map(window.AT_COMPILE).join('\n');
  document.documentElement.style.setProperty('--accent', DESIGN.theme.accent);
  document.documentElement.style.setProperty('--card', DESIGN.theme.card);
  document.documentElement.style.setProperty('--radius', DESIGN.theme.radius + 'px');
}

/* ---------------- scale ---------------- */
function updateScale() {
  const wrap = $('#wrap');
  const c = DESIGN.canvas;
  SCALE = Math.min((wrap.clientWidth - 60) / c.w, (wrap.clientHeight - 60) / c.h, 1);
  if (SCALE <= 0) SCALE = 0.1;
  $('#stage').style.transform = `scale(${SCALE})`;
  $('#stage').style.width = (c.w * SCALE) + 'px';
  $('#stage').style.height = (c.h * SCALE) + 'px';
}

/* ---------------- tabs ---------------- */
function renderTabs() {
  const row = $('#tabsrow');
  row.innerHTML = '';
  const mk = (labelTxt, id) => {
    const p = document.createElement('div');
    p.className = 'tabpill' + ((ACTIVE_TAB === id) ? ' active' : '');
    p.innerHTML = `<span>${labelTxt}</span>`;
    p.onclick = () => { ACTIVE_TAB = id; SELECTED = null; renderTabs(); render(); inspect(); };
    return p;
  };
  row.appendChild(mk('📋 All', null));
  for (const t of DESIGN.tabs) {
    const p = mk(t.name, t.id);
    if (ACTIVE_TAB === t.id) {
      const ren = document.createElement('span');
      ren.className = 'tx'; ren.textContent = '✏️';
      ren.onclick = async ev => { ev.stopPropagation();
        const n = await ATDialog.prompt('Rename tab', '', t.name, { icon: '🗂' });
        if (n) { t.name = n; renderTabs(); } };
      const del = document.createElement('span');
      del.className = 'tx'; del.textContent = '✕';
      del.onclick = async ev => { ev.stopPropagation();
        if (!await ATDialog.confirm('Delete tab?',
          `"${t.name}" will be removed — its elements stay, visible on all tabs.`,
          { danger: true, icon: '🗂', okText: 'Delete' })) return;
        DESIGN.tabs = DESIGN.tabs.filter(x => x.id !== t.id);
        DESIGN.widgets.forEach(w => { if (w.tab === t.id) delete w.tab; });
        ACTIVE_TAB = null; renderTabs(); render(); };
      p.appendChild(ren); p.appendChild(del);
    }
    row.appendChild(p);
  }
  const add = document.createElement('div');
  add.className = 'tabpill'; add.textContent = '＋ tab';
  add.onclick = async () => {
    const n = await ATDialog.prompt('New tab',
      'Name for the new page (e.g. Lights, Climate, Security):', '', { icon: '🗂' });
    if (!n) return;
    const t = { id: 't' + Date.now().toString(36), name: n };
    DESIGN.tabs.push(t); ACTIVE_TAB = t.id; renderTabs(); render();
  };
  row.appendChild(add);
}

/* ---------------- demo values ---------------- */
function demoOpts(w) {
  const nm = w.label || (w.entity ? entName(w.entity) : '') ||
    ({ label:'', box:'', line:'', fbnotes:'Family notes', energysum:'Energy',
       intercom:'Announce', seckeypad:'Security' }[w.type] ?? 'Pick entity');
  const val = { sensor: '23.4 °C', climate: '21.5°', vacuum: 'docked',
    cover: 'open', valve: 'open', media: 'playing',
    clock: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) }
    [w.type] || 'On';
  return { name: nm, on: true, icon: w.icon, val };
}

/* ---------------- canvas ---------------- */
const visible = () => DESIGN.widgets.filter(w =>
  ACTIVE_TAB === null || !w.tab || w.tab === ACTIVE_TAB);

function render() {
  const cv = $('#canvas');
  const c = DESIGN.canvas;
  cv.style.width = c.w + 'px'; cv.style.height = c.h + 'px';
  cv.style.background = DESIGN.theme.bg;
  $('#sizetag').textContent = `${c.w} × ${c.h}px — scale ${(SCALE * 100) | 0}%`;
  cv.innerHTML = '';
  for (const w of visible()) {
    const el = document.createElement('div');
    el.className = 'el' + (w.id === SELECTED ? ' selected' : '');
    el.dataset.id = w.id;
    Object.assign(el.style, { left: w.x + 'px', top: w.y + 'px',
      width: w.w + 'px', height: w.h + 'px', zIndex: CONTROL_Z[w.type] || 3 });
    const skin = window.AT_SKIN(w.skin);
    const tabName = w.tab ? (DESIGN.tabs.find(x => x.id === w.tab) || {}).name : '';
    el.innerHTML = `<div class="tag">${skin ? skin.name : w.type}` +
      `${tabName ? ' · 🗂' + tabName : ''}</div>` +
      `<div class="inner">${window.AT_MARKUP(w, demoOpts(w))}</div>` +
      `<div class="rs"></div>`;
    attachPointer(el, w);
    cv.appendChild(el);
  }
  updateScale();
}

function refreshEl(w) {
  const el = $(`.el[data-id="${w.id}"]`);
  if (el) el.querySelector('.inner').innerHTML = window.AT_MARKUP(w, demoOpts(w));
}

/* ---------------- drag / resize ---------------- */
function attachPointer(el, w) {
  const rs = el.querySelector('.rs');
  rs.addEventListener('pointerdown', ev => {
    ev.stopPropagation(); ev.preventDefault();
    rs.setPointerCapture(ev.pointerId);
    const sx = ev.clientX, sy = ev.clientY, ow = w.w, oh = w.h;
    const move = e => {
      w.w = Math.max(20, snap(ow + (e.clientX - sx) / SCALE));
      w.h = Math.max(4, snap(oh + (e.clientY - sy) / SCALE));
      el.style.width = w.w + 'px'; el.style.height = w.h + 'px';
      syncXYWH(w);
    };
    const up = () => { rs.removeEventListener('pointermove', move);
      rs.removeEventListener('pointerup', up); refreshEl(w); };
    rs.addEventListener('pointermove', move);
    rs.addEventListener('pointerup', up);
  });

  el.addEventListener('pointerdown', ev => {
    if (ev.target === rs) return;
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    if (SELECTED !== w.id) { SELECTED = w.id;
      document.querySelectorAll('.el').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected'); inspect(); }
    const sx = ev.clientX, sy = ev.clientY, ox = w.x, oy = w.y;
    const move = e => {
      w.x = Math.max(0, Math.min(DESIGN.canvas.w - 20, snap(ox + (e.clientX - sx) / SCALE)));
      w.y = Math.max(0, Math.min(DESIGN.canvas.h - 20, snap(oy + (e.clientY - sy) / SCALE)));
      el.style.left = w.x + 'px'; el.style.top = w.y + 'px';
      syncXYWH(w);
    };
    const up = () => { el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

function syncXYWH(w) {
  for (const k of ['x','y','w','h']) {
    const inp = $('#p-' + k);
    if (inp) inp.value = w[k];
  }
}

$('#canvas').addEventListener('pointerdown', ev => {
  if (ev.target === $('#canvas')) { SELECTED = null;
    document.querySelectorAll('.el').forEach(x => x.classList.remove('selected'));
    inspect(); }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Delete' && SELECTED &&
      !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    DESIGN.widgets = DESIGN.widgets.filter(w => w.id !== SELECTED);
    SELECTED = null; render(); inspect();
  }
});

/* ---------------- adding elements ---------------- */
function addWidget(props) {
  const [dw, dh] = window.AT_DEFAULT_SIZE(props.type, props.skin);
  const w = Object.assign({ id: 'w' + (++uid),
    x: snap(40 + Math.random() * 80), y: snap(40 + Math.random() * 80),
    w: dw, h: dh }, props);
  if (props.type === 'label') { w.text = 'Text'; w.size = 18; }
  if (props.type === 'box') w.text = 'Group';
  if (props.type === 'nav') { w.label = 'Open'; w.navType = 'tab'; }
  if (props.type === 'litterbox') {
    // zero-config: auto-pick the Litter-Robot's OWN sibling entities. Prefer
    // entities that share the robot's device prefix so we never grab a random
    // "weight"/"reset" sensor from another device (e.g. a water fountain).
    const find = (re, dom, base) => {
      let c = ENTITIES.filter(e => (!dom || e.domain === dom) && re.test(e.id));
      if (base) { const pref = c.filter(e => e.id.includes(base)); if (pref.length) c = pref; }
      return (c[0] || {}).id;
    };
    if (!w.entity) w.entity = find(/litter|robot/i, 'vacuum');
    const vobj = (w.entity || '').split('.')[1] || '';
    const base = vobj.replace(/_?litter_?box$/i, '').replace(/_+$/, '') || vobj;
    w.statusEntity = find(/status.?code/i, 'sensor', base);
    w.drawerEntity = find(/waste.?drawer/i, 'sensor', base);
    w.litterEntity = find(/litter.?level/i, 'sensor', base);
    w.weightEntity = find(/pet.?weight/i, 'sensor', base);   // pet_weight only, not any *_weight
    w.resetEntity  = find(/reset/i, 'button', base);
  }
  if (props.type === 'fblist' && !w.entity)
    w.entity = (ENTITIES.find(e => e.domain === 'todo') || {}).id;
  if (props.type === 'energysum') w.range = w.range || 'today';
  if (props.type === 'intercom') w.label = w.label || 'Announce';
  if (props.type === 'seckeypad') {
    w.label = w.label || 'Security';
    w.modes = Array.isArray(w.modes) && w.modes.length ? w.modes
                                                       : ['home', 'away', 'night'];
  }
  if (ACTIVE_TAB) w.tab = ACTIVE_TAB;
  DESIGN.widgets.push(w);
  SELECTED = w.id;
  render(); inspect();
}
document.querySelectorAll('.qi').forEach(p =>
  p.addEventListener('click', () => addWidget({ type: p.dataset.add,
    skin: p.dataset.add === 'clock' ? 'clock-card' : undefined })));

/* add-element modal */
function openAdd() { buildAdd(''); $('#addmodal').classList.add('open');
  setTimeout(() => $('#skinsearch').focus(), 50); }
function closeAdd() { $('#addmodal').classList.remove('open'); }
$('#skinsearch').addEventListener('input', e => buildAdd(e.target.value.trim().toLowerCase()));

function buildAdd(q) {
  injectCss();
  const body = $('#addbody');
  body.innerHTML = '';
  let skins = window.AT_ALL_SKINS();
  if (q) skins = skins.filter(s =>
    (s.name + ' ' + s.category + ' ' + s.for + ' ' + s.id).toLowerCase().includes(q));
  const cats = [...new Set(skins.map(s => s.category))]
    .sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
  if (!skins.length) {
    body.innerHTML = '<p class="muted" style="padding:20px">Nothing found.</p>'; return;
  }
  for (const cat of cats) {
    const h = document.createElement('div');
    h.className = 'cat'; h.textContent = cat;
    body.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'skingrid';
    for (const s of skins.filter(x => x.category === cat)) {
      const cell = document.createElement('div');
      cell.className = 'skprev';
      const [pw, ph] = s.size || [200, 110];
      const sc = Math.min(150 / pw, 116 / ph, 1);
      const demoW = { type: s.for, skin: s.id };
      cell.innerHTML = `
        <div class="box"><div style="width:${pw}px;height:${ph}px;transform:scale(${sc})">
          ${window.AT_MARKUP(demoW, { name: s.name, on: true,
            val: { sensor:'23.4 °C', climate:'21.5°', vacuum:'docked', cover:'open',
                   valve:'open', media:'—', clock:'12:34', select:'Auto',
                   litterbox:'Ready' }[s.for] || 'On' })}
        </div></div>
        <div class="sname">${s.name}</div><div class="scat">${s.for}</div>`;
      cell.onclick = () => { addWidget({ type: s.for, skin: s.id }); closeAdd(); };
      grid.appendChild(cell);
    }
    body.appendChild(grid);
  }
}

/* ---------------- inspector ---------------- */
function opt(list, cur, none) {
  let h = none ? `<option value="">${none}</option>` : '';
  for (const [v, l] of list)
    h += `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
  return h;
}
function entityOptions(domains, current) {
  const list = domains ? ENTITIES.filter(e => domains.includes(e.domain)) : ENTITIES;
  return opt(list.map(e => [e.id, `${e.name}  (${e.id})`]), current, '— select entity —');
}

function inspect() {
  const box = $('#inspector');
  const w = DESIGN.widgets.find(x => x.id === SELECTED);
  if (!w) {
    box.innerHTML = '<h3>Properties</h3><div class="muted">Select an element on the page to edit it.</div>';
    return;
  }
  const skin = window.AT_SKIN(w.skin);
  const isEntity = !!DOMAINS[w.type] || w.type === 'sensor';
  let html = `<h3>${skin ? skin.name : w.type}</h3>
    <div class="insec"><div class="st">Position & size</div>
    <div class="row4">
      <div><label>X</label><input type="number" id="p-x" value="${w.x}"></div>
      <div><label>Y</label><input type="number" id="p-y" value="${w.y}"></div>
      <div><label>W</label><input type="number" id="p-w" value="${w.w}"></div>
      <div><label>H</label><input type="number" id="p-h" value="${w.h}"></div>
    </div></div>`;

  if (isEntity ||
      ['clock','fbnotes','energysum','intercom','seckeypad'].includes(w.type)) {
    const sameType = window.AT_ALL_SKINS().filter(s => s.for === w.type);
    html += `<div class="insec"><div class="st">Design</div>`;
    if (sameType.length > 1)
      html += `<label>Skin</label><select id="p-skin">${
        opt(sameType.map(s => [s.id, `${s.name} (${s.category})`]), w.skin)}</select>`;
    if (skin && skin.card)
      html += `<label>Card style</label><select id="p-style">${
        opt(window.AT_ALL_STYLES().map(s => [s.id, s.name]), w.style,
            '(dashboard default)')}</select>`;
    html += `<label>Accent color override</label>
      <div class="row2"><input type="color" id="p-color"
        value="${w.color || DESIGN.theme.accent}">
      <button class="ghost" id="p-colorclear" style="flex:0 0 auto">reset</button></div>
      </div>`;
  }

  if (isEntity) {
    html += `<div class="insec"><div class="st">Data</div>
      <label>Entity</label><select id="p-entity">${entityOptions(DOMAINS[w.type], w.entity)}</select>
      <label>Custom label</label><input id="p-label" value="${(w.label||'').replace(/"/g,'&quot;')}" placeholder="auto">
      <label>Icon (emoji)</label><input id="p-icon" value="${w.icon||''}" placeholder="auto">`;
    if (w.type === 'sensor')
      html += `<label>Unit override</label><input id="p-unit" value="${w.unit||''}" placeholder="auto">
        <div class="row2">
        <div><label>Min (gauges)</label><input type="number" id="p-min" value="${w.min != null ? w.min : 0}"></div>
        <div><label>Max (gauges)</label><input type="number" id="p-max" value="${w.max != null ? w.max : 100}"></div>
        </div>`;
    if (w.type === 'climate')
      html += `<label>Step (°)</label><input id="p-step" type="number" step="0.5" value="${w.step||0.5}">`;
    if (w.type === 'camera')
      html += `<label>Refresh interval (seconds)</label>
        <input type="number" id="p-refresh" min="1" max="60" value="${w.refresh || 2}">`;
    if (w.type === 'vacuum')
      html += `<label>Map entity (camera/image — for the "live map" skin)</label>
        <select id="p-mapentity">${opt(ENTITIES
          .filter(e => ['camera','image'].includes(e.domain))
          .map(e => [e.id, `${e.name}  (${e.id})`]), w.mapEntity, '— none —')}</select>`;
    if (w.type === 'chart')
      html += `<label>Unit override</label><input id="p-unit" value="${w.unit||''}" placeholder="auto">
        <label>History window (hours)</label>
        <select id="p-hours">${opt([[6,'6 hours'],[12,'12 hours'],[24,'24 hours'],
          [48,'2 days'],[168,'1 week']], w.hours || 24)}</select>
        <div class="row2">
        <div><label>Min (ring)</label><input type="number" id="p-min" value="${w.min != null ? w.min : 0}"></div>
        <div><label>Max (ring)</label><input type="number" id="p-max" value="${w.max != null ? w.max : 100}"></div>
        </div>`;
    html += `</div>`;
  }

  if (w.type === 'litterbox') {
    const sens = ENTITIES.filter(e => e.domain === 'sensor')
      .map(e => [e.id, `${e.name}  (${e.id})`]);
    const btns = ENTITIES.filter(e => ['button','input_button'].includes(e.domain))
      .map(e => [e.id, `${e.name}  (${e.id})`]);
    html += `<div class="insec"><div class="st">Litter-Robot data</div>
      <div class="muted" style="margin:-2px 0 8px;font-size:11px">Auto-detected — override if needed.</div>
      <label>Status code (sensor)</label>
      <select id="p-statusentity">${opt(sens, w.statusEntity, '— none —')}</select>
      <label>Waste drawer (sensor %)</label>
      <select id="p-drawerentity">${opt(sens, w.drawerEntity, '— none —')}</select>
      <label>Litter level (sensor %)</label>
      <select id="p-litterentity">${opt(sens, w.litterEntity, '— none —')}</select>
      <label>Pet weight (sensor)</label>
      <select id="p-weightentity">${opt(sens, w.weightEntity, '— none —')}</select>
      <label>Reset drawer (button)</label>
      <select id="p-resetentity">${opt(btns, w.resetEntity, '— none —')}</select>
      </div>`;
  }

  if (w.type === 'energysum')
    html += `<div class="insec"><div class="st">Energy</div>
      <label>Range</label><select id="p-range">${opt([['today','Today'],
        ['yesterday','Yesterday'],['week','This week'],['month','This month']],
        w.range || 'today')}</select>
      <label>Custom title</label><input id="p-label" value="${(w.label||'').replace(/"/g,'&quot;')}" placeholder="Energy">
      </div>`;

  if (w.type === 'intercom')
    html += `<div class="insec"><div class="st">Intercom</div>
      <label>Label</label><input id="p-label" value="${(w.label||'').replace(/"/g,'&quot;')}" placeholder="Announce">
      <label>Default area id (optional)</label>
      <input id="p-defarea" value="${(w.defaultArea||'').replace(/"/g,'&quot;')}" placeholder="e.g. living_room">
      <div class="muted" style="margin-top:4px;font-size:11px">Pre-selected target
      the first time the panel is used; after that the tablet remembers.</div>
      </div>`;

  if (w.type === 'seckeypad') {
    const modes = Array.isArray(w.modes) && w.modes.length ? w.modes
                                                           : ['home','away','night'];
    html += `<div class="insec"><div class="st">Security keypad</div>
      <label>Label</label><input id="p-label" value="${(w.label||'').replace(/"/g,'&quot;')}" placeholder="Security">
      <label>Arm buttons to offer</label>
      ${[['home','Home'],['away','Away'],['night','Night']].map(([id, nm]) =>
        `<label class="checkline"><input type="checkbox" class="p-secmode"
          data-mode="${id}" ${modes.includes(id) ? 'checked' : ''}> ${nm}</label>`).join('')}
      <div class="muted" style="margin-top:4px;font-size:11px">Anyone can arm or
      disarm with the PIN set in Security Center — no login needed.</div>
      </div>`;
  }

  if (w.type === 'fbnotes')
    html += `<div class="insec"><div class="st">Family notes</div>
      <label>Custom title</label><input id="p-label" value="${(w.label||'').replace(/"/g,'&quot;')}" placeholder="Family notes">
      <div class="muted" style="margin-top:4px;font-size:11px">Shows notes from the
      Family Board tool. Tap a note on the tablet to read &amp; reply.</div>
      </div>`;

  if (w.type === 'nav') {
    const otherDash = Object.keys(DASHBOARDS).filter(s => s !== SLUG)
      .map(s => [s, DASHBOARDS[s].name || s]);
    html += `<div class="insec"><div class="st">Button</div>
      <label>Label</label><input id="p-label" value="${(w.label||'').replace(/"/g,'&quot;')}" placeholder="Open…">
      <label>Icon (emoji)</label><input id="p-icon" value="${w.icon||''}" placeholder="➡️">
      ${skin && skin.card ? `<label>Card style</label><select id="p-style">${
        opt(window.AT_ALL_STYLES().map(s => [s.id, s.name]), w.style, '(dashboard default)')}</select>` : ''}
      </div>
      <div class="insec"><div class="st">On tap</div>
      <label>Go to</label><select id="p-navtype">${opt([['tab','A tab on this dashboard'],
        ['dash','Open another dashboard (full-screen, with Back)']], w.navType || 'tab')}</select>
      <div id="nav-tab" style="display:${(w.navType||'tab')==='tab'?'block':'none'}">
        <label>Tab</label><select id="p-navtab">${
          DESIGN.tabs.length ? opt(DESIGN.tabs.map(t => [t.id, t.name]), w.navTab)
          : '<option value="">— make a tab first —</option>'}</select></div>
      <div id="nav-dash" style="display:${w.navType==='dash'?'block':'none'}">
        <label>Dashboard</label><select id="p-navdash">${
          otherDash.length ? opt(otherDash, w.navDash, '— select —')
          : '<option value="">— no other dashboards —</option>'}</select></div>
      </div>`;
  }

  if (w.type === 'label')
    html += `<div class="insec"><div class="st">Text</div>
      <label>Text</label><input id="p-text" value="${(w.text||'').replace(/"/g,'&quot;')}">
      <div class="row2">
        <div><label>Size px</label><input type="number" id="p-size" value="${w.size||18}"></div>
        <div><label>Color</label><input type="color" id="p-color2" value="${w.color||'#e8edf7'}"></div>
      </div>
      <label class="checkline"><input type="checkbox" id="p-bold" ${w.bold?'checked':''}> Bold</label>
      <label>Align</label><select id="p-align">${opt([['flex-start','Left'],
        ['center','Center'],['flex-end','Right']], w.align || 'flex-start')}</select></div>`;
  if (w.type === 'box')
    html += `<div class="insec"><div class="st">Box</div>
      <label>Title (optional)</label><input id="p-text" value="${(w.text||'').replace(/"/g,'&quot;')}">
      <label>Card style</label><select id="p-style">${
        opt(window.AT_ALL_STYLES().map(s => [s.id, s.name]), w.style, '(plain box)')}</select></div>`;
  if (w.type === 'line')
    html += `<div class="insec"><div class="st">Line</div>
      <label>Color</label><input type="color" id="p-color2" value="${w.color||'#3a4a6b'}"></div>`;

  html += `<div class="insec"><div class="st">Placement</div>
    <label>Tab</label><select id="p-tab">${
    opt(DESIGN.tabs.map(t => [t.id, t.name]), w.tab, '(all tabs)')}</select></div>`;
  html += `<div style="margin-top:14px"><button class="ghost" style="color:var(--bad);border-color:#7a2a3a"
    onclick="removeSelected()">🗑 Delete element</button></div>`;
  box.innerHTML = html;

  const bind = (sel, key, num, rerenderAll) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (num) v = parseFloat(v) || 0;
      if (v === '' && ['style','tab'].includes(key)) delete w[key];
      else w[key] = v;
      if (['x','y','w','h'].includes(key)) {
        const e2 = $(`.el[data-id="${w.id}"]`);
        if (e2) Object.assign(e2.style, { left:w.x+'px', top:w.y+'px',
                                          width:w.w+'px', height:w.h+'px' });
      } else if (rerenderAll) render(); else refreshEl(w);
      if (key === 'skin') { const [dw,dh] = window.AT_DEFAULT_SIZE(w.type, w.skin);
        w.w = dw; w.h = dh; render(); inspect(); }
    });
  };
  bind('#p-x','x',1); bind('#p-y','y',1); bind('#p-w','w',1); bind('#p-h','h',1);
  bind('#p-skin','skin'); bind('#p-entity','entity'); bind('#p-label','label');
  bind('#p-icon','icon'); bind('#p-style','style'); bind('#p-unit','unit');
  bind('#p-min','min',1); bind('#p-max','max',1); bind('#p-step','step',1);
  bind('#p-hours','hours',1); bind('#p-mapentity','mapEntity');
  bind('#p-refresh','refresh',1);
  bind('#p-statusentity','statusEntity'); bind('#p-drawerentity','drawerEntity');
  bind('#p-litterentity','litterEntity'); bind('#p-weightentity','weightEntity');
  bind('#p-resetentity','resetEntity');
  bind('#p-range','range'); bind('#p-defarea','defaultArea');
  bind('#p-text','text'); bind('#p-size','size',1); bind('#p-color','color');
  bind('#p-color2','color'); bind('#p-bold','bold'); bind('#p-align','align');
  bind('#p-tab','tab',0,true);
  bind('#p-navtab','navTab'); bind('#p-navdash','navDash');
  const nt = $('#p-navtype');
  if (nt) nt.addEventListener('change', () => {
    w.navType = nt.value;
    const t = $('#nav-tab'), d = $('#nav-dash');
    if (t) t.style.display = nt.value === 'tab' ? 'block' : 'none';
    if (d) d.style.display = nt.value === 'dash' ? 'block' : 'none';
  });
  const secModes = document.querySelectorAll('.p-secmode');
  if (secModes.length) secModes.forEach(cb => cb.addEventListener('change', () => {
    const picked = [...secModes].filter(x => x.checked).map(x => x.dataset.mode);
    if (!picked.length) { cb.checked = true; return; }   // keep at least one
    w.modes = picked; refreshEl(w);
  }));
  const cc = $('#p-colorclear');
  if (cc) cc.onclick = () => { delete w.color; refreshEl(w); inspect(); };
}

function removeSelected() {
  DESIGN.widgets = DESIGN.widgets.filter(w => w.id !== SELECTED);
  SELECTED = null; render(); inspect();
}

/* ---------------- settings ---------------- */
function openSettings() {
  const c = DESIGN.canvas, lo = DESIGN.logout;
  const preset = `${c.w}x${c.h}`;
  $('#s-preset').value = [...$('#s-preset').options].some(o => o.value === preset)
    ? preset : 'custom';
  $('#s-w').value = c.w; $('#s-h').value = c.h;
  $('#s-fit').value = c.fit || 'fit';
  $('#s-accent').value = DESIGN.theme.accent; $('#s-bg').value = DESIGN.theme.bg;
  $('#s-hidelogout').checked = !!lo.hidden;
  $('#s-zone').value = lo.zone; $('#s-taps').value = lo.taps;
  $('#settings').classList.add('open');
}
function closeSettings() { $('#settings').classList.remove('open'); }
$('#s-preset').addEventListener('change', e => {
  if (e.target.value !== 'custom') {
    const [w, h] = e.target.value.split('x');
    $('#s-w').value = w; $('#s-h').value = h;
  }
});
$('#s-rotate').addEventListener('click', () => {
  const w = $('#s-w').value, h = $('#s-h').value;
  $('#s-w').value = h; $('#s-h').value = w;
  $('#s-preset').value = 'custom';   // rotated → treat as custom size
});
function applySettings() {
  DESIGN.canvas.w = Math.max(200, +$('#s-w').value || 1280);
  DESIGN.canvas.h = Math.max(200, +$('#s-h').value || 800);
  DESIGN.canvas.fit = $('#s-fit').value;
  DESIGN.theme.accent = $('#s-accent').value;
  DESIGN.theme.bg = $('#s-bg').value;
  DESIGN.logout = { hidden: $('#s-hidelogout').checked,
    zone: $('#s-zone').value, taps: +$('#s-taps').value };
  closeSettings(); injectCss(); render();
  toast('Page setup applied — remember to Save');
}

/* ---------------- card style gallery ---------------- */
function openGallery() { buildGallery(); $('#gallery').classList.add('open'); }
function closeGallery() { $('#gallery').classList.remove('open'); }
function buildGallery() {
  injectCss();
  const body = $('#gallerybody');
  body.innerHTML = '';
  const styles = window.AT_ALL_STYLES();
  for (const cat of [...new Set(styles.map(s => s.category))]) {
    const h = document.createElement('div');
    h.className = 'cat'; h.textContent = cat;
    body.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'stylegrid';
    for (const s of styles.filter(x => x.category === cat)) {
      const cell = document.createElement('div');
      cell.className = 'sprev' + (DESIGN.theme.cardStyle === s.id ? ' current' : '');
      cell.innerHTML = `
        <div class="w on" data-cs="${s.id}">
          <span class="at-ico">💡</span>
          <div class="at-name">Ceiling light</div><div class="at-val">On</div>
        </div>
        <div class="sname">${s.name}${DESIGN.theme.cardStyle === s.id ? ' ✓ default' : ''}</div>`;
      cell.onclick = () => {
        DESIGN.theme.cardStyle = s.id; window.AT_DEFAULT_CS = s.id;
        buildGallery(); render();
        toast(`"${s.name}" is now the dashboard default`);
      };
      grid.appendChild(cell);
    }
    body.appendChild(grid);
  }
}

/* ---------------- save ---------------- */
async function save() {
  const missing = DESIGN.widgets.filter(w =>
    DOMAINS[w.type] !== undefined && w.type !== 'clock' && !w.entity).length;
  try {
    await api(`/api/admin/dashboards/${SLUG}/design`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design: DESIGN }) });
    toast(missing ? `Saved — ${missing} element(s) still need an entity`
                  : 'Saved ✓ open Preview to see it live');
  } catch (e) { toast(e.message, true); }
}

load();
