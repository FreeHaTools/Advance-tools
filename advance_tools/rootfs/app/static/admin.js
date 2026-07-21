/* Advance Tools admin UI — v1.3 (table + detail view, themes, responsive) */
'use strict';
let CFG = { users: {}, dashboards: {}, domain: '' };
let ENTITIES = [];

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
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
async function logout() { await fetch('/api/logout', { method: 'POST' }); location.href = '/'; }
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/"/g,'&quot;');

/* ---------- theme ---------- */
function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  $('#themebtn').textContent = t === 'light' ? '☀️' : '🌙';
  localStorage.setItem('at-theme', t);
}
applyTheme(localStorage.getItem('at-theme') || 'dark');
$('#themebtn').onclick = () =>
  applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');

/* ---------- tabs ---------- */
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('main section').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('#tab-' + b.dataset.tab).classList.add('active');
});

/* ---------- load ---------- */
async function load(keepDetail) {
  CFG = await api('/api/admin/config');
  const st = $('#hastat');
  st.textContent = CFG.ha_connected ? 'connected' : 'disconnected';
  st.className = CFG.ha_connected ? 'on' : 'off';
  renderDashTable(); renderUsers();
  if (!keepDetail) showList();
  api('/api/admin/entities').then(d => { ENTITIES = d.entities; }).catch(() => {});
  loadPacks();
}

/* ---------- dashboards: table view ---------- */
function usersWithAccess(slug) {
  return Object.values(CFG.users).filter(u =>
    u.is_admin || u.dashboards.includes('*') || u.dashboards.includes(slug)).length;
}

function renderDashTable() {
  const tb = $('#dashtable tbody');
  tb.innerHTML = '';
  const slugs = Object.keys(CFG.dashboards);
  $('#dashempty').style.display = slugs.length ? 'none' : 'block';
  for (const slug of slugs) {
    const d = CFG.dashboards[slug];
    const tr = document.createElement('tr');
    tr.className = 'rowlink';
    tr.innerHTML = `
      <td data-l="Dashboard"><div class="dname">${esc(d.name)}</div><div class="dsub">/d/${slug}/</div></td>
      <td data-l="Design">${d.mode === 'design' ? '🎨 visual' : '📝 HTML'}</td>
      <td data-l="Entities">${d.allow_all ? '<span class="chip">all</span>'
           : `<span class="chip">${(d.entities || []).length} rule(s)</span>`}</td>
      <td data-l="Users"><span class="chip">${usersWithAccess(slug)} 👥</span></td>
      <td data-l="Actions"><div class="actions">
        <a class="ghost iconbtn" title="View live" target="_blank" href="/d/${slug}/?preview=1">👁</a>
        <a class="ghost iconbtn" title="Designer" href="/admin/designer?d=${slug}">🎨</a>
        <a class="ghost iconbtn" title="Page setup (size, logout gesture)"
           href="/admin/designer?d=${slug}&setup=1">⚙️</a>
        <button class="ghost" data-e="${slug}">✏️ Details</button>
        <button class="ghost danger iconbtn" title="Delete" data-d="${slug}">🗑</button>
      </div></td>`;
    tr.querySelector('[data-e]').onclick = () => openDetail(slug);
    tr.querySelector('[data-d]').onclick = () => delDash(slug);
    tb.appendChild(tr);
  }
}

function showList() {
  $('#dashdetail').style.display = 'none';
  $('#dashlistview').style.display = 'block';
}

/* ---------- dashboards: detail view ---------- */
function openDetail(slug) {
  const d = CFG.dashboards[slug];
  if (!d) return;
  $('#dashlistview').style.display = 'none';
  const box = $('#dashdetail');
  box.style.display = 'block';
  box.innerHTML = `
    <div class="toolbar">
      <button class="ghost" onclick="showList()">← All dashboards</button>
      <h2 style="margin:0">${esc(d.name)} <span class="chip">/d/${slug}/</span></h2>
      <span style="flex:1"></span>
      <a class="ghost" target="_blank" href="/d/${slug}/?preview=1">👁 View</a>
      <a class="ghost" href="/admin/designer?d=${slug}">🎨 Designer</a>
      <a class="ghost" href="/admin/designer?d=${slug}&setup=1">⚙️ Page setup</a>
    </div>
    <div class="card">
      <h2><span class="dot"></span>Links</h2>
      <div class="linkrow">${dashLinks(slug)}</div>
    </div>
    <div class="card">
      <h2><span class="dot"></span>Settings</h2>
      <div class="hint">Mode: ${d.mode === 'design'
        ? '🎨 visual design — built in the Designer'
        : '📝 custom HTML — hand-written page (saving in the Designer switches it back)'}</div>
      <label>Display name</label>
      <input type="text" id="dn-${slug}" value="${esc(d.name)}">
      <label>Allowed entities (one per line — wildcards OK: light.bedroom1_*)</label>
      <textarea class="small" id="de-${slug}">${(d.entities || []).join('\n')}</textarea>
      <div class="checks" style="margin-top:8px">
        <label><input type="checkbox" id="da-${slug}" ${d.allow_all ? 'checked' : ''}>
          Allow all entities (no restriction)</label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" onclick="saveDash('${slug}')">Save settings</button>
        <button class="ghost" onclick="togglePicker('${slug}')">📋 Pick from entity list</button>
      </div>
      <div class="epicker" id="ep-${slug}" style="display:none"></div>
    </div>
    <div class="card">
      <h2><span class="dot"></span>Custom HTML (advanced)</h2>
      <div class="row">
        <button class="ghost" onclick="toggleEditor('${slug}')">📝 Open HTML editor</button>
      </div>
      <div id="ed-${slug}" style="display:none; margin-top:14px">
        <label>index.html — write your own design here (saving switches the
        dashboard to HTML mode)</label>
        <textarea class="code" id="html-${slug}" spellcheck="false"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn" onclick="saveHtml('${slug}')">Save HTML</button>
          <label class="ghost" style="cursor:pointer; margin:0">
            Upload files (html/css/js/images/zip)
            <input type="file" multiple style="display:none" onchange="upload('${slug}', this.files)">
          </label>
        </div>
        <ul class="filelist" id="files-${slug}" style="list-style:none; margin-top:10px"></ul>
      </div>
    </div>`;
}

/* ---------- new dashboard modal ---------- */
function openNewDash() { $('#nd-slug').value = ''; $('#nd-name').value = '';
  $('#newdash').classList.add('open'); setTimeout(() => $('#nd-slug').focus(), 50); }
function closeNewDash() { $('#newdash').classList.remove('open'); }
$('#newdash').addEventListener('pointerdown', ev => {
  if (ev.target === $('#newdash')) closeNewDash(); });

async function createDash() {
  const slug = $('#nd-slug').value.trim().toLowerCase();
  const name = $('#nd-name').value.trim() || slug;
  if (!slug) return toast('Please enter a slug', true);
  try {
    await api('/api/admin/dashboards', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name, entities: [], allow_all: false }) });
    closeNewDash();
    toast('Dashboard created');
    await load(true);
    openDetail(slug);
  } catch (e) { toast(e.message, true); }
}

async function saveDash(slug) {
  try {
    await api('/api/admin/dashboards', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        name: $('#dn-' + slug).value.trim(),
        entities: $('#de-' + slug).value.split('\n'),
        allow_all: $('#da-' + slug).checked }) });
    toast('Saved');
    CFG = await api('/api/admin/config');
    renderDashTable(); renderUsers();
  } catch (e) { toast(e.message, true); }
}

async function delDash(slug) {
  if (!await ATDialog.confirm('Delete dashboard?',
    `"${slug}" and all its files/design will be permanently removed.`,
    { danger: true, icon: '🗑', okText: 'Delete' })) return;
  await api('/api/admin/dashboards/' + slug, { method: 'DELETE' });
  toast('Deleted'); load();
}

/* ---------- dashboard links ---------- */
function dashLinks(slug) {
  const links = [[`${location.origin}/d/${slug}/`, '🖧 IP']];
  if (CFG.domain) links.push([`${CFG.domain}/d/${slug}/`, '🌐 Domain']);
  return links.map(([url, tag]) => `
    <span class="dlink">
      <span class="tag">${tag}</span>
      <code>${url}</code>
      <button class="ghost copybtn" data-url="${url}" title="Copy link">📋</button>
    </span>`).join('') +
    (CFG.domain ? '' : `<span class="hint" style="margin:0">— set a domain in the
     add-on Configuration to also get a clean domain link</span>`);
}
document.addEventListener('click', async ev => {
  const b = ev.target.closest('.copybtn');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.url); toast('Link copied'); }
  catch { ATDialog.prompt('Copy this link', 'Select and copy:', b.dataset.url,
                          { icon: '🔗', okText: 'Done' }); }
});

/* ---------- entity picker ---------- */
const allowList = slug =>
  $('#de-' + slug).value.split('\n').map(s => s.trim()).filter(Boolean);
function setAllowList(slug, arr) {
  $('#de-' + slug).value = [...new Set(arr)].join('\n');
}
function togglePicker(slug) {
  const box = $('#ep-' + slug);
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  if (!ENTITIES.length) return toast('Not connected to Home Assistant', true);
  box.style.display = 'block';
  box.innerHTML = `
    <input class="epsearch" id="eps-${slug}"
           placeholder="🔎 Search by name or entity id… (${ENTITIES.length} entities)">
    <div class="eplist" id="epl-${slug}"></div>`;
  $('#eps-' + slug).addEventListener('input',
    ev => buildEpList(slug, ev.target.value.trim().toLowerCase()));
  buildEpList(slug, '');
}
function buildEpList(slug, q) {
  const listEl = $('#epl-' + slug);
  const sel = new Set(allowList(slug));
  let list = ENTITIES;
  if (q) list = list.filter(e => (e.id + ' ' + e.name).toLowerCase().includes(q));
  if (!list.length) {
    listEl.innerHTML = '<div class="hint" style="padding:12px">No entities match.</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const d of [...new Set(list.map(e => e.domain))].sort()) {
    const items = list.filter(x => x.domain === d);
    const head = document.createElement('div');
    head.className = 'epdom';
    head.innerHTML = `<span>${d}</span><span class="cnt">${items.length}</span>
      <button class="ghost" title="Allow every ${d} entity">+ ${d}.*</button>`;
    head.querySelector('button').onclick = () => {
      setAllowList(slug, [...allowList(slug), `${d}.*`]);
      toast(`Added wildcard ${d}.* — remember to Save settings`);
    };
    listEl.appendChild(head);
    for (const e of items) {
      const row = document.createElement('label');
      row.className = 'eprow';
      row.innerHTML = `<input type="checkbox" ${sel.has(e.id) ? 'checked' : ''}>
        <span class="epname">${esc(e.name)}</span>
        <span class="epid">${e.id}</span>
        <span class="epstate">${esc(e.state ?? '')}${e.unit ? ' ' + esc(e.unit) : ''}</span>`;
      row.querySelector('input').addEventListener('change', ev => {
        const cur = allowList(slug);
        if (ev.target.checked) setAllowList(slug, [...cur, e.id]);
        else setAllowList(slug, cur.filter(x => x !== e.id));
      });
      listEl.appendChild(row);
    }
  }
}

/* ---------- html editor ---------- */
async function toggleEditor(slug) {
  const box = $('#ed-' + slug);
  if (box.style.display === 'none') {
    const d = await api(`/api/admin/dashboards/${slug}/html`);
    $('#html-' + slug).value = d.html;
    await refreshFiles(slug);
    box.style.display = 'block';
  } else box.style.display = 'none';
}
async function saveHtml(slug) {
  try {
    await api(`/api/admin/dashboards/${slug}/html`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: $('#html-' + slug).value }) });
    toast('HTML saved — dashboard switched to HTML mode');
  } catch (e) { toast(e.message, true); }
}
async function upload(slug, files) {
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  try {
    const r = await api(`/api/admin/dashboards/${slug}/upload`, { method: 'POST', body: fd });
    toast(`${r.saved.length} file(s) uploaded`);
    await refreshFiles(slug);
  } catch (e) { toast(e.message, true); }
}
async function refreshFiles(slug) {
  const d = await api(`/api/admin/dashboards/${slug}/files`);
  const ul = $('#files-' + slug);
  ul.innerHTML = '';
  for (const f of d.files) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(f)}</span>
      <button class="ghost danger" style="padding:2px 10px" data-f="${esc(f)}">✕</button>`;
    li.querySelector('button').onclick = async ev => {
      await api(`/api/admin/dashboards/${slug}/files/${ev.target.dataset.f}`, { method: 'DELETE' });
      refreshFiles(slug);
    };
    ul.appendChild(li);
  }
}

/* ---------- packs ---------- */
async function loadPacks() {
  try {
    const d = await api('/api/admin/packs');
    const box = $('#packlist');
    if (!box) return;
    box.innerHTML = '';
    if (!d.packs.length) {
      box.innerHTML = '<div class="hint">No imported packs yet — only the built-in ' +
        'library. Import one below, or build your own (see the next tab).</div>';
      return;
    }
    for (const p of d.packs) {
      const styles = (p.items || []).filter(i => i.kind === 'style').length;
      const skins = (p.items || []).filter(i => i.kind === 'skin').length;
      const row = document.createElement('div');
      row.className = 'packrow';
      row.innerHTML = `<div class="pi">📦</div>
        <div><div class="pn">${esc(p.name)}</div>
        <div class="pd">${p.author ? esc(p.author) + ' · ' : ''}v${esc(p.version || '?')} —
        ${skins} skin(s), ${styles} style(s)</div></div>
        <span class="sp"></span>
        <button class="ghost danger">Remove</button>`;
      row.querySelector('button').onclick = async () => {
        if (!await ATDialog.confirm('Remove pack?',
          `"${p.name}" and its designs will disappear from the Designer.`,
          { danger: true, icon: '📦', okText: 'Remove' })) return;
        await api('/api/admin/packs/' + p.pid, { method: 'DELETE' });
        loadPacks(); toast('Pack removed');
      };
      box.appendChild(row);
    }
  } catch (e) { /* optional */ }
}
async function importPack() {
  let obj;
  try { obj = JSON.parse($('#packjson').value); }
  catch { return toast('Invalid JSON', true); }
  try {
    const r = await api('/api/admin/packs', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    $('#packjson').value = '';
    toast(`Pack imported — ${r.items} item(s) added to the Designer`);
    loadPacks();
  } catch (e) { toast(e.message, true); }
}
function importPackFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => { $('#packjson').value = rd.result; importPack(); };
  rd.readAsText(file);
}

/* ---------- users ---------- */
function renderUsers() {
  const checks = $('#u-dashes');
  checks.innerHTML = '';
  for (const [slug, d] of Object.entries(CFG.dashboards)) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" value="${slug}"> ${esc(d.name)}`;
    checks.appendChild(l);
  }
  const tb = $('#usertable tbody');
  tb.innerHTML = '';
  for (const [name, u] of Object.entries(CFG.users)) {
    const tr = document.createElement('tr');
    const dashes = u.is_admin || u.dashboards.includes('*')
      ? '<span class="chip">all</span>'
      : u.dashboards.map(s => `<span class="chip">${esc((CFG.dashboards[s] || {}).name || s)}</span>`).join('') || '—';
    tr.innerHTML = `<td data-l="User">${esc(name)}${name === 'admin'
        ? ' <span class="chip" title="Built-in account">🔒 system</span>' : ''}</td>
      <td data-l="Role">${u.is_admin ? '👑 admin' : 'user'}</td><td data-l="Dashboards">${dashes}</td>
      <td data-l="Actions" style="white-space:nowrap"><div class="actions">
        <button class="ghost" data-e="${esc(name)}">✏️ Edit</button>
        ${name === 'admin' ? '' :
          `<button class="ghost danger iconbtn" data-d="${esc(name)}">🗑</button>`}</div></td>`;
    tr.querySelector('[data-e]').onclick = () => {
      $('#u-name').value = name; $('#u-pass').value = '';
      $('#u-admin').checked = u.is_admin;
      checks.querySelectorAll('input').forEach(c =>
        c.checked = u.dashboards.includes('*') || u.dashboards.includes(c.value));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const delBtn = tr.querySelector('[data-d]');
    if (delBtn) delBtn.onclick = async () => {
      if (!await ATDialog.confirm('Delete user?',
        `"${name}" will lose access to all dashboards.`,
        { danger: true, icon: '👤', okText: 'Delete' })) return;
      try { await api('/api/admin/users/' + name, { method: 'DELETE' }); load(); }
      catch (e) { toast(e.message, true); }
    };
    tb.appendChild(tr);
  }
}

async function saveUser() {
  const username = $('#u-name').value.trim();
  if (!username) return toast('Please enter a username', true);
  const dashboards = [...$('#u-dashes').querySelectorAll('input:checked')].map(c => c.value);
  try {
    await api('/api/admin/users', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: $('#u-pass').value,
        is_admin: $('#u-admin').checked, dashboards }) });
    toast('User saved');
    $('#u-name').value = ''; $('#u-pass').value = ''; $('#u-admin').checked = false;
    load(true);
  } catch (e) { toast(e.message, true); }
}

load();
