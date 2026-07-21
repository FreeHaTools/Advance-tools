/* Advance Tools — pack registry + markup builder (shared by designer & renderer).
 * Loads after packs.js (built-ins) and styles.js (built-in card styles).
 * Custom packs (same format) are merged in via AT_SET_CUSTOM_PACKS().
 */
(function () {
'use strict';

let CUSTOM_PACKS = [];
window.AT_SET_CUSTOM_PACKS = p => { CUSTOM_PACKS = p || []; };
window.AT_ALL_PACKS = () => [...(window.AT_BUILTIN_PACKS || []), ...CUSTOM_PACKS];

window.AT_ALL_SKINS = () => window.AT_ALL_PACKS()
  .flatMap(p => p.items || []).filter(i => i.kind === 'skin');

window.AT_ALL_STYLES = () => [
  ...(window.AT_STYLES || []),
  ...window.AT_ALL_PACKS().flatMap(p => p.items || []).filter(i => i.kind === 'style'),
];

window.AT_SKIN = id => window.AT_ALL_SKINS().find(s => s.id === id);

/* default skin per element type */
const TYPE_DEFAULT_SKIN = { toggle: 'toggle-card', light: 'light-slider',
  sensor: 'sensor-card', climate: 'dial', button: 'button-card',
  vacuum: 'vacuum-bot', cover: 'cover-curtain', valve: 'valve-wheel',
  media: 'media-mini', clock: 'clock-card', chart: 'chart-line',
  camera: 'camera-feed', nav: 'nav-tile', select: 'select-dropdown',
  litterbox: 'lr-cartoon-room', fbnotes: 'fb-sticky', fblist: 'fb-list',
  energysum: 'en-hero', intercom: 'ic-round', seckeypad: 'sk-pad' };
window.AT_TYPE_DEFAULT_SKIN = TYPE_DEFAULT_SKIN;

/* legacy (v0.x) variant → skin id */
const LEGACY = { 'toggle:ios':'ios', 'toggle:push':'push', 'toggle:rocker':'rocker',
  'toggle:card':'toggle-card', 'sensor:card':'sensor-card', 'sensor:big':'sensor-big',
  'sensor:chip':'sensor-chip', 'climate:dial':'dial', 'climate:card':'climate-card',
  'button:card':'button-card' };
window.AT_MIGRATE_WIDGET = function (w) {
  if (w.variant && !w.skin) { w.skin = LEGACY[`${w.type}:${w.variant}`]; delete w.variant; }
  if (w.type === 'heading') { w.type = 'label'; w.size = w.size || 17; w.bold = true;
                              delete w.collapsible; }
  if (!w.skin && TYPE_DEFAULT_SKIN[w.type]) w.skin = TYPE_DEFAULT_SKIN[w.type];
};

window.AT_DEFAULT_SIZE = function (type, skinId) {
  const s = window.AT_SKIN(skinId || TYPE_DEFAULT_SKIN[type]);
  if (s && s.size) return s.size.slice();
  return { label: [220, 40], box: [340, 240], line: [300, 4] }[type] || [200, 110];
};

const DEFAULT_ICON = { toggle: '💡', light: '💡', sensor: '📊', climate: '🌡️',
  button: '▶️', vacuum: '🤖', cover: '🪟', valve: '🚰', media: '🎵', clock: '',
  chart: '📈', camera: '📷', nav: '➡️', select: '🔽', litterbox: '🐈',
  fbnotes: '📝', fblist: '🛒', energysum: '⚡', intercom: '📢',
  seckeypad: '🔐' };

/* compile skin css (.SKIN placeholder) + collect all pack css */
window.AT_COMPILE_SKIN = s =>
  (s.css || '').split('.SKIN').join(`.at-skin[data-skin="${s.id}"]`);
window.AT_PACK_CSS = () =>
  window.AT_ALL_SKINS().map(window.AT_COMPILE_SKIN).join('\n');

/* base css: skin wrapper + hooks + card base */
window.AT_WIDGET_CSS = `
.at-skin { position:relative; width:100%; height:100%; display:flex;
  flex-direction:column; justify-content:center; overflow:hidden; }
.at-skin.w { border-radius:var(--radius,14px); padding:14px;
  background:var(--card,#1a2233); }
.at-ico { font-size:24px; line-height:1; }
.at-name { font-size:13px; color:var(--mut,#8b98b8); margin-top:6px; }
.at-val { font-size:19px; font-weight:600; margin-top:2px; }
.at-val.flash { animation:at-flash .7s; }
@keyframes at-flash { 0% { color:var(--accent); transform:scale(1.06);
  transform-origin:left; } }
.at-skin.unavail { opacity:.45; }
.at-grow { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.at-end { margin-left:auto; }
.at-box { width:100%; height:100%; border-radius:var(--radius,14px);
  background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09);
  position:relative; }
.at-box.w { background:var(--card); }
.at-box .at-boxtitle { position:absolute; top:10px; left:16px; font-size:12px;
  color:var(--mut,#8b98b8); letter-spacing:.06em; text-transform:uppercase; }
.at-label { width:100%; height:100%; display:flex; align-items:center;
  overflow:hidden; }
.at-line { width:100%; height:100%; border-radius:3px; }
.at-navov { position:fixed; inset:0; z-index:200; background:var(--bg,#0f1420);
  display:flex; flex-direction:column; animation:at-navin .25s ease; }
@keyframes at-navin { from { opacity:0; transform:translateX(30px); } }
.at-navbar { flex:0 0 auto; padding:8px 12px;
  background:var(--card,#1a2233); border-bottom:1px solid rgba(255,255,255,.1); }
.at-navback { background:rgba(255,255,255,.08); color:var(--text,#e8edf7);
  border:1px solid rgba(255,255,255,.15); padding:9px 18px; border-radius:9px;
  font-size:14px; cursor:pointer; }
.at-navback:active { transform:scale(.97); }
.at-navov iframe { flex:1; width:100%; border:0; background:var(--bg,#0f1420); }
/* waiting/busy state (set by the runtime after a tap, until the device responds) */
.at-skin.at-busy { position:relative; pointer-events:none; }
.at-skin.at-busy > * { opacity:.45; transition:opacity .12s; }
.at-skin.at-busy::after { content:''; position:absolute; z-index:60; top:50%; left:50%;
  width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%;
  border:3px solid rgba(255,255,255,.28); border-top-color:var(--accent,#4f8cff);
  animation:at-busy-spin .7s linear infinite; }
@keyframes at-busy-spin { to { transform:rotate(360deg); } }

/* ---- Home Life: shared bits (empty states, fullscreen overlays, chips) ---- */
.at-fbempty { flex:1; display:flex; align-items:center; justify-content:center;
  color:var(--mut,#8b98b8); font-size:13px; text-align:center; padding:10px;
  min-height:44px; }
.at-fsov { position:fixed; inset:0; z-index:220; display:none; align-items:center;
  justify-content:center; background:rgba(6,9,16,.8); backdrop-filter:blur(8px); }
.at-fsov.open { display:flex; animation:at-fsin .2s ease; }
@keyframes at-fsin { from { opacity:0; } }
.at-fspanel { width:min(560px,94vw); max-height:92vh; display:flex;
  flex-direction:column; background:var(--card,#1a2233);
  border:1px solid rgba(255,255,255,.12); border-radius:20px; overflow:hidden;
  animation:at-fsup .25s ease; }
@keyframes at-fsup { from { transform:translateY(22px); opacity:0; } }
.at-fshead { display:flex; align-items:center; gap:10px; padding:10px 10px 10px 18px;
  border-bottom:1px solid rgba(255,255,255,.08); font-size:16px; font-weight:700; }
.at-fsx { margin-left:auto; min-width:44px; min-height:44px; border:0;
  border-radius:12px; background:rgba(255,255,255,.08); color:var(--text,#e8edf7);
  font-size:17px; cursor:pointer; }
.at-fsx:active { transform:scale(.94); background:rgba(255,255,255,.16); }
.at-fsbody { padding:14px 18px; overflow-y:auto; display:flex;
  flex-direction:column; gap:10px; -webkit-overflow-scrolling:touch; }
.at-fsrow { display:flex; gap:8px; padding:12px 16px;
  border-top:1px solid rgba(255,255,255,.08); }
.at-fsinput { flex:1; min-width:0; min-height:46px; padding:0 14px;
  border-radius:12px; border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.06); color:var(--text,#e8edf7); font-size:15px;
  outline:none; }
.at-fsinput:focus { border-color:var(--accent,#4f8cff); }
.at-fsbtn { min-height:46px; min-width:76px; padding:0 18px; border:0;
  border-radius:12px; background:var(--accent,#4f8cff); color:#fff;
  font-size:14px; font-weight:600; cursor:pointer; }
.at-fsbtn:active { transform:scale(.96); }
/* note overlay */
.at-nov-text { font-size:21px; line-height:1.45; white-space:pre-wrap;
  word-break:break-word; }
.at-nov-meta { font-size:12px; color:var(--mut,#8b98b8); }
.at-nov-replies { display:flex; flex-direction:column; gap:8px; }
.at-nov-replies .rp { background:rgba(255,255,255,.05); border-radius:12px;
  padding:9px 12px; animation:at-fsin .25s ease; }
.at-nov-replies .rphead { display:flex; gap:8px; align-items:center;
  font-size:12px; color:var(--mut,#8b98b8); }
.at-nov-replies .rphead b { color:var(--text,#e8edf7); }
.at-nov-replies .rpdel { margin:-8px -6px -8px auto; min-width:44px;
  min-height:44px; border:0; background:none; color:var(--mut,#8b98b8);
  font-size:14px; cursor:pointer; }
.at-nov-replies .rpdel:active { color:#ff7a7a; }
.at-nov-replies .rptext { font-size:14px; margin-top:3px; word-break:break-word; }
/* intercom overlay */
.at-icsec { font-size:11px; letter-spacing:.06em; text-transform:uppercase;
  color:var(--mut,#8b98b8); margin-top:4px; }
.at-icareas, .at-icquick { display:flex; flex-wrap:wrap; gap:8px; }
.at-icchip { min-height:44px; padding:0 16px; border-radius:22px;
  border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06);
  color:var(--text,#e8edf7); font-size:14px; cursor:pointer; transition:.15s; }
.at-icchip:active { transform:scale(.95); }
.at-icchip.on { background:var(--accent,#4f8cff);
  border-color:var(--accent,#4f8cff); color:#fff; }
.at-icchip small { font-size:11px; opacity:.75; font-weight:400; }
.at-icchip.dim { opacity:.4; cursor:default; }
.at-icchip.dim:active { transform:none; }
.at-icvols { display:flex; flex-direction:column; gap:6px; }
.at-icvol { display:flex; align-items:center; gap:12px; min-height:40px; }
.at-icvol .vn { flex:0 0 auto; width:38%; max-width:220px; font-size:13px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--text,#e8edf7); }
.at-icvol .vp { flex:0 0 auto; width:44px; text-align:right; font-size:12px;
  color:var(--mut,#8b98b8); font-variant-numeric:tabular-nums; }
.at-icvol input.at-icrange { flex:1; height:28px;
  accent-color:var(--accent,#4f8cff); }
.at-icvol.master { border-bottom:1px solid rgba(255,255,255,.1);
  padding-bottom:8px; margin-bottom:2px; }
.at-icvol.master .vn { font-weight:700; }
.at-icmiczone { display:none; align-items:center; justify-content:center;
  gap:16px; padding:10px 0 2px; }
.at-icmic { width:96px; height:96px; border-radius:50%; border:0;
  background:rgba(255,255,255,.08); color:var(--text,#e8edf7); display:flex;
  flex-direction:column; align-items:center; justify-content:center; gap:2px;
  cursor:pointer; touch-action:none; user-select:none; -webkit-user-select:none; }
.at-icmic .mic { font-size:30px; pointer-events:none; }
.at-icmic .mlbl { font-size:10px; color:var(--mut,#8b98b8); pointer-events:none; }
.at-icmic.rec { background:rgba(224,60,60,.22); }
.at-icmic.rec .mlbl { color:#ff9c9c; font-variant-numeric:tabular-nums; }
.at-icmic.rec { animation:at-icrec 1.1s ease-in-out infinite; }
@keyframes at-icrec { 0%,100% { box-shadow:0 0 0 4px rgba(224,60,60,.55); }
  50% { box-shadow:0 0 0 16px rgba(224,60,60,.1); } }
.at-icmic.off { opacity:.4; cursor:not-allowed; }
.at-iccancel { width:56px; height:56px; border-radius:50%; border:0;
  background:rgba(255,255,255,.1); color:var(--text,#e8edf7); font-size:18px;
  cursor:pointer; }
.at-iccancel:active { background:rgba(224,60,60,.4); }
.at-icnote { font-size:11px; color:var(--mut,#8b98b8);
  background:rgba(255,255,255,.07); padding:7px 11px; border-radius:8px;
  align-self:center; }
.at-icstatus { min-height:20px; text-align:center; font-size:13px;
  color:var(--mut,#8b98b8); transition:.2s; }
.at-icstatus.good { color:#5fd08a; }
.at-icstatus.bad { color:#ff7a7a; }
/* security keypad (seckeypad) — state colours + pad, shared by widget & overlay.
   --sk is the state colour every part of the keypad reads. */
.at-skst { --sk:#8b98b8; }
.at-skst.sk-disarmed { --sk:#5fd08a; }
.at-skst.sk-arming { --sk:#f5a524; }
.at-skst.sk-armed { --sk:var(--accent,#4f8cff); }
.at-skst.sk-pending { --sk:#f5a524; }
.at-skst.sk-triggered { --sk:#ff3b3b; }
.at-skst.sk-off { --sk:#8b98b8; }
.at-skst.sk-arming { animation:at-skpulse 1.7s ease-in-out infinite; }
.at-skst.sk-pending { animation:at-skpulse .85s ease-in-out infinite; }
.at-skst.sk-triggered { animation:at-skalarm .6s steps(1,end) infinite; }
@keyframes at-skpulse {
  0%,100% { box-shadow:0 0 0 0 color-mix(in srgb,var(--sk,#8b98b8) 55%,transparent); }
  50% { box-shadow:0 0 0 12px transparent; } }
@keyframes at-skalarm {
  0%,49% { box-shadow:0 0 0 3px #ff3b3b, 0 0 28px rgba(255,59,59,.7); }
  50%,100% { box-shadow:0 0 0 3px rgba(255,59,59,.18); } }
.at-skbadge { display:flex; align-items:center; gap:9px; flex:0 0 auto;
  min-height:42px; padding:0 12px; border-radius:12px;
  background:color-mix(in srgb,var(--sk,#8b98b8) 16%,transparent);
  border:1px solid color-mix(in srgb,var(--sk,#8b98b8) 45%,transparent); }
.at-skdot { flex:0 0 12px; width:12px; height:12px; border-radius:50%;
  background:var(--sk,#8b98b8); }
.at-sklb { font-size:15px; font-weight:800; color:var(--sk,#8b98b8); min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.at-skcd { font-size:16px; font-weight:800; color:var(--sk,#8b98b8);
  font-variant-numeric:tabular-nums; }
.at-skbadge .at-skcd { margin-left:auto; }
.at-skdots { display:flex; align-items:center; justify-content:center; gap:10px;
  flex:0 0 auto; min-height:20px; }
.at-skdots i { width:12px; height:12px; border-radius:50%;
  border:2px solid rgba(255,255,255,.28); transition:.12s; }
.at-skdots i.on { background:var(--sk,#8b98b8); border-color:var(--sk,#8b98b8);
  transform:scale(1.18); }
.at-skdots.shake { animation:at-skshake .4s; }
@keyframes at-skshake { 0%,100% { transform:translateX(0); }
  20% { transform:translateX(-9px); } 40% { transform:translateX(9px); }
  60% { transform:translateX(-5px); } 80% { transform:translateX(5px); } }
.at-skmsg { flex:0 0 auto; min-height:16px; text-align:center; font-size:12px;
  color:var(--mut,#8b98b8); }
.at-skmsg.good { color:#5fd08a; }
.at-skmsg.bad { color:#ff7a7a; }
.at-skgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.at-skacts { display:flex; flex-wrap:wrap; gap:6px; flex:0 0 auto; }
.at-skkey, .at-skbtn { min-height:56px; border-radius:14px;
  border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06);
  color:var(--text,#e8edf7); font-weight:700; cursor:pointer;
  touch-action:manipulation; user-select:none; -webkit-user-select:none;
  -webkit-tap-highlight-color:transparent; }
.at-skkey { font-size:22px; }
.at-skkey:active, .at-skbtn:active { transform:scale(.94);
  background:rgba(255,255,255,.17); }
.at-skbtn { flex:1 1 28%; padding:0 6px; font-size:14px; }
.at-skbtn.wide { flex:1 1 100%; }
.at-skbtn.arm { border-color:color-mix(in srgb,var(--accent,#4f8cff) 55%,transparent); }
.at-skbtn.dis { border-color:color-mix(in srgb,#5fd08a 55%,transparent); }
.at-skst.sk-off .at-skgrid, .at-skst.sk-off .at-skacts,
.at-skst.sk-off .at-skdots { display:none; }
.at-skpanel { width:min(400px,92vw); }
.at-skpanel .at-fsbody { gap:9px; user-select:none; -webkit-user-select:none; }
/* energy: unconfigured message */
.at-skin .at-enmsg { display:none; }
.at-skin.encfg .at-enmain { display:none; }
.at-skin.encfg .at-enmsg { display:flex; flex:1; align-items:center;
  justify-content:center; color:var(--mut,#8b98b8); font-size:13px;
  text-align:center; padding:8px; }
`;

/* build the full inner HTML for a widget.
 * opts: { name, val, icon, on } — demo values (designer) or initial (renderer) */
window.AT_MARKUP = function (w, o) {
  o = o || {};
  if (w.type === 'label')
    return `<div class="at-label" style="font-size:${w.size || 18}px;` +
      `color:${w.color || 'inherit'};font-weight:${w.bold ? '700' : '400'};` +
      `justify-content:${w.align || 'flex-start'}">${w.text || 'Text'}</div>`;
  if (w.type === 'box')
    return `<div class="at-box${w.style && w.style !== 'plain' ? ' w' : ''}"` +
      ` data-cs="${w.style || 'plain'}">` +
      `${w.text ? `<span class="at-boxtitle">${w.text}</span>` : ''}</div>`;
  if (w.type === 'line')
    return `<div class="at-line" style="background:${w.color || 'rgba(255,255,255,.18)'}"></div>`;

  const skin = window.AT_SKIN(w.skin) ||
               window.AT_SKIN(TYPE_DEFAULT_SKIN[w.type]);
  if (!skin) return '<div class="at-skin w" data-skin="?">?</div>';
  // navigation buttons carry their own label/icon (no entity)
  const name = w.type === 'nav' ? (w.label || o.name || 'Open') : o.name;
  const icon = o.icon || w.icon || DEFAULT_ICON[skin.for] || '';
  const html = (skin.html || '')
    .split('{{name}}').join(name || '')
    .split('{{icon}}').join(icon)
    .split('{{val}}').join(o.val || '—');
  const cls = ['at-skin'];
  if (skin.card) cls.push('w');
  if (o.on) cls.push('on');
  const cs = skin.card ? ` data-cs="${w.style || window.AT_DEFAULT_CS || 'glass'}"` : '';
  const color = w.color ? ` style="--accent:${w.color}"` : '';
  return `<div class="${cls.join(' ')}" data-skin="${skin.id}"${cs}${color}>${html}</div>`;
};
})();
