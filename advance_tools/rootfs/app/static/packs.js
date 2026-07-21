/* Advance Tools — built-in skin packs.
 *
 * EVERYTHING here uses the standard "Advance Tools Pack" format — the exact
 * same format users import. A pack is:
 *
 * {
 *   "pack": "advance-tools-pack", "format": 1,
 *   "name": "My Pack", "author": "you", "version": "1.0.0",
 *   "items": [
 *     { "kind": "style", "id": "...", "name": "...", "category": "...",
 *       "css": ".CARD { ... } .CARD.on { ... }" },
 *     { "kind": "skin", "id": "...", "name": "...", "category": "...",
 *       "for": "toggle|light|sensor|climate|button|vacuum|cover|valve|media|clock",
 *       "size": [w, h], "card": false,
 *       "html": "...{{name}} {{icon}} {{val}} + at-* hook classes...",
 *       "css": ".SKIN { ... } .SKIN.on { ... }" }
 *   ]
 * }
 *
 * Skin contract:
 *  - css placeholder .SKIN compiles to .at-skin[data-skin="<id>"] (the wrapper
 *    the runtime creates around your html). State classes are toggled on the
 *    wrapper: on/unavail (toggle,light), open/closed/opening/closing (cover,
 *    valve), cleaning/docked/returning (vacuum), playing (media), heat/cool
 *    (climate). CSS var --pct (0-100) is set for sensor/light skins.
 *  - html tokens: {{name}} {{icon}} {{val}}. Live hooks the runtime updates if
 *    present: .at-name .at-val .at-ico .at-bat .at-title .at-cur .at-tgt
 *    .at-tgt2 .at-nm .at-arc. Action hooks (buttons): .at-start .at-pause
 *    .at-dock .at-up .at-stop .at-down .at-play .at-prev .at-next .at-vup
 *    .at-vdn .at-minus .at-plus .at-bri (range input).
 *  - "card": true = skin is drawn on a card that follows the Card Styles
 *    gallery (wrapper also gets class "w" + data-cs).
 */
window.AT_BUILTIN_PACKS = [

/* ================================================================= CAMERAS */
{ pack: 'advance-tools-pack', format: 1, name: 'Cameras', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'camera-feed', name: 'Camera feed', category: 'General · Cameras',
    for: 'camera', size: [320, 200], card: true, html: `
      <div class="feed">
        <img class="at-cam" alt=""/>
        <div class="at-camph ph">📷<span>Live snapshot appears here</span></div>
        <div class="bar"><span class="at-name">{{name}}</span>
          <span class="at-time tm"></span></div>
      </div>`, css: `
.SKIN { padding:0; overflow:hidden; }
.SKIN .feed { position:relative; width:100%; height:100%; background:#05070d; }
.SKIN .at-cam { width:100%; height:100%; object-fit:cover; display:block;
  transition:opacity .3s; }
.SKIN .ph { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:6px; color:var(--mut);
  font-size:30px; } .SKIN .ph span { font-size:11px; }
.SKIN .bar { position:absolute; left:0; right:0; bottom:0; display:flex;
  align-items:center; gap:8px; padding:8px 12px;
  background:linear-gradient(transparent, rgba(0,0,0,.75)); }
.SKIN .bar .at-name { margin:0; color:#fff; font-size:13px; }
.SKIN .tm { margin-left:auto; font-size:11px; color:rgba(255,255,255,.7);
  font-variant-numeric:tabular-nums; }` },

  { kind: 'skin', id: 'camera-live', name: 'Camera + LIVE', category: 'General · Cameras',
    for: 'camera', size: [320, 200], card: true, html: `
      <div class="feed">
        <img class="at-cam" alt=""/>
        <div class="at-camph ph">📷<span>connecting…</span></div>
        <div class="live"><span class="dot"></span>LIVE</div>
        <div class="bar"><span class="at-name">{{name}}</span>
          <span class="at-time tm"></span></div>
      </div>`, css: `
.SKIN { padding:0; overflow:hidden; }
.SKIN .feed { position:relative; width:100%; height:100%; background:#05070d; }
.SKIN .at-cam { width:100%; height:100%; object-fit:cover; display:block;
  transition:opacity .3s; }
.SKIN .ph { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:6px; color:var(--mut);
  font-size:30px; } .SKIN .ph span { font-size:11px; }
.SKIN .live { position:absolute; top:8px; left:10px; display:flex; gap:5px;
  align-items:center; background:rgba(0,0,0,.55); color:#fff; font-size:11px;
  font-weight:700; letter-spacing:.08em; padding:3px 9px; border-radius:6px; }
.SKIN .live .dot { width:8px; height:8px; border-radius:50%; background:#ff3b4e;
  animation:at-pulse 1.4s infinite; }
@keyframes at-pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
.SKIN .bar { position:absolute; left:0; right:0; bottom:0; display:flex;
  align-items:center; gap:8px; padding:8px 12px;
  background:linear-gradient(transparent, rgba(0,0,0,.75)); }
.SKIN .bar .at-name { margin:0; color:#fff; font-size:13px; }
.SKIN .tm { margin-left:auto; font-size:11px; color:rgba(255,255,255,.7);
  font-variant-numeric:tabular-nums; }` },

  { kind: 'skin', id: 'camera-tile', name: 'Camera tile', category: 'General · Cameras',
    for: 'camera', size: [260, 210], card: true, html: `
      <div class="feed"><img class="at-cam" alt=""/>
        <div class="at-camph ph">📷</div></div>
      <div class="foot"><span class="at-ico">📹</span>
        <span class="at-name">{{name}}</span>
        <span class="at-state st at-end"></span></div>`, css: `
.SKIN { gap:0; padding:0; overflow:hidden; }
.SKIN .feed { position:relative; width:100%; flex:1; min-height:0; background:#05070d; }
.SKIN .at-cam { width:100%; height:100%; object-fit:cover; display:block;
  transition:opacity .3s; }
.SKIN .ph { position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; color:var(--mut); font-size:30px; }
.SKIN .foot { display:flex; align-items:center; gap:8px; padding:9px 12px; }
.SKIN .foot .at-name { margin:0; font-size:13px; }
.SKIN .st { font-size:11px; color:var(--mut); }` },

  { kind: 'skin', id: 'camera-min', name: 'Camera (bare)', category: 'General · Cameras',
    for: 'camera', size: [280, 170], card: true, html: `
      <div class="feed"><img class="at-cam" alt=""/>
        <div class="at-camph ph">📷</div></div>`, css: `
.SKIN { padding:0; overflow:hidden; }
.SKIN .feed { position:relative; width:100%; height:100%; background:#05070d; }
.SKIN .at-cam { width:100%; height:100%; object-fit:cover; display:block;
  transition:opacity .3s; }
.SKIN .ph { position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; color:var(--mut); font-size:28px; }` },
]},

/* =============================================================== PET (PetLibro) */
{ pack: 'advance-tools-pack', format: 1, name: 'Pet Care', author: 'Advance Tools',
  version: '1.0.0', items: [

  /* --- feed buttons (for: button → e.g. manual_feed / ring_bell) --- */
  { kind: 'skin', id: 'pet-feed-bowl', name: 'Feed bowl', category: 'PetLibro',
    for: 'button', size: [180, 180], card: true, html: `
      <div class="scene">
        <div class="kib"><i></i><i></i><i></i><i></i></div>
        <div class="bowl"><div class="food"></div></div>
      </div>
      <div class="at-name">{{name}}</div><div class="at-val sub">Tap to feed 🐾</div>`, css: `
.SKIN { align-items:center; text-align:center; cursor:pointer; gap:4px; }
.SKIN .scene { position:relative; width:80px; height:66px; }
.SKIN .bowl { position:absolute; bottom:0; left:50%; transform:translateX(-50%);
  width:74px; height:34px; border-radius:0 0 40px 40px;
  background:linear-gradient(#e6a15a,#c9793a); box-shadow:inset 0 3px 5px rgba(0,0,0,.25); }
.SKIN .bowl .food { position:absolute; top:4px; left:8px; right:8px; height:12px;
  border-radius:50%; background:radial-gradient(circle at 30% 30%,#8a5a2a,#5f3b1a);
  transition:transform .2s; }
.SKIN .kib i { position:absolute; top:0; left:50%; width:8px; height:8px;
  border-radius:50%; background:#6f4a24; opacity:0; }
.SKIN.on .kib i { animation:at-kib .5s ease-in forwards; }
.SKIN.on .kib i:nth-child(2){ left:38%; animation-delay:.06s; }
.SKIN.on .kib i:nth-child(3){ left:60%; animation-delay:.12s; }
.SKIN.on .kib i:nth-child(4){ left:48%; animation-delay:.18s; }
@keyframes at-kib { 0%{ top:-2px; opacity:1; } 100%{ top:40px; opacity:0; } }
.SKIN.on .food { transform:scaleY(1.3); }
.SKIN .sub { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'pet-paw', name: 'Paw feed button', category: 'PetLibro',
    for: 'button', size: [160, 160], html: `
      <button class="paw">🐾</button><div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .paw { width:74px; height:74px; border-radius:50%; border:0; cursor:pointer;
  font-size:34px; color:#fff;
  background:radial-gradient(circle at 34% 30%,#7bb0ff,var(--accent) 72%);
  box-shadow:0 6px 0 color-mix(in srgb, var(--accent) 45%, #000),
    0 8px 14px rgba(0,0,0,.4); transition:transform .1s, box-shadow .1s; }
.SKIN .paw:active { transform:translateY(5px);
  box-shadow:0 1px 0 color-mix(in srgb, var(--accent) 45%, #000),
    0 3px 8px rgba(0,0,0,.4); }
.SKIN.on .paw { animation:at-pawpop .45s ease; }
@keyframes at-pawpop { 0%{ transform:scale(.85); } 60%{ transform:scale(1.12); } }
.SKIN .at-name { font-size:13px; color:var(--mut); }` },

  { kind: 'skin', id: 'pet-bell', name: 'Ring bell', category: 'PetLibro',
    for: 'button', size: [150, 160], html: `
      <div class="bell">🔔</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; cursor:pointer; }
.SKIN .bell { font-size:46px; transform-origin:top center; }
.SKIN.on .bell { animation:at-ring .5s ease-in-out; }
@keyframes at-ring { 0%,100%{ transform:rotate(0); }
  20%{ transform:rotate(18deg); } 40%{ transform:rotate(-14deg); }
  60%{ transform:rotate(10deg); } 80%{ transform:rotate(-6deg); } }
.SKIN .at-name { font-size:13px; color:var(--mut); }` },

  /* --- level gauges (for: sensor, uses --pct via min/max) --- */
  { kind: 'skin', id: 'pet-jar', name: 'Kibble jar', category: 'PetLibro',
    for: 'sensor', size: [150, 200], card: true, html: `
      <div class="jar"><div class="lid"></div><div class="fill"></div></div>
      <div class="at-val jv">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:3px; }
.SKIN .jar { width:58%; height:52%; position:relative; border-radius:6px 6px 14px 14px;
  border:2px solid rgba(255,255,255,.28); overflow:hidden; background:rgba(255,255,255,.04); }
.SKIN .lid { position:absolute; top:-8px; left:-6%; width:112%; height:12px;
  border-radius:6px; background:linear-gradient(#c9793a,#a5622c);
  box-shadow:0 2px 4px rgba(0,0,0,.4); z-index:2; }
.SKIN .fill { position:absolute; left:0; right:0; bottom:0;
  height:calc(var(--pct,0) * 1%);
  background:repeating-linear-gradient(45deg,#8a5a2a 0 6px,#75491f 6px 12px);
  transition:height .6s; }
.SKIN .jv { font-size:17px; } .SKIN .at-name { font-size:11px; text-align:center; }` },

  { kind: 'skin', id: 'pet-bowl-level', name: 'Bowl level', category: 'PetLibro',
    for: 'sensor', size: [170, 160], card: true, html: `
      <div class="bowl"><div class="food"></div></div>
      <div class="at-val bv">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:2px; }
.SKIN .bowl { width:66%; height:50%; border-radius:50%;
  background:linear-gradient(#e6a15a,#c9793a);
  box-shadow:inset 0 4px 8px rgba(0,0,0,.3); position:relative; overflow:hidden;
  display:flex; align-items:flex-end; justify-content:center; }
.SKIN .food { width:82%; height:calc(var(--pct,0) * 0.8%); border-radius:50% 50% 40% 40%;
  background:radial-gradient(circle at 40% 30%,#8a5a2a,#5f3b1a); transition:height .6s;
  margin-bottom:8%; }
.SKIN .bv { font-size:16px; } .SKIN .at-name { font-size:11px; text-align:center; }` },

  { kind: 'skin', id: 'pet-water', name: 'Water fountain', category: 'PetLibro',
    for: 'sensor', size: [160, 180], card: true, html: `
      <div class="tank"><div class="water"><span class="wave"></span></div>
        <span class="drop">💧</span></div>
      <div class="at-val wv">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:2px; }
.SKIN .tank { width:56%; height:54%; border:2px solid rgba(255,255,255,.28);
  border-radius:8px 8px 16px 16px; position:relative; overflow:hidden; }
.SKIN .water { position:absolute; left:0; right:0; bottom:0;
  height:calc(20% + var(--pct,0) * 0.6%);
  background:linear-gradient(#5cc6f5,#1a86c8); transition:height .7s; }
.SKIN .wave { position:absolute; top:-5px; left:0; right:0; height:10px;
  background:radial-gradient(circle at 8px -3px, transparent 5px, #5cc6f5 5px) repeat-x;
  background-size:16px 10px; animation:at-wv 1.2s linear infinite; }
@keyframes at-wv { to { background-position:16px 0; } }
.SKIN .drop { position:absolute; top:6px; left:50%; transform:translateX(-50%);
  font-size:16px; animation:at-dp 2s ease-in infinite; }
@keyframes at-dp { 0%,70%{ top:6px; opacity:0; } 75%{ opacity:1; } 100%{ top:60%; opacity:0; } }
.SKIN .wv { font-size:16px; } .SKIN .at-name { font-size:11px; text-align:center; }` },

  /* --- info cards (for: sensor, plain display) --- */
  { kind: 'skin', id: 'pet-stat', name: 'Pet stat', category: 'PetLibro',
    for: 'sensor', size: [200, 100], card: true, html: `
      <div class="row"><span class="ic">🐾</span>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val v">{{val}}</span></div></div>`, css: `
.SKIN { justify-content:center; }
.SKIN .row { display:flex; align-items:center; gap:12px; }
.SKIN .ic { font-size:28px; }
.SKIN .lbl { display:flex; flex-direction:column; }
.SKIN .at-name { margin:0; font-size:12px; }
.SKIN .v { font-size:20px; font-weight:700; }` },

  { kind: 'skin', id: 'pet-nextfeed', name: 'Next feed', category: 'PetLibro',
    for: 'sensor', size: [220, 110], card: true, html: `
      <div class="top"><span class="ic">🥣</span><span class="at-name">{{name}}</span></div>
      <div class="at-val big">{{val}}</div>`, css: `
.SKIN { justify-content:center; gap:6px; }
.SKIN .top { display:flex; align-items:center; gap:8px; }
.SKIN .ic { font-size:20px; } .SKIN .at-name { margin:0; font-size:12px; color:var(--mut); }
.SKIN .big { font-size:22px; font-weight:700; }` },

  { kind: 'skin', id: 'pet-battery', name: 'Battery (paw)', category: 'PetLibro',
    for: 'sensor', size: [170, 120], card: true, html: `
      <div class="bat"><div class="cap"></div><div class="fill"></div><span class="p">🐾</span></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .bat { width:70%; height:42%; border:3px solid rgba(255,255,255,.35);
  border-radius:8px; position:relative; overflow:hidden; }
.SKIN .cap { position:absolute; right:-9px; top:30%; width:6px; height:40%;
  background:rgba(255,255,255,.35); border-radius:0 3px 3px 0; }
.SKIN .fill { position:absolute; left:0; bottom:0; top:0;
  width:calc(var(--pct,0) * 1%); background:var(--accent); transition:width .5s; }
.SKIN.low .fill { background:#ff6b81; }
.SKIN .p { position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; font-size:16px; }
.SKIN .at-name { font-size:11px; text-align:center; }` },

  /* --- lid toggle (for: toggle → switch manually_open_close_lid) --- */
  { kind: 'skin', id: 'pet-lid', name: 'Feeder lid', category: 'PetLibro',
    for: 'toggle', size: [170, 170], card: true, html: `
      <div class="feeder"><div class="lid"></div><div class="body">🍖</div></div>
      <div class="at-name">{{name}}</div><div class="at-val st"></div>`, css: `
.SKIN { align-items:center; gap:4px; cursor:pointer; }
.SKIN .feeder { width:64px; height:64px; position:relative; }
.SKIN .body { width:100%; height:100%; border-radius:12px;
  background:linear-gradient(#3a4356,#232b3a); display:flex; align-items:center;
  justify-content:center; font-size:26px; box-shadow:inset 0 2px 4px rgba(255,255,255,.1); }
.SKIN .lid { position:absolute; top:0; left:-4%; width:108%; height:52%;
  border-radius:12px 12px 4px 4px; background:linear-gradient(#c9793a,#a5622c);
  transform-origin:bottom; transition:transform .5s cubic-bezier(.4,0,.2,1); z-index:2;
  box-shadow:0 2px 4px rgba(0,0,0,.4); }
.SKIN.on .lid { transform:rotateX(-110deg); }
.SKIN .st { font-size:12px; color:var(--mut); }
.SKIN.on .st::after { content:'Open'; } .SKIN:not(.on) .st::after { content:'Closed'; }` },
]},

/* ============================================================== LITTER-ROBOT */
{ pack: 'advance-tools-pack', format: 1, name: 'Litter-Robot', author: 'Advance Tools',
  version: '1.0.0', items: [

  /* --- clean-cycle controls (for: vacuum → vacuum.litter_robot_4) --- */
  { kind: 'skin', id: 'lr-globe', name: 'Litter-Robot globe', category: 'Litter-Robot',
    for: 'vacuum', size: [230, 250], card: true, html: `
      <div class="unit">
        <div class="bonnet"></div>
        <div class="globe"><div class="hole"></div></div>
        <div class="base"></div>
      </div>
      <div class="at-name">{{name}}</div>
      <div class="at-val st">—</div>
      <div class="row"><button class="at-start">▶ Clean</button>
        <button class="at-dock">🏠</button></div>`, css: `
.SKIN { align-items:center; gap:5px; }
.SKIN .unit { position:relative; width:112px; height:98px; }
.SKIN .globe { position:absolute; bottom:14px; left:50%;
  width:80px; height:80px; margin-left:-40px; border-radius:50%;
  background:radial-gradient(circle at 34% 28%,#3c4453,#12161f 72%);
  box-shadow:inset 0 2px 6px rgba(255,255,255,.12),0 6px 14px rgba(0,0,0,.5);
  overflow:hidden; }
.SKIN .globe .hole { position:absolute; top:50%; left:50%; width:28px; height:28px;
  margin:-14px 0 0 -14px; border-radius:50%; background:rgba(0,0,0,.6);
  box-shadow:inset 0 2px 4px rgba(0,0,0,.6); }
.SKIN .bonnet { position:absolute; top:0; left:50%; margin-left:-30px;
  width:60px; height:34px; border-radius:30px 30px 6px 6px;
  background:linear-gradient(#eef1f6,#c4ccd6); z-index:2;
  box-shadow:0 2px 4px rgba(0,0,0,.35); }
.SKIN .base { position:absolute; bottom:0; left:50%; margin-left:-49px;
  width:98px; height:20px; border-radius:6px; background:linear-gradient(#eef1f6,#b9c1cc); }
.SKIN.cleaning .globe { animation:at-lrglobe 2.6s linear infinite; }
@keyframes at-lrglobe { to { transform:rotate(360deg); } }
.SKIN.cleaning .globe .hole { background:color-mix(in srgb,var(--accent) 45%,#000); }
.SKIN .st { text-transform:capitalize; color:var(--mut); font-size:13px; }
.SKIN.cleaning .st { color:var(--accent); }
.SKIN .row { display:flex; gap:8px; }
.SKIN .row button { height:36px; padding:0 12px; border-radius:10px; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:14px; cursor:pointer; }
.SKIN .row button:active { background:var(--accent); }
.SKIN.cleaning .at-start { background:var(--accent); }` },

  { kind: 'skin', id: 'lr-panel', name: 'Litter-Robot panel', category: 'Litter-Robot',
    for: 'vacuum', size: [260, 155], card: true, html: `
      <div class="top"><span class="ic">🐈</span>
        <span class="at-name">{{name}}</span>
        <span class="at-val st at-end">—</span></div>
      <button class="at-start big">Start Clean Cycle</button>
      <div class="row2"><button class="at-pause">⏸ Pause</button>
        <button class="at-dock">🏠 Dock</button></div>`, css: `
.SKIN { gap:10px; padding:14px; justify-content:center; }
.SKIN .top { display:flex; align-items:center; gap:8px; }
.SKIN .top .ic { font-size:20px; } .SKIN .top .at-name { margin:0; }
.SKIN .top .st { margin-left:auto; color:var(--mut); font-size:13px; text-transform:capitalize; }
.SKIN.cleaning .st { color:var(--accent); }
.SKIN .big { height:46px; border-radius:12px; border:0; cursor:pointer; font-size:15px;
  font-weight:600; color:#fff;
  background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#000));
  box-shadow:0 4px 12px color-mix(in srgb,var(--accent) 40%,transparent); }
.SKIN.cleaning .big { animation:at-lrpulse 1.4s ease-in-out infinite; }
@keyframes at-lrpulse { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.28); } }
.SKIN .row2 { display:flex; gap:8px; }
.SKIN .row2 button { flex:1; height:36px; border-radius:10px; border:0;
  background:rgba(255,255,255,.1); color:inherit; font-size:13px; cursor:pointer; }
.SKIN .row2 button:active { background:var(--accent); }` },

  { kind: 'skin', id: 'lr-tile', name: 'Clean cycle tile', category: 'Litter-Robot',
    for: 'vacuum', size: [160, 130], card: true, html: `
      <button class="at-start tile">
        <span class="spin">🌀</span>
        <span class="lbl">Clean Cycle</span>
        <span class="at-val st">—</span></button>`, css: `
.SKIN { padding:0; }
.SKIN .tile { width:100%; height:100%; border:0; border-radius:inherit; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;
  color:inherit; background:rgba(255,255,255,.06); }
.SKIN .tile:active { background:var(--accent); }
.SKIN .spin { font-size:30px; display:inline-block; }
.SKIN.cleaning .spin { animation:at-lrspin 1s linear infinite; }
@keyframes at-lrspin { to { transform:rotate(360deg); } }
.SKIN .lbl { font-size:13px; font-weight:600; }
.SKIN .st { font-size:11px; color:var(--mut); text-transform:capitalize; }
.SKIN.cleaning .st { color:var(--accent); }` },

  /* --- waste drawer level (for: sensor % → fills & reddens as it fills) --- */
  { kind: 'skin', id: 'lr-drawer', name: 'Waste drawer', category: 'Litter-Robot',
    for: 'sensor', size: [160, 195], card: true, html: `
      <div class="bin"><div class="fill"></div><span class="ic">🗑️</span></div>
      <div class="at-val dv">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:3px; }
.SKIN .bin { width:56%; height:50%; position:relative; overflow:hidden;
  border:2px solid rgba(255,255,255,.28); border-radius:6px 6px 10px 10px;
  background:rgba(255,255,255,.04); display:flex; align-items:center; justify-content:center; }
.SKIN .fill { position:absolute; left:0; right:0; bottom:0;
  height:calc(var(--pct,0) * 1%); transition:height .6s,background .6s;
  background:color-mix(in srgb,#e0512b calc(var(--pct,0) * 1%),#6d727b); }
.SKIN .ic { position:relative; z-index:2; font-size:22px; opacity:.9;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
.SKIN .dv { font-size:17px; } .SKIN .at-name { font-size:11px; text-align:center; }` },

  { kind: 'skin', id: 'lr-drawer-ring', name: 'Waste drawer ring', category: 'Litter-Robot',
    for: 'sensor', size: [160, 170], card: true, html: `
      <div class="ring"><div class="hole"><span class="at-val rv">{{val}}</span></div></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .ring { width:96px; height:96px; border-radius:50%;
  background:conic-gradient(color-mix(in srgb,#e0512b calc(var(--pct,0) * 1%),#4a90d9)
    calc(var(--pct,0) * 3.6deg), rgba(255,255,255,.12) 0);
  display:flex; align-items:center; justify-content:center; transition:background .6s; }
.SKIN .hole { width:70px; height:70px; border-radius:50%;
  background:var(--card,#171b26); display:flex; align-items:center; justify-content:center; }
.SKIN .rv { font-size:19px; font-weight:700; }
.SKIN .at-name { font-size:11px; text-align:center; }` },

  /* --- litter level (for: sensor % → low turns amber) --- */
  { kind: 'skin', id: 'lr-litter', name: 'Litter level', category: 'Litter-Robot',
    for: 'sensor', size: [150, 195], card: true, html: `
      <div class="hopper"><div class="fill"></div></div>
      <div class="at-val lv">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:3px; }
.SKIN .hopper { width:56%; height:52%; position:relative; overflow:hidden;
  border:2px solid rgba(255,255,255,.28); border-radius:10px 10px 4px 4px;
  background:rgba(255,255,255,.04); }
.SKIN .fill { position:absolute; left:0; right:0; bottom:0;
  height:calc(var(--pct,0) * 1%); transition:height .6s;
  background:repeating-linear-gradient(45deg,#cdd2d8 0 5px,#aeb4bc 5px 10px); }
.SKIN.low .fill { background:repeating-linear-gradient(45deg,#e8b04b 0 5px,#c98a25 5px 10px); }
.SKIN .lv { font-size:17px; } .SKIN.low .lv { color:#e8b04b; }
.SKIN .at-name { font-size:11px; text-align:center; }` },

  /* --- info cards (for: sensor, plain display) --- */
  { kind: 'skin', id: 'lr-weight', name: 'Pet weight', category: 'Litter-Robot',
    for: 'sensor', size: [200, 110], card: true, html: `
      <div class="row"><span class="ic">🐈</span>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val v">{{val}}</span></div>
        <span class="sc">⚖️</span></div>`, css: `
.SKIN { justify-content:center; }
.SKIN .row { display:flex; align-items:center; gap:10px; }
.SKIN .ic { font-size:30px; }
.SKIN .lbl { display:flex; flex-direction:column; }
.SKIN .at-name { margin:0; font-size:12px; color:var(--mut); }
.SKIN .v { font-size:21px; font-weight:700; }
.SKIN .sc { margin-left:auto; font-size:20px; opacity:.6; }` },

  { kind: 'skin', id: 'lr-status', name: 'Status pill', category: 'Litter-Robot',
    for: 'sensor', size: [230, 96], card: true, html: `
      <div class="wrap"><span class="dot"></span>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val v">{{val}}</span></div></div>`, css: `
.SKIN { justify-content:center; }
.SKIN .wrap { display:flex; align-items:center; gap:12px; }
.SKIN .dot { width:12px; height:12px; border-radius:50%; background:var(--accent);
  box-shadow:0 0 8px var(--accent); flex:none; }
.SKIN .lbl { display:flex; flex-direction:column; }
.SKIN .at-name { margin:0; font-size:12px; color:var(--mut); }
.SKIN .v { font-size:18px; font-weight:600; text-transform:capitalize; }` },

  { kind: 'skin', id: 'lr-cycles', name: 'Cycle counter', category: 'Litter-Robot',
    for: 'sensor', size: [180, 110], card: true, html: `
      <div class="top"><span class="ic">🔄</span><span class="at-name">{{name}}</span></div>
      <div class="at-val big">{{val}}</div>`, css: `
.SKIN { justify-content:center; gap:6px; align-items:center; }
.SKIN .top { display:flex; align-items:center; gap:8px; }
.SKIN .ic { font-size:20px; } .SKIN .at-name { margin:0; font-size:12px; color:var(--mut); }
.SKIN .big { font-size:30px; font-weight:800; font-variant-numeric:tabular-nums;
  letter-spacing:1px; }` },

  /* --- toggles (for: toggle → switch entities) --- */
  { kind: 'skin', id: 'lr-nightlight', name: 'Night light', category: 'Litter-Robot',
    for: 'toggle', size: [160, 160], card: true, html: `
      <div class="lamp">💡</div><div class="at-name">{{name}}</div>
      <div class="at-val st"></div>`, css: `
.SKIN { align-items:center; gap:6px; cursor:pointer; }
.SKIN .lamp { width:66px; height:66px; border-radius:50%; display:flex;
  align-items:center; justify-content:center; font-size:32px;
  background:rgba(255,255,255,.06); transition:.35s; filter:grayscale(1) brightness(.7); }
.SKIN.on .lamp { filter:none;
  background:radial-gradient(circle at 50% 45%,rgba(255,214,102,.55),transparent 70%);
  box-shadow:0 0 26px rgba(255,206,84,.6); animation:at-lrglow 2.4s ease-in-out infinite; }
@keyframes at-lrglow { 0%,100% { box-shadow:0 0 20px rgba(255,206,84,.45); }
  50% { box-shadow:0 0 32px rgba(255,206,84,.75); } }
.SKIN .at-name { font-size:12px; color:var(--mut); }
.SKIN .st { font-size:12px; color:var(--mut); }
.SKIN.on .st::after { content:'On'; } .SKIN:not(.on) .st::after { content:'Off'; }` },

  { kind: 'skin', id: 'lr-lock', name: 'Panel lock', category: 'Litter-Robot',
    for: 'toggle', size: [160, 160], card: true, html: `
      <div class="lk">🔒</div><div class="at-name">{{name}}</div>
      <div class="at-val st"></div>`, css: `
.SKIN { align-items:center; gap:6px; cursor:pointer; }
.SKIN .lk { width:66px; height:66px; border-radius:16px; display:flex;
  align-items:center; justify-content:center; font-size:30px; transition:.3s;
  background:rgba(255,255,255,.06); }
.SKIN.on .lk { background:color-mix(in srgb,var(--accent) 30%,transparent);
  box-shadow:0 0 16px color-mix(in srgb,var(--accent) 45%,transparent); }
.SKIN.on .lk::after { content:'🔒'; } .SKIN:not(.on) .lk::after { content:'🔓'; }
.SKIN .lk { font-size:0; } .SKIN .lk::after { font-size:30px; }
.SKIN .at-name { font-size:12px; color:var(--mut); }
.SKIN .st { font-size:12px; color:var(--mut); }
.SKIN.on .st::after { content:'Locked'; } .SKIN:not(.on) .st::after { content:'Unlocked'; }` },

  { kind: 'skin', id: 'lr-sleep', name: 'Sleep mode', category: 'Litter-Robot',
    for: 'toggle', size: [170, 150], card: true, html: `
      <div class="sky"><span class="moon">🌙</span><span class="z z1">z</span>
        <span class="z z2">z</span><span class="z z3">z</span></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:6px; cursor:pointer; }
.SKIN .sky { position:relative; width:80px; height:64px; display:flex;
  align-items:center; justify-content:center; }
.SKIN .moon { font-size:38px; transition:.3s; filter:grayscale(.6) opacity(.6); }
.SKIN.on .moon { filter:none; animation:at-lrsleep 3s ease-in-out infinite; }
@keyframes at-lrsleep { 0%,100% { transform:rotate(-6deg); } 50% { transform:rotate(6deg); } }
.SKIN .z { position:absolute; font-weight:700; color:#9ec5ff; opacity:0; }
.SKIN .z1 { top:10px; right:14px; font-size:12px; }
.SKIN .z2 { top:2px; right:6px; font-size:16px; }
.SKIN .z3 { top:-6px; right:-2px; font-size:20px; }
.SKIN.on .z1 { animation:at-lrz 2.4s ease-in infinite; }
.SKIN.on .z2 { animation:at-lrz 2.4s ease-in infinite .8s; }
.SKIN.on .z3 { animation:at-lrz 2.4s ease-in infinite 1.6s; }
@keyframes at-lrz { 0% { opacity:0; transform:translateY(6px); }
  30% { opacity:1; } 100% { opacity:0; transform:translateY(-10px); } }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  /* --- reset waste drawer (for: button → button.reset_waste_drawer) --- */
  { kind: 'skin', id: 'lr-reset', name: 'Reset drawer', category: 'Litter-Robot',
    for: 'button', size: [170, 160], card: true, html: `
      <div class="tr">🗑️<span class="sweep"></span></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">Tap to reset</div>`, css: `
.SKIN { align-items:center; justify-content:center; gap:6px; cursor:pointer; }
.SKIN .tr { position:relative; font-size:44px; }
.SKIN .sweep { position:absolute; inset:0; border-radius:50%;
  background:conic-gradient(from 0deg,transparent,color-mix(in srgb,var(--accent) 60%,transparent),transparent);
  opacity:0; }
.SKIN.on .sweep { animation:at-lrspin .6s linear; opacity:1; }
.SKIN.on .tr { animation:at-lrshake .5s ease; }
@keyframes at-lrshake { 0%,100% { transform:rotate(0); }
  25% { transform:rotate(-12deg); } 75% { transform:rotate(12deg); } }
.SKIN .at-name { font-size:13px; } .SKIN .sub { font-size:11px; color:var(--mut); }` },

  /* ===== all-in-one animated Litter-Robot cards (for: litterbox — multi-entity) =====
     Hooks: .at-name .at-lrstatus .at-drawerval .at-litterval .at-weightval
            .at-clean .at-reset ; state classes: cleaning catin drawerfull litterlow statusfull
            ; vars --drawer --litter (0-100). Three vibes x3 = Cartoon / Luxe / Funny. */

  /* ---------- CARTOON ---------- */
  { kind: 'skin', id: 'lr-cartoon-room', name: 'Cartoon — Litter room', category: 'Litter-Robot',
    for: 'litterbox', size: [340, 290], card: true, html: `
      <div class="hd"><span class="at-name">{{name}}</span>
        <span class="at-lrstatus tag">Ready</span></div>
      <div class="room">
        <div class="lbox"><div class="dome"></div><div class="tray"><div class="pile"></div></div></div>
        <div class="cat">🐈</div><div class="plop">💩</div>
        <div class="spark s1">✨</div><div class="spark s2">✨</div><div class="spark s3">✨</div>
        <div class="fly f1">🪰</div><div class="fly f2">🪰</div>
        <div class="floor"></div>
      </div>
      <div class="wbar"><span class="wlbl">⚖️ Weight</span><span class="at-weightval wval">–</span></div>
      <div class="mins">
        <div class="mini"><span>Waste</span><i class="mb d"></i><b class="at-drawerval">–</b></div>
        <div class="mini"><span>Litter</span><i class="mb l"></i><b class="at-litterval">–</b></div></div>
      <div class="btns"><button class="at-clean cb">🧹 Clean cycle</button>
        <button class="at-reset rb">♻️</button></div>`, css: `
.SKIN { padding:13px; gap:9px; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.SKIN .tag { margin-left:auto; font-size:11px; padding:3px 10px; border-radius:20px;
  background:rgba(255,255,255,.1); color:var(--mut); white-space:nowrap; transition:.3s; }
.SKIN.cleaning .tag { background:var(--accent); color:#fff; }
.SKIN.catin .tag { background:#8a63d2; color:#fff; }
.SKIN.drawerfull .tag,.SKIN.statusfull .tag { background:#e0512b; color:#fff; }
.SKIN .room { position:relative; flex:1; min-height:96px; border-radius:14px; overflow:hidden;
  background:radial-gradient(120% 90% at 50% 0%,#2a3b57,#16202f); }
.SKIN .floor { position:absolute; left:0; right:0; bottom:0; height:26%;
  background:linear-gradient(#3a4a66,#2b3648); border-top:2px solid rgba(255,255,255,.08); }
.SKIN .lbox { position:absolute; bottom:20%; left:52%; width:80px; height:46px; }
.SKIN .dome { position:absolute; top:-18px; left:0; width:80px; height:40px;
  border-radius:42px 42px 0 0; background:linear-gradient(#eef2f7,#c3ccd7);
  transform-origin:50% 100%; }
.SKIN .tray { position:absolute; bottom:0; left:6px; width:68px; height:22px; border-radius:7px;
  background:#0e131c; overflow:hidden; }
.SKIN .pile { position:absolute; left:6px; right:6px; bottom:0;
  height:calc(var(--drawer,0) * 0.17px + 2px);
  background:radial-gradient(circle at 25% 40%,#6f4c2b,#3d2a17); border-radius:9px 9px 0 0; transition:height .6s; }
.SKIN .cat { position:absolute; bottom:24%; left:10%; font-size:34px; transform-origin:50% 100%;
  transition:left .9s cubic-bezier(.5,0,.3,1); }
.SKIN .cat { animation:cr-tail 2.4s ease-in-out infinite; }
@keyframes cr-tail { 0%,100% { transform:rotate(-2deg); } 50% { transform:rotate(2deg); } }
.SKIN.catin .cat { left:47%; animation:cr-squat 1s ease-in-out infinite; }
@keyframes cr-squat { 0%,100% { transform:scaleY(1); } 50% { transform:scaleY(.82) translateY(4px); } }
.SKIN .plop { position:absolute; bottom:20%; left:58%; font-size:16px; opacity:0; }
.SKIN.catin .plop { animation:cr-plop 1.7s ease-in infinite; }
@keyframes cr-plop { 0%,55% { opacity:0; transform:translateY(-10px) scale(.6); }
  66% { opacity:1; transform:translateY(0) scale(1.15); } 80% { transform:scale(1); } 100% { opacity:1; } }
.SKIN .spark { position:absolute; font-size:14px; opacity:0; }
.SKIN .s1 { top:14%; left:48%; } .SKIN .s2 { top:26%; left:66%; } .SKIN .s3 { top:34%; left:56%; }
.SKIN.cleaning .dome { animation:cr-shake 0.5s ease-in-out infinite; }
@keyframes cr-shake { 0%,100% { transform:rotate(-4deg); } 50% { transform:rotate(4deg); } }
.SKIN.cleaning .spark { animation:cr-spk 1.2s ease-in-out infinite; }
.SKIN.cleaning .s2 { animation-delay:.3s; } .SKIN.cleaning .s3 { animation-delay:.6s; }
@keyframes cr-spk { 0%,100% { opacity:0; transform:scale(.5) translateY(4px); }
  50% { opacity:1; transform:scale(1.1) translateY(-2px); } }
.SKIN .fly { position:absolute; font-size:12px; opacity:0; }
.SKIN .f1 { bottom:36%; left:54%; } .SKIN .f2 { bottom:42%; left:64%; }
.SKIN.drawerfull .fly { opacity:1; animation:cr-fly 1.5s linear infinite; }
.SKIN.drawerfull .f2 { animation-delay:.6s; }
@keyframes cr-fly { 0%,100% { transform:translate(0,0); } 25% { transform:translate(7px,-6px); }
  50% { transform:translate(-5px,-9px); } 75% { transform:translate(5px,-3px); } }
.SKIN .wbar { display:flex; align-items:center; gap:8px; padding:7px 12px; border-radius:11px;
  background:linear-gradient(90deg,rgba(255,255,255,.09),rgba(255,255,255,.03)); }
.SKIN .wlbl { font-size:12px; color:var(--mut); }
.SKIN .wval { margin-left:auto; font-size:19px; font-weight:800; }
.SKIN .mins { display:flex; gap:8px; }
.SKIN .mini { flex:1; display:flex; align-items:center; gap:6px; font-size:11px; color:var(--mut); }
.SKIN .mini span { width:36px; } .SKIN .mini b { color:var(--text,#e8edf7); width:34px; text-align:right; }
.SKIN .mb { flex:1; height:7px; border-radius:5px; background:rgba(255,255,255,.1); position:relative; overflow:hidden; }
.SKIN .mb::after { content:''; position:absolute; left:0; top:0; bottom:0; }
.SKIN .mb.d::after { width:calc(var(--drawer,0) * 1%);
  background:color-mix(in srgb,#e0512b calc(var(--drawer,0) * 1%),#5aa9e6); transition:width .6s,background .6s; }
.SKIN .mb.l::after { width:calc(var(--litter,0) * 1%); background:#7cc6f0; transition:width .6s; }
.SKIN.litterlow .mb.l::after { background:#e8b04b; }
.SKIN .btns { display:flex; gap:8px; }
.SKIN .cb { flex:1; border:0; border-radius:10px; padding:10px; cursor:pointer; color:#fff;
  font-size:13px; font-weight:600; background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#000)); }
.SKIN .rb { border:0; border-radius:10px; padding:10px 14px; cursor:pointer;
  background:rgba(255,255,255,.14); color:inherit; font-size:14px; }
.SKIN .cb:active,.SKIN .rb:active { transform:scale(.96); }` },

  { kind: 'skin', id: 'lr-cartoon-face', name: 'Cartoon — Kitty face', category: 'Litter-Robot',
    for: 'litterbox', size: [300, 280], card: true, html: `
      <div class="hd"><span class="at-name">{{name}}</span>
        <span class="at-lrstatus tag">Ready</span></div>
      <div class="face">
        <div class="head"><span class="ear el"></span><span class="ear er"></span>
          <span class="eye eyl"><i></i></span><span class="eye eyr"><i></i></span>
          <span class="nose"></span><span class="mouth"></span>
          <span class="blush bl"></span><span class="blush br"></span></div>
        <div class="poo">💩</div><div class="zt z1">z</div><div class="zt z2">z</div>
      </div>
      <div class="wbig">⚖️ <b class="at-weightval">–</b> <small>weight</small></div>
      <div class="mins">
        <div class="mini"><span>Waste</span><i class="mb d"></i><b class="at-drawerval">–</b></div>
        <div class="mini"><span>Litter</span><i class="mb l"></i><b class="at-litterval">–</b></div></div>
      <div class="btns"><button class="at-clean cb">🧹 Clean</button>
        <button class="at-reset rb">♻️ Reset</button></div>`, css: `
.SKIN { padding:13px; gap:9px; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .tag { margin-left:auto; font-size:11px; padding:3px 10px; border-radius:20px;
  background:rgba(255,255,255,.1); color:var(--mut); white-space:nowrap; }
.SKIN.cleaning .tag { background:var(--accent); color:#fff; }
.SKIN.catin .tag { background:#8a63d2; color:#fff; }
.SKIN.drawerfull .tag,.SKIN.statusfull .tag { background:#e0512b; color:#fff; }
.SKIN .face { position:relative; flex:1; min-height:92px; display:flex; align-items:center; justify-content:center; }
.SKIN .head { position:relative; width:96px; height:80px; border-radius:48% 48% 46% 46%;
  background:radial-gradient(circle at 50% 35%,#ffd9a3,#f0b070); box-shadow:inset 0 -6px 10px rgba(0,0,0,.12); }
.SKIN .ear { position:absolute; top:-14px; width:0; height:0; border-left:16px solid transparent;
  border-right:16px solid transparent; border-bottom:26px solid #f0b070; }
.SKIN .el { left:6px; transform:rotate(-18deg); } .SKIN .er { right:6px; transform:rotate(18deg); }
.SKIN .eye { position:absolute; top:34px; width:16px; height:18px; border-radius:50%; background:#2a2320;
  overflow:hidden; transition:height .15s; }
.SKIN .eyl { left:24px; } .SKIN .eyr { right:24px; }
.SKIN .eye i { position:absolute; top:3px; left:3px; width:6px; height:6px; border-radius:50%; background:#fff; }
.SKIN .nose { position:absolute; top:52px; left:50%; margin-left:-5px; width:10px; height:7px;
  border-radius:50%; background:#e17a7a; }
.SKIN .mouth { position:absolute; top:60px; left:50%; width:16px; height:8px; margin-left:-8px;
  border-bottom:2px solid #a5663a; border-radius:0 0 10px 10px; }
.SKIN .blush { position:absolute; top:48px; width:12px; height:7px; border-radius:50%;
  background:rgba(233,122,122,.5); }
.SKIN .bl { left:12px; } .SKIN .br { right:12px; }
.SKIN .head { animation:cf-bob 3s ease-in-out infinite; }
@keyframes cf-bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-3px); } }
.SKIN .eye { animation:cf-blink 4s infinite; }
@keyframes cf-blink { 0%,94%,100% { height:18px; } 97% { height:3px; } }
/* cat using it → eyes squeeze shut, strain, poop drops */
.SKIN.catin .eye { height:4px; animation:none; }
.SKIN.catin .head { animation:cf-strain .6s ease-in-out infinite; }
@keyframes cf-strain { 0%,100% { transform:translateY(0) scale(1); } 50% { transform:translateY(2px) scale(1.04,.96); } }
.SKIN .poo { position:absolute; bottom:2px; left:50%; margin-left:-11px; font-size:22px; opacity:0; }
.SKIN.catin .poo { animation:cf-poo 1.5s ease-in infinite; }
@keyframes cf-poo { 0%,50% { opacity:0; transform:translateY(-14px) scale(.5); }
  64% { opacity:1; transform:translateY(0) scale(1.2); } 78% { transform:scale(1); } 100% { opacity:1; } }
/* cleaning → sleepy Zzz + closed eyes */
.SKIN.cleaning .eye { height:4px; animation:none; }
.SKIN .zt { position:absolute; top:12px; right:64px; font-weight:800; color:#9ec5ff; opacity:0; font-size:15px; }
.SKIN .z2 { top:2px; right:56px; font-size:20px; }
.SKIN.cleaning .z1 { animation:cf-z 2.2s ease-in infinite; }
.SKIN.cleaning .z2 { animation:cf-z 2.2s ease-in infinite 1.1s; }
@keyframes cf-z { 0% { opacity:0; transform:translateY(6px); } 40% { opacity:1; } 100% { opacity:0; transform:translateY(-12px); } }
/* drawer full → nose/mouth turn queasy green */
.SKIN.drawerfull .head { filter:hue-rotate(55deg) saturate(.8); }
.SKIN .wbig { text-align:center; font-size:13px; color:var(--mut); }
.SKIN .wbig b { font-size:22px; font-weight:800; color:var(--text,#e8edf7); }
.SKIN .wbig small { font-size:11px; }
.SKIN .mins { display:flex; gap:8px; }
.SKIN .mini { flex:1; display:flex; align-items:center; gap:6px; font-size:11px; color:var(--mut); }
.SKIN .mini span { width:36px; } .SKIN .mini b { color:var(--text,#e8edf7); width:34px; text-align:right; }
.SKIN .mb { flex:1; height:7px; border-radius:5px; background:rgba(255,255,255,.1); position:relative; overflow:hidden; }
.SKIN .mb::after { content:''; position:absolute; left:0; top:0; bottom:0; }
.SKIN .mb.d::after { width:calc(var(--drawer,0) * 1%);
  background:color-mix(in srgb,#e0512b calc(var(--drawer,0) * 1%),#5aa9e6); transition:width .6s,background .6s; }
.SKIN .mb.l::after { width:calc(var(--litter,0) * 1%); background:#7cc6f0; transition:width .6s; }
.SKIN.litterlow .mb.l::after { background:#e8b04b; }
.SKIN .btns { display:flex; gap:8px; }
.SKIN .cb { flex:1; border:0; border-radius:10px; padding:9px; cursor:pointer; color:#fff;
  font-size:13px; font-weight:600; background:var(--accent); }
.SKIN .rb { border:0; border-radius:10px; padding:9px 12px; cursor:pointer;
  background:rgba(255,255,255,.14); color:inherit; font-size:12px; }
.SKIN .cb:active,.SKIN .rb:active { transform:scale(.96); }` },

  { kind: 'skin', id: 'lr-cartoon-pop', name: 'Cartoon — Pop-up', category: 'Litter-Robot',
    for: 'litterbox', size: [300, 270], card: true, html: `
      <div class="hd"><span class="at-name">{{name}}</span>
        <span class="at-lrstatus tag">Ready</span></div>
      <div class="stage">
        <div class="ring dr"><span class="rc"><b class="at-drawerval">–</b><small>full</small></span></div>
        <div class="unit"><div class="bonnet"></div>
          <div class="globe"><div class="hole"></div></div>
          <div class="cat">🐱</div><div class="poo">💩</div>
          <div class="base"></div></div>
        <div class="ring li"><span class="rc"><b class="at-litterval">–</b><small>left</small></span></div>
      </div>
      <div class="wbig">⚖️ <b class="at-weightval">–</b></div>
      <div class="btns"><button class="at-clean cb">🧹 Clean cycle</button>
        <button class="at-reset rb">♻️</button></div>`, css: `
.SKIN { padding:13px; gap:9px; align-items:stretch; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .tag { margin-left:auto; font-size:11px; padding:3px 10px; border-radius:20px;
  background:rgba(255,255,255,.1); color:var(--mut); white-space:nowrap; }
.SKIN.cleaning .tag { background:var(--accent); color:#fff; }
.SKIN.catin .tag { background:#8a63d2; color:#fff; }
.SKIN.drawerfull .tag,.SKIN.statusfull .tag { background:#e0512b; color:#fff; }
.SKIN .stage { flex:1; display:flex; align-items:center; justify-content:space-between; }
.SKIN .ring { width:66px; height:66px; border-radius:50%; flex:none; position:relative;
  display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--mut); }
.SKIN .ring::before { content:''; position:absolute; inset:0; border-radius:50%; }
.SKIN .dr::before { background:conic-gradient(color-mix(in srgb,#e0512b calc(var(--drawer,0) * 1%),#5aa9e6)
  calc(var(--drawer,0) * 3.6deg), rgba(255,255,255,.1) 0); transition:background .6s; }
.SKIN .li::before { background:conic-gradient(#e8b04b calc(var(--litter,0) * 3.6deg), rgba(255,255,255,.1) 0);
  transition:background .6s; }
.SKIN .ring .rc { position:absolute; inset:8px; border-radius:50%; z-index:1;
  background:var(--card,#171b26); display:flex; flex-direction:column;
  align-items:center; justify-content:center; }
.SKIN .ring .rc b { font-size:15px; font-weight:800; color:var(--text,#e8edf7); }
.SKIN .ring .rc small { font-size:8px; color:var(--mut); }
.SKIN .unit { position:relative; width:96px; height:96px; }
.SKIN .globe { position:absolute; bottom:14px; left:50%; width:72px; height:72px; margin-left:-36px;
  border-radius:50%; overflow:hidden;
  background:radial-gradient(circle at 34% 28%,#3c4453,#12161f 72%);
  box-shadow:inset 0 2px 6px rgba(255,255,255,.12),0 6px 14px rgba(0,0,0,.5); }
.SKIN .globe .hole { position:absolute; top:50%; left:50%; width:26px; height:26px; margin:-13px 0 0 -13px;
  border-radius:50%; background:rgba(0,0,0,.6); }
.SKIN .bonnet { position:absolute; top:0; left:50%; margin-left:-27px; width:54px; height:28px;
  border-radius:27px 27px 6px 6px; background:linear-gradient(#eef2f7,#c3ccd7); z-index:3; }
.SKIN .base { position:absolute; bottom:0; left:50%; margin-left:-44px; width:88px; height:20px;
  border-radius:6px; background:linear-gradient(#eef2f7,#bcc4cf); }
.SKIN.cleaning .globe { animation:cp-spin 2.4s linear infinite; }
@keyframes cp-spin { to { transform:rotate(360deg); } }
.SKIN .cat { position:absolute; top:-6px; left:50%; margin-left:-16px; font-size:30px; opacity:0;
  transform:translateY(10px); transition:.3s; z-index:4; }
.SKIN.catin .cat { opacity:1; transform:translateY(0); animation:cp-peek 1s ease-in-out infinite; }
@keyframes cp-peek { 0%,100% { transform:translateY(0) rotate(-4deg); } 50% { transform:translateY(-4px) rotate(4deg); } }
.SKIN .poo { position:absolute; bottom:22px; left:50%; margin-left:-9px; font-size:15px; opacity:0; }
.SKIN.catin .poo { animation:cp-poo 1.6s ease-in infinite; }
@keyframes cp-poo { 0%,55% { opacity:0; transform:translateY(-6px); } 66% { opacity:1; } 100% { opacity:1; transform:translateY(4px); } }
.SKIN .wbig { text-align:center; font-size:12px; color:var(--mut); }
.SKIN .wbig b { font-size:20px; font-weight:800; color:var(--text,#e8edf7); }
.SKIN .btns { display:flex; gap:8px; }
.SKIN .cb { flex:1; border:0; border-radius:10px; padding:9px; cursor:pointer; color:#fff;
  font-size:13px; font-weight:600; background:var(--accent); }
.SKIN .rb { border:0; border-radius:10px; padding:9px 13px; cursor:pointer;
  background:rgba(255,255,255,.14); color:inherit; font-size:14px; }
.SKIN .cb:active,.SKIN .rb:active { transform:scale(.96); }` },

  /* ---------- LUXE ---------- */
  { kind: 'skin', id: 'lr-luxe-glass', name: 'Luxe — Glass', category: 'Litter-Robot',
    for: 'litterbox', size: [320, 260], card: true, html: `
      <div class="g">
        <div class="hd"><span class="dot"></span><span class="at-name">{{name}}</span>
          <span class="at-lrstatus st">Ready</span></div>
        <div class="mid">
          <div class="gauge"><svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="50"/>
            <circle class="arc" cx="60" cy="60" r="50"/></svg>
            <div class="gc"><span class="at-drawerval gv">–</span><small>drawer full</small></div>
            <div class="cat">🐈</div></div>
          <div class="col">
            <div class="wt"><small>weight</small><b class="at-weightval">–</b></div>
            <div class="lit"><small>litter left</small>
              <div class="lbar"><i></i></div><b class="at-litterval">–</b></div></div>
        </div>
        <div class="acts"><button class="at-clean c">Clean cycle</button>
          <button class="at-reset r">Reset</button></div>
      </div>`, css: `
.SKIN { padding:0; }
.SKIN .g { width:100%; height:100%; box-sizing:border-box; padding:16px; display:flex;
  flex-direction:column; gap:11px; border-radius:16px;
  background:linear-gradient(150deg,rgba(255,255,255,.10),rgba(255,255,255,.02));
  border:1px solid rgba(255,255,255,.12); backdrop-filter:blur(6px); }
.SKIN .hd { display:flex; align-items:center; gap:9px; }
.SKIN .dot { width:9px; height:9px; border-radius:50%; background:#4fce7f; box-shadow:0 0 8px #4fce7f; flex:none; }
.SKIN.cleaning .dot { background:var(--accent); box-shadow:0 0 10px var(--accent); animation:lg-pulse 1.1s ease-in-out infinite; }
.SKIN.catin .dot { background:#8a63d2; box-shadow:0 0 10px #8a63d2; }
.SKIN.drawerfull .dot,.SKIN.statusfull .dot { background:#e0512b; box-shadow:0 0 10px #e0512b; }
@keyframes lg-pulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.5); } }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .st { margin-left:auto; font-size:12px; color:var(--mut); text-transform:capitalize; white-space:nowrap; }
.SKIN .mid { display:flex; gap:14px; flex:1; align-items:center; }
.SKIN .gauge { position:relative; width:104px; height:104px; flex:none; }
.SKIN .gauge svg { width:104px; height:104px; transform:rotate(-90deg); }
.SKIN .trk { fill:none; stroke:rgba(255,255,255,.1); stroke-width:9; }
.SKIN .arc { fill:none; stroke-width:9; stroke-linecap:round;
  stroke:color-mix(in srgb,#e0512b calc(var(--drawer,0) * 1%),#5aa9e6);
  stroke-dasharray:314; stroke-dashoffset:calc(314 - 314 * var(--drawer,0) / 100);
  transition:stroke-dashoffset .7s ease,stroke .6s; }
.SKIN .gc { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.SKIN .gc .gv { font-size:22px; font-weight:800; } .SKIN .gc small { font-size:9px; color:var(--mut); }
.SKIN .cat { position:absolute; top:-6px; right:-4px; font-size:20px; opacity:0; transform:scale(.6); transition:.3s; }
.SKIN.catin .cat { opacity:1; transform:scale(1); animation:lg-bob 1.1s ease-in-out infinite; }
@keyframes lg-bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-3px); } }
.SKIN .col { flex:1; display:flex; flex-direction:column; gap:12px; }
.SKIN .wt small,.SKIN .lit small { display:block; font-size:11px; color:var(--mut); margin-bottom:2px; }
.SKIN .wt b { font-size:26px; font-weight:800; }
.SKIN .lit { display:flex; flex-direction:column; }
.SKIN .lbar { height:7px; border-radius:5px; background:rgba(255,255,255,.1); overflow:hidden; margin:2px 0; }
.SKIN .lbar i { display:block; height:100%; width:calc(var(--litter,0) * 1%);
  background:linear-gradient(90deg,#7cc6f0,#4f8cff); transition:width .7s; }
.SKIN.litterlow .lbar i { background:linear-gradient(90deg,#e8b04b,#d88a1f); }
.SKIN .lit b { font-size:13px; }
.SKIN .acts { display:flex; gap:9px; }
.SKIN .c { flex:1; border:0; border-radius:11px; padding:11px; cursor:pointer; color:#fff; font-size:13px;
  font-weight:600; background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#000));
  box-shadow:0 6px 16px color-mix(in srgb,var(--accent) 35%,transparent); }
.SKIN.cleaning .c { animation:lg-sheen 1.5s ease-in-out infinite; }
@keyframes lg-sheen { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.22); } }
.SKIN .r { flex:1; border:0; border-radius:11px; padding:11px 16px; cursor:pointer;
  background:rgba(255,255,255,.12); color:inherit; font-size:13px; white-space:nowrap; }
.SKIN .c:active,.SKIN .r:active { transform:scale(.97); }` },

  { kind: 'skin', id: 'lr-luxe-noir', name: 'Luxe — Noir', category: 'Litter-Robot',
    for: 'litterbox', size: [320, 278], card: true, html: `
      <div class="n">
        <div class="hd"><span class="at-name">{{name}}</span>
          <span class="at-lrstatus st"><i class="d"></i>Ready</span></div>
        <div class="weigh"><span class="at-weightval">–</span><small>lb · pet weight</small>
          <span class="cat">🐈</span></div>
        <div class="bars">
          <div class="b"><label>Waste drawer</label><div class="tr"><i class="d"></i></div><b class="at-drawerval">–</b></div>
          <div class="b"><label>Litter left</label><div class="tr"><i class="l"></i></div><b class="at-litterval">–</b></div></div>
        <div class="acts"><button class="at-clean c">◈ Clean cycle</button>
          <button class="at-reset r">Reset</button></div>
      </div>`, css: `
.SKIN { padding:0; }
.SKIN .n { width:100%; height:100%; box-sizing:border-box; padding:16px; display:flex;
  flex-direction:column; gap:11px; border-radius:16px; color:#e9edf5;
  background:linear-gradient(160deg,#12131c,#1c2030); border:1px solid rgba(255,255,255,.06); }
.SKIN .hd { display:flex; align-items:center; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; letter-spacing:.3px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .st { margin-left:auto; display:flex; align-items:center; gap:6px; font-size:12px;
  color:#9aa7c2; text-transform:capitalize; white-space:nowrap; }
.SKIN .st .d { width:8px; height:8px; border-radius:50%; background:#4fce7f; box-shadow:0 0 8px #4fce7f; }
.SKIN.cleaning .st .d { background:var(--accent); box-shadow:0 0 8px var(--accent); animation:ln-blink 1s ease-in-out infinite; }
.SKIN.catin .st .d { background:#a682ff; box-shadow:0 0 8px #a682ff; }
.SKIN.drawerfull .st .d,.SKIN.statusfull .st .d { background:#ff6a44; box-shadow:0 0 8px #ff6a44; }
@keyframes ln-blink { 0%,100% { opacity:1; } 50% { opacity:.3; } }
.SKIN .weigh { position:relative; display:flex; align-items:baseline; gap:8px; padding:6px 2px;
  border-bottom:1px solid rgba(255,255,255,.07); }
.SKIN .weigh > span:first-child { font-size:34px; font-weight:800; letter-spacing:-1px;
  background:linear-gradient(90deg,#fff,#9fb4ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
.SKIN .weigh small { font-size:11px; color:#8391af; }
.SKIN .weigh .cat { margin-left:auto; font-size:24px; opacity:.25; transition:.3s; }
.SKIN.catin .weigh .cat { opacity:1; animation:ln-bob 1.1s ease-in-out infinite; }
@keyframes ln-bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
.SKIN .bars { display:flex; flex-direction:column; gap:9px; }
.SKIN .b { display:flex; align-items:center; gap:9px; }
.SKIN .b label { width:78px; font-size:11px; color:#8391af; }
.SKIN .tr { flex:1; height:6px; border-radius:4px; background:rgba(255,255,255,.08); overflow:hidden; }
.SKIN .tr i { display:block; height:100%; }
.SKIN .tr .d { width:calc(var(--drawer,0) * 1%);
  background:linear-gradient(90deg,#5aa9e6,color-mix(in srgb,#ff6a44 calc(var(--drawer,0) * 1%),#5aa9e6)); transition:width .7s,background .6s; }
.SKIN .tr .l { width:calc(var(--litter,0) * 1%); background:linear-gradient(90deg,#7cc6f0,#4f8cff); transition:width .7s; }
.SKIN.litterlow .tr .l { background:linear-gradient(90deg,#e8b04b,#d88a1f); }
.SKIN .b b { width:36px; text-align:right; font-size:13px; font-weight:700; }
.SKIN .acts { display:flex; gap:9px; margin-top:auto; }
.SKIN .c { flex:1; border:1px solid var(--accent); border-radius:11px; padding:11px; cursor:pointer;
  color:#dbe6ff; font-size:13px; font-weight:600; letter-spacing:.5px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 22%,transparent),transparent); }
.SKIN.cleaning .c { animation:ln-glow 1.4s ease-in-out infinite; }
@keyframes ln-glow { 0%,100% { box-shadow:0 0 0 rgba(0,0,0,0); } 50% { box-shadow:0 0 16px color-mix(in srgb,var(--accent) 55%,transparent); } }
.SKIN .r { flex:1; border:1px solid rgba(255,255,255,.14); border-radius:11px; padding:11px 15px; cursor:pointer;
  background:transparent; color:#c3ccdf; font-size:13px; white-space:nowrap; }
.SKIN .c:active,.SKIN .r:active { transform:scale(.97); }` },

  { kind: 'skin', id: 'lr-luxe-arc', name: 'Luxe — Mono arc', category: 'Litter-Robot',
    for: 'litterbox', size: [280, 292], card: true, html: `
      <div class="hd"><span class="at-name">{{name}}</span>
        <span class="at-lrstatus st">Ready</span></div>
      <div class="arcwrap">
        <svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="52"/>
          <circle class="arc" cx="60" cy="60" r="52"/></svg>
        <div class="ac"><b class="at-weightval">–</b><small>weight</small>
          <span class="cat">🐈</span></div>
      </div>
      <div class="row2">
        <div class="kv"><small>Waste</small><b class="at-drawerval">–</b></div>
        <div class="kv"><small>Litter left</small><b class="at-litterval">–</b></div></div>
      <div class="acts"><button class="at-clean c">Clean cycle</button>
        <button class="at-reset r">Reset</button></div>`, css: `
.SKIN { padding:15px; gap:10px; }
.SKIN .hd { display:flex; align-items:center; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .st { margin-left:auto; font-size:12px; color:var(--mut); text-transform:capitalize; }
.SKIN .arcwrap { position:relative; align-self:center; width:132px; height:132px; }
.SKIN .arcwrap svg { width:132px; height:132px; transform:rotate(135deg); }
.SKIN .trk { fill:none; stroke:rgba(255,255,255,.09); stroke-width:8; stroke-linecap:round;
  stroke-dasharray:245 327; }
.SKIN .arc { fill:none; stroke:var(--accent); stroke-width:8; stroke-linecap:round;
  stroke-dasharray:245 327; stroke-dashoffset:calc(245 - 245 * var(--litter,0) / 100); transition:stroke-dashoffset .7s; }
.SKIN.litterlow .arc { stroke:#e8b04b; }
.SKIN .ac { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.SKIN .ac b { font-size:26px; font-weight:800; } .SKIN .ac small { font-size:10px; color:var(--mut); }
.SKIN .ac .cat { font-size:18px; opacity:0; transition:.3s; margin-top:2px; }
.SKIN.catin .ac .cat { opacity:1; animation:la-bob 1.1s ease-in-out infinite; }
@keyframes la-bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-3px); } }
.SKIN .row2 { display:flex; gap:10px; }
.SKIN .kv { flex:1; padding:8px 12px; border-radius:11px; background:rgba(255,255,255,.05); }
.SKIN .kv small { display:block; font-size:10px; color:var(--mut); }
.SKIN .kv b { font-size:17px; font-weight:700; }
.SKIN .acts { display:flex; gap:9px; }
.SKIN .c { flex:1; border:0; border-radius:11px; padding:10px; cursor:pointer; color:#fff; font-size:13px;
  font-weight:600; background:var(--accent); }
.SKIN.cleaning .c { animation:la-glow 1.4s ease-in-out infinite; }
@keyframes la-glow { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.22); } }
.SKIN .r { flex:1; border:0; border-radius:11px; padding:10px 14px; cursor:pointer; background:rgba(255,255,255,.12);
  color:inherit; font-size:13px; white-space:nowrap; }
.SKIN .c:active,.SKIN .r:active { transform:scale(.97); }` },

  /* ---------- FUNNY ---------- */
  { kind: 'skin', id: 'lr-funny-derp', name: 'Funny — Derp cat', category: 'Litter-Robot',
    for: 'litterbox', size: [320, 285], card: true, html: `
      <div class="hd"><span class="at-name">{{name}}</span>
        <span class="at-lrstatus tag">chillin'</span></div>
      <div class="scene">
        <div class="derp"><span class="eye e1"><i></i></span><span class="eye e2"><i></i></span>
          <span class="mouth"></span></div>
        <div class="boom">💥</div><div class="bigpoo">💩</div>
        <div class="stink k1">〰️</div><div class="stink k2">〰️</div>
        <div class="fly f1">🪰</div><div class="fly f2">🪰</div><div class="fly f3">🪰</div>
        <div class="say">READY</div>
      </div>
      <div class="wsilly">💪 <b class="at-weightval">–</b> of pure floof</div>
      <div class="mins">
        <div class="mini"><span>💩</span><i class="mb d"></i><b class="at-drawerval">–</b></div>
        <div class="mini"><span>🏖️</span><i class="mb l"></i><b class="at-litterval">–</b></div></div>
      <div class="btns"><button class="at-clean cb">🧹 SCOOP IT!</button>
        <button class="at-reset rb">🗑️</button></div>`, css: `
.SKIN { padding:13px; gap:8px; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .tag { margin-left:auto; font-size:11px; padding:3px 10px; border-radius:20px;
  background:rgba(255,255,255,.1); color:var(--mut); white-space:nowrap; font-weight:700; }
.SKIN.cleaning .tag { background:var(--accent); color:#fff; }
.SKIN.catin .tag { background:#8a63d2; color:#fff; }
.SKIN.drawerfull .tag,.SKIN.statusfull .tag { background:#e0512b; color:#fff; }
.SKIN .scene { position:relative; flex:1; min-height:104px; border-radius:14px; overflow:hidden;
  background:repeating-linear-gradient(45deg,#232c40 0 14px,#26304a 14px 28px);
  display:flex; align-items:center; justify-content:center; }
.SKIN .derp { position:relative; width:88px; height:70px; border-radius:50% 50% 46% 46%;
  background:radial-gradient(circle at 50% 40%,#ffe0a8,#efb268); animation:fd-wobble 2s ease-in-out infinite; }
@keyframes fd-wobble { 0%,100% { transform:rotate(-3deg); } 50% { transform:rotate(3deg); } }
.SKIN .derp .eye { position:absolute; top:16px; width:22px; height:22px; border-radius:50%; background:#fff;
  border:2px solid #2a2320; overflow:hidden; }
.SKIN .e1 { left:14px; } .SKIN .e2 { right:14px; }
.SKIN .derp .eye i { position:absolute; width:9px; height:9px; border-radius:50%; background:#2a2320;
  top:8px; left:3px; animation:fd-googly 1.6s ease-in-out infinite; }
.SKIN .e2 i { animation-delay:.3s; }
@keyframes fd-googly { 0%,100% { transform:translate(0,2px); } 33% { transform:translate(8px,0); } 66% { transform:translate(2px,6px); } }
.SKIN .mouth { position:absolute; bottom:14px; left:50%; margin-left:-8px; width:16px; height:10px;
  background:#c05a5a; border-radius:0 0 10px 10px; }
.SKIN.catin .derp { animation:fd-strain .4s ease-in-out infinite; }
@keyframes fd-strain { 0%,100% { transform:scale(1); } 50% { transform:scale(1.06,.92) translateY(3px); } }
.SKIN.catin .mouth { height:16px; width:20px; margin-left:-10px; border-radius:50%; }
.SKIN .bigpoo { position:absolute; bottom:10px; left:50%; margin-left:-16px; font-size:30px; opacity:0; }
.SKIN.catin .bigpoo { animation:fd-poo 1.4s ease-in infinite; }
@keyframes fd-poo { 0%,45% { opacity:0; transform:translateY(-18px) scale(.4) rotate(0); }
  60% { opacity:1; transform:translateY(0) scale(1.3) rotate(-8deg); } 72% { transform:scale(1) rotate(0); } 100% { opacity:1; } }
.SKIN .boom { position:absolute; bottom:6px; left:50%; margin-left:-16px; font-size:30px; opacity:0; }
.SKIN.catin .boom { animation:fd-boom 1.4s ease-in infinite; }
@keyframes fd-boom { 0%,58% { opacity:0; transform:scale(.3); } 62% { opacity:.9; transform:scale(1.4); } 74% { opacity:0; transform:scale(1.8); } 100% { opacity:0; } }
.SKIN .stink,.SKIN .fly { position:absolute; opacity:0; }
.SKIN .stink { font-size:16px; color:#9fd39a; } .SKIN .k1 { top:16%; left:40%; } .SKIN .k2 { top:22%; left:58%; }
.SKIN.drawerfull .stink { animation:fd-stink 2s ease-in infinite; } .SKIN.drawerfull .k2 { animation-delay:.8s; }
@keyframes fd-stink { 0% { opacity:0; transform:translateY(0) scale(.8); } 40% { opacity:.9; } 100% { opacity:0; transform:translateY(-20px) scale(1.2); } }
.SKIN .fly { font-size:13px; } .SKIN .f1 { top:30%; left:34%; } .SKIN .f2 { top:24%; left:64%; } .SKIN .f3 { top:44%; left:52%; }
.SKIN.drawerfull .fly { opacity:1; animation:fd-fly 1.3s linear infinite; }
.SKIN.drawerfull .f2 { animation-delay:.4s; } .SKIN.drawerfull .f3 { animation-delay:.8s; }
@keyframes fd-fly { 0%,100% { transform:translate(0,0); } 25% { transform:translate(8px,-7px); } 50% { transform:translate(-6px,-10px); } 75% { transform:translate(6px,-4px); } }
.SKIN .say { position:absolute; top:8px; left:10px; font-weight:800; font-size:12px; color:#fff;
  background:#000; padding:2px 8px; border-radius:10px; border:2px solid #fff; transform:rotate(-6deg); }
.SKIN.cleaning .say::after { content:'SCRUB!'; } .SKIN.catin .say::after { content:'nnngh…'; }
.SKIN.drawerfull .say::after { content:'PEE-YEW!'; }
.SKIN.cleaning .say,.SKIN.catin .say,.SKIN.drawerfull .say { font-size:0; }
.SKIN.cleaning .say::after,.SKIN.catin .say::after,.SKIN.drawerfull .say::after { font-size:12px; }
.SKIN .wsilly { text-align:center; font-size:13px; color:var(--mut); }
.SKIN .wsilly b { font-size:18px; font-weight:800; color:var(--text,#e8edf7); }
.SKIN .mins { display:flex; gap:8px; }
.SKIN .mini { flex:1; display:flex; align-items:center; gap:6px; font-size:13px; }
.SKIN .mini > span { width:20px; text-align:center; } .SKIN .mini b { color:var(--text,#e8edf7); width:34px; text-align:right; font-size:11px; }
.SKIN .mb { flex:1; height:9px; border-radius:5px; background:rgba(255,255,255,.1); position:relative; overflow:hidden; }
.SKIN .mb::after { content:''; position:absolute; left:0; top:0; bottom:0; }
.SKIN .mb.d::after { width:calc(var(--drawer,0) * 1%);
  background:repeating-linear-gradient(45deg,#8a5a2a 0 5px,#6f4a24 5px 10px); transition:width .6s; }
.SKIN .mb.l::after { width:calc(var(--litter,0) * 1%); background:#7cc6f0; transition:width .6s; }
.SKIN.litterlow .mb.l::after { background:#e8b04b; }
.SKIN .btns { display:flex; gap:8px; }
.SKIN .cb { flex:1; border:0; border-radius:10px; padding:10px; cursor:pointer; color:#fff; font-size:13px;
  font-weight:800; letter-spacing:.5px; background:var(--accent); }
.SKIN.drawerfull .cb { animation:fd-shake .5s ease-in-out infinite; }
@keyframes fd-shake { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-2px); } 75% { transform:translateX(2px); } }
.SKIN .rb { border:0; border-radius:10px; padding:10px 13px; cursor:pointer; background:rgba(255,255,255,.14);
  color:inherit; font-size:14px; }
.SKIN .cb:active,.SKIN .rb:active { transform:scale(.95); }` },

  { kind: 'skin', id: 'lr-funny-meter', name: 'Funny — Poop-o-meter', category: 'Litter-Robot',
    for: 'litterbox', size: [300, 275], card: true, html: `
      <div class="hd"><span class="at-name">{{name}}</span>
        <span class="at-lrstatus tag">😺</span></div>
      <div class="react"><span class="emo">😺</span>
        <span class="pow">💩</span><span class="sweat">💦</span></div>
      <div class="meter"><span class="mlbl">POOP-O-METER</span>
        <div class="mtrack"><div class="mfill"></div></div><b class="at-drawerval">–</b></div>
      <div class="meter"><span class="mlbl">SAND LEFT</span>
        <div class="mtrack"><div class="mfill l"></div></div><b class="at-litterval">–</b></div>
      <div class="wgt">🐾 <b class="at-weightval">–</b> <small>of majesty</small></div>
      <div class="btns"><button class="at-clean cb">🧹 CLEAN!</button>
        <button class="at-reset rb">EMPTY</button></div>`, css: `
.SKIN { padding:13px; gap:9px; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .tag { margin-left:auto; font-size:16px; }
.SKIN .react { position:relative; flex:1; min-height:80px; display:flex; align-items:center; justify-content:center;
  border-radius:14px; background:radial-gradient(circle at 50% 40%,#2c3550,#1a2030); }
.SKIN .emo { font-size:54px; line-height:1; animation:fm-idle 2.5s ease-in-out infinite; }
@keyframes fm-idle { 0%,100% { transform:translateY(0) rotate(-2deg); } 50% { transform:translateY(-4px) rotate(2deg); } }
.SKIN.catin .emo { animation:fm-strain .5s ease-in-out infinite; }
@keyframes fm-strain { 0%,100% { transform:scale(1); } 50% { transform:scale(1.12,.9); } }
.SKIN .pow { position:absolute; bottom:8px; font-size:26px; opacity:0; }
.SKIN.catin .pow { animation:fm-pow 1.4s ease-in infinite; }
@keyframes fm-pow { 0%,50% { opacity:0; transform:translateY(-10px) scale(.5); } 64% { opacity:1; transform:scale(1.3); } 100% { opacity:1; transform:scale(1); } }
.SKIN .sweat { position:absolute; top:24%; right:34%; font-size:18px; opacity:0; }
.SKIN.catin .sweat { animation:fm-sweat 1.4s ease-in infinite; }
@keyframes fm-sweat { 0%,30% { opacity:0; transform:translateY(-4px); } 45% { opacity:1; } 100% { opacity:0; transform:translateY(14px); } }
.SKIN .meter { display:flex; align-items:center; gap:8px; }
.SKIN .mlbl { width:96px; font-size:9px; font-weight:800; letter-spacing:.5px; color:var(--mut); }
.SKIN .mtrack { flex:1; height:12px; border-radius:7px; background:rgba(255,255,255,.1); overflow:hidden; }
.SKIN .mfill { height:100%; width:calc(var(--drawer,0) * 1%);
  background:linear-gradient(90deg,#6ec06e,#e8b04b,#e0512b); background-size:300% 100%; background-position:right;
  transition:width .6s; }
.SKIN .mfill.l { width:calc(var(--litter,0) * 1%); background:linear-gradient(90deg,#e0512b,#e8b04b,#6ec06e);
  background-size:300% 100%; background-position:left; }
.SKIN .meter b { width:36px; text-align:right; font-size:12px; font-weight:800; }
.SKIN .wgt { text-align:center; font-size:13px; color:var(--mut); }
.SKIN .wgt b { font-size:18px; font-weight:800; color:var(--text,#e8edf7); }
.SKIN .btns { display:flex; gap:8px; }
.SKIN .cb { flex:1; border:0; border-radius:10px; padding:10px; cursor:pointer; color:#fff; font-size:13px;
  font-weight:800; background:var(--accent); }
.SKIN .rb { border:0; border-radius:10px; padding:10px 13px; cursor:pointer; background:rgba(255,255,255,.14);
  color:inherit; font-size:12px; font-weight:700; }
.SKIN .cb:active,.SKIN .rb:active { transform:scale(.95); }` },

  { kind: 'skin', id: 'lr-funny-throne', name: 'Funny — The throne', category: 'Litter-Robot',
    for: 'litterbox', size: [300, 280], card: true, html: `
      <div class="hd"><span class="at-name">{{name}}</span>
        <span class="at-lrstatus tag">idle</span></div>
      <div class="scene">
        <div class="crown">👑</div>
        <div class="throne"><div class="seat"></div><div class="cat">🐈</div>
          <div class="paper">📰</div><div class="poo">💩</div></div>
        <div class="stink k1">〰️</div><div class="stink k2">〰️</div>
        <div class="spark s1">✨</div><div class="spark s2">✨</div>
      </div>
      <div class="wgt">👑 His Majesty · <b class="at-weightval">–</b></div>
      <div class="mins">
        <div class="mini"><span>Throne</span><i class="mb d"></i><b class="at-drawerval">–</b></div>
        <div class="mini"><span>Sand</span><i class="mb l"></i><b class="at-litterval">–</b></div></div>
      <div class="btns"><button class="at-clean cb">🧹 Cleanse the throne</button>
        <button class="at-reset rb">🗑️</button></div>`, css: `
.SKIN { padding:13px; gap:8px; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .tag { margin-left:auto; font-size:11px; padding:3px 10px; border-radius:20px;
  background:rgba(255,255,255,.1); color:var(--mut); white-space:nowrap; }
.SKIN.cleaning .tag { background:var(--accent); color:#fff; }
.SKIN.catin .tag { background:#8a63d2; color:#fff; }
.SKIN.drawerfull .tag,.SKIN.statusfull .tag { background:#e0512b; color:#fff; }
.SKIN .scene { position:relative; flex:1; min-height:96px; border-radius:14px; overflow:hidden;
  background:radial-gradient(120% 100% at 50% 10%,#3a2f52,#1c1830); display:flex; align-items:flex-end; justify-content:center; }
.SKIN .crown { position:absolute; top:8px; left:50%; margin-left:-14px; font-size:24px;
  animation:ft-crown 2.4s ease-in-out infinite; }
@keyframes ft-crown { 0%,100% { transform:translateY(0) rotate(-4deg); } 50% { transform:translateY(-4px) rotate(4deg); } }
.SKIN .throne { position:relative; width:90px; height:66px; margin-bottom:8px; }
.SKIN .seat { position:absolute; bottom:0; left:50%; margin-left:-33px; width:66px; height:34px;
  border-radius:12px 12px 6px 6px; background:linear-gradient(#5a4a7a,#3a2f52);
  box-shadow:0 4px 10px rgba(0,0,0,.4),inset 0 2px 3px rgba(255,255,255,.12); }
.SKIN .cat { position:absolute; bottom:22px; left:50%; margin-left:-17px; font-size:34px; transform-origin:50% 100%; }
.SKIN.catin .cat { animation:ft-squat .8s ease-in-out infinite; }
@keyframes ft-squat { 0%,100% { transform:scaleY(1); } 50% { transform:scaleY(.85) translateY(3px); } }
.SKIN .paper { position:absolute; bottom:30px; right:6px; font-size:18px; transform:rotate(12deg); opacity:.9; }
.SKIN .poo { position:absolute; bottom:6px; left:50%; margin-left:-9px; font-size:15px; opacity:0; }
.SKIN.catin .poo { animation:ft-poo 1.6s ease-in infinite; }
@keyframes ft-poo { 0%,55% { opacity:0; transform:translateY(-6px); } 66% { opacity:1; } 100% { opacity:1; transform:translateY(2px); } }
.SKIN .stink,.SKIN .spark { position:absolute; opacity:0; }
.SKIN .stink { font-size:15px; color:#9fd39a; } .SKIN .k1 { bottom:34%; left:40%; } .SKIN .k2 { bottom:40%; left:56%; }
.SKIN.drawerfull .stink { animation:ft-stink 2s ease-in infinite; } .SKIN.drawerfull .k2 { animation-delay:.8s; }
@keyframes ft-stink { 0% { opacity:0; transform:translateY(0); } 40% { opacity:.85; } 100% { opacity:0; transform:translateY(-16px); } }
.SKIN .spark { font-size:14px; } .SKIN .s1 { top:30%; left:34%; } .SKIN .s2 { top:40%; right:30%; }
.SKIN.cleaning .spark { animation:ft-spk 1.2s ease-in-out infinite; } .SKIN.cleaning .s2 { animation-delay:.4s; }
@keyframes ft-spk { 0%,100% { opacity:0; transform:scale(.5); } 50% { opacity:1; transform:scale(1.15); } }
.SKIN .wgt { text-align:center; font-size:12px; color:var(--mut); }
.SKIN .wgt b { font-size:17px; font-weight:800; color:var(--text,#e8edf7); }
.SKIN .mins { display:flex; gap:8px; }
.SKIN .mini { flex:1; display:flex; align-items:center; gap:6px; font-size:11px; color:var(--mut); }
.SKIN .mini span { width:40px; } .SKIN .mini b { color:var(--text,#e8edf7); width:34px; text-align:right; }
.SKIN .mb { flex:1; height:7px; border-radius:5px; background:rgba(255,255,255,.1); position:relative; overflow:hidden; }
.SKIN .mb::after { content:''; position:absolute; left:0; top:0; bottom:0; }
.SKIN .mb.d::after { width:calc(var(--drawer,0) * 1%);
  background:color-mix(in srgb,#e0512b calc(var(--drawer,0) * 1%),#8a63d2); transition:width .6s,background .6s; }
.SKIN .mb.l::after { width:calc(var(--litter,0) * 1%); background:#c8a6ff; transition:width .6s; }
.SKIN.litterlow .mb.l::after { background:#e8b04b; }
.SKIN .btns { display:flex; gap:8px; }
.SKIN .cb { flex:1; border:0; border-radius:10px; padding:10px; cursor:pointer; color:#fff; font-size:12px;
  font-weight:700; background:linear-gradient(135deg,#8a63d2,#5a3fa0); }
.SKIN .rb { border:0; border-radius:10px; padding:10px 13px; cursor:pointer; background:rgba(255,255,255,.14);
  color:inherit; font-size:14px; }
.SKIN .cb:active,.SKIN .rb:active { transform:scale(.95); }` },
]},

/* ============================================================== CONTROLS (select) */
{ pack: 'advance-tools-pack', format: 1, name: 'Controls', author: 'Advance Tools',
  version: '1.0.0', items: [

  /* for: select → select.select_option / input_select. Options come from the
     entity's `options` attribute at runtime; demo markup is replaced live. */
  { kind: 'skin', id: 'select-dropdown', name: 'Dropdown', category: 'General · Controls',
    for: 'select', size: [220, 92], card: true, html: `
      <div class="at-name">{{name}}</div>
      <select class="at-optsel"><option>{{val}}</option></select>`, css: `
.SKIN { justify-content:center; gap:8px; padding:14px; }
.SKIN .at-name { margin:0; }
.SKIN .at-optsel { width:100%; padding:10px 12px; border-radius:10px;
  background:rgba(255,255,255,.08); color:inherit;
  border:1px solid rgba(255,255,255,.16); font-size:14px; cursor:pointer;
  appearance:none; -webkit-appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),
    linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;
  background-size:5px 5px,5px 5px; background-repeat:no-repeat; }
.SKIN .at-optsel option { color:#111; }` },

  { kind: 'skin', id: 'select-segmented', name: 'Segmented', category: 'General · Controls',
    for: 'select', size: [250, 108], card: true, html: `
      <div class="at-name">{{name}}</div>
      <div class="at-opts seg"><button class="at-opt active">Auto</button>
        <button class="at-opt">On</button><button class="at-opt">Off</button></div>`, css: `
.SKIN { justify-content:center; gap:9px; padding:14px; }
.SKIN .at-name { margin:0; }
.SKIN .seg { display:flex; gap:4px; background:rgba(255,255,255,.06);
  border-radius:12px; padding:4px; }
.SKIN .at-opt { flex:1; border:0; border-radius:9px; padding:9px 6px; cursor:pointer;
  background:transparent; color:var(--mut); font-size:13px; text-transform:capitalize;
  transition:.2s; white-space:nowrap; }
.SKIN .at-opt.active { background:var(--accent); color:#fff; font-weight:600;
  box-shadow:0 2px 6px color-mix(in srgb,var(--accent) 40%,transparent); }` },

  { kind: 'skin', id: 'select-chips', name: 'Chips', category: 'General · Controls',
    for: 'select', size: [250, 120], card: true, html: `
      <div class="at-name">{{name}}</div>
      <div class="at-opts chips"><button class="at-opt active">Auto</button>
        <button class="at-opt">Low</button><button class="at-opt">Med</button>
        <button class="at-opt">High</button></div>`, css: `
.SKIN { justify-content:center; gap:9px; padding:14px; }
.SKIN .at-name { margin:0; }
.SKIN .chips { display:flex; flex-wrap:wrap; gap:6px; }
.SKIN .at-opt { border:1px solid rgba(255,255,255,.16); border-radius:20px;
  padding:7px 14px; cursor:pointer; background:rgba(255,255,255,.05);
  color:var(--mut); font-size:13px; text-transform:capitalize; transition:.2s; }
.SKIN .at-opt.active { background:var(--accent); border-color:var(--accent);
  color:#fff; font-weight:600; }` },
]},

/* ============================================================== NAVIGATION */
{ pack: 'advance-tools-pack', format: 1, name: 'Navigation', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'nav-tile', name: 'Nav tile', category: 'General · Navigation',
    for: 'nav', size: [150, 130], card: true, html: `
      <span class="at-ico ni">{{icon}}</span>
      <div class="at-name">{{name}}</div>
      <div class="arw">›</div>`, css: `
.SKIN { align-items:center; text-align:center; cursor:pointer; position:relative;
  transition:transform .12s, box-shadow .2s; }
.SKIN:hover { transform:translateY(-3px); }
.SKIN:active { transform:scale(.97); }
.SKIN .ni { font-size:34px; }
.SKIN .at-name { font-size:14px; margin-top:8px; }
.SKIN .arw { position:absolute; top:10px; right:14px; color:var(--mut); font-size:18px; }` },

  { kind: 'skin', id: 'nav-row', name: 'Nav row', category: 'General · Navigation',
    for: 'nav', size: [240, 64], card: true, html: `
      <span class="at-ico ni">{{icon}}</span>
      <span class="at-name">{{name}}</span>
      <span class="arw at-end">›</span>`, css: `
.SKIN { flex-direction:row; align-items:center; gap:12px; cursor:pointer;
  transition:.12s; }
.SKIN:active { transform:scale(.98); }
.SKIN .ni { font-size:22px; }
.SKIN .at-name { margin:0; font-size:14px; color:inherit; }
.SKIN .arw { margin-left:auto; color:var(--mut); font-size:20px; }` },

  { kind: 'skin', id: 'nav-glass', name: 'Nav button (glow)', category: 'General · Navigation',
    for: 'nav', size: [200, 70], html: `
      <button class="btn"><span class="at-ico ni">{{icon}}</span>
        <span class="at-name">{{name}}</span></button>`, css: `
.SKIN { align-items:stretch; justify-content:stretch; }
.SKIN .btn { flex:1; display:flex; align-items:center; justify-content:center; gap:10px;
  border:0; cursor:pointer; border-radius:14px; color:#fff; font-size:15px;
  background:linear-gradient(135deg,var(--accent),#7b5cff);
  box-shadow:0 6px 18px color-mix(in srgb, var(--accent) 45%, transparent);
  transition:transform .12s, box-shadow .2s; }
.SKIN .btn:hover { transform:translateY(-2px);
  box-shadow:0 10px 26px color-mix(in srgb, var(--accent) 55%, transparent); }
.SKIN .btn:active { transform:scale(.97); }
.SKIN .ni { font-size:22px; }` },

  { kind: 'skin', id: 'nav-big', name: 'Nav big', category: 'General · Navigation',
    for: 'nav', size: [260, 96], card: true, html: `
      <div class="row"><span class="at-ico ni">{{icon}}</span>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="sub">Tap to open</span></div>
        <span class="arw">→</span></div>`, css: `
.SKIN { justify-content:center; cursor:pointer; transition:.12s; }
.SKIN:active { transform:scale(.98); }
.SKIN .row { display:flex; align-items:center; gap:14px; }
.SKIN .ni { font-size:32px; flex:0 0 auto; }
.SKIN .lbl { display:flex; flex-direction:column; }
.SKIN .at-name { margin:0; font-size:15px; font-weight:600; }
.SKIN .sub { font-size:11px; color:var(--mut); }
.SKIN .arw { margin-left:auto; color:var(--accent); font-size:24px; }` },
]},

/* ================================================================== CHARTS */
{ pack: 'advance-tools-pack', format: 1, name: 'Charts', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'chart-line', name: 'Line chart', category: 'General · Charts',
    for: 'chart', size: [300, 170], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-val at-end"></span></div>
      <svg class="at-chart" viewBox="0 0 300 90" preserveAspectRatio="none">
        <polyline class="at-line ln" fill="none" points=""/>
      </svg>
      <div class="at-empty ce">loading…</div>`, css: `
.SKIN { justify-content:flex-start; gap:6px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; } .SKIN .top .at-val { margin:0 0 0 auto; font-size:16px; }
.SKIN .at-chart { width:100%; flex:1; min-height:0; }
.SKIN .ln { stroke:var(--accent); stroke-width:2.5; stroke-linejoin:round;
  stroke-linecap:round; vector-effect:non-scaling-stroke; }
.SKIN .ce { font-size:11px; color:var(--mut); text-align:center; display:none; }` },

  { kind: 'skin', id: 'chart-area', name: 'Area chart', category: 'General · Charts',
    for: 'chart', size: [300, 170], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-val at-end"></span></div>
      <svg class="at-chart" viewBox="0 0 300 90" preserveAspectRatio="none">
        <defs><linearGradient id="pmag" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--accent)" stop-opacity=".55"/>
          <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient></defs>
        <polygon class="at-area ar" points=""/>
        <polyline class="at-line ln" fill="none" points=""/>
      </svg>
      <div class="at-empty ce">loading…</div>`, css: `
.SKIN { justify-content:flex-start; gap:6px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; } .SKIN .top .at-val { margin:0 0 0 auto; font-size:16px; }
.SKIN .at-chart { width:100%; flex:1; min-height:0; }
.SKIN .ar { fill:url(#pmag); }
.SKIN .ln { stroke:var(--accent); stroke-width:2.5; fill:none;
  stroke-linejoin:round; vector-effect:non-scaling-stroke; }
.SKIN .ce { font-size:11px; color:var(--mut); text-align:center; display:none; }` },

  { kind: 'skin', id: 'chart-bars', name: 'Bar chart', category: 'General · Charts',
    for: 'chart', size: [300, 170], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-val at-end"></span></div>
      <svg class="at-chart" viewBox="0 0 300 90" preserveAspectRatio="none">
        <g class="at-bars bg"></g>
      </svg>
      <div class="at-empty ce">loading…</div>`, css: `
.SKIN { justify-content:flex-start; gap:6px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; } .SKIN .top .at-val { margin:0 0 0 auto; font-size:16px; }
.SKIN .at-chart { width:100%; flex:1; min-height:0; }
.SKIN .bg rect { fill:var(--accent); }
.SKIN .ce { font-size:11px; color:var(--mut); text-align:center; display:none; }` },

  { kind: 'skin', id: 'chart-ring', name: 'Live ring', category: 'General · Charts',
    for: 'chart', size: [180, 180], card: true, html: `
      <svg viewBox="0 0 120 120">
        <circle class="rt" cx="60" cy="60" r="50" pathLength="100"/>
        <circle class="at-ring rg" cx="60" cy="60" r="50" pathLength="100"
          stroke-dasharray="100" stroke-dashoffset="100"
          transform="rotate(-90 60 60)"/>
        <text class="at-val rv" x="60" y="60" text-anchor="middle"
          dominant-baseline="central">—</text>
      </svg>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:4px; }
.SKIN svg { width:100%; flex:1; min-height:0; }
.SKIN .rt { fill:none; stroke:rgba(255,255,255,.1); stroke-width:11; }
.SKIN .rg { fill:none; stroke:var(--accent); stroke-width:11; stroke-linecap:round;
  transition:stroke-dashoffset .6s ease; }
.SKIN .rv { font-size:20px; font-weight:700; fill:currentColor; }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'chart-spark', name: 'Sparkline + value', category: 'General · Charts',
    for: 'chart', size: [220, 120], card: true, html: `
      <div class="at-name">{{name}}</div>
      <div class="at-val big">—</div>
      <svg class="at-chart" viewBox="0 0 200 34" preserveAspectRatio="none">
        <polyline class="at-line ln" fill="none" points=""/>
      </svg>`, css: `
.SKIN { justify-content:center; gap:2px; }
.SKIN .big { font-size:30px; font-weight:700; }
.SKIN .at-chart { width:100%; height:30px; }
.SKIN .ln { stroke:var(--accent); stroke-width:2; fill:none;
  vector-effect:non-scaling-stroke; }` },
]},

/* ================================================================ SWITCHES */
{ pack: 'advance-tools-pack', format: 1, name: 'Switches', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'ios', name: 'iOS switch', category: 'General · Switches',
    for: 'toggle', size: [230, 64], card: true, html: `
      <span class="at-ico">{{icon}}</span><span class="at-name at-grow">{{name}}</span>
      <div class="sw"><div class="knob"></div></div>`, css: `
.SKIN { flex-direction:row; align-items:center; gap:12px; }
.SKIN .at-name { margin:0; font-size:14px; color:inherit; }
.SKIN .sw { width:54px; height:32px; border-radius:20px; flex:0 0 auto;
  background:rgba(255,255,255,.16); position:relative; transition:background .25s; }
.SKIN .knob { position:absolute; top:3px; left:3px; width:26px; height:26px;
  border-radius:50%; background:#fff; transition:transform .25s cubic-bezier(.3,1.4,.6,1);
  box-shadow:0 2px 6px rgba(0,0,0,.45); }
.SKIN.on .sw { background:var(--accent); }
.SKIN.on .knob { transform:translateX(22px); }` },

  { kind: 'skin', id: 'material', name: 'Material switch', category: 'General · Switches',
    for: 'toggle', size: [230, 60], card: true, html: `
      <span class="at-ico">{{icon}}</span><span class="at-name at-grow">{{name}}</span>
      <div class="sw"><div class="knob"></div></div>`, css: `
.SKIN { flex-direction:row; align-items:center; gap:12px; }
.SKIN .at-name { margin:0; font-size:14px; color:inherit; }
.SKIN .sw { width:46px; height:18px; border-radius:10px; flex:0 0 auto;
  background:rgba(255,255,255,.22); position:relative; transition:.25s; }
.SKIN .knob { position:absolute; top:-4px; left:-2px; width:26px; height:26px;
  border-radius:50%; background:#aeb6c4; transition:.25s;
  box-shadow:0 2px 5px rgba(0,0,0,.5); }
.SKIN.on .sw { background:color-mix(in srgb, var(--accent) 45%, transparent); }
.SKIN.on .knob { transform:translateX(24px); background:var(--accent); }` },

  { kind: 'skin', id: 'lever', name: 'Retro lever', category: 'General · Switches',
    for: 'toggle', size: [140, 190], html: `
      <div class="plate"><div class="slot"></div><div class="arm"></div>
      <div class="hub"></div></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:10px; }
.SKIN .plate { width:58%; height:68%; max-width:110px; border-radius:14px;
  position:relative; background:linear-gradient(#3a4150,#232936);
  box-shadow:0 5px 12px rgba(0,0,0,.5), inset 0 1px 2px rgba(255,255,255,.15); }
.SKIN .slot { position:absolute; left:50%; top:10%; bottom:10%; width:14px;
  transform:translateX(-50%); border-radius:8px; background:#0c0f16;
  box-shadow:inset 0 2px 6px #000; }
.SKIN .arm { position:absolute; left:50%; bottom:50%; width:16px; height:34%;
  margin-left:-8px; transform-origin:50% 100%; transform:rotate(180deg);
  border-radius:8px 8px 3px 3px;
  background:linear-gradient(90deg,#f2f3f6,#b9bec9);
  transition:transform .22s cubic-bezier(.34,1.4,.64,1);
  box-shadow:0 3px 6px rgba(0,0,0,.5); }
.SKIN .arm::after { content:''; position:absolute; top:-13px; left:50%;
  transform:translateX(-50%); width:28px; height:28px; border-radius:50%;
  background:radial-gradient(circle at 35% 30%, #ff8383, #b91c1c);
  box-shadow:0 2px 5px rgba(0,0,0,.5); transition:background .2s, box-shadow .2s; }
.SKIN .hub { position:absolute; left:50%; top:50%; width:24px; height:24px;
  transform:translate(-50%,-50%); border-radius:50%;
  background:radial-gradient(circle at 35% 30%, #4a5263, #1a1f2a);
  box-shadow:inset 0 1px 2px rgba(255,255,255,.25), 0 1px 3px #000; }
.SKIN.on .arm { transform:rotate(0deg); }
.SKIN.on .arm::after { background:radial-gradient(circle at 35% 30%,
  color-mix(in srgb, var(--accent) 60%, #fff), var(--accent));
  box-shadow:0 0 12px var(--accent); }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'rocker', name: 'Wall switch', category: 'General · Switches',
    for: 'toggle', size: [140, 190], html: `
      <div class="plate"><div class="rk"></div></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .plate { width:62%; height:72%; max-width:120px; border-radius:12px;
  background:linear-gradient(#e8e9ee,#c9ccd6); padding:12%;
  box-shadow:0 4px 10px rgba(0,0,0,.45), inset 0 1px 2px #fff; perspective:240px; }
.SKIN .rk { width:100%; height:100%; border-radius:6px; position:relative;
  background:linear-gradient(#f5f6f9,#d7dae2); transform:rotateX(14deg);
  transition:transform .16s, background .16s; box-shadow:0 3px 5px rgba(0,0,0,.35); }
.SKIN .rk::after { content:''; position:absolute; left:20%; right:20%; bottom:12%;
  height:3px; border-radius:2px; background:rgba(0,0,0,.18); transition:.16s; }
.SKIN.on .rk { transform:rotateX(-14deg); background:linear-gradient(#fff,#e8eaf0); }
.SKIN.on .rk::after { bottom:auto; top:12%; background:var(--accent);
  box-shadow:0 0 8px var(--accent); }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'rocker-dark', name: 'Wall switch (dark)', category: 'General · Switches',
    for: 'toggle', size: [140, 190], html: `
      <div class="plate"><div class="rk"></div></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .plate { width:62%; height:72%; max-width:120px; border-radius:12px;
  background:linear-gradient(#2b303c,#171b24); padding:12%;
  box-shadow:0 4px 10px rgba(0,0,0,.55), inset 0 1px 1px rgba(255,255,255,.12);
  perspective:240px; }
.SKIN .rk { width:100%; height:100%; border-radius:6px; position:relative;
  background:linear-gradient(#3a4150,#262c39); transform:rotateX(14deg);
  transition:.16s; box-shadow:0 3px 5px rgba(0,0,0,.5); }
.SKIN .rk::after { content:''; position:absolute; left:20%; right:20%; bottom:12%;
  height:3px; border-radius:2px; background:rgba(0,0,0,.4); transition:.16s; }
.SKIN.on .rk { transform:rotateX(-14deg); }
.SKIN.on .rk::after { bottom:auto; top:12%; background:var(--accent);
  box-shadow:0 0 10px var(--accent); }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'tile', name: 'Flat tile', category: 'General · Switches',
    for: 'toggle', size: [140, 140], card: true, html: `
      <span class="at-ico big">{{icon}}</span>
      <div class="at-name">{{name}}</div><div class="at-val"></div>`, css: `
.SKIN { align-items:center; text-align:center; transition:.2s; }
.SKIN .at-ico.big { font-size:36px; }
.SKIN.on { outline:2px solid var(--accent);
  background:color-mix(in srgb, var(--accent) 16%, var(--card)); }` },
]},

/* ============================================================ PUSH BUTTONS */
{ pack: 'advance-tools-pack', format: 1, name: 'Push Buttons', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'push', name: 'Glossy push', category: 'General · Buttons',
    for: 'toggle', size: [150, 170], html: `
      <div class="btn"><span class="at-ico">{{icon}}</span></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .btn { width:64%; aspect-ratio:1; max-height:70%; border-radius:50%;
  background:radial-gradient(circle at 32% 30%, #2c3852, #161d2e 70%);
  box-shadow:0 6px 14px rgba(0,0,0,.5), inset 0 2px 4px rgba(255,255,255,.14),
             inset 0 -4px 8px rgba(0,0,0,.5);
  display:flex; align-items:center; justify-content:center;
  transition:transform .1s, box-shadow .25s; font-size:30px; }
.SKIN:active .btn { transform:translateY(3px) scale(.97); }
.SKIN.on .btn { box-shadow:0 0 22px var(--accent), 0 6px 14px rgba(0,0,0,.5),
  inset 0 2px 4px rgba(255,255,255,.14);
  background:radial-gradient(circle at 32% 30%,
  color-mix(in srgb, var(--accent) 55%, #2c3852), #161d2e 75%); }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'bigred', name: 'Industrial red', category: 'General · Buttons',
    for: 'toggle', size: [160, 180], html: `
      <div class="base"><div class="btn"></div></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .base { width:72%; aspect-ratio:1; max-height:72%; border-radius:18px;
  background:linear-gradient(#f5c542,#c79a1d);
  box-shadow:0 5px 12px rgba(0,0,0,.5), inset 0 -4px 8px rgba(0,0,0,.3);
  display:flex; align-items:center; justify-content:center;
  background-image:repeating-linear-gradient(45deg, rgba(0,0,0,.25) 0 12px,
    transparent 12px 24px); }
.SKIN .btn { width:62%; aspect-ratio:1; border-radius:50%;
  background:radial-gradient(circle at 34% 28%, #ff6b6b, #b91c1c 68%);
  box-shadow:0 6px 0 #7f1d1d, 0 9px 14px rgba(0,0,0,.5);
  transition:transform .08s, box-shadow .08s; }
.SKIN:active .btn { transform:translateY(5px); box-shadow:0 1px 0 #7f1d1d,
  0 3px 8px rgba(0,0,0,.5); }
.SKIN.on .btn { background:radial-gradient(circle at 34% 28%,
  color-mix(in srgb, var(--accent) 70%, #fff), var(--accent) 70%);
  box-shadow:0 6px 0 color-mix(in srgb, var(--accent) 55%, #000),
  0 0 24px var(--accent); }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'neon-ring', name: 'Neon ring', category: 'General · Buttons',
    for: 'toggle', size: [150, 170], html: `
      <div class="btn"><span class="at-ico">{{icon}}</span></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .btn { width:62%; aspect-ratio:1; max-height:68%; border-radius:50%;
  background:#0b0f1a; border:3px solid rgba(255,255,255,.14);
  display:flex; align-items:center; justify-content:center; font-size:28px;
  transition:.25s; }
.SKIN:active .btn { transform:scale(.94); }
.SKIN.on .btn { border-color:var(--accent);
  box-shadow:0 0 18px var(--accent), inset 0 0 18px
  color-mix(in srgb, var(--accent) 35%, transparent);
  animation:at-nr 1.8s ease-in-out infinite; }
@keyframes at-nr { 50% { box-shadow:0 0 30px var(--accent), inset 0 0 26px
  color-mix(in srgb, var(--accent) 45%, transparent); } }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },
]},

/* ================================================================= SOCKETS */
{ pack: 'advance-tools-pack', format: 1, name: 'Sockets', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'socket-eu', name: 'EU socket (Schuko)', category: 'General · Sockets',
    for: 'toggle', size: [150, 180], html: `
      <div class="face"><div class="hole l"></div><div class="hole r"></div>
      <div class="pin t"></div><div class="pin b"></div></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .face { width:70%; aspect-ratio:1; max-height:72%; border-radius:50%;
  background:radial-gradient(circle at 35% 30%, #f2f3f6, #c6cad3 75%);
  position:relative; box-shadow:0 5px 12px rgba(0,0,0,.45),
  inset 0 0 0 6px #dfe2e8, inset 0 0 14px rgba(0,0,0,.25); transition:.25s; }
.SKIN .hole { position:absolute; top:50%; width:14%; aspect-ratio:1;
  border-radius:50%; background:#14181f; transform:translateY(-50%);
  box-shadow:inset 0 2px 4px #000; }
.SKIN .hole.l { left:22%; } .SKIN .hole.r { right:22%; }
.SKIN .pin { position:absolute; left:50%; width:16%; height:7%;
  transform:translateX(-50%); background:#9aa1ad; border-radius:4px; }
.SKIN .pin.t { top:6%; } .SKIN .pin.b { bottom:6%; }
.SKIN.on .face { box-shadow:0 5px 12px rgba(0,0,0,.45), inset 0 0 0 6px #dfe2e8,
  0 0 22px var(--accent); }
.SKIN.on .hole { box-shadow:inset 0 2px 4px #000, 0 0 8px var(--accent); }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'socket-us', name: 'US outlet', category: 'General · Sockets',
    for: 'toggle', size: [150, 190], html: `
      <div class="face"><div class="slot l"></div><div class="slot r"></div>
      <div class="gnd"></div></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .face { width:58%; height:74%; border-radius:16px;
  background:linear-gradient(#f2f3f6,#d4d8e0); position:relative;
  box-shadow:0 5px 12px rgba(0,0,0,.45), inset 0 1px 2px #fff; transition:.25s; }
.SKIN .slot { position:absolute; top:26%; width:8%; height:22%; background:#14181f;
  border-radius:3px; box-shadow:inset 0 2px 3px #000; }
.SKIN .slot.l { left:28%; } .SKIN .slot.r { right:28%; height:16%; top:29%; }
.SKIN .gnd { position:absolute; left:50%; bottom:18%; width:16%; aspect-ratio:1;
  transform:translateX(-50%); background:#14181f;
  border-radius:50% 50% 6px 6px; box-shadow:inset 0 2px 3px #000; }
.SKIN.on .face { box-shadow:0 5px 12px rgba(0,0,0,.45), 0 0 22px var(--accent); }
.SKIN.on .slot, .SKIN.on .gnd { box-shadow:inset 0 2px 3px #000,
  0 0 8px var(--accent); }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },
]},

/* ======================================================== SENSORS & GAUGES */
{ pack: 'advance-tools-pack', format: 1, name: 'Sensors & Gauges', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'sensor-card', name: 'Sensor card', category: 'General · Sensors',
    for: 'sensor', size: [200, 110], card: true, html: `
      <span class="at-ico">{{icon}}</span>
      <div class="at-name">{{name}}</div><div class="at-val">{{val}}</div>`, css: `` },

  { kind: 'skin', id: 'sensor-big', name: 'Big number', category: 'General · Sensors',
    for: 'sensor', size: [240, 150], card: true, html: `
      <div class="at-val">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; text-align:center; }
.SKIN .at-val { font-size:44px; font-weight:700; }` },

  { kind: 'skin', id: 'sensor-chip', name: 'Chip', category: 'General · Sensors',
    for: 'sensor', size: [190, 46], card: true, html: `
      <span class="at-ico">{{icon}}</span><span class="at-name">{{name}}</span>
      <span class="at-val at-end">{{val}}</span>`, css: `
.SKIN { flex-direction:row; align-items:center; gap:10px; padding:8px 16px; }
.SKIN .at-ico { font-size:18px; } .SKIN .at-name { margin:0; font-size:12px; }
.SKIN .at-val { margin:0 0 0 auto; font-size:15px; }` },

  { kind: 'skin', id: 'gauge', name: 'Gauge', category: 'General · Gauges',
    for: 'sensor', size: [220, 160], card: true, html: `
      <svg viewBox="0 0 200 120">
        <path class="track" pathLength="100" d="M 20 105 A 85 85 0 0 1 180 105"/>
        <path class="at-arc arc" pathLength="100" d="M 20 105 A 85 85 0 0 1 180 105"/>
        <text class="at-val gv" x="100" y="92" text-anchor="middle">{{val}}</text>
        <text class="at-name gn" x="100" y="114" text-anchor="middle">{{name}}</text>
      </svg>`, css: `
.SKIN { align-items:center; }
.SKIN svg { width:100%; height:100%; }
.SKIN .track { fill:none; stroke:rgba(255,255,255,.12); stroke-width:13;
  stroke-linecap:round; }
.SKIN .arc { fill:none; stroke:var(--accent); stroke-width:13; stroke-linecap:round;
  stroke-dasharray:var(--pct,0) 100; transition:stroke-dasharray .5s; }
.SKIN .gv { font-size:26px; font-weight:700; fill:currentColor; }
.SKIN .gn { font-size:11px; fill:#8b98b8; }` },

  { kind: 'skin', id: 'bar', name: 'Progress bar', category: 'General · Gauges',
    for: 'sensor', size: [260, 84], card: true, html: `
      <div class="row"><span class="at-name">{{name}}</span>
      <span class="at-val at-end">{{val}}</span></div>
      <div class="track"><div class="fill"></div></div>`, css: `
.SKIN { justify-content:center; gap:10px; }
.SKIN .row { display:flex; align-items:center; }
.SKIN .row .at-name { margin:0; } .SKIN .row .at-val { margin:0 0 0 auto; font-size:15px; }
.SKIN .track { height:10px; border-radius:6px; background:rgba(255,255,255,.12);
  overflow:hidden; }
.SKIN .fill { height:100%; width:calc(var(--pct,0) * 1%); border-radius:6px;
  background:linear-gradient(90deg, color-mix(in srgb, var(--accent) 60%, #fff),
  var(--accent)); transition:width .5s; }` },

  { kind: 'skin', id: 'battery', name: 'Battery', category: 'General · Gauges',
    for: 'sensor', size: [180, 120], card: true, html: `
      <div class="bat"><div class="cap"></div><div class="fill"></div>
      <span class="at-val bv">{{val}}</span></div>
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; }
.SKIN .bat { width:70%; height:44%; border:3px solid rgba(255,255,255,.35);
  border-radius:8px; position:relative; }
.SKIN .cap { position:absolute; right:-9px; top:30%; width:6px; height:40%;
  background:rgba(255,255,255,.35); border-radius:0 3px 3px 0; }
.SKIN .fill { position:absolute; inset:3px; width:calc(var(--pct,0) * 1% - 6px);
  min-width:0; border-radius:4px; background:var(--accent); transition:width .5s; }
.SKIN[style*="--pct:1"] .fill, .SKIN.low .fill { background:#ff6b81; }
.SKIN .bv { position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; font-size:14px; font-weight:700;
  text-shadow:0 1px 3px rgba(0,0,0,.7); margin:0; }
.SKIN .at-name { text-align:center; }` },

  { kind: 'skin', id: 'soil', name: 'Soil / plant', category: 'General · Gauges',
    for: 'sensor', size: [160, 190], card: true, html: `
      <div class="pot"><div class="water"></div><span class="plant">🌱</span></div>
      <div class="at-val sv">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:4px; }
.SKIN .pot { width:56%; height:52%; position:relative; overflow:hidden;
  background:linear-gradient(#8a5a37,#5f3b20); border-radius:8px 8px 16px 16px;
  clip-path:polygon(0 0, 100% 0, 86% 100%, 14% 100%); }
.SKIN .water { position:absolute; left:0; right:0; bottom:0;
  height:calc(var(--pct,0) * 1%); background:linear-gradient(
  color-mix(in srgb, var(--accent) 70%, #22d3ee), #1573b8);
  opacity:.85; transition:height .6s; }
.SKIN .plant { position:absolute; left:50%; top:-6px; transform:translateX(-50%);
  font-size:30px; }
.SKIN .sv { font-size:17px; } .SKIN .at-name { font-size:11px; }` },

  { kind: 'skin', id: 'thermo', name: 'Thermometer', category: 'General · Gauges',
    for: 'sensor', size: [130, 210], card: true, html: `
      <div class="tube"><div class="fill"></div><div class="bulb"></div></div>
      <div class="at-val">{{val}}</div><div class="at-name">{{name}}</div>`, css: `
.SKIN { align-items:center; gap:3px; }
.SKIN .tube { width:14px; height:52%; background:rgba(255,255,255,.12);
  border-radius:8px 8px 0 0; position:relative; }
.SKIN .fill { position:absolute; left:3px; right:3px; bottom:0;
  height:calc(var(--pct,0) * 1%); background:var(--accent);
  border-radius:6px; transition:height .5s; }
.SKIN .bulb { position:absolute; left:50%; bottom:-16px; width:26px; height:26px;
  transform:translateX(-50%); border-radius:50%; background:var(--accent);
  box-shadow:0 0 10px color-mix(in srgb, var(--accent) 60%, transparent); }
.SKIN .at-val { margin-top:18px; font-size:16px; }
.SKIN .at-name { font-size:11px; }` },

  { kind: 'skin', id: 'led', name: 'LED indicator', category: 'General · Sensors',
    for: 'sensor', size: [190, 52], card: true, html: `
      <div class="dot"></div><span class="at-name">{{name}}</span>
      <span class="at-val at-end">{{val}}</span>`, css: `
.SKIN { flex-direction:row; align-items:center; gap:10px; padding:8px 16px; }
.SKIN .dot { width:14px; height:14px; border-radius:50%; background:#4a5568;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.6); flex:0 0 auto; transition:.3s; }
.SKIN.on .dot, .SKIN.active .dot { background:var(--accent);
  box-shadow:0 0 10px var(--accent); }
.SKIN .at-name { margin:0; font-size:13px; }
.SKIN .at-val { margin:0 0 0 auto; font-size:13px; color:var(--mut); }` },
]},

/* ================================================================= CLIMATE */
{ pack: 'advance-tools-pack', format: 1, name: 'Climate', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'dial', name: 'Nest dial', category: 'General · Climate',
    for: 'climate', size: [260, 300], html: `
      <svg viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="96" class="bezel"/>
        <path class="track" pathLength="100" d="M 43.4 156.6 A 80 80 0 1 1 156.6 156.6"/>
        <path class="at-arc arc" pathLength="100" stroke-dasharray="100"
          stroke-dashoffset="100" d="M 43.4 156.6 A 80 80 0 1 1 156.6 156.6"/>
        <text class="at-cur cur" x="100" y="76" text-anchor="middle">—</text>
        <text class="at-set set" x="100" y="122" text-anchor="middle">—</text>
        <text class="at-act act" x="100" y="146" text-anchor="middle"></text>
        <text class="at-nm nm" x="100" y="182" text-anchor="middle">{{name}}</text>
      </svg>
      <button class="at-minus">−</button><button class="at-plus">+</button>`, css: `
.SKIN { display:flex; align-items:center; justify-content:center; position:relative; }
.SKIN svg { width:100%; height:100%; }
.SKIN .bezel { fill:#10151f; stroke:rgba(255,255,255,.08); stroke-width:2; }
.SKIN .track { fill:none; stroke:rgba(255,255,255,.1); stroke-width:12;
  stroke-linecap:round; }
.SKIN .arc { fill:none; stroke:var(--accent); stroke-width:12; stroke-linecap:round;
  transition:stroke-dashoffset .4s, stroke .3s; }
.SKIN.heat .arc { stroke:#ff8a3d; } .SKIN.cool .arc { stroke:#38bdf8; }
.SKIN.off .arc, .SKIN.idle .arc { stroke:rgba(255,255,255,.28); }
.SKIN .cur { font-size:13px; font-weight:600; fill:#aab4cc; }
.SKIN .set { font-size:46px; font-weight:700; fill:currentColor; }
.SKIN .act { font-size:12px; fill:#8b98b8; text-transform:capitalize; }
.SKIN.heat .act { fill:#ff8a3d; } .SKIN.cool .act { fill:#38bdf8; }
.SKIN .nm { font-size:12px; fill:#8b98b8; }
.SKIN .at-minus, .SKIN .at-plus { position:absolute; bottom:4%; width:42px;
  height:42px; border-radius:50%; border:0; background:rgba(255,255,255,.13);
  color:inherit; font-size:22px; cursor:pointer; }
.SKIN .at-minus { left:6%; } .SKIN .at-plus { right:6%; }
.SKIN .at-minus:active, .SKIN .at-plus:active { background:var(--accent); }` },

  { kind: 'skin', id: 'nest-full', name: 'Nest (full control)', category: 'General · Climate',
    for: 'climate', size: [300, 400], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-act act at-end"></span></div>
      <div class="dialwrap">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="96" class="bezel"/>
          <path class="track" pathLength="100" d="M 43.4 156.6 A 80 80 0 1 1 156.6 156.6"/>
          <path class="at-arc arc" pathLength="100" stroke-dasharray="100"
            stroke-dashoffset="100" d="M 43.4 156.6 A 80 80 0 1 1 156.6 156.6"/>
          <text class="at-cur cur" x="100" y="80" text-anchor="middle">—</text>
          <text class="at-set set" x="100" y="122" text-anchor="middle">—</text>
          <text class="at-hum hum" x="100" y="150" text-anchor="middle"></text>
        </svg>
        <button class="at-minus">−</button><button class="at-plus">+</button>
      </div>
      <div class="modes">
        <button class="at-mode" data-mode="off">Off</button>
        <button class="at-mode" data-mode="heat">Heat</button>
        <button class="at-mode" data-mode="cool">Cool</button>
        <button class="at-mode" data-mode="heat_cool">Auto</button>
      </div>
      <div class="extras">
        <button class="at-eco">🌿 Eco</button>
        <button class="at-fan">🌀 Fan</button>
      </div>
      <svg class="at-spark spark" viewBox="0 0 280 46" preserveAspectRatio="none">
        <polyline class="at-sparkline" fill="none" points=""/>
      </svg>`, css: `
.SKIN { gap:8px; padding:16px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; font-size:14px; }
.SKIN .act { font-size:12px; text-transform:capitalize; color:var(--mut); }
.SKIN.heat .act { color:#ff8a3d; } .SKIN.cool .act { color:#38bdf8; }
.SKIN .dialwrap { position:relative; width:100%; aspect-ratio:1; max-height:180px;
  margin:0 auto; display:flex; align-items:center; justify-content:center; }
.SKIN .dialwrap svg { width:100%; height:100%; }
.SKIN .bezel { fill:#10151f; stroke:rgba(255,255,255,.08); stroke-width:2; }
.SKIN .track { fill:none; stroke:rgba(255,255,255,.1); stroke-width:12; stroke-linecap:round; }
.SKIN .arc { fill:none; stroke:var(--accent); stroke-width:12; stroke-linecap:round;
  transition:stroke-dashoffset .4s, stroke .3s; }
.SKIN.heat .arc { stroke:#ff8a3d; } .SKIN.cool .arc { stroke:#38bdf8; }
.SKIN.off .arc, .SKIN.idle .arc { stroke:rgba(255,255,255,.28); }
.SKIN .cur { font-size:13px; font-weight:600; fill:#aab4cc; }
.SKIN .set { font-size:44px; font-weight:700; fill:currentColor; }
.SKIN .hum { font-size:11px; fill:#6b7791; }
.SKIN .at-minus, .SKIN .at-plus { position:absolute; bottom:2%; width:38px; height:38px;
  border-radius:50%; border:0; background:rgba(255,255,255,.13); color:inherit;
  font-size:20px; cursor:pointer; }
.SKIN .at-minus { left:2%; } .SKIN .at-plus { right:2%; }
.SKIN .at-minus:active, .SKIN .at-plus:active { background:var(--accent); }
.SKIN .modes { display:flex; gap:6px; }
.SKIN .modes button { flex:1; padding:8px 0; border-radius:9px; border:1px solid
  rgba(255,255,255,.12); background:rgba(255,255,255,.05); color:var(--mut);
  font-size:12px; cursor:pointer; }
.SKIN .modes button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
.SKIN .modes button[data-mode="heat"].active { background:#ff8a3d; border-color:#ff8a3d; }
.SKIN .modes button[data-mode="cool"].active { background:#38bdf8; border-color:#38bdf8; }
.SKIN .modes button.hide { display:none; }
.SKIN .extras { display:flex; gap:6px; }
.SKIN .extras button { flex:1; padding:8px 0; border-radius:9px; border:1px solid
  rgba(255,255,255,.12); background:rgba(255,255,255,.05); color:var(--mut);
  font-size:12px; cursor:pointer; }
.SKIN .extras button.active { background:#3ecf8e; color:#08291a; border-color:#3ecf8e; }
.SKIN .extras button.hide { display:none; }
.SKIN .spark { width:100%; height:40px; }
.SKIN .at-sparkline { stroke:var(--accent); stroke-width:2; }
.SKIN.heat .at-sparkline { stroke:#ff8a3d; } .SKIN.cool .at-sparkline { stroke:#38bdf8; }` },

  { kind: 'skin', id: 'climate-card', name: 'Thermostat card', category: 'General · Climate',
    for: 'climate', size: [240, 160], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-act act at-end"></span></div>
      <div class="row"><button class="at-minus">−</button>
      <div class="at-set">—</div><button class="at-plus">+</button></div>
      <div class="at-cur cur">Now —</div>`, css: `
.SKIN { justify-content:center; gap:6px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; }
.SKIN .act { font-size:12px; text-transform:capitalize; color:var(--mut); }
.SKIN.heat .act { color:#ff8a3d; } .SKIN.cool .act { color:#38bdf8; }
.SKIN .row { display:flex; align-items:center; gap:14px; margin:2px 0; }
.SKIN .row button { width:44px; height:44px; border-radius:50%; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:21px; cursor:pointer;
  flex:0 0 auto; }
.SKIN .row button:active { background:var(--accent); }
.SKIN .at-set { flex:1; text-align:center; font-size:34px; font-weight:700; }
.SKIN.heat .at-set { color:#ff8a3d; } .SKIN.cool .at-set { color:#38bdf8; }
.SKIN .cur { font-size:13px; color:var(--mut); }` },

  { kind: 'skin', id: 'climate-mini', name: 'Setpoint chip', category: 'General · Climate',
    for: 'climate', size: [240, 60], card: true, html: `
      <span class="at-name">{{name}}</span>
      <span class="at-cur cur"></span>
      <button class="at-minus">−</button><span class="at-set">—</span>
      <button class="at-plus">+</button>`, css: `
.SKIN { flex-direction:row; align-items:center; gap:8px; padding:8px 14px; }
.SKIN .at-name { margin:0; font-size:13px; }
.SKIN .cur { margin:0 auto 0 6px; font-size:12px; color:var(--mut); }
.SKIN button { width:34px; height:34px; border-radius:50%; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:17px; cursor:pointer;
  flex:0 0 auto; }
.SKIN button:active { background:var(--accent); }
.SKIN .at-set { font-size:19px; font-weight:700; min-width:48px; text-align:center; }
.SKIN.heat .at-set { color:#ff8a3d; } .SKIN.cool .at-set { color:#38bdf8; }` },
]},

/* ================================================================== LIGHTS */
{ pack: 'advance-tools-pack', format: 1, name: 'Lights', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'light-slider', name: 'Dimmer slider', category: 'General · Lights',
    for: 'light', size: [260, 110], card: true, html: `
      <div class="row"><span class="at-ico at-main">{{icon}}</span>
      <span class="at-name">{{name}}</span><span class="at-val at-end"></span></div>
      <input class="at-bri" type="range" min="0" max="100" value="0">`, css: `
.SKIN { justify-content:center; gap:12px; }
.SKIN .row { display:flex; align-items:center; gap:10px; }
.SKIN .row .at-name { margin:0; font-size:14px; color:inherit; }
.SKIN .row .at-val { margin:0 0 0 auto; font-size:13px; color:var(--mut); }
.SKIN .at-main { cursor:pointer; font-size:22px; }
.SKIN .at-bri { -webkit-appearance:none; appearance:none; width:100%; height:26px;
  border-radius:14px; background:linear-gradient(90deg, var(--accent)
  calc(var(--pct,0) * 1%), rgba(255,255,255,.12) 0); outline:none; cursor:pointer; }
.SKIN .at-bri::-webkit-slider-thumb { -webkit-appearance:none; width:22px;
  height:22px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }
.SKIN:not(.on) .at-bri { background:rgba(255,255,255,.1); }` },

  { kind: 'skin', id: 'bulb-glow', name: 'Glowing bulb', category: 'General · Lights',
    for: 'light', size: [150, 180], html: `
      <div class="bulb at-main">💡</div>
      <input class="at-bri" type="range" min="0" max="100" value="0">
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; }
.SKIN .bulb { font-size:52px; filter:grayscale(1) brightness(.55); cursor:pointer;
  transition:.3s; }
.SKIN.on .bulb { filter:none;
  text-shadow:0 0 calc(6px + var(--pct,0) * .4px) var(--accent); }
.SKIN .at-bri { -webkit-appearance:none; appearance:none; width:80%; height:8px;
  border-radius:5px; background:linear-gradient(90deg, var(--accent)
  calc(var(--pct,0) * 1%), rgba(255,255,255,.14) 0); outline:none; cursor:pointer; }
.SKIN .at-bri::-webkit-slider-thumb { -webkit-appearance:none; width:18px;
  height:18px; border-radius:50%; background:#fff; }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'rgb-card', name: 'RGB card', category: 'General · RGB Lights',
    for: 'light', size: [260, 210], card: true, html: `
      <div class="top"><span class="at-ico at-main">💡</span>
        <span class="at-name">{{name}}</span>
        <span class="at-val at-end"></span></div>
      <div class="swatches">
        <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
        <button class="at-swatch" data-rgb="255,150,40" style="background:#ff9628"></button>
        <button class="at-swatch" data-rgb="255,230,90" style="background:#ffe65a"></button>
        <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
        <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
        <button class="at-swatch" data-rgb="150,80,255" style="background:#9650ff"></button>
        <button class="at-swatch" data-rgb="255,120,220" style="background:#ff78dc"></button>
        <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
      </div>
      <input class="at-hue" type="range" min="0" max="360" value="0">
      <input class="at-bri" type="range" min="0" max="100" value="0">`, css: `
.SKIN { justify-content:center; gap:11px; }
.SKIN .top { display:flex; align-items:center; gap:8px; }
.SKIN .top .at-main { cursor:pointer; font-size:22px; }
.SKIN .top .at-name { margin:0; font-size:14px; color:inherit; }
.SKIN .top .at-val { margin:0 0 0 auto; font-size:13px; color:var(--mut); }
.SKIN .swatches { display:flex; gap:6px; }
.SKIN .swatch, .SKIN .at-swatch { flex:1; height:26px; border-radius:7px; border:0;
  cursor:pointer; box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); transition:transform .1s; }
.SKIN .at-swatch:active { transform:scale(.9); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .at-hue { -webkit-appearance:none; appearance:none; width:100%; height:16px;
  border-radius:8px; cursor:pointer; outline:none;
  background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-hue::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px;
  border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.5); }
.SKIN .at-bri { -webkit-appearance:none; appearance:none; width:100%; height:16px;
  border-radius:8px; outline:none; cursor:pointer;
  background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-bri::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px;
  border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.5); }
.SKIN:not(.on) .at-bri { background:rgba(255,255,255,.1); }` },

  { kind: 'skin', id: 'rgb-orb', name: 'RGB orb', category: 'General · RGB Lights',
    for: 'light', size: [180, 220], html: `
      <div class="orb at-main"></div>
      <div class="swatches">
        <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
        <button class="at-swatch" data-rgb="255,180,40" style="background:#ffb428"></button>
        <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
        <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
        <button class="at-swatch" data-rgb="180,90,255" style="background:#b45aff"></button>
        <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
      </div>
      <input class="at-bri" type="range" min="0" max="100" value="0">
      <div class="at-name">{{name}}</div>`, css: `
.SKIN { display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:10px; }
.SKIN .orb { width:66px; height:66px; border-radius:50%; cursor:pointer;
  background:radial-gradient(circle at 34% 30%, #3a4150, #1c212c 72%);
  transition:.3s; }
.SKIN.on .orb { background:radial-gradient(circle at 34% 30%,
  color-mix(in srgb, var(--accent) 75%, #fff), var(--accent) 72%);
  box-shadow:0 0 calc(10px + var(--pct,0) * .5px) var(--accent); }
.SKIN .swatches { display:flex; gap:5px; }
.SKIN .at-swatch { width:20px; height:20px; border-radius:50%; border:0;
  cursor:pointer; box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.85); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .at-bri { -webkit-appearance:none; appearance:none; width:82%; height:8px;
  border-radius:5px; outline:none; cursor:pointer;
  background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.14) 0); }
.SKIN .at-bri::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px;
  border-radius:50%; background:#fff; }
.SKIN .at-name { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'rgb-strip', name: 'RGB strip', category: 'General · RGB Lights',
    for: 'light', size: [280, 150], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-ico at-main at-end">💡</span></div>
      <div class="strip"></div>
      <input class="at-hue" type="range" min="0" max="360" value="0">
      <input class="at-bri" type="range" min="0" max="100" value="0">`, css: `
.SKIN { justify-content:center; gap:10px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; }
.SKIN .top .at-main { cursor:pointer; font-size:20px; }
.SKIN .strip { height:14px; border-radius:7px; background:var(--accent,#444);
  box-shadow:0 0 calc(4px + var(--pct,0) * .3px) var(--accent);
  transition:background .3s, box-shadow .3s; }
.SKIN:not(.on) .strip { background:rgba(255,255,255,.12); box-shadow:none; }
.SKIN .at-hue { -webkit-appearance:none; appearance:none; width:100%; height:16px;
  border-radius:8px; cursor:pointer; outline:none;
  background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-hue::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px;
  border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.5); }
.SKIN .at-bri { -webkit-appearance:none; appearance:none; width:100%; height:16px;
  border-radius:8px; outline:none; cursor:pointer;
  background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-bri::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px;
  border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.5); }
.SKIN:not(.on) .at-bri { background:rgba(255,255,255,.1); }` },

  /* ---- expandable RGB cards: power toggle + drop-down settings drawer ---- */
  { kind: 'skin', id: 'rgb-expand', name: 'RGB card (expand)', category: 'General · RGB Lights',
    for: 'light', size: [270, 80], card: true, html: `
      <div class="hdr">
        <span class="at-ico ic">💡</span>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val st"></span></div>
        <button class="at-power sw"><span></span></button>
        <button class="at-expand chev">▾</button>
      </div>
      <div class="drawer">
        <div class="swatches">
          <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
          <button class="at-swatch" data-rgb="255,150,40" style="background:#ff9628"></button>
          <button class="at-swatch" data-rgb="255,230,90" style="background:#ffe65a"></button>
          <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
          <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
          <button class="at-swatch" data-rgb="150,80,255" style="background:#9650ff"></button>
          <button class="at-swatch" data-rgb="255,120,220" style="background:#ff78dc"></button>
          <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
        </div>
        <div class="ctl"><span class="ci">🌈</span>
          <input class="at-hue" type="range" min="0" max="360" value="0"></div>
        <div class="ctl"><span class="ci">☀️</span>
          <input class="at-bri" type="range" min="0" max="100" value="0"></div>
      </div>`, css: `
.SKIN { overflow:visible; justify-content:center; padding:14px; }
.SKIN .hdr { display:flex; align-items:center; gap:11px; }
.SKIN .ic { font-size:24px; }
.SKIN:not(.on) .ic { filter:grayscale(1) brightness(.6); }
.SKIN .lbl { display:flex; flex-direction:column; min-width:0; }
.SKIN .at-name { margin:0; font-size:14px; color:inherit; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.SKIN .st { font-size:11px; color:var(--mut); }
.SKIN .sw { margin-left:auto; width:46px; height:27px; border-radius:14px; border:0;
  background:rgba(255,255,255,.18); position:relative; cursor:pointer; padding:0;
  flex:0 0 auto; transition:background .25s; }
.SKIN .sw span { position:absolute; top:3px; left:3px; width:21px; height:21px;
  border-radius:50%; background:#fff; transition:transform .25s cubic-bezier(.3,1.4,.6,1); }
.SKIN.on .sw { background:var(--accent); } .SKIN.on .sw span { transform:translateX(19px); }
.SKIN .chev { border:0; background:none; color:var(--mut); font-size:15px; cursor:pointer;
  transition:transform .25s; flex:0 0 auto; }
.SKIN.expanded .chev { transform:rotate(180deg); }
.SKIN .drawer { position:absolute; left:0; right:0; top:calc(100% + 6px);
  background:var(--card); border:1px solid rgba(255,255,255,.12); border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.55); padding:14px; display:flex;
  flex-direction:column; gap:12px; z-index:30; opacity:0; transform:translateY(-8px);
  pointer-events:none; transition:.22s; }
.SKIN.expanded .drawer { opacity:1; transform:none; pointer-events:auto; }
.SKIN .swatches { display:flex; gap:6px; }
.SKIN .at-swatch { flex:1; height:26px; border-radius:7px; border:0; cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.9); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .ctl { display:flex; align-items:center; gap:10px; }
.SKIN .ctl .ci { font-size:15px; flex:0 0 auto; }
.SKIN .at-hue, .SKIN .at-bri { flex:1; -webkit-appearance:none; appearance:none;
  height:14px; border-radius:7px; outline:none; cursor:pointer; }
.SKIN .at-hue { background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-bri { background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-hue::-webkit-slider-thumb, .SKIN .at-bri::-webkit-slider-thumb {
  -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }` },

  { kind: 'skin', id: 'rgb-expand-glow', name: 'RGB glow (expand)', category: 'General · RGB Lights',
    for: 'light', size: [270, 88], card: true, html: `
      <div class="hdr">
        <button class="at-power orb"></button>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val st"></span></div>
        <button class="at-expand chev">⌄</button>
      </div>
      <div class="drawer">
        <div class="swatches">
          <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
          <button class="at-swatch" data-rgb="255,180,40" style="background:#ffb428"></button>
          <button class="at-swatch" data-rgb="255,235,120" style="background:#ffeb78"></button>
          <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
          <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
          <button class="at-swatch" data-rgb="180,90,255" style="background:#b45aff"></button>
          <button class="at-swatch" data-rgb="255,120,220" style="background:#ff78dc"></button>
          <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
        </div>
        <div class="ctl"><span class="ci">🎨</span>
          <input class="at-hue" type="range" min="0" max="360" value="0"></div>
        <div class="ctl"><span class="ci">🔆</span>
          <input class="at-bri" type="range" min="0" max="100" value="0"></div>
      </div>`, css: `
.SKIN { overflow:visible; justify-content:center; padding:14px; }
.SKIN .hdr { display:flex; align-items:center; gap:12px; }
.SKIN .orb { width:40px; height:40px; border-radius:50%; border:0; cursor:pointer;
  flex:0 0 auto; background:radial-gradient(circle at 34% 30%, #3a4150, #1c212c 72%);
  transition:.3s; }
.SKIN.on .orb { background:radial-gradient(circle at 34% 30%,
  color-mix(in srgb, var(--accent) 78%, #fff), var(--accent) 72%);
  box-shadow:0 0 calc(8px + var(--pct,0) * .35px) var(--accent); }
.SKIN .lbl { display:flex; flex-direction:column; min-width:0; }
.SKIN .at-name { margin:0; font-size:14px; color:inherit; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.SKIN .st { font-size:11px; color:var(--mut); }
.SKIN .chev { margin-left:auto; border:0; background:rgba(255,255,255,.08);
  color:var(--mut); font-size:16px; cursor:pointer; width:32px; height:32px;
  border-radius:50%; transition:transform .25s; flex:0 0 auto; }
.SKIN.expanded .chev { transform:rotate(180deg); }
.SKIN .drawer { position:absolute; left:0; right:0; top:calc(100% + 6px);
  background:var(--card); border:1px solid rgba(255,255,255,.12); border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.55); padding:14px; display:flex;
  flex-direction:column; gap:12px; z-index:30; opacity:0; transform:translateY(-8px);
  pointer-events:none; transition:.22s; }
.SKIN.expanded .drawer { opacity:1; transform:none; pointer-events:auto; }
.SKIN .swatches { display:flex; gap:6px; justify-content:space-between; }
.SKIN .at-swatch { width:26px; height:26px; border-radius:50%; border:0; cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.85); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:2px; }
.SKIN .ctl { display:flex; align-items:center; gap:10px; }
.SKIN .ctl .ci { font-size:15px; flex:0 0 auto; }
.SKIN .at-hue, .SKIN .at-bri { flex:1; -webkit-appearance:none; appearance:none;
  height:14px; border-radius:7px; outline:none; cursor:pointer; }
.SKIN .at-hue { background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-bri { background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-hue::-webkit-slider-thumb, .SKIN .at-bri::-webkit-slider-thumb {
  -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }` },

  { kind: 'skin', id: 'rgb-expand-pro', name: 'RGB pro (expand)', category: 'General · RGB Lights',
    for: 'light', size: [280, 82], card: true, html: `
      <div class="hdr">
        <span class="at-ico ic">🌈</span>
        <span class="at-name">{{name}}</span>
        <span class="at-val st at-end"></span>
        <button class="at-power pw">⏻</button>
        <button class="at-expand chev">▾</button>
      </div>
      <div class="drawer">
        <div class="sect">Colours</div>
        <div class="swatches">
          <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
          <button class="at-swatch" data-rgb="255,110,40" style="background:#ff6e28"></button>
          <button class="at-swatch" data-rgb="255,180,40" style="background:#ffb428"></button>
          <button class="at-swatch" data-rgb="255,235,120" style="background:#ffeb78"></button>
          <button class="at-swatch" data-rgb="120,230,90" style="background:#78e65a"></button>
          <button class="at-swatch" data-rgb="40,200,160" style="background:#28c8a0"></button>
          <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
          <button class="at-swatch" data-rgb="110,90,255" style="background:#6e5aff"></button>
          <button class="at-swatch" data-rgb="200,80,255" style="background:#c850ff"></button>
          <button class="at-swatch" data-rgb="255,120,200" style="background:#ff78c8"></button>
          <button class="at-swatch" data-rgb="255,200,150" style="background:#ffc896"></button>
          <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
        </div>
        <div class="sect">Any colour</div>
        <div class="ctl"><input class="at-hue" type="range" min="0" max="360" value="0"></div>
        <div class="sect">Brightness</div>
        <div class="ctl"><input class="at-bri" type="range" min="0" max="100" value="0"></div>
      </div>`, css: `
.SKIN { overflow:visible; justify-content:center; padding:14px 16px; }
.SKIN .hdr { display:flex; align-items:center; gap:10px; }
.SKIN .ic { font-size:20px; }
.SKIN .at-name { margin:0; font-size:14px; }
.SKIN .st { font-size:11px; color:var(--mut); margin-left:auto; }
.SKIN .pw { width:34px; height:34px; border-radius:50%; border:0; cursor:pointer;
  flex:0 0 auto; background:rgba(255,255,255,.1); color:var(--mut); font-size:15px;
  transition:.25s; }
.SKIN.on .pw { background:var(--accent); color:#fff; box-shadow:0 0 12px var(--accent); }
.SKIN .chev { border:0; background:none; color:var(--mut); font-size:15px; cursor:pointer;
  flex:0 0 auto; transition:transform .25s; }
.SKIN.expanded .chev { transform:rotate(180deg); }
.SKIN .drawer { position:absolute; left:0; right:0; top:calc(100% + 6px);
  background:var(--card); border:1px solid rgba(255,255,255,.12); border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.55); padding:14px 16px; display:flex;
  flex-direction:column; gap:8px; z-index:30; opacity:0; transform:translateY(-8px);
  pointer-events:none; transition:.22s; }
.SKIN.expanded .drawer { opacity:1; transform:none; pointer-events:auto; }
.SKIN .sect { font-size:10px; color:var(--mut); text-transform:uppercase;
  letter-spacing:.08em; margin-top:4px; }
.SKIN .swatches { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; }
.SKIN .at-swatch { aspect-ratio:1; border-radius:8px; border:0; cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.88); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .ctl { display:flex; }
.SKIN .at-hue, .SKIN .at-bri { flex:1; -webkit-appearance:none; appearance:none;
  height:16px; border-radius:8px; outline:none; cursor:pointer; }
.SKIN .at-hue { background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-bri { background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-hue::-webkit-slider-thumb, .SKIN .at-bri::-webkit-slider-thumb {
  -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }` },

  /* ---- expandable RGB cards with animated / graphical power buttons ---- */
  { kind: 'skin', id: 'rgb-neon', name: 'RGB neon (expand)', category: 'General · RGB Lights',
    for: 'light', size: [270, 96], card: true, html: `
      <div class="hdr">
        <button class="at-power neon"><span class="pw">⏻</span></button>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val st"></span></div>
        <button class="at-expand chev">▾</button>
      </div>
      <div class="drawer">
        <div class="swatches">
          <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
          <button class="at-swatch" data-rgb="255,150,40" style="background:#ff9628"></button>
          <button class="at-swatch" data-rgb="255,230,90" style="background:#ffe65a"></button>
          <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
          <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
          <button class="at-swatch" data-rgb="150,80,255" style="background:#9650ff"></button>
          <button class="at-swatch" data-rgb="255,120,220" style="background:#ff78dc"></button>
          <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
        </div>
        <div class="ctl"><span class="ci">🌈</span>
          <input class="at-hue" type="range" min="0" max="360" value="0"></div>
        <div class="ctl"><span class="ci">☀️</span>
          <input class="at-bri" type="range" min="0" max="100" value="0"></div>
      </div>`, css: `
.SKIN { overflow:visible; justify-content:center; padding:14px; }
.SKIN .hdr { display:flex; align-items:center; gap:12px; }
.SKIN .neon { width:46px; height:46px; border-radius:50%; flex:0 0 auto; cursor:pointer;
  background:#0c1017; border:2px solid rgba(255,255,255,.14); color:#5b6784;
  font-size:18px; display:flex; align-items:center; justify-content:center;
  transition:.25s; }
.SKIN .neon:active { transform:scale(.92); }
.SKIN.on .neon { color:#fff; border-color:var(--accent);
  box-shadow:0 0 16px var(--accent), inset 0 0 14px
  color-mix(in srgb, var(--accent) 35%, transparent);
  animation:at-neonpulse 1.8s ease-in-out infinite; }
@keyframes at-neonpulse { 50% { box-shadow:0 0 26px var(--accent), inset 0 0 20px
  color-mix(in srgb, var(--accent) 45%, transparent); } }
.SKIN .lbl { display:flex; flex-direction:column; min-width:0; }
.SKIN .at-name { margin:0; font-size:14px; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.SKIN .st { font-size:11px; color:var(--mut); }
.SKIN .chev { margin-left:auto; border:0; background:none; color:var(--mut);
  font-size:15px; cursor:pointer; flex:0 0 auto; transition:transform .25s; }
.SKIN.expanded .chev { transform:rotate(180deg); }
.SKIN .drawer { position:absolute; left:0; right:0; top:calc(100% + 6px);
  background:var(--card); border:1px solid rgba(255,255,255,.12); border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.55); padding:14px; display:flex;
  flex-direction:column; gap:12px; z-index:30; opacity:0; transform:translateY(-8px);
  pointer-events:none; transition:.22s; }
.SKIN.expanded .drawer { opacity:1; transform:none; pointer-events:auto; }
.SKIN .swatches { display:flex; gap:6px; }
.SKIN .at-swatch { flex:1; height:26px; border-radius:7px; border:0; cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.9); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .ctl { display:flex; align-items:center; gap:10px; }
.SKIN .ctl .ci { font-size:15px; flex:0 0 auto; }
.SKIN .at-hue, .SKIN .at-bri { flex:1; -webkit-appearance:none; appearance:none;
  height:14px; border-radius:7px; outline:none; cursor:pointer; }
.SKIN .at-hue { background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-bri { background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-hue::-webkit-slider-thumb, .SKIN .at-bri::-webkit-slider-thumb {
  -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }` },

  { kind: 'skin', id: 'rgb-3d', name: 'RGB 3D button (expand)', category: 'General · RGB Lights',
    for: 'light', size: [270, 96], card: true, html: `
      <div class="hdr">
        <button class="at-power btn3d"><span>⏻</span></button>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val st"></span></div>
        <button class="at-expand chev">▾</button>
      </div>
      <div class="drawer">
        <div class="swatches">
          <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
          <button class="at-swatch" data-rgb="255,150,40" style="background:#ff9628"></button>
          <button class="at-swatch" data-rgb="255,230,90" style="background:#ffe65a"></button>
          <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
          <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
          <button class="at-swatch" data-rgb="150,80,255" style="background:#9650ff"></button>
          <button class="at-swatch" data-rgb="255,120,220" style="background:#ff78dc"></button>
          <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
        </div>
        <div class="ctl"><span class="ci">🎨</span>
          <input class="at-hue" type="range" min="0" max="360" value="0"></div>
        <div class="ctl"><span class="ci">🔆</span>
          <input class="at-bri" type="range" min="0" max="100" value="0"></div>
      </div>`, css: `
.SKIN { overflow:visible; justify-content:center; padding:14px; }
.SKIN .hdr { display:flex; align-items:center; gap:13px; }
.SKIN .btn3d { width:48px; height:48px; border-radius:50%; border:0; flex:0 0 auto;
  cursor:pointer; color:#aeb6c4; font-size:19px;
  background:radial-gradient(circle at 34% 30%, #39414f, #20262f 72%);
  box-shadow:0 6px 0 #12161d, 0 8px 12px rgba(0,0,0,.5),
    inset 0 1px 2px rgba(255,255,255,.18);
  transition:transform .08s, box-shadow .12s, color .2s; }
.SKIN .btn3d:active { transform:translateY(5px);
  box-shadow:0 1px 0 #12161d, 0 2px 6px rgba(0,0,0,.5),
    inset 0 1px 2px rgba(255,255,255,.12); }
.SKIN.on .btn3d { color:#fff;
  background:radial-gradient(circle at 34% 30%,
    color-mix(in srgb, var(--accent) 60%, #39414f), #20262f 74%);
  box-shadow:0 6px 0 color-mix(in srgb, var(--accent) 45%, #000),
    0 0 22px var(--accent), inset 0 1px 2px rgba(255,255,255,.2); }
.SKIN .lbl { display:flex; flex-direction:column; min-width:0; }
.SKIN .at-name { margin:0; font-size:14px; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.SKIN .st { font-size:11px; color:var(--mut); }
.SKIN .chev { margin-left:auto; border:0; background:none; color:var(--mut);
  font-size:15px; cursor:pointer; flex:0 0 auto; transition:transform .25s; }
.SKIN.expanded .chev { transform:rotate(180deg); }
.SKIN .drawer { position:absolute; left:0; right:0; top:calc(100% + 6px);
  background:var(--card); border:1px solid rgba(255,255,255,.12); border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.55); padding:14px; display:flex;
  flex-direction:column; gap:12px; z-index:30; opacity:0; transform:translateY(-8px);
  pointer-events:none; transition:.22s; }
.SKIN.expanded .drawer { opacity:1; transform:none; pointer-events:auto; }
.SKIN .swatches { display:flex; gap:6px; }
.SKIN .at-swatch { flex:1; height:26px; border-radius:7px; border:0; cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.9); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .ctl { display:flex; align-items:center; gap:10px; }
.SKIN .ctl .ci { font-size:15px; flex:0 0 auto; }
.SKIN .at-hue, .SKIN .at-bri { flex:1; -webkit-appearance:none; appearance:none;
  height:14px; border-radius:7px; outline:none; cursor:pointer; }
.SKIN .at-hue { background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-bri { background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-hue::-webkit-slider-thumb, .SKIN .at-bri::-webkit-slider-thumb {
  -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }` },

  { kind: 'skin', id: 'rgb-slide', name: 'RGB slide power (expand)', category: 'General · RGB Lights',
    for: 'light', size: [280, 98], card: true, html: `
      <div class="hdr">
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val st"></span></div>
        <button class="at-expand chev">▾</button>
      </div>
      <button class="at-power slide"><span class="knob">⏻</span>
        <span class="txt on-t">ON</span><span class="txt off-t">OFF</span></button>
      <div class="drawer">
        <div class="swatches">
          <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
          <button class="at-swatch" data-rgb="255,150,40" style="background:#ff9628"></button>
          <button class="at-swatch" data-rgb="255,230,90" style="background:#ffe65a"></button>
          <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
          <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
          <button class="at-swatch" data-rgb="150,80,255" style="background:#9650ff"></button>
          <button class="at-swatch" data-rgb="255,120,220" style="background:#ff78dc"></button>
          <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
        </div>
        <div class="ctl"><span class="ci">🌈</span>
          <input class="at-hue" type="range" min="0" max="360" value="0"></div>
        <div class="ctl"><span class="ci">☀️</span>
          <input class="at-bri" type="range" min="0" max="100" value="0"></div>
      </div>`, css: `
.SKIN { overflow:visible; justify-content:center; gap:10px; padding:14px; }
.SKIN .hdr { display:flex; align-items:center; }
.SKIN .lbl { display:flex; flex-direction:column; min-width:0; }
.SKIN .at-name { margin:0; font-size:14px; }
.SKIN .st { font-size:11px; color:var(--mut); }
.SKIN .chev { margin-left:auto; border:0; background:none; color:var(--mut);
  font-size:15px; cursor:pointer; transition:transform .25s; }
.SKIN.expanded .chev { transform:rotate(180deg); }
.SKIN .slide { position:relative; width:100%; height:38px; border-radius:19px; border:0;
  cursor:pointer; background:rgba(255,255,255,.1); overflow:hidden; padding:0;
  transition:background .3s; }
.SKIN.on .slide { background:color-mix(in srgb, var(--accent) 55%, transparent); }
.SKIN .knob { position:absolute; top:3px; left:3px; width:32px; height:32px;
  border-radius:50%; background:#fff; color:#333; display:flex; align-items:center;
  justify-content:center; font-size:15px;
  transition:transform .3s cubic-bezier(.3,1.3,.6,1); box-shadow:0 1px 4px rgba(0,0,0,.4); }
.SKIN.on .knob { transform:translateX(calc(100% + 100%)); color:var(--accent); }
.SKIN .txt { position:absolute; top:50%; transform:translateY(-50%); font-size:12px;
  font-weight:700; letter-spacing:.1em; color:#fff; opacity:0; transition:.3s; }
.SKIN .on-t { left:16px; } .SKIN .off-t { right:16px; color:var(--mut); }
.SKIN.on .on-t { opacity:1; } .SKIN:not(.on) .off-t { opacity:1; }
.SKIN .drawer { position:absolute; left:0; right:0; top:calc(100% + 6px);
  background:var(--card); border:1px solid rgba(255,255,255,.12); border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.55); padding:14px; display:flex;
  flex-direction:column; gap:12px; z-index:30; opacity:0; transform:translateY(-8px);
  pointer-events:none; transition:.22s; }
.SKIN.expanded .drawer { opacity:1; transform:none; pointer-events:auto; }
.SKIN .swatches { display:flex; gap:6px; }
.SKIN .at-swatch { flex:1; height:26px; border-radius:7px; border:0; cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.9); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .ctl { display:flex; align-items:center; gap:10px; }
.SKIN .ctl .ci { font-size:15px; flex:0 0 auto; }
.SKIN .at-hue, .SKIN .at-bri { flex:1; -webkit-appearance:none; appearance:none;
  height:14px; border-radius:7px; outline:none; cursor:pointer; }
.SKIN .at-hue { background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-bri { background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-hue::-webkit-slider-thumb, .SKIN .at-bri::-webkit-slider-thumb {
  -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }` },

  { kind: 'skin', id: 'rgb-bulb', name: 'RGB bulb (expand)', category: 'General · RGB Lights',
    for: 'light', size: [270, 100], card: true, html: `
      <div class="hdr">
        <button class="at-power bulbbtn"><span class="rays"></span><span class="b">💡</span></button>
        <div class="lbl"><span class="at-name">{{name}}</span>
          <span class="at-val st"></span></div>
        <button class="at-expand chev">▾</button>
      </div>
      <div class="drawer">
        <div class="swatches">
          <button class="at-swatch" data-rgb="255,60,60" style="background:#ff3c3c"></button>
          <button class="at-swatch" data-rgb="255,150,40" style="background:#ff9628"></button>
          <button class="at-swatch" data-rgb="255,230,90" style="background:#ffe65a"></button>
          <button class="at-swatch" data-rgb="70,220,90" style="background:#46dc5a"></button>
          <button class="at-swatch" data-rgb="60,150,255" style="background:#3c96ff"></button>
          <button class="at-swatch" data-rgb="150,80,255" style="background:#9650ff"></button>
          <button class="at-swatch" data-rgb="255,120,220" style="background:#ff78dc"></button>
          <button class="at-swatch" data-rgb="255,255,255" style="background:#fff"></button>
        </div>
        <div class="ctl"><span class="ci">🎨</span>
          <input class="at-hue" type="range" min="0" max="360" value="0"></div>
        <div class="ctl"><span class="ci">🔆</span>
          <input class="at-bri" type="range" min="0" max="100" value="0"></div>
      </div>`, css: `
.SKIN { overflow:visible; justify-content:center; padding:14px; }
.SKIN .hdr { display:flex; align-items:center; gap:12px; }
.SKIN .bulbbtn { position:relative; width:48px; height:48px; border:0;
  background:none; cursor:pointer; flex:0 0 auto; }
.SKIN .bulbbtn .b { font-size:30px; filter:grayscale(1) brightness(.55);
  transition:.3s; display:inline-block; }
.SKIN.on .bulbbtn .b { filter:none;
  text-shadow:0 0 calc(8px + var(--pct,0) * .3px) var(--accent);
  animation:at-bulbin .4s ease; }
@keyframes at-bulbin { 0% { transform:scale(.7); } 60% { transform:scale(1.15); } }
.SKIN .bulbbtn .rays { position:absolute; inset:-6px; border-radius:50%; opacity:0;
  background:radial-gradient(circle, color-mix(in srgb, var(--accent) 45%, transparent)
  0%, transparent 60%); transition:opacity .3s; }
.SKIN.on .bulbbtn .rays { opacity:1; animation:at-rays 2s ease-in-out infinite; }
@keyframes at-rays { 50% { transform:scale(1.18); opacity:.6; } }
.SKIN .lbl { display:flex; flex-direction:column; min-width:0; }
.SKIN .at-name { margin:0; font-size:14px; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.SKIN .st { font-size:11px; color:var(--mut); }
.SKIN .chev { margin-left:auto; border:0; background:none; color:var(--mut);
  font-size:15px; cursor:pointer; flex:0 0 auto; transition:transform .25s; }
.SKIN.expanded .chev { transform:rotate(180deg); }
.SKIN .drawer { position:absolute; left:0; right:0; top:calc(100% + 6px);
  background:var(--card); border:1px solid rgba(255,255,255,.12); border-radius:16px;
  box-shadow:0 14px 34px rgba(0,0,0,.55); padding:14px; display:flex;
  flex-direction:column; gap:12px; z-index:30; opacity:0; transform:translateY(-8px);
  pointer-events:none; transition:.22s; }
.SKIN.expanded .drawer { opacity:1; transform:none; pointer-events:auto; }
.SKIN .swatches { display:flex; gap:6px; }
.SKIN .at-swatch { flex:1; height:26px; border-radius:7px; border:0; cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25); }
.SKIN .at-swatch:active { transform:scale(.9); }
.SKIN .at-swatch.active { outline:2px solid #fff; outline-offset:1px; }
.SKIN .ctl { display:flex; align-items:center; gap:10px; }
.SKIN .ctl .ci { font-size:15px; flex:0 0 auto; }
.SKIN .at-hue, .SKIN .at-bri { flex:1; -webkit-appearance:none; appearance:none;
  height:14px; border-radius:7px; outline:none; cursor:pointer; }
.SKIN .at-hue { background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.SKIN .at-bri { background:linear-gradient(90deg, var(--accent) calc(var(--pct,0) * 1%),
  rgba(255,255,255,.12) 0); }
.SKIN .at-hue::-webkit-slider-thumb, .SKIN .at-bri::-webkit-slider-thumb {
  -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5); }` },
]},

/* ================================================================= DEVICES */
{ pack: 'advance-tools-pack', format: 1, name: 'Devices', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'vacuum-bot', name: 'Robot vacuum', category: 'Robot Vacuum',
    for: 'vacuum', size: [240, 220], card: true, html: `
      <div class="bot"><div class="lidar"></div><div class="eyes">🤖</div></div>
      <div class="at-name">{{name}}</div>
      <div class="stat"><span class="at-val">{{val}}</span>
      <span class="at-bat at-end"></span></div>
      <div class="row"><button class="at-start">▶</button>
      <button class="at-pause">⏸</button><button class="at-dock">🏠</button></div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .bot { width:74px; height:74px; border-radius:50%; position:relative;
  background:radial-gradient(circle at 34% 28%, #3a4150, #1c212c 72%);
  box-shadow:0 5px 12px rgba(0,0,0,.5), inset 0 1px 2px rgba(255,255,255,.15);
  display:flex; align-items:center; justify-content:center; }
.SKIN .lidar { position:absolute; top:-6px; left:50%; transform:translateX(-50%);
  width:26px; height:12px; border-radius:6px; background:#0c0f16;
  box-shadow:0 0 6px rgba(0,0,0,.6); }
.SKIN .eyes { font-size:26px; }
.SKIN.cleaning .bot { animation:at-vac 1.2s ease-in-out infinite; }
@keyframes at-vac { 0%,100% { transform:translateX(-5px) rotate(-4deg); }
  50% { transform:translateX(5px) rotate(4deg); } }
.SKIN.cleaning .lidar { background:var(--accent); box-shadow:0 0 8px var(--accent); }
.SKIN .stat { display:flex; gap:10px; width:100%; padding:0 8px; }
.SKIN .stat .at-val { font-size:13px; margin:0; font-weight:400; color:var(--mut); }
.SKIN .stat .at-bat { margin-left:auto; font-size:13px; color:var(--mut); }
.SKIN .row { display:flex; gap:10px; }
.SKIN .row button { width:44px; height:38px; border-radius:10px; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:15px; cursor:pointer; }
.SKIN .row button:active { background:var(--accent); }` },

  { kind: 'skin', id: 'vacuum-map', name: 'Vacuum + live map', category: 'Robot Vacuum',
    for: 'vacuum', size: [320, 400], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-bat at-end"></span></div>
      <div class="mapbox">
        <img class="at-map" alt="map"/>
        <div class="at-mapph ph">🗺️<span>Map appears when the vacuum is online
          (set the map camera in this element's Map entity field)</span></div>
      </div>
      <div class="statline"><span class="at-val st">—</span>
        <span class="at-fan fan at-end"></span></div>
      <div class="ctrl">
        <button class="at-start" title="Start">▶</button>
        <button class="at-pause" title="Pause">⏸</button>
        <button class="at-dock" title="Dock">🏠</button>
        <button class="at-spot" title="Spot clean">🎯</button>
        <button class="at-fanspeed" title="Fan speed">🌀</button>
        <button class="at-locate" title="Locate">🔊</button>
      </div>`, css: `
.SKIN { gap:8px; padding:14px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; } .SKIN .top .at-bat { margin-left:auto;
  font-size:13px; color:var(--mut); }
.SKIN .mapbox { position:relative; width:100%; flex:1; min-height:0;
  border-radius:12px; overflow:hidden; background:#0d1220;
  border:1px solid rgba(255,255,255,.08); }
.SKIN .at-map { width:100%; height:100%; object-fit:contain; display:block; }
.SKIN .ph { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:8px; text-align:center;
  color:var(--mut); font-size:28px; padding:16px; }
.SKIN .ph span { font-size:11px; line-height:1.6; }
.SKIN .statline { display:flex; align-items:center; font-size:13px; }
.SKIN .st { text-transform:capitalize; }
.SKIN.cleaning .st { color:var(--accent); }
.SKIN .fan { margin-left:auto; color:var(--mut); }
.SKIN .ctrl { display:flex; gap:6px; }
.SKIN .ctrl button { flex:1; height:40px; border-radius:10px; border:0;
  background:rgba(255,255,255,.1); color:inherit; font-size:16px; cursor:pointer; }
.SKIN .ctrl button:active { background:var(--accent); }
.SKIN.cleaning .at-start { background:var(--accent); }` },

  { kind: 'skin', id: 'vacuum-pro', name: 'Vacuum full control', category: 'Robot Vacuum',
    for: 'vacuum', size: [260, 250], card: true, html: `
      <div class="top"><span class="at-name">{{name}}</span>
        <span class="at-bat at-end"></span></div>
      <div class="disc"><div class="ring"></div><div class="ico">🤖</div></div>
      <div class="statline"><span class="at-val st">—</span>
        <span class="at-fan fan at-end"></span></div>
      <div class="ctrl">
        <button class="at-start" title="Start">▶</button>
        <button class="at-pause" title="Pause">⏸</button>
        <button class="at-stop" title="Stop">⏹</button>
        <button class="at-dock" title="Dock">🏠</button>
      </div>
      <div class="ctrl">
        <button class="at-spot" title="Spot clean">🎯 Spot</button>
        <button class="at-fanspeed" title="Fan speed">🌀 Fan</button>
        <button class="at-locate" title="Locate">🔊 Find</button>
      </div>`, css: `
.SKIN { gap:8px; padding:14px; }
.SKIN .top { display:flex; align-items:center; }
.SKIN .top .at-name { margin:0; } .SKIN .top .at-bat { margin-left:auto;
  font-size:13px; color:var(--mut); }
.SKIN .disc { position:relative; width:64px; height:64px; margin:2px auto;
  display:flex; align-items:center; justify-content:center; }
.SKIN .ring { position:absolute; inset:0; border-radius:50%;
  border:3px solid rgba(255,255,255,.14); }
.SKIN.cleaning .ring { border-top-color:var(--accent);
  animation:at-spin 1s linear infinite; }
@keyframes at-spin { to { transform:rotate(360deg); } }
.SKIN .ico { font-size:30px; }
.SKIN .statline { display:flex; align-items:center; font-size:13px; }
.SKIN .st { text-transform:capitalize; } .SKIN.cleaning .st { color:var(--accent); }
.SKIN .fan { margin-left:auto; color:var(--mut); }
.SKIN .ctrl { display:flex; gap:6px; }
.SKIN .ctrl button { flex:1; height:38px; border-radius:10px; border:0;
  background:rgba(255,255,255,.1); color:inherit; font-size:14px; cursor:pointer; }
.SKIN .ctrl button:active { background:var(--accent); }` },

  { kind: 'skin', id: 'cover-curtain', name: 'Curtain / blind', category: 'General · Covers',
    for: 'cover', size: [200, 220], card: true, html: `
      <div class="win"><div class="blind"></div></div>
      <div class="at-name">{{name}}</div>
      <div class="row"><button class="at-up">▲</button>
      <button class="at-stop">■</button><button class="at-down">▼</button></div>`, css: `
.SKIN { align-items:center; gap:8px; }
.SKIN .win { width:66%; height:46%; border:3px solid rgba(255,255,255,.25);
  border-radius:8px; overflow:hidden; position:relative;
  background:linear-gradient(#39506e,#22304a); }
.SKIN .blind { position:absolute; left:0; right:0; top:0; height:20%;
  background:repeating-linear-gradient(#c9ccd6 0 8px, #aab0bd 8px 10px);
  transition:height .8s; box-shadow:0 2px 6px rgba(0,0,0,.4); }
.SKIN.closed .blind { height:100%; }
.SKIN.opening .blind, .SKIN.closing .blind { height:55%; }
.SKIN .row { display:flex; gap:10px; }
.SKIN .row button { width:44px; height:36px; border-radius:10px; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:14px; cursor:pointer; }
.SKIN .row button:active { background:var(--accent); }` },

  { kind: 'skin', id: 'garage-sectional', name: 'Garage — sectional', category: 'General · Garage',
    for: 'cover', size: [220, 240], card: true, html: `
      <div class="house"><div class="frame">
        <div class="door"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="car">🚗</div></div></div>
      <div class="at-name">{{name}}</div>
      <div class="at-val sub">—</div>
      <div class="row"><button class="at-up">▲ Open</button>
      <button class="at-stop">■</button><button class="at-down">▼ Close</button></div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .house { width:74%; max-width:150px; }
.SKIN .frame { position:relative; width:100%; aspect-ratio:1.15;
  background:linear-gradient(#2a3242,#1a2130); border:3px solid #3a4456;
  border-radius:6px 6px 0 0; overflow:hidden; display:flex; align-items:flex-end;
  justify-content:center; }
.SKIN .car { font-size:34px; margin-bottom:6px; }
.SKIN .door { position:absolute; left:0; right:0; top:0; height:100%;
  display:flex; flex-direction:column; gap:3px; padding:3px;
  background:linear-gradient(#d5d9e2,#b7bdca);
  transition:transform .9s cubic-bezier(.4,0,.2,1); transform-origin:top; }
.SKIN .door i { flex:1; border-radius:3px;
  background:linear-gradient(#eef0f4,#c9cedb);
  box-shadow:inset 0 -2px 2px rgba(0,0,0,.15), inset 0 1px 1px #fff; }
.SKIN.open .door { transform:translateY(-100%); }
.SKIN.opening .door, .SKIN.closing .door { transform:translateY(-55%); }
.SKIN .sub { font-size:12px; color:var(--mut); text-transform:capitalize; }
.SKIN .row { display:flex; gap:8px; }
.SKIN .row button { padding:8px 10px; border-radius:9px; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:12px; cursor:pointer; }
.SKIN .row button:active { background:var(--accent); }` },

  { kind: 'skin', id: 'garage-roller', name: 'Garage — roller', category: 'General · Garage',
    for: 'cover', size: [220, 230], card: true, html: `
      <div class="frame"><div class="roll"></div><div class="grip"></div></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">—</div>
      <div class="row"><button class="at-up">▲</button>
      <button class="at-stop">■</button><button class="at-down">▼</button></div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .frame { width:74%; max-width:150px; aspect-ratio:1.1; position:relative;
  border:3px solid #3a4456; border-radius:6px; overflow:hidden;
  background:#161c28; }
.SKIN .roll { position:absolute; left:0; right:0; top:0; height:100%;
  background:repeating-linear-gradient(#c7ccd8 0 6px, #a7adbc 6px 8px);
  transition:height .9s cubic-bezier(.4,0,.2,1);
  box-shadow:0 3px 6px rgba(0,0,0,.4); }
.SKIN.open .roll { height:12%; }
.SKIN.opening .roll, .SKIN.closing .roll { height:56%; }
.SKIN .grip { position:absolute; left:20%; right:20%; bottom:6%; height:4px;
  border-radius:2px; background:rgba(0,0,0,.25); }
.SKIN .sub { font-size:12px; color:var(--mut); text-transform:capitalize; }
.SKIN .row { display:flex; gap:10px; }
.SKIN .row button { width:44px; height:36px; border-radius:10px; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:14px; cursor:pointer; }
.SKIN .row button:active { background:var(--accent); }` },

  { kind: 'skin', id: 'garage-tile', name: 'Garage — tap tile', category: 'General · Garage',
    for: 'cover', size: [180, 150], card: true, html: `
      <span class="at-ico ic">🚪</span>
      <div class="at-name">{{name}}</div>
      <div class="at-val sub">tap to toggle</div>`, css: `
.SKIN { align-items:center; text-align:center; cursor:pointer; transition:.2s; }
.SKIN .ic { font-size:38px; transition:.3s; }
.SKIN.open { outline:2px solid var(--accent);
  background:color-mix(in srgb, var(--accent) 15%, var(--card)); }
.SKIN.open .ic { transform:translateY(-4px); }
.SKIN.opening .ic, .SKIN.closing .ic { animation:at-gj .8s ease-in-out infinite; }
@keyframes at-gj { 50% { transform:translateY(-6px); } }
.SKIN .sub { font-size:12px; color:var(--mut); text-transform:capitalize; }` },

  { kind: 'skin', id: 'valve-wheel', name: 'Valve wheel', category: 'General · Valves',
    for: 'valve', size: [170, 190], card: true, html: `
      <div class="pipe"><div class="wheel">✳</div></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">{{val}}</div>`, css: `
.SKIN { align-items:center; gap:4px; }
.SKIN .pipe { width:80%; height:20px; border-radius:10px; position:relative;
  background:linear-gradient(#5b6472,#39404d); margin:26px 0 18px;
  box-shadow:inset 0 2px 3px rgba(255,255,255,.2); }
.SKIN .wheel { position:absolute; left:50%; top:50%;
  transform:translate(-50%,-50%) rotate(0deg); font-size:46px; line-height:1;
  color:#c33; transition:transform .8s, color .4s, text-shadow .4s; }
.SKIN.open .wheel { transform:translate(-50%,-50%) rotate(180deg);
  color:var(--accent); text-shadow:0 0 12px var(--accent); }
.SKIN .sub { font-size:12px; color:var(--mut); font-weight:400; }` },

  { kind: 'skin', id: 'valve-pipe', name: 'Flow pipe', category: 'General · Valves',
    for: 'valve', size: [220, 150], card: true, html: `
      <div class="pipe"><div class="flow"></div><div class="knob"></div></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">{{val}}</div>`, css: `
.SKIN { align-items:center; gap:8px; }
.SKIN .pipe { width:88%; height:30px; border-radius:15px; position:relative;
  overflow:hidden; margin:16px 0 8px;
  background:linear-gradient(#3a4150,#222a38);
  box-shadow:inset 0 2px 5px rgba(0,0,0,.6), inset 0 -1px 1px rgba(255,255,255,.08); }
.SKIN .flow { position:absolute; inset:4px; border-radius:11px; opacity:0;
  background:repeating-linear-gradient(110deg,
    #2ea8e6 0 12px, #38bdf8 12px 20px, #6fd0f5 20px 28px);
  background-size:44px 100%; transition:opacity .35s; }
.SKIN.open .flow { opacity:.92; animation:at-flow .8s linear infinite; }
@keyframes at-flow { to { background-position:44px 0; } }
.SKIN .knob { position:absolute; left:50%; top:-11px; width:14px; height:20px;
  transform:translateX(-50%) rotate(0deg); transform-origin:50% 90%;
  background:linear-gradient(#e2e6ee,#aeb6c4); border-radius:4px;
  transition:transform .4s; box-shadow:0 2px 4px rgba(0,0,0,.5); }
.SKIN.open .knob { transform:translateX(-50%) rotate(90deg); }
.SKIN .sub { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'valve-faucet', name: 'Faucet', category: 'General · Valves',
    for: 'valve', size: [170, 200], card: true, html: `
      <div class="tap"><div class="body"></div><div class="spout"></div>
        <div class="stream"></div><div class="drop"></div></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">{{val}}</div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .tap { position:relative; width:70%; height:56%; }
.SKIN .body { position:absolute; top:6%; left:22%; width:56%; height:20%;
  background:linear-gradient(#cfd4de,#9aa2b2); border-radius:8px 8px 4px 4px;
  box-shadow:0 2px 4px rgba(0,0,0,.4); }
.SKIN .spout { position:absolute; top:24%; left:46%; width:10%; height:30%;
  background:linear-gradient(#c3c9d4,#9aa2b2); border-radius:0 0 4px 4px; }
.SKIN .stream { position:absolute; top:54%; left:48%; width:6%; height:0;
  background:linear-gradient(#7fd4f7,#38bdf8); opacity:0; border-radius:3px;
  transition:opacity .2s; }
.SKIN.open .stream { height:42%; opacity:.9; animation:at-stream .5s linear infinite; }
@keyframes at-stream { 0%{filter:brightness(1)} 50%{filter:brightness(1.25)} 100%{filter:brightness(1)} }
.SKIN .drop { position:absolute; top:54%; left:48%; width:8%; aspect-ratio:1;
  background:#38bdf8; border-radius:50% 50% 50% 0;
  transform:translateX(-8%) rotate(45deg); opacity:0; }
.SKIN.open .drop { animation:at-drip 1s ease-in infinite; }
@keyframes at-drip { 0%{top:54%; opacity:0} 20%{opacity:.9} 100%{top:100%; opacity:0} }
.SKIN .sub { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'valve-ball', name: 'Ball valve', category: 'General · Valves',
    for: 'valve', size: [220, 160], card: true, html: `
      <div class="line"><div class="side l"><div class="flow"></div></div>
        <div class="ball"><div class="bore"></div></div>
        <div class="side r"><div class="flow"></div></div></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">{{val}}</div>`, css: `
.SKIN { align-items:center; gap:8px; }
.SKIN .line { display:flex; align-items:center; width:90%; margin:18px 0 8px; }
.SKIN .side { flex:1; height:20px; position:relative; overflow:hidden;
  background:linear-gradient(#3a4150,#222a38);
  box-shadow:inset 0 2px 4px rgba(0,0,0,.55); }
.SKIN .side.l { border-radius:10px 0 0 10px; }
.SKIN .side.r { border-radius:0 10px 10px 0; }
.SKIN .flow { position:absolute; inset:3px; opacity:0;
  background:repeating-linear-gradient(110deg,#2ea8e6 0 10px,#6fd0f5 10px 20px);
  background-size:34px 100%; transition:opacity .35s; }
.SKIN.open .flow { opacity:.9; animation:at-flow2 .7s linear infinite; }
@keyframes at-flow2 { to { background-position:34px 0; } }
.SKIN .ball { width:44px; height:44px; border-radius:50%; flex:0 0 auto;
  background:radial-gradient(circle at 34% 30%,#8892a6,#3a4250 72%);
  position:relative; box-shadow:0 3px 6px rgba(0,0,0,.5); z-index:1; }
.SKIN .bore { position:absolute; inset:0; margin:auto; width:100%; height:12px;
  top:50%; transform:translateY(-50%) rotate(90deg); transition:transform .5s;
  background:#161d2a; border-radius:6px; }
.SKIN.open .bore { transform:translateY(-50%) rotate(0deg);
  background:linear-gradient(90deg,#2ea8e6,#6fd0f5); }
.SKIN .sub { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'valve-tank', name: 'Water tank', category: 'General · Valves',
    for: 'valve', size: [160, 200], card: true, html: `
      <div class="tank"><div class="water"><div class="wave"></div></div></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">{{val}}</div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .tank { width:58%; height:56%; border:3px solid rgba(255,255,255,.3);
  border-radius:8px 8px 12px 12px; position:relative; overflow:hidden;
  background:rgba(255,255,255,.03); }
.SKIN .water { position:absolute; left:0; right:0; bottom:0; height:22%;
  background:linear-gradient(#38bdf8,#1573b8); transition:height .8s ease; }
.SKIN.open .water { height:82%; }
.SKIN .wave { position:absolute; top:-6px; left:0; right:0; height:12px;
  background:radial-gradient(circle at 10px -2px, transparent 6px, #38bdf8 6px)
    repeat-x; background-size:20px 12px; opacity:.8; }
.SKIN.open .wave { animation:at-wave 1.1s linear infinite; }
@keyframes at-wave { to { background-position:20px 0; } }
.SKIN .sub { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'valve-sprinkler', name: 'Sprinkler', category: 'General · Valves',
    for: 'valve', size: [190, 190], card: true, html: `
      <div class="spr"><div class="head"></div>
        <span class="d d1"></span><span class="d d2"></span>
        <span class="d d3"></span><span class="d d4"></span></div>
      <div class="at-name">{{name}}</div><div class="at-val sub">{{val}}</div>`, css: `
.SKIN { align-items:center; gap:6px; }
.SKIN .spr { position:relative; width:70%; height:52%; display:flex;
  align-items:flex-end; justify-content:center; }
.SKIN .head { width:26px; height:26px; border-radius:50% 50% 50% 50%/60% 60% 40% 40%;
  background:radial-gradient(circle at 34% 30%,#6b7488,#333b49);
  box-shadow:0 3px 6px rgba(0,0,0,.5); }
.SKIN .d { position:absolute; bottom:34%; left:50%; width:7px; height:7px;
  border-radius:50%; background:#38bdf8; opacity:0; }
.SKIN.open .d1 { animation:at-spray 1s ease-out infinite; }
.SKIN.open .d2 { animation:at-spray 1s ease-out .25s infinite; }
.SKIN.open .d3 { animation:at-spray 1s ease-out .5s infinite; }
.SKIN.open .d4 { animation:at-spray 1s ease-out .75s infinite; }
@keyframes at-spray { 0%{opacity:0;transform:translate(-50%,0) scale(.6)}
  20%{opacity:.95} 100%{opacity:0;
  transform:translate(calc(-50% + var(--x,40px)), -46px) scale(1)} }
.SKIN .d2 { --x:-40px; } .SKIN .d3 { --x:22px; } .SKIN .d4 { --x:-22px; }
.SKIN .sub { font-size:12px; color:var(--mut); }` },

  { kind: 'skin', id: 'media-mini', name: 'Media player', category: 'General · Media',
    for: 'media', size: [280, 130], card: true, html: `
      <div class="at-title mt">—</div><div class="at-name">{{name}}</div>
      <div class="row"><button class="at-prev">⏮</button>
      <button class="at-play">⏯</button><button class="at-next">⏭</button>
      <span class="sp"></span>
      <button class="at-vdn">🔉</button><button class="at-vup">🔊</button></div>`, css: `
.SKIN { justify-content:center; gap:6px; }
.SKIN .mt { font-size:15px; font-weight:600; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.SKIN.playing .mt { color:var(--accent); }
.SKIN .at-name { margin:0; }
.SKIN .row { display:flex; gap:8px; align-items:center; margin-top:4px; }
.SKIN .row .sp { flex:1; }
.SKIN .row button { width:38px; height:34px; border-radius:9px; border:0;
  background:rgba(255,255,255,.12); color:inherit; font-size:14px; cursor:pointer; }
.SKIN .row button:active { background:var(--accent); }` },
]},

/* ============================================================ BASIC CARDS */
{ pack: 'advance-tools-pack', format: 1, name: 'Basics', author: 'Advance Tools',
  version: '1.0.0', items: [

  { kind: 'skin', id: 'toggle-card', name: 'Toggle card', category: 'General · Basics',
    for: 'toggle', size: [200, 110], card: true, html: `
      <span class="at-ico">{{icon}}</span>
      <div class="at-name">{{name}}</div><div class="at-val"></div>`, css: `
.SKIN.on { outline:2px solid var(--accent); }` },

  { kind: 'skin', id: 'button-card', name: 'Action button', category: 'General · Basics',
    for: 'button', size: [180, 110], card: true, html: `
      <span class="at-ico">{{icon}}</span><div class="at-name">{{name}}</div>
      <div class="at-val sub">Tap to run</div>`, css: `
.SKIN .sub { font-size:13px; color:var(--mut); font-weight:400; }
.SKIN.on { outline:2px solid var(--accent); }` },

  { kind: 'skin', id: 'clock-card', name: 'Clock', category: 'General · Basics',
    for: 'clock', size: [250, 120], card: true, html: `
      <div class="at-val">{{val}}</div><div class="at-name"></div>`, css: `
.SKIN { align-items:center; text-align:center; }
.SKIN .at-val { font-size:2.4em; font-weight:700; }` },
]},

/* ============================================================== HOME LIFE */
{ pack: 'advance-tools-pack', format: 1, name: 'Home Life', author: 'Advance Tools',
  version: '1.0.0', items: [

  /* ---- Family Notes (fbnotes — polls /api/dash/family_board/board) ----
     Runtime hooks: .at-fbwrap (notes container, re-rendered every poll),
     .at-name. Injected note markup: .note[style=--nc/--rot] > .ntext + .nfoot
     (.nauthor .ntime .nre). Tap a note = fullscreen reply overlay. */
  { kind: 'skin', id: 'fb-sticky', name: 'Sticky note wall', category: 'Home Life',
    for: 'fbnotes', size: [380, 300], card: false, html: `
      <div class="hd"><span class="at-ico">📝</span><span class="at-name">{{name}}</span></div>
      <div class="at-fbwrap wall">
        <div class="note" style="--nc:#ffd76e;--rot:-1.8deg"><div class="ntext">Buy milk on the way home 🥛</div>
          <div class="nfoot"><span class="nauthor">Mike</span><span class="ntime">2h ago</span><span class="nre">💬 2</span></div></div>
        <div class="note" style="--nc:#a5e6b8;--rot:1.4deg"><div class="ntext">Vet visit Saturday 10:00</div>
          <div class="nfoot"><span class="nauthor">Sara</span><span class="ntime">5h ago</span></div></div>
        <div class="note" style="--nc:#9fd0ff;--rot:-0.7deg"><div class="ntext">Pizza night! 🍕</div>
          <div class="nfoot"><span class="nauthor">Dad</span><span class="ntime">1d ago</span><span class="nre">💬 1</span></div></div>
      </div>`, css: `
.SKIN { padding:6px; gap:8px; justify-content:flex-start; }
.SKIN .hd { display:flex; align-items:center; gap:8px; padding:0 6px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.SKIN .wall { flex:1; overflow-y:auto; display:grid; align-content:start;
  grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px;
  padding:6px; -webkit-overflow-scrolling:touch; }
.SKIN .note { background:linear-gradient(180deg,
    color-mix(in srgb,var(--nc,#ffd76e) 90%,#fff), var(--nc,#ffd76e));
  color:#33290f; border-radius:3px 12px 3px 10px; padding:12px 12px 8px;
  min-height:88px; display:flex; flex-direction:column; cursor:pointer;
  transform:rotate(var(--rot,0deg)); box-shadow:0 6px 14px rgba(0,0,0,.35);
  transition:transform .18s; animation:fbn-in .35s both; }
@keyframes fbn-in { from { opacity:0; transform:scale(.85) rotate(var(--rot,0deg)); } }
.SKIN .note:active { transform:rotate(0deg) scale(1.05); }
.SKIN .ntext { flex:1; font-size:13px; line-height:1.35; font-weight:600;
  word-break:break-word; overflow:hidden; }
.SKIN .nfoot { display:flex; gap:6px; align-items:center; margin-top:8px;
  font-size:10px; color:rgba(0,0,0,.55); }
.SKIN .nre { margin-left:auto; font-weight:700; }
.SKIN .at-fbempty { grid-column:1/-1; }` },

  { kind: 'skin', id: 'fb-feed', name: 'Notes feed', category: 'Home Life',
    for: 'fbnotes', size: [320, 300], card: true, html: `
      <div class="hd"><span class="at-ico">📝</span><span class="at-name">{{name}}</span></div>
      <div class="at-fbwrap feed">
        <div class="note" style="--nc:#ffd76e"><div class="ntext">Buy milk on the way home 🥛</div>
          <div class="nfoot"><span class="nauthor">Mike</span><span class="ntime">2h ago</span><span class="nre">💬 2</span></div></div>
        <div class="note" style="--nc:#a5e6b8"><div class="ntext">Vet visit Saturday 10:00</div>
          <div class="nfoot"><span class="nauthor">Sara</span><span class="ntime">5h ago</span></div></div>
      </div>`, css: `
.SKIN { gap:9px; justify-content:flex-start; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.SKIN .feed { flex:1; overflow-y:auto; display:flex; flex-direction:column;
  gap:8px; -webkit-overflow-scrolling:touch; }
.SKIN .note { flex:0 0 auto; display:flex; flex-direction:column; min-height:46px;
  background:rgba(255,255,255,.05); border-left:4px solid var(--nc,#ffd76e);
  border-radius:10px; padding:10px 12px; cursor:pointer;
  transition:background .15s; animation:fbf-in .3s both; }
@keyframes fbf-in { from { opacity:0; transform:translateX(-8px); } }
.SKIN .note:active { background:rgba(255,255,255,.11); }
.SKIN .ntext { font-size:13px; line-height:1.4; word-break:break-word; }
.SKIN .nfoot { display:flex; gap:8px; align-items:center; margin-top:6px;
  font-size:10px; color:var(--mut); }
.SKIN .nre { margin-left:auto; font-weight:700; }` },

  /* ---- Shopping / To-do list (fblist — bound to a todo.* entity) ----
     Hooks: .at-fblwrap (rows), .at-fbladd + .at-fbladdbtn (add row),
     .at-fblclear (two-tap confirm), .at-fblcount (open-items badge).
     Injected row: .li[.done] > .ck (toggle circle) + .tx (summary). */
  { kind: 'skin', id: 'fb-list', name: 'Shopping list', category: 'Home Life',
    for: 'fblist', size: [300, 340], card: true, html: `
      <div class="hd"><span class="at-ico">🛒</span><span class="at-name">{{name}}</span>
        <button class="at-fblclear cl">Clear done</button></div>
      <div class="at-fblwrap list">
        <div class="li"><button class="ck"></button><span class="tx">Milk</span></div>
        <div class="li"><button class="ck"></button><span class="tx">Bread</span></div>
        <div class="li done"><button class="ck"></button><span class="tx">Eggs</span></div>
      </div>
      <div class="addrow"><input class="at-fbladd" placeholder="Add item…" maxlength="120">
        <button class="at-fbladdbtn">＋</button></div>`, css: `
.SKIN { gap:8px; justify-content:flex-start; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; flex:1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .cl { flex:0 0 auto; border:0; border-radius:9px; padding:8px 11px;
  min-height:36px; font-size:11px; background:rgba(255,255,255,.08);
  color:var(--mut); cursor:pointer; transition:.2s; }
.SKIN .cl.arm { background:#e0512b; color:#fff; }
.SKIN .list { flex:1; overflow-y:auto; display:flex; flex-direction:column;
  -webkit-overflow-scrolling:touch; }
.SKIN .li { flex:0 0 auto; display:flex; align-items:center; gap:6px;
  min-height:46px; border-bottom:1px solid rgba(255,255,255,.06);
  animation:fbl-in .25s both; }
@keyframes fbl-in { from { opacity:0; transform:translateY(4px); } }
.SKIN .li:last-child { border-bottom:0; }
.SKIN .ck { flex:0 0 44px; width:44px; height:44px; border:0; background:none;
  cursor:pointer; position:relative; }
.SKIN .ck::before { content:''; position:absolute; inset:9px; border-radius:50%;
  border:2px solid rgba(255,255,255,.35); transition:.2s; }
.SKIN .li.done .ck::before { background:var(--accent); border-color:var(--accent); }
.SKIN .ck::after { content:'✓'; position:absolute; inset:0; display:flex;
  align-items:center; justify-content:center; font-size:14px; color:#fff;
  opacity:0; transform:scale(.4); transition:.2s; }
.SKIN .li.done .ck::after { opacity:1; transform:scale(1); }
.SKIN .tx { flex:1; font-size:14px; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; position:relative;
  transition:color .3s; }
.SKIN .li.done .tx { color:var(--mut); }
.SKIN .tx::after { content:''; position:absolute; left:0; top:50%; height:2px;
  width:0; background:var(--mut); transition:width .35s ease; }
.SKIN .li.done .tx::after { width:100%; }
.SKIN .addrow { display:flex; gap:8px; }
.SKIN .at-fbladd { flex:1; min-width:0; min-height:44px; padding:0 12px;
  border-radius:11px; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.06); color:inherit; font-size:14px; outline:none; }
.SKIN .at-fbladd:focus { border-color:var(--accent); }
.SKIN .at-fbladdbtn { flex:0 0 44px; min-height:44px; border:0; border-radius:11px;
  background:var(--accent); color:#fff; font-size:20px; cursor:pointer; }
.SKIN .at-fbladdbtn:active { transform:scale(.94); }` },

  { kind: 'skin', id: 'fb-list-card', name: 'List card + badge', category: 'Home Life',
    for: 'fblist', size: [300, 360], card: true, html: `
      <div class="hd"><span class="at-ico">🛒</span>
        <span class="at-name">{{name}}</span><span class="at-fblcount cnt">2</span></div>
      <div class="at-fblwrap list">
        <div class="li"><button class="ck"></button><span class="tx">Milk</span></div>
        <div class="li"><button class="ck"></button><span class="tx">Bread</span></div>
        <div class="li done"><button class="ck"></button><span class="tx">Eggs</span></div>
      </div>
      <div class="addrow"><input class="at-fbladd" placeholder="Add item…" maxlength="120">
        <button class="at-fbladdbtn">＋</button></div>
      <button class="at-fblclear cl">🧹 Clear done</button>`, css: `
.SKIN { gap:9px; justify-content:flex-start;
  border-top:3px solid var(--accent); }
.SKIN .hd { display:flex; align-items:center; gap:9px; padding-bottom:8px;
  border-bottom:1px solid rgba(255,255,255,.08); }
.SKIN .hd .at-ico { font-size:20px; }
.SKIN .hd .at-name { margin:0; font-size:16px; font-weight:700; flex:1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .cnt { flex:0 0 auto; min-width:26px; height:26px; border-radius:13px;
  background:var(--accent); color:#fff; font-size:12px; font-weight:800;
  display:flex; align-items:center; justify-content:center; padding:0 8px;
  transition:transform .2s; }
.SKIN .list { flex:1; overflow-y:auto; display:flex; flex-direction:column;
  -webkit-overflow-scrolling:touch; }
.SKIN .li { flex:0 0 auto; display:flex; align-items:center; gap:6px;
  min-height:46px; animation:fblc-in .25s both; }
@keyframes fblc-in { from { opacity:0; transform:translateY(4px); } }
.SKIN .ck { flex:0 0 44px; width:44px; height:44px; border:0; background:none;
  cursor:pointer; position:relative; }
.SKIN .ck::before { content:''; position:absolute; inset:9px; border-radius:9px;
  border:2px solid rgba(255,255,255,.35); transition:.2s; }
.SKIN .li.done .ck::before { background:var(--accent); border-color:var(--accent); }
.SKIN .ck::after { content:'✓'; position:absolute; inset:0; display:flex;
  align-items:center; justify-content:center; font-size:14px; color:#fff;
  opacity:0; transform:scale(.4); transition:.2s; }
.SKIN .li.done .ck::after { opacity:1; transform:scale(1); }
.SKIN .tx { flex:1; font-size:14px; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; position:relative;
  transition:color .3s; }
.SKIN .li.done .tx { color:var(--mut); }
.SKIN .tx::after { content:''; position:absolute; left:0; top:50%; height:2px;
  width:0; background:var(--mut); transition:width .35s ease; }
.SKIN .li.done .tx::after { width:100%; }
.SKIN .addrow { display:flex; gap:8px; }
.SKIN .at-fbladd { flex:1; min-width:0; min-height:44px; padding:0 12px;
  border-radius:11px; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.06); color:inherit; font-size:14px; outline:none; }
.SKIN .at-fbladd:focus { border-color:var(--accent); }
.SKIN .at-fbladdbtn { flex:0 0 44px; min-height:44px; border:0; border-radius:11px;
  background:var(--accent); color:#fff; font-size:20px; cursor:pointer; }
.SKIN .at-fbladdbtn:active { transform:scale(.94); }
.SKIN .cl { border:0; border-radius:10px; padding:10px; min-height:40px;
  font-size:12px; background:rgba(255,255,255,.08); color:var(--mut);
  cursor:pointer; transition:.2s; }
.SKIN .cl.arm { background:#e0512b; color:#fff; }` },

  /* ---- Energy summary (energysum — polls /api/dash/energy_center/summary) ----
     Hooks: .at-enkwh .at-encost .at-enrange, .at-enbars (series bars),
     .at-entop (ranked rows), .at-enmain / .at-enmsg (+ encfg state class). */
  { kind: 'skin', id: 'en-hero', name: 'Energy hero', category: 'Home Life',
    for: 'energysum', size: [320, 240], card: true, html: `
      <div class="hd"><span class="at-ico">⚡</span><span class="at-name">{{name}}</span>
        <span class="at-enrange rl">today</span></div>
      <div class="at-enmain main">
        <div class="big"><b class="at-enkwh">12.4</b><span class="unit">kWh</span>
          <span class="at-encost pill">3.42 €</span></div>
        <div class="at-enbars bars">
          <div class="eb" style="--pct:22"><i></i><span>00</span></div>
          <div class="eb" style="--pct:14"><i></i><span>03</span></div>
          <div class="eb" style="--pct:10"><i></i><span>06</span></div>
          <div class="eb" style="--pct:38"><i></i><span>09</span></div>
          <div class="eb" style="--pct:55"><i></i><span>12</span></div>
          <div class="eb" style="--pct:46"><i></i><span>15</span></div>
          <div class="eb" style="--pct:88"><i></i><span>18</span></div>
          <div class="eb" style="--pct:62"><i></i><span>21</span></div>
        </div>
      </div>
      <div class="at-enmsg">Energy Center isn't set up yet</div>`, css: `
.SKIN { gap:10px; justify-content:flex-start; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; flex:1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .rl { flex:0 0 auto; font-size:11px; color:var(--mut);
  background:rgba(255,255,255,.08); padding:3px 10px; border-radius:12px;
  text-transform:capitalize; }
.SKIN .at-enmain { flex:1; display:flex; flex-direction:column; gap:10px;
  min-height:0; }
.SKIN .big { display:flex; align-items:baseline; gap:6px; }
.SKIN .at-enkwh { font-size:34px; font-weight:800; line-height:1;
  font-variant-numeric:tabular-nums; }
.SKIN .unit { font-size:13px; color:var(--mut); }
.SKIN .pill { margin-left:auto; font-size:13px; font-weight:700; color:#0e2c18;
  background:linear-gradient(135deg,#7ee2a0,#4cc07a); padding:5px 12px;
  border-radius:16px; white-space:nowrap; }
.SKIN .bars { flex:1; display:flex; gap:5px; min-height:52px; }
.SKIN .eb { flex:1; display:flex; flex-direction:column; justify-content:flex-end;
  align-items:center; gap:3px; min-width:0; }
.SKIN .eb i { width:100%; height:calc(var(--pct,0) * 1%); min-height:2px;
  border-radius:4px 4px 0 0; background:linear-gradient(180deg,var(--accent),
  color-mix(in srgb,var(--accent) 40%,transparent)); transition:height .5s; }
.SKIN .eb span { font-size:8px; color:var(--mut); max-width:100%;
  overflow:hidden; white-space:nowrap; }` },

  { kind: 'skin', id: 'en-top', name: 'Top consumers', category: 'Home Life',
    for: 'energysum', size: [320, 260], card: true, html: `
      <div class="hd"><span class="at-ico">⚡</span><span class="at-name">{{name}}</span>
        <span class="at-enrange rl">today</span></div>
      <div class="at-enmain main">
        <div class="tot"><b class="at-enkwh">12.4</b><span class="unit">kWh</span>
          <span class="at-encost cost">3.42 €</span></div>
        <div class="at-entop top">
          <div class="er"><span class="rk">1</span><span class="nm">Heat pump</span><i class="bar" style="--pct:82"></i><b class="kw">5.1</b></div>
          <div class="er"><span class="rk">2</span><span class="nm">Dryer</span><i class="bar" style="--pct:48"></i><b class="kw">3.0</b></div>
          <div class="er"><span class="rk">3</span><span class="nm">Fridge</span><i class="bar" style="--pct:24"></i><b class="kw">1.5</b></div>
        </div>
      </div>
      <div class="at-enmsg">Energy Center isn't set up yet</div>`, css: `
.SKIN { gap:10px; justify-content:flex-start; }
.SKIN .hd { display:flex; align-items:center; gap:8px; }
.SKIN .hd .at-name { margin:0; font-size:14px; font-weight:600; flex:1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.SKIN .rl { flex:0 0 auto; font-size:11px; color:var(--mut);
  background:rgba(255,255,255,.08); padding:3px 10px; border-radius:12px;
  text-transform:capitalize; }
.SKIN .at-enmain { flex:1; display:flex; flex-direction:column; gap:9px;
  min-height:0; }
.SKIN .tot { display:flex; align-items:baseline; gap:6px; }
.SKIN .at-enkwh { font-size:24px; font-weight:800; line-height:1;
  font-variant-numeric:tabular-nums; }
.SKIN .unit { font-size:12px; color:var(--mut); }
.SKIN .cost { margin-left:auto; font-size:13px; font-weight:700; color:#7ee2a0; }
.SKIN .top { flex:1; display:flex; flex-direction:column; gap:7px;
  overflow-y:auto; -webkit-overflow-scrolling:touch; }
.SKIN .er { flex:0 0 auto; display:flex; align-items:center; gap:8px;
  min-height:24px; animation:ent-in .3s both; }
@keyframes ent-in { from { opacity:0; transform:translateX(-8px); } }
.SKIN .rk { flex:0 0 18px; font-size:11px; font-weight:800; color:var(--mut);
  text-align:center; }
.SKIN .er:first-child .rk { color:#ffd76e; }
.SKIN .nm { flex:0 0 34%; font-size:12px; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.SKIN .bar { flex:1; height:9px; border-radius:6px;
  background:rgba(255,255,255,.08); position:relative; overflow:hidden; }
.SKIN .bar::after { content:''; position:absolute; left:0; top:0; bottom:0;
  width:calc(var(--pct,0) * 1%); border-radius:6px;
  background:linear-gradient(90deg,var(--accent),#e8b04b); transition:width .6s; }
.SKIN .kw { flex:0 0 auto; font-size:11px; font-weight:700;
  font-variant-numeric:tabular-nums; }` },

  /* ---- Intercom / Announce (intercom — whole widget opens the overlay) ---- */
  { kind: 'skin', id: 'ic-round', name: 'Announce button', category: 'Home Life',
    for: 'intercom', size: [180, 200], card: false, html: `
      <div class="orb"><span class="ic">📢</span></div>
      <div class="at-name lbl">{{name}}</div>`, css: `
.SKIN { align-items:center; justify-content:center; gap:12px; cursor:pointer; }
.SKIN .orb { width:110px; height:110px; max-width:82%; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  background:radial-gradient(circle at 32% 30%,
    color-mix(in srgb,var(--accent) 70%,#fff),
    var(--accent) 62%, color-mix(in srgb,var(--accent) 55%,#000));
  animation:icr-glow 2.6s ease-in-out infinite; transition:transform .15s; }
@keyframes icr-glow {
  0%,100% { box-shadow:0 0 18px color-mix(in srgb,var(--accent) 45%,transparent); }
  50% { box-shadow:0 0 36px color-mix(in srgb,var(--accent) 80%,transparent); } }
.SKIN:active .orb { transform:scale(.92); }
.SKIN .ic { font-size:44px; }
.SKIN .lbl { margin:0; font-size:14px; font-weight:600; color:var(--text,#e8edf7); }` },

  { kind: 'skin', id: 'ic-bar', name: 'Announce bar', category: 'Home Life',
    for: 'intercom', size: [320, 90], card: true, html: `
      <div class="row"><span class="ic">📢</span>
        <div class="tx"><span class="at-name">{{name}}</span>
          <span class="sub">Tap to announce</span></div>
        <span class="arrow">▸</span></div>`, css: `
.SKIN { cursor:pointer; justify-content:center; transition:transform .15s; }
.SKIN:active { transform:scale(.985); }
.SKIN .row { display:flex; align-items:center; gap:14px; }
.SKIN .ic { flex:0 0 52px; width:52px; height:52px; font-size:28px;
  display:flex; align-items:center; justify-content:center; border-radius:16px;
  background:color-mix(in srgb,var(--accent) 25%,transparent);
  animation:icb-pulse 2.6s ease-in-out infinite; }
@keyframes icb-pulse {
  0%,100% { box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 40%,transparent); }
  50% { box-shadow:0 0 0 9px transparent; } }
.SKIN .tx { display:flex; flex-direction:column; min-width:0; }
.SKIN .tx .at-name { margin:0; font-size:15px; font-weight:700;
  color:var(--text,#e8edf7); overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.SKIN .sub { font-size:11px; color:var(--mut); }
.SKIN .arrow { margin-left:auto; font-size:18px; color:var(--mut); }` },

  /* ---- Security keypad (seckeypad — arm/disarm with a PIN, no login) ---- */
  { kind: 'skin', id: 'sk-pad', name: 'Security keypad', category: 'Home Life',
    for: 'seckeypad', size: [300, 520], card: true, html: `
      <div class="at-name lbl">{{name}}</div>
      <div class="at-skbadge"><i class="at-skdot"></i>
        <span class="at-sklb">Disarmed</span><b class="at-skcd"></b></div>
      <div class="at-skdots"><i></i><i></i><i></i><i></i></div>
      <div class="at-skmsg"></div>
      <div class="at-skgrid">
        <button class="at-skkey" type="button" data-k="1">1</button>
        <button class="at-skkey" type="button" data-k="2">2</button>
        <button class="at-skkey" type="button" data-k="3">3</button>
        <button class="at-skkey" type="button" data-k="4">4</button>
        <button class="at-skkey" type="button" data-k="5">5</button>
        <button class="at-skkey" type="button" data-k="6">6</button>
        <button class="at-skkey" type="button" data-k="7">7</button>
        <button class="at-skkey" type="button" data-k="8">8</button>
        <button class="at-skkey" type="button" data-k="9">9</button>
        <button class="at-skkey" type="button" data-k="clear">C</button>
        <button class="at-skkey" type="button" data-k="0">0</button>
        <button class="at-skkey" type="button" data-k="back">⌫</button>
      </div>
      <div class="at-skacts">
        <button class="at-skbtn arm" type="button" data-mode="home">🔒 Home</button>
        <button class="at-skbtn arm" type="button" data-mode="away">🔒 Away</button>
        <button class="at-skbtn arm" type="button" data-mode="night">🔒 Night</button>
        <button class="at-skbtn dis wide" type="button" data-mode="disarm">🔓 Disarm</button>
      </div>`, css: `
.SKIN { gap:8px; justify-content:flex-start; }
.SKIN .lbl { margin:0; font-size:12px; text-align:center; }
.SKIN .at-skgrid { flex:1; grid-auto-rows:1fr; }
.SKIN .at-skkey { height:100%; }` },

  { kind: 'skin', id: 'sk-shield', name: 'Security shield', category: 'Home Life',
    for: 'seckeypad', size: [180, 200], card: false, html: `
      <div class="orb"><span class="ic">🔐</span><b class="at-skcd"></b></div>
      <div class="at-name nm">{{name}}</div>
      <div class="at-sklb lb">…</div>`, css: `
.SKIN { align-items:center; justify-content:center; gap:8px; cursor:pointer; }
.SKIN .orb { width:104px; height:104px; max-width:78%; border-radius:50%;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:1px; background:radial-gradient(circle at 32% 30%,
    color-mix(in srgb,var(--sk,#8b98b8) 72%,#fff),
    var(--sk,#8b98b8) 62%, color-mix(in srgb,var(--sk,#8b98b8) 55%,#000));
  box-shadow:0 0 22px color-mix(in srgb,var(--sk,#8b98b8) 45%,transparent);
  transition:transform .15s; }
.SKIN:active .orb { transform:scale(.92); }
.SKIN .orb .ic { font-size:38px; line-height:1; }
.SKIN .orb .at-skcd { font-size:13px; color:#fff; }
.SKIN .nm { margin:0; font-size:12px; text-align:center; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
.SKIN .lb { font-size:13px; text-align:center; }` },

  { kind: 'skin', id: 'sk-bar', name: 'Security bar', category: 'Home Life',
    for: 'seckeypad', size: [320, 90], card: true, html: `
      <div class="row"><span class="ic">🔐</span>
        <div class="tx"><span class="at-name">{{name}}</span>
          <span class="at-sklb sub">…</span></div>
        <b class="at-skcd"></b></div>`, css: `
.SKIN { cursor:pointer; justify-content:center; transition:transform .15s; }
.SKIN:active { transform:scale(.985); }
.SKIN .row { display:flex; align-items:center; gap:14px; }
.SKIN .ic { flex:0 0 52px; width:52px; height:52px; font-size:28px;
  display:flex; align-items:center; justify-content:center; border-radius:16px;
  background:color-mix(in srgb,var(--sk,#8b98b8) 25%,transparent); }
.SKIN .tx { display:flex; flex-direction:column; min-width:0; }
.SKIN .tx .at-name { margin:0; font-size:15px; font-weight:700;
  color:var(--text,#e8edf7); overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.SKIN .sub { font-size:12px; }
.SKIN .at-skcd { margin-left:auto; font-size:20px; }` },

  /* ---- Themed keypad skins (pure CSS, no images/fonts/scripts) ---- */

  { kind: 'skin', id: 'sk-matrix', name: 'Matrix keypad', category: 'Home Life',
    for: 'seckeypad', size: [300, 520], card: false, html: `
      <div class="rain"></div>
      <div class="scan"></div>
      <div class="wrap">
        <div class="at-name lbl">{{name}}</div>
        <div class="rd"><span class="at-sklb">Disarmed</span><b class="at-skcd"></b></div>
        <div class="at-skdots"><i></i><i></i><i></i><i></i></div>
        <div class="at-skmsg"></div>
        <div class="at-skgrid">
          <button class="at-skkey" type="button" data-k="1">1</button>
          <button class="at-skkey" type="button" data-k="2">2</button>
          <button class="at-skkey" type="button" data-k="3">3</button>
          <button class="at-skkey" type="button" data-k="4">4</button>
          <button class="at-skkey" type="button" data-k="5">5</button>
          <button class="at-skkey" type="button" data-k="6">6</button>
          <button class="at-skkey" type="button" data-k="7">7</button>
          <button class="at-skkey" type="button" data-k="8">8</button>
          <button class="at-skkey" type="button" data-k="9">9</button>
          <button class="at-skkey" type="button" data-k="clear">C</button>
          <button class="at-skkey" type="button" data-k="0">0</button>
          <button class="at-skkey" type="button" data-k="back">⌫</button>
        </div>
        <div class="at-skacts">
          <button class="at-skbtn arm" type="button" data-mode="home">Home</button>
          <button class="at-skbtn arm" type="button" data-mode="away">Away</button>
          <button class="at-skbtn arm" type="button" data-mode="night">Night</button>
          <button class="at-skbtn dis wide" type="button" data-mode="disarm">Disarm</button>
        </div>
      </div>`, css: `
.SKIN { --mx:#39ff5f; padding:12px; background:#020704; overflow:hidden;
  border-radius:var(--radius,14px);
  border:1px solid color-mix(in srgb,var(--mx) 45%,transparent);
  font-family:ui-monospace,"Cascadia Mono","Consolas","Courier New",monospace; }
.SKIN .rain { position:absolute; inset:-30% 0; z-index:0; opacity:.28;
  pointer-events:none; }
.SKIN .rain::before, .SKIN .rain::after { content:''; position:absolute; inset:0;
  background-image:repeating-linear-gradient(180deg, transparent 0 44px,
    var(--mx) 50px, transparent 56px 130px);
  -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 3px,transparent 3px 21px);
  mask-image:repeating-linear-gradient(90deg,#000 0 3px,transparent 3px 21px);
  animation:sk-mx-fall 5.5s linear infinite; }
.SKIN .rain::after { -webkit-mask-position:11px 0; mask-position:11px 0;
  animation-duration:9s; opacity:.55; }
@keyframes sk-mx-fall { from { transform:translateY(-22%); }
  to { transform:translateY(22%); } }
.SKIN .scan { position:absolute; inset:0; z-index:0; pointer-events:none;
  background:repeating-linear-gradient(180deg, rgba(0,0,0,.42) 0 1px,
    transparent 1px 3px); }
.SKIN .wrap { position:relative; z-index:1; display:flex; flex-direction:column;
  gap:7px; height:100%; min-height:0; flex-wrap:nowrap; }
.SKIN .lbl { margin:0; font-size:11px; text-align:center; letter-spacing:1px;
  text-transform:uppercase; color:color-mix(in srgb,var(--mx) 72%,#000); }
.SKIN .rd { display:flex; align-items:center; gap:8px; min-height:32px;
  padding:0 9px; border-radius:4px; background:rgba(0,0,0,.55);
  border:1px solid color-mix(in srgb,var(--mx) 35%,transparent); }
.SKIN .at-sklb { color:var(--mx); font-size:13px; font-weight:700;
  letter-spacing:.5px; text-shadow:0 0 8px color-mix(in srgb,var(--mx) 60%,transparent); }
.SKIN .at-sklb::after { content:"_"; margin-left:2px;
  animation:sk-mx-cur 1.05s steps(1,end) infinite; }
@keyframes sk-mx-cur { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }
.SKIN .at-skcd { margin-left:auto; color:var(--mx); font-size:14px; }
.SKIN .at-skdots i { border-color:color-mix(in srgb,var(--mx) 45%,transparent);
  border-radius:2px; }
.SKIN .at-skdots i.on { background:var(--mx); border-color:var(--mx); }
.SKIN .at-skmsg { color:color-mix(in srgb,var(--mx) 65%,#000); font-size:11px; }
.SKIN .at-skgrid { flex:1; grid-auto-rows:1fr; gap:5px; }
.SKIN .at-skkey { height:100%; border-radius:4px; background:rgba(0,0,0,.5);
  border:1px solid color-mix(in srgb,var(--mx) 30%,transparent);
  color:var(--mx); font-family:inherit; font-size:20px; }
.SKIN .at-skkey:active { background:color-mix(in srgb,var(--mx) 28%,#000);
  color:#eaffee; transform:none; }
.SKIN .at-skbtn { border-radius:4px; background:rgba(0,0,0,.5); font-family:inherit;
  border:1px solid color-mix(in srgb,var(--mx) 40%,transparent);
  color:var(--mx); letter-spacing:1px; text-transform:uppercase; font-size:12px; }
.SKIN .at-skbtn:active { background:color-mix(in srgb,var(--mx) 28%,#000);
  color:#eaffee; transform:none; }
.SKIN.sk-disarmed { --mx:#39ff5f; animation:none; }
.SKIN.sk-arming { --mx:#ffd93b; animation:none; }
.SKIN.sk-armed { --mx:#35e0ff; animation:none; }
.SKIN.sk-pending { --mx:#ffd93b; animation:none; }
.SKIN.sk-pending .rain { opacity:.4; }
.SKIN.sk-triggered { --mx:#ff2f2f; background:#0d0202; animation:none;
  border-color:#ff2f2f; }
.SKIN.sk-triggered .rain { opacity:.55; }
.SKIN.sk-triggered .rain::before { animation-duration:1.6s; }
.SKIN.sk-triggered .rain::after { animation-duration:2.6s; }
.SKIN.sk-off { --mx:#4d6b55; animation:none; }
.SKIN.sk-off .rain { opacity:.12; }
@media (prefers-reduced-motion: reduce) {
  .SKIN .rain::before, .SKIN .rain::after, .SKIN .at-sklb::after {
    animation:none; } }` },

  { kind: 'skin', id: 'sk-police', name: 'Police panel', category: 'Home Life',
    for: 'seckeypad', size: [300, 520], card: false, html: `
      <div class="strobe"><i class="r"></i><i class="b"></i></div>
      <div class="wrap">
        <div class="hd"><span class="shield"></span>
          <div class="tx"><span class="at-name lbl">{{name}}</span>
            <span class="at-sklb">Disarmed</span></div>
          <b class="at-skcd"></b></div>
        <div class="at-skdots"><i></i><i></i><i></i><i></i></div>
        <div class="at-skmsg"></div>
        <div class="at-skgrid">
          <button class="at-skkey" type="button" data-k="1">1</button>
          <button class="at-skkey" type="button" data-k="2">2</button>
          <button class="at-skkey" type="button" data-k="3">3</button>
          <button class="at-skkey" type="button" data-k="4">4</button>
          <button class="at-skkey" type="button" data-k="5">5</button>
          <button class="at-skkey" type="button" data-k="6">6</button>
          <button class="at-skkey" type="button" data-k="7">7</button>
          <button class="at-skkey" type="button" data-k="8">8</button>
          <button class="at-skkey" type="button" data-k="9">9</button>
          <button class="at-skkey" type="button" data-k="clear">C</button>
          <button class="at-skkey" type="button" data-k="0">0</button>
          <button class="at-skkey" type="button" data-k="back">⌫</button>
        </div>
        <div class="at-skacts">
          <button class="at-skbtn arm" type="button" data-mode="home">Home</button>
          <button class="at-skbtn arm" type="button" data-mode="away">Away</button>
          <button class="at-skbtn arm" type="button" data-mode="night">Night</button>
          <button class="at-skbtn dis wide" type="button" data-mode="disarm">Disarm</button>
        </div>
      </div>`, css: `
.SKIN { --pc:#4f8cff; padding:12px; padding-top:20px; overflow:hidden;
  border-radius:var(--radius,14px); border:1px solid rgba(120,150,210,.28);
  background:linear-gradient(180deg,#0d1730,#070c1b 60%,#050915);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.SKIN .strobe { position:absolute; top:0; left:0; right:0; height:8px; z-index:2;
  display:flex; }
.SKIN .strobe i { flex:1; opacity:.22; }
.SKIN .strobe .r { background:linear-gradient(90deg,#ff2b2b,#8a0f0f); }
.SKIN .strobe .b { background:linear-gradient(90deg,#0f3a8a,#2b7bff); }
.SKIN .wrap { position:relative; z-index:1; display:flex; flex-direction:column;
  gap:7px; height:100%; min-height:0; flex-wrap:nowrap; }
.SKIN .hd { display:flex; align-items:center; gap:10px; min-height:44px;
  padding:0 10px; border-radius:10px; background:rgba(255,255,255,.05);
  border:1px solid color-mix(in srgb,var(--pc) 40%,transparent); }
.SKIN .shield { flex:0 0 22px; width:22px; height:26px; background:var(--pc);
  clip-path:polygon(50% 0,100% 20%,100% 58%,50% 100%,0 58%,0 20%);
  box-shadow:0 0 10px color-mix(in srgb,var(--pc) 55%,transparent); }
.SKIN .tx { display:flex; flex-direction:column; min-width:0; }
.SKIN .lbl { margin:0; font-size:10px; letter-spacing:1.6px;
  text-transform:uppercase; color:#8fa3c8; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.SKIN .at-sklb { color:var(--pc); font-size:14px; font-weight:800;
  letter-spacing:.4px; }
.SKIN .at-skcd { margin-left:auto; color:var(--pc); font-size:16px; }
.SKIN .at-skdots i { border-color:rgba(150,175,220,.4); }
.SKIN .at-skdots i.on { background:var(--pc); border-color:var(--pc); }
.SKIN .at-skmsg { color:#8fa3c8; }
.SKIN .at-skgrid { flex:1; min-height:0; grid-auto-rows:1fr; gap:6px; }
.SKIN .at-skkey { height:100%; border-radius:8px; color:#101a30; font-size:21px;
  font-weight:800; border:1px solid #7d8ba5;
  background:linear-gradient(180deg,#f4f7fc,#c2cbdc 55%,#aab5c9);
  box-shadow:inset 0 1px 0 #fff, 0 2px 0 rgba(0,0,0,.45); }
.SKIN .at-skkey:active { transform:translateY(2px);
  background:linear-gradient(180deg,#c2cbdc,#e6ebf4);
  box-shadow:inset 0 2px 4px rgba(0,0,0,.35); }
.SKIN .at-skbtn { border-radius:8px; font-size:12px; letter-spacing:1px;
  text-transform:uppercase; color:#dce6fb; background:rgba(255,255,255,.06);
  border:1px solid color-mix(in srgb,var(--pc) 50%,transparent); }
.SKIN .at-skbtn.dis { border-color:rgba(95,208,138,.55); color:#bff3d2; }
.SKIN.sk-disarmed { --pc:#5fd08a; animation:none; }
.SKIN.sk-arming { --pc:#f5a524; animation:none; }
.SKIN.sk-arming .strobe .b { opacity:.45; }
.SKIN.sk-armed { --pc:#2b7bff; animation:none; }
.SKIN.sk-armed .strobe .b { opacity:.85; }
.SKIN.sk-pending { --pc:#f5a524; animation:none; }
.SKIN.sk-pending .strobe i { opacity:.5; }
.SKIN.sk-triggered { --pc:#ff3b3b; animation:none; border-color:#ff3b3b; }
.SKIN.sk-triggered .strobe i { opacity:1;
  animation:sk-pl-flash .5s steps(1,end) infinite; }
.SKIN.sk-triggered .strobe .b { animation-delay:.25s; }
@keyframes sk-pl-flash { 0%,49% { opacity:1; } 50%,100% { opacity:.1; } }
.SKIN.sk-off { --pc:#8b98b8; animation:none; }
.SKIN.sk-off .strobe i { opacity:.1; }
@media (prefers-reduced-motion: reduce) {
  .SKIN.sk-triggered .strobe i { animation:none; opacity:.9; } }` },

  { kind: 'skin', id: 'sk-army', name: 'Military keypad', category: 'Home Life',
    for: 'seckeypad', size: [300, 520], card: false, html: `
      <div class="rivets"></div>
      <div class="haz t"><i></i></div>
      <div class="haz b"><i></i></div>
      <div class="wrap">
        <div class="at-name lbl">{{name}}</div>
        <div class="win"><span class="at-sklb">Disarmed</span><b class="at-skcd"></b></div>
        <div class="at-skdots"><i></i><i></i><i></i><i></i></div>
        <div class="at-skmsg"></div>
        <div class="at-skgrid">
          <button class="at-skkey" type="button" data-k="1">1</button>
          <button class="at-skkey" type="button" data-k="2">2</button>
          <button class="at-skkey" type="button" data-k="3">3</button>
          <button class="at-skkey" type="button" data-k="4">4</button>
          <button class="at-skkey" type="button" data-k="5">5</button>
          <button class="at-skkey" type="button" data-k="6">6</button>
          <button class="at-skkey" type="button" data-k="7">7</button>
          <button class="at-skkey" type="button" data-k="8">8</button>
          <button class="at-skkey" type="button" data-k="9">9</button>
          <button class="at-skkey" type="button" data-k="clear">C</button>
          <button class="at-skkey" type="button" data-k="0">0</button>
          <button class="at-skkey" type="button" data-k="back">⌫</button>
        </div>
        <div class="at-skacts">
          <button class="at-skbtn arm" type="button" data-mode="home">Home</button>
          <button class="at-skbtn arm" type="button" data-mode="away">Away</button>
          <button class="at-skbtn arm" type="button" data-mode="night">Night</button>
          <button class="at-skbtn dis wide" type="button" data-mode="disarm">Disarm</button>
        </div>
      </div>`, css: `
.SKIN { --am:#c8d18a; padding:14px; overflow:hidden; border-radius:6px;
  border:2px solid #2a2f1c;
  background:linear-gradient(160deg,#5a6340,#434a2c 45%,#333824),
    repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 2px,
      transparent 2px 5px);
  font-family:"Arial Black","Helvetica Neue",Impact,system-ui,sans-serif; }
.SKIN .rivets { position:absolute; inset:0; z-index:0; pointer-events:none;
  background-repeat:no-repeat;
  background-image:
    radial-gradient(circle 5px at 9px 9px,#d7dcbe 0 2px,#5c6142 2px 5px,transparent 5px),
    radial-gradient(circle 5px at calc(100% - 9px) 9px,#d7dcbe 0 2px,#5c6142 2px 5px,transparent 5px),
    radial-gradient(circle 5px at 9px calc(100% - 9px),#d7dcbe 0 2px,#5c6142 2px 5px,transparent 5px),
    radial-gradient(circle 5px at calc(100% - 9px) calc(100% - 9px),#d7dcbe 0 2px,#5c6142 2px 5px,transparent 5px); }
.SKIN .haz { position:absolute; left:0; right:0; height:10px; z-index:2;
  overflow:hidden; display:none; }
.SKIN .haz.t { top:0; } .SKIN .haz.b { bottom:0; }
.SKIN .haz i { position:absolute; top:0; bottom:0; left:-32px; width:calc(100% + 64px);
  background:repeating-linear-gradient(45deg,#ffb300 0 11px,#181405 11px 22px);
  animation:sk-am-haz .9s linear infinite; }
@keyframes sk-am-haz { from { transform:translateX(0); }
  to { transform:translateX(31.1px); } }
.SKIN .wrap { position:relative; z-index:1; display:flex; flex-direction:column;
  gap:7px; height:100%; min-height:0; flex-wrap:nowrap; }
.SKIN .lbl { margin:0; font-size:11px; text-align:center; letter-spacing:3px;
  text-transform:uppercase; color:#dbe2b4; text-shadow:0 1px 0 #22260f; }
.SKIN .win { display:flex; align-items:center; gap:8px; min-height:40px;
  padding:0 10px; border-radius:3px; background:#171a0e;
  border:2px solid #262b16; box-shadow:inset 0 2px 8px rgba(0,0,0,.8); }
.SKIN .at-sklb { color:var(--am); font-size:14px; font-weight:900;
  letter-spacing:1.5px; text-transform:uppercase;
  text-shadow:0 0 8px color-mix(in srgb,var(--am) 45%,transparent); }
.SKIN .at-skcd { margin-left:auto; color:var(--am); font-size:15px; }
.SKIN .at-skdots i { border-radius:2px; border-color:#8c9663; }
.SKIN .at-skdots i.on { background:var(--am); border-color:var(--am); }
.SKIN .at-skmsg { color:#dbe2b4; font-size:11px; letter-spacing:1px;
  text-transform:uppercase; }
.SKIN .at-skgrid { flex:1; min-height:0; grid-auto-rows:1fr; gap:6px; }
.SKIN .at-skkey { height:100%; border-radius:4px; font-size:20px; font-weight:900;
  color:#e6ecc6; border:2px solid #22260f; letter-spacing:1px;
  background:linear-gradient(180deg,#69714a,#4b5231 60%,#3d4327);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18), 0 2px 0 #1d2110; }
.SKIN .at-skkey:active { transform:translateY(2px); box-shadow:inset 0 2px 6px rgba(0,0,0,.6);
  background:linear-gradient(180deg,#3d4327,#5a6340); }
.SKIN .at-skbtn { border-radius:4px; font-size:12px; font-weight:900;
  letter-spacing:2px; text-transform:uppercase; color:#e6ecc6;
  border:2px solid #22260f;
  background:linear-gradient(180deg,#69714a,#464d2e); }
.SKIN .at-skbtn.dis { color:#c9f0d3; }
.SKIN.sk-disarmed { --am:#c8d18a; animation:none; }
.SKIN.sk-arming { --am:#ffc233; animation:none; }
.SKIN.sk-armed { --am:#8fd6ff; animation:none; }
.SKIN.sk-pending { --am:#ffc233; animation:none; }
.SKIN.sk-pending .haz.t { display:block; }
.SKIN.sk-triggered { --am:#ff6a4d; animation:none; border-color:#ffb300; }
.SKIN.sk-triggered .haz { display:block; }
.SKIN.sk-off { --am:#8c9663; animation:none; }
@media (prefers-reduced-motion: reduce) {
  .SKIN .haz i { animation:none; } }` },

  { kind: 'skin', id: 'sk-vault', name: 'Vault keypad', category: 'Home Life',
    for: 'seckeypad', size: [300, 520], card: false, html: `
      <div class="wrap">
        <div class="hd"><span class="dial"></span>
          <div class="tx"><span class="at-name lbl">{{name}}</span>
            <span class="at-sklb">Disarmed</span></div>
          <b class="at-skcd"></b><i class="lamp"></i></div>
        <div class="at-skdots"><i></i><i></i><i></i><i></i></div>
        <div class="at-skmsg"></div>
        <div class="at-skgrid">
          <button class="at-skkey" type="button" data-k="1">1</button>
          <button class="at-skkey" type="button" data-k="2">2</button>
          <button class="at-skkey" type="button" data-k="3">3</button>
          <button class="at-skkey" type="button" data-k="4">4</button>
          <button class="at-skkey" type="button" data-k="5">5</button>
          <button class="at-skkey" type="button" data-k="6">6</button>
          <button class="at-skkey" type="button" data-k="7">7</button>
          <button class="at-skkey" type="button" data-k="8">8</button>
          <button class="at-skkey" type="button" data-k="9">9</button>
          <button class="at-skkey" type="button" data-k="clear">C</button>
          <button class="at-skkey" type="button" data-k="0">0</button>
          <button class="at-skkey" type="button" data-k="back">⌫</button>
        </div>
        <div class="at-skacts">
          <button class="at-skbtn arm" type="button" data-mode="home">Home</button>
          <button class="at-skbtn arm" type="button" data-mode="away">Away</button>
          <button class="at-skbtn arm" type="button" data-mode="night">Night</button>
          <button class="at-skbtn dis wide" type="button" data-mode="disarm">Disarm</button>
        </div>
      </div>`, css: `
.SKIN { --vt:#c9962f; padding:13px; overflow:hidden;
  border-radius:var(--radius,14px); border:2px solid #2b3138;
  background:linear-gradient(180deg,#6d757e,#4d545c 40%,#3a4047),
    repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px,
      rgba(0,0,0,.05) 1px 3px);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.SKIN .wrap { position:relative; z-index:1; display:flex; flex-direction:column;
  gap:8px; height:100%; min-height:0; flex-wrap:nowrap; }
.SKIN .hd { display:flex; align-items:center; gap:9px; min-height:52px;
  padding:0 10px; border-radius:10px; background:linear-gradient(180deg,#22272d,#171b20);
  border:1px solid #10141a; box-shadow:inset 0 2px 8px rgba(0,0,0,.7); }
.SKIN .dial { flex:0 0 34px; width:34px; height:34px; border-radius:50%;
  background:conic-gradient(from 0deg, #d9b45e 0 8%, #8a6a1c 8% 16%,
    #d9b45e 16% 24%, #8a6a1c 24% 32%, #d9b45e 32% 40%, #8a6a1c 40% 48%,
    #d9b45e 48% 56%, #8a6a1c 56% 64%, #d9b45e 64% 72%, #8a6a1c 72% 80%,
    #d9b45e 80% 88%, #8a6a1c 88% 100%);
  border:2px solid #2b3138; box-shadow:0 0 10px rgba(201,150,47,.35); }
.SKIN .tx { display:flex; flex-direction:column; min-width:0; }
.SKIN .lbl { margin:0; font-size:10px; letter-spacing:1.5px;
  text-transform:uppercase; color:#9aa5b1; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.SKIN .at-sklb { color:var(--vt); font-size:14px; font-weight:800; }
.SKIN .at-skcd { margin-left:auto; color:var(--vt); font-size:16px; }
.SKIN .lamp { flex:0 0 12px; width:12px; height:12px; border-radius:50%;
  background:#3a2020; border:1px solid #10141a; }
.SKIN .at-skdots i { border-color:#8d99a6; }
.SKIN .at-skdots i.on { background:var(--vt); border-color:var(--vt); }
.SKIN .at-skmsg { color:#c3ccd6; }
.SKIN .at-skgrid { flex:1; min-height:0; grid-auto-rows:1fr; gap:6px; }
.SKIN .at-skkey { height:100%; border-radius:10px; font-size:21px; font-weight:800;
  color:#eef2f7; border:1px solid #23282e;
  background:linear-gradient(180deg,#5d656e,#3d434a);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.25), 0 3px 0 #23282e; }
.SKIN .at-skkey:active { transform:translateY(3px);
  background:linear-gradient(180deg,#2f343a,#454c54);
  box-shadow:inset 0 3px 7px rgba(0,0,0,.65); color:var(--vt); }
.SKIN .at-skbtn { border-radius:10px; font-size:12px; font-weight:800;
  letter-spacing:1px; color:#eef2f7; border:1px solid #23282e;
  background:linear-gradient(180deg,#5d656e,#3d434a);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.2); }
.SKIN .at-skbtn.dis { color:#bff3d2; }
.SKIN.sk-disarmed { --vt:#7fe0a5; animation:none; }
.SKIN.sk-arming { --vt:#f5a524; animation:none; }
.SKIN.sk-armed { --vt:#e0b558; animation:none; }
.SKIN.sk-armed .dial { box-shadow:0 0 16px rgba(224,181,88,.75); }
.SKIN.sk-pending { --vt:#f5a524; animation:none; }
.SKIN.sk-pending .dial { animation:sk-vt-spin 2.4s linear infinite; }
.SKIN.sk-triggered { --vt:#ff5a4d; animation:none; border-color:#8c2020; }
.SKIN.sk-triggered .lamp { background:#ff3b3b;
  box-shadow:0 0 14px rgba(255,59,59,.9);
  animation:sk-vt-lamp .7s ease-in-out infinite; }
.SKIN.sk-triggered .dial { animation:sk-vt-spin 1s linear infinite; }
@keyframes sk-vt-spin { to { transform:rotate(360deg); } }
@keyframes sk-vt-lamp { 0%,100% { opacity:1; } 50% { opacity:.25; } }
.SKIN.sk-off { --vt:#9aa5b1; animation:none; }
@media (prefers-reduced-motion: reduce) {
  .SKIN .dial, .SKIN .lamp { animation:none !important; } }` },

  { kind: 'skin', id: 'sk-neon', name: 'Neon keypad', category: 'Home Life',
    for: 'seckeypad', size: [300, 520], card: false, html: `
      <div class="flood"></div>
      <div class="wrap">
        <div class="at-name lbl">{{name}}</div>
        <div class="rd"><span class="at-sklb">Disarmed</span><b class="at-skcd"></b></div>
        <div class="at-skdots"><i></i><i></i><i></i><i></i></div>
        <div class="at-skmsg"></div>
        <div class="at-skgrid">
          <button class="at-skkey" type="button" data-k="1">1</button>
          <button class="at-skkey" type="button" data-k="2">2</button>
          <button class="at-skkey" type="button" data-k="3">3</button>
          <button class="at-skkey" type="button" data-k="4">4</button>
          <button class="at-skkey" type="button" data-k="5">5</button>
          <button class="at-skkey" type="button" data-k="6">6</button>
          <button class="at-skkey" type="button" data-k="7">7</button>
          <button class="at-skkey" type="button" data-k="8">8</button>
          <button class="at-skkey" type="button" data-k="9">9</button>
          <button class="at-skkey" type="button" data-k="clear">C</button>
          <button class="at-skkey" type="button" data-k="0">0</button>
          <button class="at-skkey" type="button" data-k="back">⌫</button>
        </div>
        <div class="at-skacts">
          <button class="at-skbtn arm" type="button" data-mode="home">Home</button>
          <button class="at-skbtn arm" type="button" data-mode="away">Away</button>
          <button class="at-skbtn arm" type="button" data-mode="night">Night</button>
          <button class="at-skbtn dis wide" type="button" data-mode="disarm">Disarm</button>
        </div>
      </div>`, css: `
.SKIN { --n1:#ff2fd0; --n2:#22e6ff; padding:12px; overflow:hidden;
  border-radius:var(--radius,14px); border:1px solid rgba(255,255,255,.1);
  background:radial-gradient(120% 80% at 50% 0%, #17092a 0%, #08060f 60%, #05040a 100%);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.SKIN .flood { position:absolute; inset:0; z-index:0; pointer-events:none;
  opacity:0; background:radial-gradient(120% 70% at 50% 50%,
    rgba(255,45,45,.55), transparent 70%); }
.SKIN .wrap { position:relative; z-index:1; display:flex; flex-direction:column;
  gap:7px; height:100%; min-height:0; flex-wrap:nowrap; }
.SKIN .lbl { margin:0; font-size:11px; text-align:center; letter-spacing:2px;
  text-transform:uppercase; color:#b8a6d8;
  text-shadow:1px 0 0 rgba(255,47,208,.55), -1px 0 0 rgba(34,230,255,.55); }
.SKIN .rd { display:flex; align-items:center; gap:8px; min-height:38px;
  padding:0 11px; border-radius:11px; background:rgba(255,255,255,.03);
  border:1px solid var(--n2);
  box-shadow:0 0 12px color-mix(in srgb,var(--n2) 45%,transparent),
    inset 0 0 12px color-mix(in srgb,var(--n1) 22%,transparent); }
.SKIN .at-sklb { color:var(--n2); font-size:14px; font-weight:800;
  letter-spacing:1px; text-transform:uppercase;
  text-shadow:0 0 10px color-mix(in srgb,var(--n2) 70%,transparent); }
.SKIN .at-skcd { margin-left:auto; color:var(--n1); font-size:16px;
  text-shadow:0 0 10px color-mix(in srgb,var(--n1) 70%,transparent); }
.SKIN .at-skdots i { border-color:color-mix(in srgb,var(--n1) 55%,transparent); }
.SKIN .at-skdots i.on { background:var(--n1); border-color:var(--n1);
  box-shadow:0 0 10px var(--n1); }
.SKIN .at-skmsg { color:#9d8fbb; }
.SKIN .at-skgrid { flex:1; min-height:0; grid-auto-rows:1fr; gap:6px; }
.SKIN .at-skkey { height:100%; border-radius:12px; font-size:21px; font-weight:700;
  color:#eaf6ff; background:rgba(255,255,255,.045);
  border:1px solid color-mix(in srgb,var(--n2) 55%,transparent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16);
  text-shadow:0 0 8px color-mix(in srgb,var(--n2) 45%,transparent); }
.SKIN .at-skkey:active { transform:scale(.95);
  background:color-mix(in srgb,var(--n2) 22%,transparent);
  border-color:var(--n1); color:#fff; }
.SKIN .at-skbtn { border-radius:12px; font-size:12px; letter-spacing:1.4px;
  text-transform:uppercase; color:#f6e9ff; background:rgba(255,255,255,.04);
  border:1px solid color-mix(in srgb,var(--n1) 60%,transparent); }
.SKIN .at-skbtn.dis { border-color:color-mix(in srgb,var(--n2) 60%,transparent);
  color:#e6fbff; }
.SKIN .at-skbtn:active { transform:scale(.95);
  background:color-mix(in srgb,var(--n1) 22%,transparent); }
.SKIN.sk-disarmed { --n1:#ff2fd0; --n2:#3cff9e; animation:none; }
.SKIN.sk-arming { --n1:#ffb02e; --n2:#ff2fd0; animation:none; }
.SKIN.sk-armed { --n1:#ff2fd0; --n2:#22e6ff; animation:none; }
.SKIN.sk-pending { --n1:#ffb02e; --n2:#ff6b2e; animation:none; }
.SKIN.sk-pending .flood { opacity:.25; }
.SKIN.sk-triggered { --n1:#ff2d2d; --n2:#ff5a5a; animation:none;
  border-color:#ff2d2d; }
.SKIN.sk-triggered .flood { opacity:1;
  animation:sk-nn-flood .8s ease-in-out infinite; }
@keyframes sk-nn-flood { 0%,100% { opacity:.85; } 50% { opacity:.2; } }
.SKIN.sk-off { --n1:#6b6a80; --n2:#6b6a80; animation:none; }
@media (prefers-reduced-motion: reduce) {
  .SKIN .flood { animation:none !important; } }` },

  { kind: 'skin', id: 'sk-retro', name: 'Classic alarm panel', category: 'Home Life',
    for: 'seckeypad', size: [300, 570], card: false, html: `
      <div class="wrap">
        <div class="at-name lbl">{{name}}</div>
        <div class="leds">
          <span class="led ready"><i></i>Ready</span>
          <span class="led armed"><i></i>Armed</span>
          <span class="led trouble"><i></i>Trouble</span>
        </div>
        <div class="lcd"><span class="at-sklb">Disarmed</span><b class="at-skcd"></b></div>
        <div class="at-skdots"><i></i><i></i><i></i><i></i></div>
        <div class="at-skmsg"></div>
        <div class="at-skgrid">
          <button class="at-skkey" type="button" data-k="1">1</button>
          <button class="at-skkey" type="button" data-k="2">2</button>
          <button class="at-skkey" type="button" data-k="3">3</button>
          <button class="at-skkey" type="button" data-k="4">4</button>
          <button class="at-skkey" type="button" data-k="5">5</button>
          <button class="at-skkey" type="button" data-k="6">6</button>
          <button class="at-skkey" type="button" data-k="7">7</button>
          <button class="at-skkey" type="button" data-k="8">8</button>
          <button class="at-skkey" type="button" data-k="9">9</button>
          <button class="at-skkey" type="button" data-k="clear">C</button>
          <button class="at-skkey" type="button" data-k="0">0</button>
          <button class="at-skkey" type="button" data-k="back">⌫</button>
        </div>
        <div class="at-skacts">
          <button class="at-skbtn arm" type="button" data-mode="home">Home</button>
          <button class="at-skbtn arm" type="button" data-mode="away">Away</button>
          <button class="at-skbtn arm" type="button" data-mode="night">Night</button>
          <button class="at-skbtn dis wide" type="button" data-mode="disarm">Disarm</button>
        </div>
      </div>`, css: `
.SKIN { padding:13px; overflow:hidden; border-radius:10px;
  border:1px solid #a9a291;
  background:linear-gradient(180deg,#e2ded0,#cfcab8 55%,#c2bda9);
  box-shadow:inset 0 1px 0 #f3f0e6;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.SKIN .wrap { position:relative; display:flex; flex-direction:column; gap:6px;
  height:100%; min-height:0; flex-wrap:nowrap; }
.SKIN .lbl { margin:0; font-size:11px; text-align:center; letter-spacing:1px;
  text-transform:uppercase; color:#6b6555; }
.SKIN .leds { display:flex; justify-content:space-between; gap:6px;
  padding:0 2px; }
.SKIN .led { display:flex; align-items:center; gap:5px; font-size:9.5px;
  letter-spacing:.6px; text-transform:uppercase; color:#6b6555; font-weight:700; }
.SKIN .led i { width:9px; height:9px; border-radius:50%; background:#8f8a7a;
  border:1px solid #6f6a5c; }
.SKIN .lcd { display:flex; align-items:center; gap:8px; min-height:42px;
  padding:0 10px; border-radius:3px;
  background:linear-gradient(180deg,#94b96f,#7ba354);
  border:2px solid #5d6a47; box-shadow:inset 0 2px 6px rgba(0,0,0,.35); }
.SKIN .at-sklb { color:#13210b; font-size:14px; font-weight:800;
  letter-spacing:.5px; text-shadow:0 1px 0 rgba(255,255,255,.25);
  font-family:ui-monospace,"Consolas","Courier New",monospace; }
.SKIN .at-skcd { margin-left:auto; color:#13210b; font-size:15px;
  font-family:ui-monospace,"Consolas","Courier New",monospace; }
.SKIN .at-skdots i { border-color:#8f8a7a; }
.SKIN .at-skdots i.on { background:#3f4a2c; border-color:#3f4a2c; }
.SKIN .at-skmsg { color:#6b6555; }
.SKIN .at-skgrid { flex:1; min-height:0; grid-auto-rows:1fr; gap:6px; }
.SKIN .at-skkey { height:100%; border-radius:5px; font-size:20px; font-weight:700;
  color:#2a2a26; border:1px solid #9b9484;
  background:linear-gradient(180deg,#f6f3e9,#ddd8c8);
  box-shadow:inset 0 1px 0 #fff, 0 2px 0 #a9a291; }
.SKIN .at-skkey:active { transform:translateY(2px);
  background:linear-gradient(180deg,#d5cfbe,#eae6da);
  box-shadow:inset 0 2px 5px rgba(0,0,0,.25); }
.SKIN .at-skbtn { border-radius:5px; font-size:12px; font-weight:700;
  color:#2a2a26; border:1px solid #9b9484;
  background:linear-gradient(180deg,#f6f3e9,#ddd8c8);
  box-shadow:inset 0 1px 0 #fff; }
.SKIN .at-skbtn:active { transform:translateY(2px);
  background:linear-gradient(180deg,#d5cfbe,#eae6da); }
.SKIN.sk-disarmed { animation:none; }
.SKIN.sk-disarmed .led.ready i { background:#35d46a; box-shadow:0 0 6px #35d46a; }
.SKIN.sk-arming { animation:none; }
.SKIN.sk-arming .led.armed i { background:#ff4030; box-shadow:0 0 6px #ff4030;
  animation:sk-rt-blink 1s steps(1,end) infinite; }
.SKIN.sk-armed { animation:none; }
.SKIN.sk-armed .led.armed i { background:#ff4030; box-shadow:0 0 6px #ff4030; }
.SKIN.sk-pending { animation:none; }
.SKIN.sk-pending .led.armed i { background:#ff4030; box-shadow:0 0 6px #ff4030;
  animation:sk-rt-blink .5s steps(1,end) infinite; }
.SKIN.sk-triggered { animation:none; border-color:#b03a2a; }
.SKIN.sk-triggered .led.armed i { background:#ff4030; box-shadow:0 0 6px #ff4030; }
.SKIN.sk-triggered .led.trouble i { background:#ffb300; box-shadow:0 0 6px #ffb300;
  animation:sk-rt-blink .4s steps(1,end) infinite; }
.SKIN.sk-triggered .lcd { background:linear-gradient(180deg,#e8b26a,#d18f3c); }
.SKIN.sk-off { animation:none; }
.SKIN.sk-off .led.trouble i { background:#ffb300; }
.SKIN.sk-off .lcd { background:linear-gradient(180deg,#a8ac9a,#8f9382); }
@keyframes sk-rt-blink { 0%,49% { opacity:1; } 50%,100% { opacity:.15; } }
@media (prefers-reduced-motion: reduce) {
  .SKIN .led i { animation:none !important; } }` },

  { kind: 'skin', id: 'sk-radar', name: 'Radar panel', category: 'Home Life',
    for: 'seckeypad', size: [260, 260], card: false, html: `
      <div class="scope">
        <div class="rings"></div>
        <div class="sweep"></div>
        <div class="mid"><span class="at-sklb">…</span><b class="at-skcd"></b>
          <span class="at-name nm">{{name}}</span></div>
      </div>`, css: `
.SKIN { align-items:center; justify-content:center; cursor:pointer;
  font-family:ui-monospace,"Consolas","Courier New",monospace; }
.SKIN .scope { position:relative; width:100%; height:100%; border-radius:50%;
  overflow:hidden; border:2px solid color-mix(in srgb,var(--sk,#5fd08a) 65%,transparent);
  background:radial-gradient(circle at 50% 50%,#0a2016 0%,#04140d 68%,#010906 100%);
  box-shadow:inset 0 0 34px rgba(0,0,0,.85); transition:transform .15s; }
.SKIN:active .scope { transform:scale(.95); }
.SKIN .rings { position:absolute; inset:0; opacity:.35;
  background:
    repeating-radial-gradient(circle at 50% 50%, transparent 0 24px,
      color-mix(in srgb,var(--sk,#5fd08a) 55%,transparent) 24px 25px),
    linear-gradient(90deg, transparent calc(50% - 1px),
      color-mix(in srgb,var(--sk,#5fd08a) 45%,transparent) calc(50% - 1px),
      color-mix(in srgb,var(--sk,#5fd08a) 45%,transparent) calc(50% + 1px),
      transparent calc(50% + 1px)),
    linear-gradient(180deg, transparent calc(50% - 1px),
      color-mix(in srgb,var(--sk,#5fd08a) 45%,transparent) calc(50% - 1px),
      color-mix(in srgb,var(--sk,#5fd08a) 45%,transparent) calc(50% + 1px),
      transparent calc(50% + 1px)); }
.SKIN .sweep { position:absolute; inset:0; border-radius:50%;
  background:conic-gradient(from 0deg,
    color-mix(in srgb,var(--sk,#5fd08a) 62%,transparent) 0deg,
    transparent 62deg, transparent 360deg);
  animation:sk-rd-spin 4.2s linear infinite; }
@keyframes sk-rd-spin { to { transform:rotate(360deg); } }
.SKIN .mid { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:2px; text-align:center;
  padding:0 18px; }
.SKIN .mid .at-sklb { font-size:14px; font-weight:800; letter-spacing:1px;
  text-transform:uppercase; max-width:100%;
  text-shadow:0 0 10px color-mix(in srgb,var(--sk,#5fd08a) 70%,transparent); }
.SKIN .mid .at-skcd { font-size:19px; }
.SKIN .nm { margin:2px 0 0; font-size:10px; letter-spacing:1px;
  text-transform:uppercase; color:#7f9a8b; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
.SKIN.sk-disarmed { animation:none; }
.SKIN.sk-disarmed .sweep { animation-duration:5.5s; }
.SKIN.sk-arming { animation:none; }
.SKIN.sk-arming .sweep { animation-duration:2.4s; }
.SKIN.sk-armed { animation:none; }
.SKIN.sk-armed .sweep { animation-duration:4s; }
.SKIN.sk-pending { animation:none; }
.SKIN.sk-pending .sweep { animation-duration:1.3s; }
.SKIN.sk-triggered { animation:none; }
.SKIN.sk-triggered .scope { border-width:3px;
  background:radial-gradient(circle at 50% 50%,#2a0808 0%,#160303 68%,#0a0101 100%); }
.SKIN.sk-triggered .sweep { animation-duration:.7s; }
.SKIN.sk-off { animation:none; }
.SKIN.sk-off .sweep { animation:none; opacity:.2; }
@media (prefers-reduced-motion: reduce) {
  .SKIN .sweep { animation:none !important; opacity:.5; } }` },

  { kind: 'skin', id: 'sk-siren', name: 'Siren bar', category: 'Home Life',
    for: 'seckeypad', size: [340, 110], card: true, html: `
      <div class="row">
        <div class="beacon"><i class="beam"></i><i class="dome"></i></div>
        <div class="tx"><span class="at-name nm">{{name}}</span>
          <span class="at-sklb lb">…</span></div>
        <b class="at-skcd"></b>
      </div>`, css: `
.SKIN { cursor:pointer; justify-content:center; transition:transform .15s; }
.SKIN:active { transform:scale(.985); }
.SKIN .row { display:flex; align-items:center; gap:14px; }
.SKIN .beacon { position:relative; flex:0 0 54px; width:54px; height:54px;
  border-radius:50%; overflow:hidden; border:2px solid rgba(0,0,0,.45);
  background:radial-gradient(circle at 50% 62%,
    color-mix(in srgb,var(--sk,#8b98b8) 45%,#0a0d14),
    #070a10 72%);
  box-shadow:inset 0 -6px 10px rgba(0,0,0,.6); }
.SKIN .beam { position:absolute; inset:0; border-radius:50%;
  background:conic-gradient(from 0deg,
    color-mix(in srgb,var(--sk,#8b98b8) 85%,transparent) 0deg,
    transparent 46deg, transparent 180deg,
    color-mix(in srgb,var(--sk,#8b98b8) 85%,transparent) 180deg,
    transparent 226deg, transparent 360deg);
  opacity:.35; }
.SKIN .dome { position:absolute; inset:0; border-radius:50%; pointer-events:none;
  background:linear-gradient(180deg, rgba(255,255,255,.3), transparent 45%); }
.SKIN .tx { display:flex; flex-direction:column; min-width:0; }
.SKIN .nm { margin:0; font-size:11px; letter-spacing:1.4px;
  text-transform:uppercase; color:var(--mut,#8b98b8); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.SKIN .lb { font-size:19px; font-weight:800; letter-spacing:.5px;
  text-transform:uppercase; }
.SKIN .at-skcd { margin-left:auto; font-size:24px; }
.SKIN.sk-disarmed { animation:none; }
.SKIN.sk-arming { animation:none; }
.SKIN.sk-arming .beam { opacity:.6; }
.SKIN.sk-armed { animation:none; }
.SKIN.sk-armed .beam { opacity:.55; }
.SKIN.sk-pending { animation:none; }
.SKIN.sk-pending .beam { opacity:.9;
  animation:sk-sr-spin 1.6s linear infinite; }
.SKIN.sk-triggered { animation:none; }
.SKIN.sk-triggered .beacon { border-color:#ff3b3b;
  box-shadow:inset 0 -6px 10px rgba(0,0,0,.5), 0 0 16px rgba(255,59,59,.65); }
.SKIN.sk-triggered .beam { opacity:1; animation:sk-sr-spin .55s linear infinite; }
.SKIN.sk-triggered .lb { animation:sk-sr-blink .55s steps(1,end) infinite; }
@keyframes sk-sr-spin { to { transform:rotate(360deg); } }
@keyframes sk-sr-blink { 0%,49% { opacity:1; } 50%,100% { opacity:.35; } }
.SKIN.sk-off { animation:none; }
.SKIN.sk-off .beam { opacity:.15; }
@media (prefers-reduced-motion: reduce) {
  .SKIN .beam, .SKIN .lb { animation:none !important; } }` },
]},
];
