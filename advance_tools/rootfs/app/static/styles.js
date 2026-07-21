/* Advance Tools — card style library.
 * Each style's CSS uses the placeholder `.CARD` which is compiled to the real
 * selector (.w[data-cs="<id>"]) at runtime. `.CARD.on` styles the active state.
 * Custom styles imported by the admin use the same format.
 */
window.AT_STYLES = [
  /* ---------------- Glass ---------------- */
  { id: 'glass', name: 'Glassmorphism', category: 'Glass', css: `
.CARD { background: rgba(255,255,255,.07); backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.13);
  box-shadow: 0 4px 14px rgba(0,0,0,.22); }
.CARD.on { border-color: var(--accent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 35%, transparent); }` },

  { id: 'frost', name: 'Frost hover', category: 'Glass', css: `
.CARD { background: rgba(255,255,255,.05); backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,.09);
  transition: transform .25s, box-shadow .25s; }
.CARD:hover { transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0,0,0,.32); }
.CARD.on { background: rgba(255,255,255,.11); border-color: var(--accent); }` },

  /* ---------------- Neon ---------------- */
  { id: 'neon-blue', name: 'Neon blue', category: 'Neon', css: `
.CARD { background: #0b0f1a; border: 1px solid #38bdf8;
  box-shadow: 0 0 8px rgba(56,189,248,.3), inset 0 0 14px rgba(56,189,248,.06); }
.CARD.on { animation: at-neonb 1.8s ease-in-out infinite; border-color: #7dd3fc; }
@keyframes at-neonb {
  0%,100% { box-shadow: 0 0 8px rgba(56,189,248,.45), inset 0 0 14px rgba(56,189,248,.1); }
  50%     { box-shadow: 0 0 16px rgba(56,189,248,.75), inset 0 0 20px rgba(56,189,248,.18); } }` },

  { id: 'neon-pink', name: 'Neon pink', category: 'Neon', css: `
.CARD { background: #140a18; border: 1px solid #f472b6;
  box-shadow: 0 0 8px rgba(244,114,182,.3), inset 0 0 14px rgba(244,114,182,.06); }
.CARD.on { animation: at-neonp 1.8s ease-in-out infinite; border-color: #f9a8d4; }
@keyframes at-neonp {
  0%,100% { box-shadow: 0 0 8px rgba(244,114,182,.45), inset 0 0 14px rgba(244,114,182,.1); }
  50%     { box-shadow: 0 0 16px rgba(244,114,182,.75), inset 0 0 20px rgba(244,114,182,.18); } }` },

  /* ---------------- Gradient ---------------- */
  { id: 'sunset', name: 'Sunset flow', category: 'Gradient', css: `
.CARD { background: linear-gradient(135deg,#ff6a3d,#c04cf0,#3d5aff);
  background-size: 300% 300%; animation: at-sun 14s ease infinite;
  border: 0; color: #fff; }
.CARD .name { color: rgba(255,255,255,.8); }
.CARD.on { box-shadow: 0 0 16px rgba(255,120,80,.45); }
@keyframes at-sun { 0%{background-position:0% 50%} 50%{background-position:100% 50%}
  100%{background-position:0% 50%} }` },

  { id: 'ocean', name: 'Ocean flow', category: 'Gradient', css: `
.CARD { background: linear-gradient(135deg,#0ea5e9,#22d3ee,#6366f1);
  background-size: 300% 300%; animation: at-oce 14s ease infinite;
  border: 0; color: #fff; }
.CARD .name { color: rgba(255,255,255,.8); }
.CARD.on { box-shadow: 0 0 16px rgba(34,211,238,.45); }
@keyframes at-oce { 0%{background-position:0% 50%} 50%{background-position:100% 50%}
  100%{background-position:0% 50%} }` },

  { id: 'aurora', name: 'Aurora', category: 'Gradient', css: `
.CARD { position: relative; overflow: hidden; background: #0c1122;
  border: 1px solid rgba(255,255,255,.08); }
.CARD::before { content: ''; position: absolute; inset: -60%;
  background: radial-gradient(circle at 30% 30%, rgba(79,140,255,.4), transparent 42%),
              radial-gradient(circle at 70% 70%, rgba(62,207,142,.35), transparent 45%),
              radial-gradient(circle at 60% 20%, rgba(192,76,240,.3), transparent 40%);
  animation: at-aur 10s linear infinite; }
.CARD > * { position: relative; z-index: 1; }
.CARD.on { border-color: rgba(62,207,142,.75); }
@keyframes at-aur { to { transform: rotate(360deg); } }` },

  /* ---------------- Minimal ---------------- */
  { id: 'flat-light', name: 'Flat light', category: 'Minimal', css: `
.CARD { background: #f4f6fb; color: #12141a; border: 0; }
.CARD .name { color: #5b6472; }
.CARD.on { background: var(--accent); color: #fff; }
.CARD.on .name { color: rgba(255,255,255,.85); }` },

  { id: 'outline', name: 'Outline', category: 'Minimal', css: `
.CARD { background: transparent; border: 1.5px solid rgba(255,255,255,.16);
  transition: border-color .2s, background .2s; }
.CARD.on { border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent); }` },

  /* ---------------- Fun ---------------- */
  { id: 'cyber', name: 'Cyberpunk', category: 'Fun', css: `
.CARD { background: linear-gradient(#0d0f17,#131b2c); border: 1px solid #22d3ee;
  border-radius: 0; position: relative; overflow: hidden;
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%,
                     16px 100%, 0 calc(100% - 16px)); }
.CARD::after { content: ''; position: absolute; left: -120%; top: 0; width: 60%;
  height: 100%; transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent, rgba(34,211,238,.16), transparent);
  animation: at-cybs 4s ease-in-out infinite; }
.CARD.on { border-color: #f0abfc;
  /* clip-path clips outer shadows, so the active glow must be inset-only */
  box-shadow: inset 0 0 18px rgba(240,171,252,.22), inset 0 0 30px rgba(34,211,238,.1); }
@keyframes at-cybs { 0%,60% { left: -120%; } 100% { left: 160%; } }` },

  { id: 'bounce', name: 'Bouncy', category: 'Fun', css: `
.CARD { background: var(--card); border: 1px solid rgba(255,255,255,.1);
  transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
.CARD:active { transform: scale(.9); }
.CARD.on { border-color: var(--accent); animation: at-bnc .5s cubic-bezier(.34,1.56,.64,1); }
@keyframes at-bnc { 0% { transform: scale(.86); } 60% { transform: scale(1.06); }
  100% { transform: scale(1); } }` },
];

/* Compile a style's CSS: replace .CARD placeholder with the real selector. */
window.AT_COMPILE = function (style) {
  return style.css.split('.CARD').join(`.w[data-cs="${style.id}"]`);
};
