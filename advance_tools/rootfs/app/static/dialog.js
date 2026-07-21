/* Advance Tools — shared styled dialogs (replaces native confirm/prompt). */
(function () {
'use strict';

const css = `
.pmdlg-ov { position:fixed; inset:0; background:rgba(4,7,14,.72);
  backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center;
  z-index:1000; animation:pmdlg-in .18s ease; }
@keyframes pmdlg-in { from { opacity:0; } }
.pmdlg { background:linear-gradient(180deg,#1c2434,#151c2a);
  border:1px solid #2f3b58; border-radius:18px; padding:24px 26px;
  width:min(92vw,420px); box-shadow:0 24px 70px rgba(0,0,0,.6);
  animation:pmdlg-pop .22s cubic-bezier(.34,1.4,.64,1);
  font-family:"Segoe UI",Tahoma,sans-serif; color:#e8edf7; }
@keyframes pmdlg-pop { from { transform:scale(.92) translateY(10px); opacity:0; } }
.pmdlg .ic { width:44px; height:44px; border-radius:13px; display:flex;
  align-items:center; justify-content:center; font-size:21px; margin-bottom:14px;
  background:linear-gradient(135deg,#4f8cff,#7b5cff); }
.pmdlg.danger .ic { background:linear-gradient(135deg,#ff6b81,#c2334d); }
.pmdlg h3 { font-size:16px; margin:0 0 6px; }
.pmdlg p { font-size:13px; color:#8b98b8; line-height:1.8; margin:0; }
.pmdlg input { width:100%; margin-top:14px; padding:11px 12px; border-radius:10px;
  border:1px solid #2f3b58; background:#101624; color:#e8edf7; font-size:14px;
  box-sizing:border-box; }
.pmdlg input:focus { outline:none; border-color:#4f8cff; }
.pmdlg .btns { display:flex; gap:10px; justify-content:flex-end; margin-top:20px; }
.pmdlg button { border:0; padding:10px 22px; border-radius:10px; cursor:pointer;
  font-size:14px; font-weight:600; }
.pmdlg .ok { background:linear-gradient(135deg,#4f8cff,#7b5cff); color:#fff; }
.pmdlg.danger .ok { background:linear-gradient(135deg,#ff6b81,#c2334d); }
.pmdlg .cancel { background:rgba(255,255,255,.07); color:#8b98b8;
  border:1px solid #2f3b58; }
.pmdlg button:active { transform:scale(.97); }
body.light .pmdlg { background:#ffffff; border-color:#dde3f0; color:#17203a;
  box-shadow:0 24px 70px rgba(23,32,58,.18); }
body.light .pmdlg p { color:#5b6784; }
body.light .pmdlg input { background:#f4f6fb; border-color:#dde3f0; color:#17203a; }
body.light .pmdlg .cancel { background:#f4f6fb; color:#5b6784; border-color:#dde3f0; }`;

function ensureCss() {
  if (document.getElementById('pmdlg-css')) return;
  const s = document.createElement('style');
  s.id = 'pmdlg-css';
  s.textContent = css;
  document.head.appendChild(s);
}

function show({ title, message, icon, danger, input, value, okText, cancelText }) {
  ensureCss();
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'pmdlg-ov';
    ov.innerHTML = `
      <div class="pmdlg${danger ? ' danger' : ''}">
        <div class="ic">${icon || (danger ? '⚠️' : '✳️')}</div>
        <h3>${title || ''}</h3>
        ${message ? `<p>${message}</p>` : ''}
        ${input ? `<input value="${(value || '').replace(/"/g, '&quot;')}">` : ''}
        <div class="btns">
          <button class="cancel">${cancelText || 'Cancel'}</button>
          <button class="ok">${okText || 'OK'}</button>
        </div>
      </div>`;
    const inp = ov.querySelector('input');
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector('.ok').onclick = () => done(input ? (inp.value.trim() || null) : true);
    ov.querySelector('.cancel').onclick = () => done(input ? null : false);
    ov.addEventListener('pointerdown', ev => {
      if (ev.target === ov) done(input ? null : false);
    });
    ov.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') done(input ? null : false);
      if (ev.key === 'Enter') done(input ? (inp.value.trim() || null) : true);
    });
    document.body.appendChild(ov);
    (inp || ov.querySelector('.ok')).focus();
    if (inp) inp.select();
  });
}

window.ATDialog = {
  confirm: (title, message, opts) =>
    show(Object.assign({ title, message, okText: 'Yes, do it' }, opts)),
  prompt: (title, message, value, opts) =>
    show(Object.assign({ title, message, value, input: true, okText: 'Save' }, opts)),
  alert: (title, message, opts) =>
    show(Object.assign({ title, message, okText: 'OK', cancelText: 'Close' }, opts)),
};
})();
