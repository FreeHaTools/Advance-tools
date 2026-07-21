/* Notify Hub — Advance Tools
 * Rules, channels, Telegram bot and delivery history.
 */
'use strict';

const API = '/api/tools/notify_hub';

let DATA = {
  channels: [], rules: [], settings: { telegram: {} }, entities: [],
  notify_services: [], digest_sections: {}, log: [], bot: {},
};

let editRule = null;      // rule being edited in the modal
let editChan = null;      // channel being edited in the modal
let ruleFilter = '';
let ctlSelected = new Set();

/* ------------------------------------------------------------- helpers */

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), bad ? 6500 : 3500);
}

async function api(path, options) {
  const response = await fetch(API + path, Object.assign(
    { headers: { 'Content-Type': 'application/json' } }, options || {}));
  let body = {};
  try { body = await response.json(); } catch (e) { /* empty body */ }
  if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status));
  return body;
}

function entityName(id) {
  const found = DATA.entities.find((e) => e.id === id);
  return found ? found.name : id;
}

function timeAgo(ts) {
  const seconds = Math.floor(Date.now() / 1000) - ts;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' h ago';
  return new Date(ts * 1000).toLocaleString();
}

/* --------------------------------------------------------- type tables */

const RULE_TYPES = [
  {
    id: 'entity', icon: '🎯', name: 'A device does something',
    hint: 'A sensor opens, a value crosses a threshold, anything changes state.',
  },
  {
    id: 'system', icon: '⚙️', name: 'Home Assistant problems',
    hint: 'Errors and warnings in the log, or Home Assistant restarting.',
  },
  {
    id: 'dead_device', icon: '🩺', name: 'Dead or flat devices',
    hint: 'Something stopped responding, or a battery is running out.',
  },
  {
    id: 'digest', icon: '📰', name: 'Scheduled digest',
    hint: 'A summary of the house at a time you choose.',
  },
];

const CHANNEL_TYPES = [
  {
    id: 'telegram', icon: '✈️', name: 'Telegram',
    hint: 'A chat or group your bot messages. Set the bot up first.',
  },
  {
    id: 'notify', icon: '📱', name: 'Home Assistant notify',
    hint: 'The mobile app, email, or any notify service HA already has.',
  },
  {
    id: 'persistent', icon: '🔔', name: 'Home Assistant panel',
    hint: 'A notification in the Home Assistant sidebar.',
  },
  {
    id: 'webhook', icon: '🔗', name: 'Webhook',
    hint: 'POST to any URL — Discord, Slack, ntfy, your own server.',
  },
];

const ruleType = (id) => RULE_TYPES.find((t) => t.id === id) || RULE_TYPES[0];
const chanType = (id) => CHANNEL_TYPES.find((t) => t.id === id) || CHANNEL_TYPES[0];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* --------------------------------------------------------------- load */

async function load() {
  try {
    DATA = await api('/data');
  } catch (err) {
    toast(err.message, true);
    return;
  }
  const dot = $('connStat');
  dot.innerHTML = '<span class="dot' + (DATA.connected ? ' ok' : '') + '"></span>'
    + (DATA.connected ? 'connected to Home Assistant' : 'not connected');
  renderStats();
  renderRules();
  renderChannels();
  renderBotPage();
  renderLog();
  $('quietStart').value = DATA.settings.quiet_start || '';
  $('quietEnd').value = DATA.settings.quiet_end || '';
  $('muteBtn').textContent = DATA.muted ? '🔔 Unmute' : '🔕 Mute';
}

function renderStats() {
  const rules = DATA.rules;
  const on = rules.filter((r) => r.enabled).length;
  const sentToday = DATA.log.filter((l) => (
    l.ts * 1000 > Date.now() - 86400000 && !l.skipped)).length;
  const boxes = [
    { label: 'Rules', value: rules.length },
    { label: 'Switched on', value: on, cls: on ? 'ok' : '' },
    { label: 'Channels', value: DATA.channels.length,
      cls: DATA.channels.length ? '' : 'bad' },
    { label: 'Sent (24 h)', value: sentToday },
    { label: 'Bot', value: DATA.bot && DATA.bot.username ? '@' + DATA.bot.username : '—',
      cls: DATA.bot && DATA.bot.running ? 'ok' : 'warn' },
  ];
  $('stats').innerHTML = boxes.map((b) => (
    `<div class="statbox"><b class="${b.cls || ''}">${esc(b.value)}</b>`
    + `<span>${esc(b.label)}</span></div>`)).join('');
}

/* -------------------------------------------------------------- rules */

function ruleSummary(rule) {
  const p = rule.params || {};
  if (rule.type === 'entity') {
    const names = (p.entities || []).slice(0, 3).map(entityName).join(', ');
    const more = (p.entities || []).length - 3;
    let when = 'changes';
    if (p.mode === 'numeric') {
      const bits = [];
      if (p.above !== '' && p.above != null) bits.push('above ' + p.above);
      if (p.below !== '' && p.below != null) bits.push('below ' + p.below);
      when = 'goes ' + (bits.join(' and ') || 'past the threshold');
    } else if (p.mode === 'state') {
      when = p.to ? 'becomes ' + p.to : 'leaves ' + p.from;
    }
    return `<b>${esc(names)}${more > 0 ? ` +${more}` : ''}</b> ${esc(when)}`
      + (p.for_minutes ? ` for <b>${p.for_minutes} min</b>` : '');
  }
  if (rule.type === 'system') {
    return 'Watching: <b>' + esc((p.watch || []).join(', ') || 'nothing') + '</b>';
  }
  if (rule.type === 'dead_device') {
    return `Unavailable for <b>${esc(p.unavailable_minutes || 30)} min</b>`
      + (p.check_battery ? `, battery under <b>${esc(p.battery_threshold || 15)}%</b>` : '');
  }
  if (rule.type === 'digest') {
    const days = (p.days || []).map((d) => DAYS[d]).join(', ');
    return `Every <b>${esc(days || '—')}</b> at <b>${esc(p.time || '')}</b>`;
  }
  return '';
}

function renderRules() {
  const needle = ruleFilter.toLowerCase();
  const list = DATA.rules.filter((r) => !needle
    || r.name.toLowerCase().includes(needle)
    || r.type.includes(needle));
  const box = $('ruleList');

  if (!DATA.channels.length) {
    box.innerHTML = '<div class="empty"><div class="big">📡</div>'
      + 'First add a channel — somewhere for notifications to go.<br>'
      + '<button class="btn sm" onclick="document.querySelector(\'[data-page=channels]\').click()">'
      + 'Go to Channels</button></div>';
    return;
  }
  if (!list.length) {
    box.innerHTML = '<div class="empty"><div class="big">🔔</div>'
      + (DATA.rules.length ? 'No rule matches that search.'
        : 'No rules yet — press <b>New rule</b> to make your first one.') + '</div>';
    return;
  }

  box.innerHTML = list.map((rule) => {
    const type = ruleType(rule.type);
    const channels = (rule.channels || []).map((cid) => {
      const c = DATA.channels.find((x) => x.id === cid);
      return c ? c.name : 'missing channel';
    });
    const broken = rule.type === 'entity' && rule.exists === false;
    return `<div class="rcard ${rule.enabled ? '' : 'off'}" data-id="${esc(rule.id)}">
      <div class="top">
        <div class="ticon">${type.icon}</div>
        <div class="nm"><b>${esc(rule.name)}</b><small>${esc(type.name)}</small></div>
        <button class="tgl ${rule.enabled ? 'on' : ''}" data-act="toggle"
                title="switch this rule on or off"></button>
      </div>
      <div class="detail">${ruleSummary(rule)}</div>
      <div class="badges">
        ${channels.map((n) => `<span class="tbadge">📡 ${esc(n)}</span>`).join('')}
        ${rule.urgent ? '<span class="tbadge warnb">urgent</span>' : ''}
        ${rule.cooldown ? `<span class="tbadge">⏱ ${rule.cooldown} min</span>` : ''}
        ${broken ? '<span class="tbadge badb">automation missing — save again</span>' : ''}
        ${rule.last_triggered
          ? `<span class="tbadge okb">last: ${esc(new Date(rule.last_triggered).toLocaleString())}</span>`
          : ''}
      </div>
      <div class="foot">
        <button class="iconbtn" data-act="test">🧪 Test</button>
        <div class="sp"></div>
        <button class="iconbtn" data-act="edit">✏️ Edit</button>
        <button class="iconbtn danger" data-act="delete">🗑</button>
      </div>
    </div>`;
  }).join('');
}

async function onRuleCardClick(event) {
  const card = event.target.closest('.rcard');
  const button = event.target.closest('[data-act]');
  if (!card || !button) return;
  const rule = DATA.rules.find((r) => r.id === card.dataset.id);
  if (!rule) return;
  const action = button.dataset.act;

  if (action === 'edit') { openRule(rule); return; }

  if (action === 'delete') {
    if (!confirm(`Delete the rule "${rule.name}"?`
      + (rule.type === 'entity'
        ? '\n\nIts Home Assistant automation is removed too.' : ''))) return;
    try {
      await api('/rules/' + rule.id, { method: 'DELETE' });
      toast('Rule deleted');
      await load();
    } catch (err) { toast(err.message, true); }
    return;
  }

  if (action === 'toggle') {
    try {
      await api(`/rules/${rule.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: rule.enabled ? 'off' : 'on' }),
      });
      await load();
    } catch (err) { toast(err.message, true); }
    return;
  }

  if (action === 'test') {
    button.innerHTML = '<span class="spinning">⏳</span> Sending';
    try {
      await api(`/rules/${rule.id}/action`, {
        method: 'POST', body: JSON.stringify({ action: 'test' }),
      });
      toast('Test sent — check your channels');
    } catch (err) { toast(err.message, true); }
    button.innerHTML = '🧪 Test';
    load();
  }
}

/* -------------------------------------------------- rule modal: params */

function pickerHTML(id, placeholder) {
  return `<div class="pickwrap">
    <div class="pickbar">
      <input type="text" id="${id}Search" placeholder="${esc(placeholder)}">
      <span class="cnt" id="${id}Count">0 selected</span>
      <label class="inline"><input type="checkbox" id="${id}All">show all</label>
    </div>
    <div class="picklist" id="${id}List"></div>
  </div>`;
}

/** Wire a multi-select entity picker. Returns a getter for the selection. */
function mountPicker(id, selected, domainFilter) {
  const set = new Set(selected || []);
  const listEl = $(id + 'List');
  const searchEl = $(id + 'Search');
  const allEl = $(id + 'All');
  const countEl = $(id + 'Count');

  function draw() {
    const needle = (searchEl.value || '').toLowerCase().trim();
    let items = DATA.entities;
    if (!allEl.checked && domainFilter) items = items.filter(domainFilter);
    if (needle) {
      items = items.filter((e) => e.id.toLowerCase().includes(needle)
        || e.name.toLowerCase().includes(needle));
    }
    const chosen = items.filter((e) => set.has(e.id));
    const rest = items.filter((e) => !set.has(e.id));
    items = chosen.concat(rest).slice(0, 300);

    countEl.textContent = set.size + ' selected';
    listEl.innerHTML = items.length ? items.map((e) => `
      <label class="pickitem">
        <input type="checkbox" value="${esc(e.id)}" ${set.has(e.id) ? 'checked' : ''}>
        <span class="pn">${esc(e.name)}<small>${esc(e.id)}</small></span>
        <span class="st">${esc(e.state)}</span>
      </label>`).join('')
      : '<div class="picknone">Nothing matches. Tick <b>show all</b> to see every entity.</div>';
  }

  searchEl.addEventListener('input', draw);
  allEl.addEventListener('change', draw);
  listEl.addEventListener('change', (event) => {
    const box = event.target;
    if (box.tagName !== 'INPUT') return;
    if (box.checked) set.add(box.value); else set.delete(box.value);
    countEl.textContent = set.size + ' selected';
  });
  draw();
  return () => Array.from(set);
}

let getEntities = () => [];
let getIgnore = () => [];

function renderParams(type, rule) {
  const p = (rule && rule.params) || {};
  const box = $('paramBox');
  $('previewBox').style.display = 'none';

  if (type === 'entity') {
    box.innerHTML = `
      <label>Entities to watch</label>
      ${pickerHTML('ent', 'Search entities…')}
      <label>Trigger when the entity…</label>
      <select id="mode">
        <option value="state">reaches a specific state</option>
        <option value="numeric">crosses a number</option>
        <option value="any">changes at all</option>
      </select>
      <div id="modeFields"></div>
      <div class="paramrow" style="margin-top:12px">
        <div><label>…and stays that way for (minutes)</label>
          <input type="number" id="forMinutes" min="0" value="${esc(p.for_minutes || 0)}"></div>
      </div>
      <div class="paramrow">
        <div><label>Only after</label><input type="time" id="onlyAfter" value="${esc(p.only_after || '')}"></div>
        <div><label>Only before</label><input type="time" id="onlyBefore" value="${esc(p.only_before || '')}"></div>
      </div>
      <div class="fieldnote">Leave the times empty to let the rule work around
        the clock.</div>`;
    getEntities = mountPicker('ent', p.entities,
      (e) => ['binary_sensor', 'sensor', 'light', 'switch', 'lock', 'cover',
        'climate', 'device_tracker', 'person', 'alarm_control_panel',
        'media_player', 'input_boolean'].includes(e.domain));
    $('mode').value = p.mode || 'state';
    $('mode').addEventListener('change', () => { drawModeFields(p); previewSoon(); });
    drawModeFields(p);
  } else if (type === 'system') {
    const watch = p.watch || ['errors'];
    box.innerHTML = `
      <label>What should I tell you about?</label>
      <div class="chips" id="watchChips">
        ${[['errors', '❌ Errors'], ['warnings', '⚠️ Warnings'],
      ['ha_start', '♻️ Home Assistant restarts']].map(([id, label]) => (
        `<div class="chip ${watch.includes(id) ? 'on' : ''}" data-v="${id}">${label}</div>`)).join('')}
      </div>
      <label>Ignore anything containing (one word or phrase per line)</label>
      <textarea id="ignoreWords" placeholder="e.g. spotify">${esc((p.ignore || []).join('\n'))}</textarea>
      <div class="fieldnote">A noisy integration you can't fix? Put its name here
        and its log lines stop reaching you. A busy system can produce a lot of
        warnings — a cooldown under Delivery options keeps it civil.</div>`;
    chipGroup('watchChips');
  } else if (type === 'dead_device') {
    box.innerHTML = `
      <div class="paramrow">
        <div><label>Report a device once it has been unavailable for (minutes)</label>
          <input type="number" id="deadMinutes" min="1" value="${esc(p.unavailable_minutes || 30)}"></div>
      </div>
      <label class="inline" style="margin-top:12px">
        <input type="checkbox" id="checkBattery" ${p.check_battery ? 'checked' : ''}>
        also warn me about low batteries</label>
      <div class="paramrow">
        <div><label>Battery threshold (%)</label>
          <input type="number" id="batteryThreshold" min="1" max="99"
                 value="${esc(p.battery_threshold || 15)}"></div>
      </div>
      <label>Never report these</label>
      ${pickerHTML('ign', 'Search entities to ignore…')}
      <div class="fieldnote">Each device is reported once. When it comes back and
        dies again, you hear about it again.</div>`;
    getIgnore = mountPicker('ign', p.ignore, () => true);
  } else if (type === 'digest') {
    const days = p.days || [0, 1, 2, 3, 4, 5, 6];
    const sections = p.sections || ['lights_on', 'doors_open', 'batteries'];
    box.innerHTML = `
      <div class="paramrow">
        <div><label>Send it at</label>
          <input type="time" id="digestTime" value="${esc(p.time || '08:00')}"></div>
      </div>
      <label>On these days</label>
      <div class="chips" id="dayChips">
        ${DAYS.map((d, i) => (
        `<div class="chip ${days.includes(i) ? 'on' : ''}" data-v="${i}">${d}</div>`)).join('')}
      </div>
      <label>Include</label>
      <div class="chips" id="sectionChips">
        ${Object.entries(DATA.digest_sections || {}).map(([id, label]) => (
        `<div class="chip ${sections.includes(id) ? 'on' : ''}" data-v="${esc(id)}">${esc(label)}</div>`)).join('')}
      </div>`;
    chipGroup('dayChips');
    chipGroup('sectionChips');
  }

  $('textBox').style.display = type === 'digest' ? 'none' : '';
  $('tplNote').style.display = type === 'entity' ? '' : 'none';
}

function drawModeFields(p) {
  const mode = $('mode').value;
  const box = $('modeFields');
  if (mode === 'state') {
    box.innerHTML = `<div class="paramrow">
      <div><label>Becomes this state</label>
        <input type="text" id="toState" placeholder="on, off, open, home…"
               value="${esc(p.to || '')}"></div>
      <div><label>Coming from (optional)</label>
        <input type="text" id="fromState" value="${esc(p.from || '')}"></div>
    </div>
    <div class="fieldnote">Doors and motion use <b>on</b> and <b>off</b>; covers
      use <b>open</b> and <b>closed</b>; locks use <b>locked</b> and
      <b>unlocked</b>.</div>`;
  } else if (mode === 'numeric') {
    box.innerHTML = `<div class="paramrow">
      <div><label>Goes above</label>
        <input type="number" id="above" step="any" value="${esc(p.above == null ? '' : p.above)}"></div>
      <div><label>Goes below</label>
        <input type="number" id="below" step="any" value="${esc(p.below == null ? '' : p.below)}"></div>
    </div>
    <div class="fieldnote">Fill in one or both. The rule fires the moment the
      value crosses the line, not while it stays there.</div>`;
  } else {
    box.innerHTML = '<div class="fieldnote">Any change at all will notify you — '
      + 'useful for alarm panels and device trackers.</div>';
  }
  box.querySelectorAll('input').forEach((i) => i.addEventListener('input', previewSoon));
}

function chipGroup(id) {
  const el = $(id);
  el.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (chip) chip.classList.toggle('on');
  });
}

function chipValues(id) {
  const el = $(id);
  if (!el) return [];
  return Array.from(el.querySelectorAll('.chip.on')).map((c) => c.dataset.v);
}

/* --------------------------------------------------- rule modal: shell */

function openRule(rule) {
  editRule = rule || null;
  $('ruleTitle').textContent = rule ? 'Edit rule' : 'New rule';
  $('ruleErr').style.display = 'none';
  $('ruleName').value = rule ? rule.name : '';
  $('cusTitle').value = rule ? rule.title || '' : '';
  $('cusMsg').value = rule ? rule.message || '' : '';
  $('cooldown').value = rule ? rule.cooldown || 0 : 0;
  $('urgent').checked = rule ? !!rule.urgent : false;

  $('typeTiles').innerHTML = RULE_TYPES.map((t) => `
    <div class="ttile ${rule && rule.type === t.id ? 'on' : ''}" data-t="${t.id}">
      <div class="ti">${t.icon}</div><b>${esc(t.name)}</b>
      <small>${esc(t.hint)}</small></div>`).join('');

  $('chanPick').innerHTML = DATA.channels.length ? DATA.channels.map((c) => `
    <label class="pickitem">
      <input type="checkbox" value="${esc(c.id)}"
        ${rule && (rule.channels || []).includes(c.id) ? 'checked' : ''}>
      <span class="pn">${chanType(c.type).icon} ${esc(c.name)}
        <small>${esc(chanType(c.type).name)}</small></span>
      <span class="st">${c.enabled ? '' : 'off'}</span>
    </label>`).join('')
    : '<div class="picknone">No channels yet — add one on the Channels tab.</div>';

  if (rule) {
    $('ruleForm').style.display = '';
    $('ruleIcon').textContent = ruleType(rule.type).icon;
    renderParams(rule.type, rule);
  } else {
    $('ruleForm').style.display = 'none';
    $('ruleIcon').textContent = '🔔';
  }
  $('ruleModal').classList.add('open');
}

function collectRule() {
  const tile = document.querySelector('#typeTiles .ttile.on');
  if (!tile) throw new Error('pick a rule type first');
  const type = tile.dataset.t;
  const params = {};

  if (type === 'entity') {
    params.entities = getEntities();
    params.mode = $('mode').value;
    if (params.mode === 'state') {
      params.to = $('toState').value.trim();
      params.from = $('fromState').value.trim();
    } else if (params.mode === 'numeric') {
      params.above = $('above').value === '' ? '' : Number($('above').value);
      params.below = $('below').value === '' ? '' : Number($('below').value);
    }
    params.for_minutes = Number($('forMinutes').value || 0);
    params.only_after = $('onlyAfter').value;
    params.only_before = $('onlyBefore').value;
  } else if (type === 'system') {
    params.watch = chipValues('watchChips');
    params.ignore = $('ignoreWords').value.split('\n')
      .map((s) => s.trim()).filter(Boolean);
  } else if (type === 'dead_device') {
    params.unavailable_minutes = Number($('deadMinutes').value || 30);
    params.check_battery = $('checkBattery').checked;
    params.battery_threshold = Number($('batteryThreshold').value || 15);
    params.ignore = getIgnore();
  } else if (type === 'digest') {
    params.time = $('digestTime').value;
    params.days = chipValues('dayChips').map(Number);
    params.sections = chipValues('sectionChips');
  }

  return {
    id: editRule ? editRule.id : '',
    type,
    name: $('ruleName').value.trim(),
    enabled: editRule ? editRule.enabled : true,
    urgent: $('urgent').checked,
    cooldown: Number($('cooldown').value || 0),
    channels: Array.from($('chanPick').querySelectorAll('input:checked'))
      .map((i) => i.value),
    title: $('cusTitle').value.trim(),
    message: $('cusMsg').value.trim(),
    params,
  };
}

let previewTimer = null;
function previewSoon() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    let body;
    try { body = collectRule(); } catch (e) { return; }
    if (body.type !== 'entity') { $('previewBox').style.display = 'none'; return; }
    try {
      const result = await api('/preview', {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!result.config) { $('previewBox').style.display = 'none'; return; }
      $('previewBox').style.display = '';
      $('previewText').innerHTML = '<b>This creates a Home Assistant automation</b>'
        + ' — you will find it under Settings → Automations, but edit it here.';
      $('yamlPre').textContent = JSON.stringify(result.config, null, 2);
    } catch (err) {
      $('previewBox').style.display = 'none';
    }
  }, 400);
}

async function saveRule() {
  const button = $('saveRule');
  let body;
  try { body = collectRule(); } catch (err) {
    $('ruleErr').textContent = err.message;
    $('ruleErr').style.display = 'block';
    return;
  }
  button.disabled = true;
  try {
    await api('/rules', { method: 'POST', body: JSON.stringify(body) });
    $('ruleModal').classList.remove('open');
    toast('Rule saved');
    await load();
  } catch (err) {
    $('ruleErr').textContent = err.message;
    $('ruleErr').style.display = 'block';
  }
  button.disabled = false;
}

/* ----------------------------------------------------------- channels */

function channelDetail(channel) {
  const cfg = channel.config || {};
  if (channel.type === 'telegram') return `Chat <b>${esc(cfg.chat_id || '?')}</b>`;
  if (channel.type === 'notify') return `<b>${esc(cfg.service || '?')}</b>`;
  if (channel.type === 'webhook') {
    return `${esc(cfg.format || 'json')} → <b>${esc((cfg.url || '').slice(0, 46))}…</b>`;
  }
  return 'Shows up in the Home Assistant sidebar';
}

function renderChannels() {
  const box = $('chanList');
  if (!DATA.channels.length) {
    box.innerHTML = '<div class="empty"><div class="big">📡</div>'
      + 'No channels yet.<br>Add one so your rules have somewhere to send to.</div>';
    return;
  }
  box.innerHTML = DATA.channels.map((c) => {
    const type = chanType(c.type);
    const used = DATA.rules.filter((r) => (r.channels || []).includes(c.id)).length;
    return `<div class="rcard ${c.enabled ? '' : 'off'}" data-id="${esc(c.id)}">
      <div class="top">
        <div class="ticon">${type.icon}</div>
        <div class="nm"><b>${esc(c.name)}</b><small>${esc(type.name)}</small></div>
      </div>
      <div class="detail">${channelDetail(c)}</div>
      <div class="badges">
        <span class="tbadge">${used} rule${used === 1 ? '' : 's'}</span>
        ${c.enabled ? '' : '<span class="tbadge warnb">switched off</span>'}
      </div>
      <div class="foot">
        <button class="iconbtn" data-act="test">🧪 Send a test</button>
        <div class="sp"></div>
        <button class="iconbtn" data-act="edit">✏️ Edit</button>
        <button class="iconbtn danger" data-act="delete">🗑</button>
      </div>
    </div>`;
  }).join('');
}

async function onChanCardClick(event) {
  const card = event.target.closest('.rcard');
  const button = event.target.closest('[data-act]');
  if (!card || !button) return;
  const channel = DATA.channels.find((c) => c.id === card.dataset.id);
  if (!channel) return;

  if (button.dataset.act === 'edit') { openChan(channel); return; }
  if (button.dataset.act === 'delete') {
    if (!confirm(`Delete the channel "${channel.name}"?`)) return;
    try {
      await api('/channels/' + channel.id, { method: 'DELETE' });
      toast('Channel deleted');
      await load();
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (button.dataset.act === 'test') {
    button.innerHTML = '<span class="spinning">⏳</span> Sending';
    try {
      await api(`/channels/${channel.id}/test`, { method: 'POST' });
      toast('Test sent to ' + channel.name);
    } catch (err) { toast(err.message, true); }
    button.innerHTML = '🧪 Send a test';
    load();
  }
}

function chanFields(type, channel) {
  const cfg = (channel && channel.config) || {};
  if (type === 'telegram') {
    const tokenSet = DATA.settings.telegram && DATA.settings.telegram.token_set;
    return `<label>Chat ID</label>
      <input type="text" id="cfChat" value="${esc(cfg.chat_id || '')}"
             placeholder="123456789">
      <div class="fieldnote">${tokenSet
        ? 'Use <b>Find my chats</b> on the Telegram bot tab to look this up.'
        : '⚠️ No bot token saved yet — set one up on the Telegram bot tab first.'}</div>
      <label>Topic ID (only for forum groups, optional)</label>
      <input type="number" id="cfThread" value="${esc(cfg.thread_id || '')}">`;
  }
  if (type === 'notify') {
    const services = DATA.notify_services || [];
    return `<label>Notify service</label>
      <select id="cfService">
        ${services.length ? services.map((s) => (
        `<option value="${esc(s)}" ${cfg.service === s ? 'selected' : ''}>${esc(s)}</option>`)).join('')
        : '<option value="">no notify services found</option>'}
      </select>
      <div class="fieldnote">These come straight from Home Assistant. Your phone
        shows up as <b>notify.mobile_app_…</b> once the companion app is set up.</div>`;
  }
  if (type === 'webhook') {
    return `<label>URL</label>
      <input type="text" id="cfUrl" value="${esc(cfg.url || '')}"
             placeholder="https://discord.com/api/webhooks/…">
      <label>Body format</label>
      <select id="cfFormat">
        ${[['json', 'Plain JSON (title + message)'], ['discord', 'Discord'],
      ['slack', 'Slack / Mattermost']].map(([id, label]) => (
        `<option value="${id}" ${cfg.format === id ? 'selected' : ''}>${label}</option>`)).join('')}
      </select>
      <div class="fieldnote">Discord and Slack both hand out webhook URLs in their
        channel settings — paste one here and you're done.</div>`;
  }
  return '<div class="fieldnote">Nothing to configure — notifications appear in '
    + "Home Assistant's own notification panel.</div>";
}

function openChan(channel) {
  editChan = channel || null;
  $('chanTitle').textContent = channel ? 'Edit channel' : 'New channel';
  $('chanErr').style.display = 'none';
  $('chanName').value = channel ? channel.name : '';
  $('chanTiles').innerHTML = CHANNEL_TYPES.map((t) => `
    <div class="ttile ${channel && channel.type === t.id ? 'on' : ''}" data-t="${t.id}">
      <div class="ti">${t.icon}</div><b>${esc(t.name)}</b>
      <small>${esc(t.hint)}</small></div>`).join('');
  if (channel) {
    $('chanForm').style.display = '';
    $('chanIcon').textContent = chanType(channel.type).icon;
    $('chanFields').innerHTML = chanFields(channel.type, channel);
  } else {
    $('chanForm').style.display = 'none';
    $('chanIcon').textContent = '📡';
  }
  $('chanModal').classList.add('open');
}

async function saveChan() {
  const tile = document.querySelector('#chanTiles .ttile.on');
  if (!tile) return;
  const type = tile.dataset.t;
  const config = {};
  if (type === 'telegram') {
    config.chat_id = $('cfChat').value.trim();
    if ($('cfThread').value) config.thread_id = Number($('cfThread').value);
  } else if (type === 'notify') {
    config.service = $('cfService').value;
  } else if (type === 'webhook') {
    config.url = $('cfUrl').value.trim();
    config.format = $('cfFormat').value;
  }
  const body = {
    id: editChan ? editChan.id : '',
    type,
    name: $('chanName').value.trim(),
    enabled: editChan ? editChan.enabled : true,
    config,
  };
  $('saveChan').disabled = true;
  try {
    await api('/channels', { method: 'POST', body: JSON.stringify(body) });
    $('chanModal').classList.remove('open');
    toast('Channel saved');
    await load();
  } catch (err) {
    $('chanErr').textContent = err.message;
    $('chanErr').style.display = 'block';
  }
  $('saveChan').disabled = false;
}

/* ---------------------------------------------------------- bot page */

function renderBotPage() {
  const tg = DATA.settings.telegram || {};
  $('tokenState').innerHTML = tg.token_set
    ? '✅ A token is saved. Leave the box empty to keep it.'
    : '⚠️ No token saved yet.';
  $('allowChats').value = (tg.allow_chats || []).join('\n');
  ctlSelected = new Set(tg.controls || []);

  const bot = DATA.bot || {};
  $('botStat').innerHTML = bot.error
    ? `<span class="dot"></span>${esc(bot.error)}`
    : (bot.running
      ? `<span class="dot ok"></span>listening as @${esc(bot.username || '')}`
      : '<span class="dot"></span>bot not running');
  drawControls();
}

function drawControls() {
  const needle = ($('ctlSearch').value || '').toLowerCase().trim();
  const domains = ['light', 'switch', 'fan', 'cover', 'lock', 'input_boolean',
    'script', 'scene', 'media_player'];
  let items = DATA.entities.filter((e) => domains.includes(e.domain));
  if (needle) {
    items = items.filter((e) => e.id.toLowerCase().includes(needle)
      || e.name.toLowerCase().includes(needle));
  }
  const chosen = items.filter((e) => ctlSelected.has(e.id));
  items = chosen.concat(items.filter((e) => !ctlSelected.has(e.id))).slice(0, 250);
  $('ctlCount').textContent = ctlSelected.size + ' selected';
  $('ctlList').innerHTML = items.length ? items.map((e) => `
    <label class="pickitem">
      <input type="checkbox" value="${esc(e.id)}" ${ctlSelected.has(e.id) ? 'checked' : ''}>
      <span class="pn">${esc(e.name)}<small>${esc(e.id)}</small></span>
      <span class="st">${esc(e.state)}</span>
    </label>`).join('')
    : '<div class="picknone">No controllable entities match.</div>';
}

/* -------------------------------------------------------------- history */

function renderLog() {
  const box = $('logList');
  if (!DATA.log.length) {
    box.innerHTML = '<div class="empty"><div class="big">🕘</div>'
      + 'Nothing sent yet.</div>';
    return;
  }
  box.innerHTML = DATA.log.map((entry) => {
    const results = entry.results || [];
    const ok = results.some((r) => r.ok);
    const icon = entry.skipped ? '⏸' : (ok ? '✅' : '❌');
    const detail = entry.skipped
      ? 'skipped — ' + esc(entry.skipped)
      : results.map((r) => (r.ok ? '✅ ' : '❌ ') + esc(r.name)
        + (r.error ? ' (' + esc(r.error) + ')' : '')).join(' · ');
    return `<div class="logrow">
      <div class="lic">${icon}</div>
      <div class="lb">
        <b>${esc(entry.title || entry.rule)}</b>
        <p>${esc(entry.message || '')}</p>
        <p style="color:var(--mut);font-size:11px">${esc(entry.rule)} — ${detail}</p>
      </div>
      <div class="lt">${esc(timeAgo(entry.ts))}</div>
    </div>`;
  }).join('');
}

/* ----------------------------------------------------------- settings */

async function saveSettings(patch, message) {
  try {
    await api('/settings', { method: 'POST', body: JSON.stringify(patch) });
    toast(message || 'Saved');
    await load();
  } catch (err) { toast(err.message, true); }
}

/* ---------------------------------------------------------------- wire */

function wire() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('on'));
      tab.classList.add('on');
      $('page-' + tab.dataset.page).classList.add('on');
    });
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.modal').classList.remove('open');
    });
  });
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) modal.classList.remove('open');
    });
  });

  $('newBtn').addEventListener('click', () => {
    if (!DATA.channels.length) {
      toast('Add a channel first — a rule needs somewhere to send to.', true);
      document.querySelector('[data-page=channels]').click();
      return;
    }
    openRule(null);
  });
  $('newChanBtn').addEventListener('click', () => openChan(null));

  $('typeTiles').addEventListener('click', (event) => {
    const tile = event.target.closest('.ttile');
    if (!tile) return;
    document.querySelectorAll('#typeTiles .ttile').forEach((t) => t.classList.remove('on'));
    tile.classList.add('on');
    $('ruleIcon').textContent = ruleType(tile.dataset.t).icon;
    $('ruleForm').style.display = '';
    renderParams(tile.dataset.t, editRule && editRule.type === tile.dataset.t
      ? editRule : null);
    previewSoon();
  });

  $('chanTiles').addEventListener('click', (event) => {
    const tile = event.target.closest('.ttile');
    if (!tile) return;
    document.querySelectorAll('#chanTiles .ttile').forEach((t) => t.classList.remove('on'));
    tile.classList.add('on');
    $('chanIcon').textContent = chanType(tile.dataset.t).icon;
    $('chanForm').style.display = '';
    $('chanFields').innerHTML = chanFields(tile.dataset.t,
      editChan && editChan.type === tile.dataset.t ? editChan : null);
  });

  $('saveRule').addEventListener('click', saveRule);
  $('saveChan').addEventListener('click', saveChan);
  $('ruleName').addEventListener('input', previewSoon);
  $('cusTitle').addEventListener('input', previewSoon);
  $('cusMsg').addEventListener('input', previewSoon);
  $('yamlToggle').addEventListener('click', () => {
    $('yamlPre').classList.toggle('open');
  });

  $('ruleList').addEventListener('click', onRuleCardClick);
  $('chanList').addEventListener('click', onChanCardClick);
  $('ruleSearch').addEventListener('input', (event) => {
    ruleFilter = event.target.value;
    renderRules();
  });

  $('saveQuiet').addEventListener('click', () => saveSettings({
    quiet_start: $('quietStart').value, quiet_end: $('quietEnd').value,
  }, 'Quiet hours saved'));

  $('muteBtn').addEventListener('click', async () => {
    const minutes = DATA.muted ? 0 : 60;
    try {
      await api('/mute', { method: 'POST', body: JSON.stringify({ minutes }) });
      toast(minutes ? 'Muted for an hour — urgent rules still get through'
        : 'Notifications are back on');
      await load();
    } catch (err) { toast(err.message, true); }
  });

  $('saveToken').addEventListener('click', () => {
    const token = $('botToken').value.trim();
    if (!token) { toast('Paste a token first', true); return; }
    $('botToken').value = '';
    saveSettings({ telegram: { token } }, 'Token saved — checking the bot…');
  });
  $('clearToken').addEventListener('click', () => {
    if (!confirm('Remove the saved bot token? Telegram channels stop working.')) return;
    saveSettings({ telegram: { clear_token: true } }, 'Token removed');
  });
  $('testBot').addEventListener('click', async () => {
    try {
      const result = await api('/bot/test', { method: 'POST' });
      toast(`Bot is alive: ${result.name} (@${result.username})`);
      await load();
    } catch (err) { toast(err.message, true); }
  });
  $('findChats').addEventListener('click', async () => {
    try {
      const result = await api('/bot/chats');
      if (!result.chats.length) {
        $('chatFound').innerHTML = 'No recent chats. Open Telegram, send '
          + '<code>/start</code> to your bot, then press this again.';
        return;
      }
      $('chatFound').innerHTML = 'Found: ' + result.chats.map((c) => (
        `<code>${esc(c.id)}</code> ${esc(c.title)}`)).join(' · ')
        + '<br>Copy the ID you want into the box above and press Save.';
    } catch (err) { toast(err.message, true); }
  });
  $('saveAllow').addEventListener('click', () => saveSettings({
    telegram: {
      allow_chats: $('allowChats').value.split('\n')
        .map((s) => s.trim()).filter(Boolean),
    },
  }, 'Allowed chats saved'));

  $('ctlSearch').addEventListener('input', drawControls);
  $('ctlList').addEventListener('change', (event) => {
    const box = event.target;
    if (box.tagName !== 'INPUT') return;
    if (box.checked) ctlSelected.add(box.value); else ctlSelected.delete(box.value);
    $('ctlCount').textContent = ctlSelected.size + ' selected';
  });
  $('saveControls').addEventListener('click', () => saveSettings({
    telegram: { controls: Array.from(ctlSelected) },
  }, 'Quick controls saved'));

  $('clearLog').addEventListener('click', async () => {
    if (!confirm('Clear the whole delivery history?')) return;
    try {
      await api('/log/clear', { method: 'POST' });
      await load();
    } catch (err) { toast(err.message, true); }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open'));
    }
  });
}

wire();
load();
setInterval(() => {
  // never refresh under the user's fingers while a modal is open
  if (!document.querySelector('.modal.open')) load();
}, 30000);
