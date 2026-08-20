/* AI Assistant — Advance Tools
 * Chat UI, push-to-talk + wake-word voice input (Web Speech API),
 * spoken replies (speechSynthesis), confirmation / PIN flow, settings.
 */
'use strict';

const API = '/api/tools/ai_assistant';

let SETTINGS = {};
let DEFAULTS = {};
let SESSION = String(Date.now());

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, opts) {
  const resp = await fetch(API + path, Object.assign({
    headers: { 'Content-Type': 'application/json' },
  }, opts));
  let body = {};
  try { body = await resp.json(); } catch (e) { /* empty */ }
  if (!resp.ok) throw new Error(body.error || ('HTTP ' + resp.status));
  return body;
}

/* ------------------------------------------------------------- tabs */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('on'));
    tab.classList.add('on');
    $('page-' + tab.dataset.page).classList.add('on');
  });
});

/* ------------------------------------------------------------- chat */

function addMsg(cls, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  el.textContent = text;
  $('msgs').appendChild(el);
  $('msgs').scrollTop = $('msgs').scrollHeight;
  return el;
}

function addTyping() {
  const el = document.createElement('div');
  el.className = 'typing';
  el.innerHTML = 'thinking <span>●</span><span>●</span><span>●</span>';
  $('msgs').appendChild(el);
  $('msgs').scrollTop = $('msgs').scrollHeight;
  return el;
}

function addActions(msgEl, actions) {
  if (!actions || !actions.length) return;
  const box = document.createElement('div');
  box.className = 'acts';
  actions.forEach((a) => {
    const row = document.createElement('div');
    row.className = a.ok ? 'ok' : 'bad';
    row.textContent = a.call + (a.error ? ' — ' + a.error : '');
    box.appendChild(row);
  });
  msgEl.appendChild(box);
}

function addConfirm(pending) {
  const box = document.createElement('div');
  box.className = 'confirmbox';
  box.innerHTML =
    '<p>🔐 Confirm this action?<br><code>' + esc(pending.summary) +
    '</code></p>' +
    (pending.needs_pin
      ? '<input type="password" inputmode="numeric" placeholder="PIN">'
      : '');
  const yes = document.createElement('button');
  yes.className = 'btn sm';
  yes.textContent = '✅ Confirm';
  const no = document.createElement('button');
  no.className = 'ghost';
  no.style.marginLeft = '8px';
  no.textContent = 'Cancel';
  box.appendChild(yes); box.appendChild(no);
  $('msgs').appendChild(box);
  $('msgs').scrollTop = $('msgs').scrollHeight;

  yes.addEventListener('click', async () => {
    const pin = box.querySelector('input');
    yes.disabled = true;
    try {
      const res = await api('/confirm', {
        method: 'POST',
        body: JSON.stringify({ id: pending.id, pin: pin ? pin.value : '' }),
      });
      box.remove();
      const el = addMsg('bot', res.ok ? '✅ Done.' : '⚠️ Something failed.');
      addActions(el, res.results);
      speak(res.ok ? 'Done' : 'Something failed');
    } catch (err) {
      yes.disabled = false;
      toast(err.message, true);
    }
  });
  no.addEventListener('click', () => {
    api('/cancel', { method: 'POST', body: JSON.stringify({ id: pending.id }) })
      .catch(() => {});
    box.remove();
    addMsg('sys', 'Cancelled.');
  });
}

let busy = false;

async function send(text) {
  text = (text || '').trim();
  if (!text || busy) return;
  busy = true;
  addMsg('user', text);
  $('input').value = '';
  autosize();
  const typing = addTyping();
  try {
    const res = await api('/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, session: SESSION }),
    });
    typing.remove();
    const el = addMsg('bot', res.reply);
    addActions(el, res.actions);
    if (res.pending) addConfirm(res.pending);
    speak(res.reply);
  } catch (err) {
    typing.remove();
    addMsg('bot', '⚠️ ' + err.message);
  }
  busy = false;
}

$('sendbtn').addEventListener('click', () => send($('input').value));
$('input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    send($('input').value);
  }
});

function autosize() {
  const el = $('input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}
$('input').addEventListener('input', autosize);

$('resetbtn').addEventListener('click', () => {
  SESSION = String(Date.now());
  $('msgs').innerHTML = '';
  addMsg('sys', 'New conversation started.');
});

/* ------------------------------------------------------------- TTS */

function speak(text) {
  if (!$('speakchk').checked) return;
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(
      String(text).replace(/[✅⚠️🔐🎙🧹]/g, '').slice(0, 400));
    const lang = SETTINGS.language;
    if (lang && lang !== 'auto') utter.lang = lang;
    window.speechSynthesis.speak(utter);
  } catch (e) { /* voice is best-effort */ }
}

/* ------------------------------------------------- speech recognition */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let ptt = null;          // push-to-talk recognizer
let pttActive = false;
let pttFinal = '';
let wake = null;         // wake-word recognizer
let wakeWanted = false;

function srLang() {
  const lang = SETTINGS.language;
  return (lang && lang !== 'auto') ? lang : (navigator.language || 'en-US');
}

function voiceBlockReason() {
  if (!SR) return 'This browser has no speech recognition — use Chrome.';
  if (!window.isSecureContext) return 'Voice needs the HTTPS address.';
  if (window.top !== window.self) {
    try { void window.top.location.host; } catch (e) {
      return 'The microphone is blocked inside the Home Assistant frame — ' +
             'open Advance Tools at its direct address to use voice.';
    }
  }
  return '';
}

function vNorm(t) {
  return String(t || '').toLowerCase()
    .replace(/[.,!?;:'"\u00ab\u00bb\u061f\u060c\u2026]/g, ' ')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function ackText() {
  const t = (SETTINGS.ack_text || '').trim();
  if (t) return t;
  return (SETTINGS.language || '').startsWith('fa') ? '\u062c\u0627\u0646\u0645\u061f' : 'Yes?';
}

function speakForce(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 200));
    const lang = SETTINGS.language;
    if (lang && lang !== 'auto') u.lang = lang;
    window.speechSynthesis.speak(u);
  } catch (e) { /* best effort */ }
}

function micPermission() {
  /* Resolves '' on success, or the DOMException name on failure. */
  const gm = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia({ audio: true }) : null;
  if (!gm) return Promise.resolve('');
  return gm.then(st => { st.getTracks().forEach(t => t.stop()); return ''; })
           .catch(e => (e && e.name) || 'NotAllowedError');
}

function micFailText(name) {
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'No microphone was found on this device — plug one in or use a ' +
           'device that has one.';
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'The microphone is busy or not working — check the system sound ' +
           'settings.';
  return 'Microphone permission was denied — allow the mic for this site.';
}

function beep(freq) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq || 880;
    gain.gain.value = 0.08;
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 140);
  } catch (e) { /* no audio */ }
}

/* ---- push-to-talk: hold the mic button (or tap to toggle) ---- */

async function pttStart() {
  const reason = voiceBlockReason();
  if (reason) { toast(reason, true); return; }
  if (pttActive) return;
  const permErr = await micPermission();
  if (permErr) { toast(micFailText(permErr), true); return; }
  if (pttActive) return;
  stopWakeInternal();                  // one mic user at a time
  pttActive = true;
  pttFinal = '';
  $('micbtn').classList.add('rec');
  $('input').value = '';
  pttSpin();
}

/* Mobile browsers end a recognition session after every pause; keep
   restarting while the button is held (or toggled on) and accumulate. */
function pttSpin() {
  if (!pttActive) return;
  ptt = new SR();
  ptt.lang = srLang();
  ptt.interimResults = true;
  ptt.continuous = true;
  ptt.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) {
        pttFinal = (pttFinal + ' ' + ev.results[i][0].transcript).trim();
      } else interim += ev.results[i][0].transcript;
    }
    $('input').value = (pttFinal + ' ' + interim).trim();
    autosize();
  };
  ptt.onend = () => {
    ptt = null;
    if (pttActive) { setTimeout(pttSpin, 150); return; }   // keep listening
    $('micbtn').classList.remove('rec');
    const text = $('input').value.trim();
    if (text) send(text);
    restartWakeIfWanted();
  };
  ptt.onerror = (ev) => {
    const e = (ev || {}).error;
    if (e === 'not-allowed') pttActive = false;
    if (e && e !== 'aborted' && e !== 'no-speech')
      toast(e === 'not-allowed'
        ? 'Microphone blocked \u2014 allow the mic for this site.'
        : e === 'network'
          ? 'Speech service unreachable \u2014 check the internet, use Chrome.'
          : 'Speech error: ' + e, true);
  };
  try { ptt.start(); } catch (e) { /* restart race */ }
}

function pttStop() {
  pttActive = false;
  if (ptt) { try { ptt.stop(); } catch (e) { /* already stopped */ } }
}

let pressTimer = null;
let wasHold = false;
$('micbtn').addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  wasHold = false;
  pressTimer = setTimeout(() => { wasHold = true; pttStart(); }, 220);
});
$('micbtn').addEventListener('pointerup', (ev) => {
  ev.preventDefault();
  clearTimeout(pressTimer);
  if (wasHold) pttStop();                       // hold-to-talk released
  else if (pttActive) pttStop();                // tap while recording → stop
  else pttStart();                              // tap → start
});
$('micbtn').addEventListener('pointerleave', () => {
  clearTimeout(pressTimer);
  if (wasHold) pttStop();
});

/* ---- wake word: continuous listen for "hey <name>" ---- */

function wakePhrases() {
  const names = [SETTINGS.assistant_name || 'Nova'];
  String(SETTINGS.wake_aliases || '').split(',').forEach((a) => {
    if (a.trim()) names.push(a.trim());
  });
  const out = [];
  names.forEach((n) => {
    n = vNorm(n);
    if (!n) return;
    ['hey ' + n, 'ok ' + n, 'okay ' + n, 'hi ' + n, n].forEach((p) => out.push(p));
  });
  return out.sort((a, b) => b.length - a.length);
}

function matchWake(text) {
  const t = vNorm(text);
  const flat = t.split(' ').join('');
  for (const p of wakePhrases()) {
    const i = t.indexOf(p);
    if (i >= 0) return { rest: t.slice(i + p.length).trim() };
    if (flat.includes(p.split(' ').join(''))) return { rest: '' };
  }
  return null;
}

let wakeCap = null;                    // { text, timer } — survives restarts
let wakePermErrs = 0;

function wakeFinish() {
  const c = wakeCap;
  wakeCap = null;
  $('wakestate').textContent = '\ud83d\udc42 listening for wake word\u2026';
  $('wakestate').className = '';
  if (c && c.text) { beep(660); send(c.text); }
  else beep(440);
}

function wakeArm(ms) {
  if (!wakeCap) return;
  clearTimeout(wakeCap.timer);
  wakeCap.timer = setTimeout(wakeFinish, ms);
}

function startWake() {
  const reason = voiceBlockReason();
  if (reason) { toast(reason, true); $('wakechk').checked = false; return; }
  micPermission().then((permErr) => {
    if (permErr) {
      toast(micFailText(permErr), true);
      $('wakechk').checked = false;
      return;
    }
    wakeWanted = true;
    runWake();
  });
}

function runWake() {
  if (!wakeWanted || pttActive) return;
  wake = new SR();
  wake.lang = srLang();
  wake.interimResults = false;
  wake.continuous = true;
  if (!wakeCap) {
    $('wakestate').textContent = '\ud83d\udc42 listening for wake word\u2026';
    $('wakestate').className = '';
  }

  wake.onresult = (ev) => {
    if (window.speechSynthesis && window.speechSynthesis.speaking) return;
    const raw = ev.results[ev.results.length - 1][0].transcript;
    if (!wakeCap) {
      const m = matchWake(raw);
      if (!m) return;
      beep(990);
      if (m.rest) { beep(660); send(m.rest); return; }
      speakForce(ackText());                 // answer the wake word out loud
      $('wakestate').textContent = '\ud83c\udf99 yes? say your command\u2026';
      $('wakestate').className = 'listening';
      wakeCap = { text: '', timer: null };
      wakeArm(9000);
    } else {
      wakeCap.text = (wakeCap.text + ' ' + vNorm(raw)).trim();
      wakeArm(1600);
    }
  };
  wake.onend = () => { setTimeout(runWake, wakeCap ? 200 : 400); };
  wake.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      wakePermErrs += 1;
      if (wakePermErrs >= 3) {
        wakeWanted = false;
        $('wakechk').checked = false;
        $('wakestate').textContent = '';
        toast('Microphone permission denied.', true);
        return;
      }
      /* Chrome may refuse without a fresh user gesture — retry on tap. */
      const once = () => {
        document.removeEventListener('pointerdown', once);
        if (wakeWanted) runWake();
      };
      document.addEventListener('pointerdown', once);
    } else {
      wakePermErrs = 0;
    }
  };
  try { wake.start(); } catch (e) { /* restart race */ }
}

function stopWakeInternal() {
  if (wake) { try { wake.onend = null; wake.stop(); } catch (e) { /* gone */ } }
  wake = null;
  $('wakestate').textContent = '';
}

function restartWakeIfWanted() {
  if (wakeWanted) setTimeout(runWake, 300);
}

$('wakechk').addEventListener('change', () => {
  if ($('wakechk').checked) startWake();
  else { wakeWanted = false; stopWakeInternal(); }
});

/* ------------------------------------------------------------- settings */

function fillSettings() {
  const s = SETTINGS;
  $('s-provider').value = s.provider || 'anthropic';
  $('s-model').value = s.model || '';
  $('s-name').value = s.assistant_name || 'Nova';
  $('s-lang').value = s.language || 'auto';
  $('s-aliases').value = s.wake_aliases || '';
  $('s-fburl').value = s.fallback_url || '';
  $('s-fbmodel').value = s.fallback_model || '';
  $('fbkey-state').textContent = s.fallback_key_set
    ? '\u2705 key saved \u2014 leave empty to keep it' : 'no key yet';
  $('s-ack').value = s.ack_text || '';
  $('s-ollama').value = s.ollama_url || '';
  $('s-safety').value = (s.safety || {}).mode || 'confirm';
  $('s-sens').value = ((s.safety || {}).sensitive_domains || []).join(', ');
  $('s-tgchats').value = ((s.telegram || {}).allow_chats || []).join(', ');
  $('s-tgpoll').value = (s.telegram || {}).polling === false ? '0' : '1';
  $('akey-state').textContent = s.anthropic_key_set
    ? '✅ key saved — leave empty to keep it' : 'no key yet';
  $('okey-state').textContent = (s.openai_key_set
    ? '✅ key saved — leave empty to keep it. '
    : '') + 'Also used to transcribe Telegram voice notes.';
  $('ckey-state').textContent = s.custom_key_set
    ? '\u2705 key saved \u2014 leave empty to keep it'
    : 'Needed for Groq / Gemini / OpenRouter / Cerebras; leave empty for ' +
      'a local Ollama.';
  $('pin-state').textContent = (s.safety || {}).pin_set
    ? '✅ PIN set — leave empty to keep it' : 'no PIN yet';
  $('tg-state').innerHTML = ((s.telegram || {}).token_set
    ? '✅ token saved — leave empty to keep it. '
    : 'Create one with @BotFather. ') +
    '⚠ Use a <b>different</b> bot than Notify Hub.';
  $('wakename').textContent = '“Hey ' + (s.assistant_name || 'Nova') + '”';
  $('modelhint').textContent = 'Default: ' +
    (DEFAULTS[$('s-provider').value] || '');
  updateProviderFields();
}

function updateProviderFields() {
  const p = $('s-provider').value;
  $('f-akey').style.display = p === 'anthropic' ? '' : 'none';
  $('f-ollama').style.display = p === 'ollama' ? '' : 'none';
  $('f-ckey').style.display = p === 'ollama' ? '' : 'none';
  $('modelhint').textContent = 'Default: ' + (DEFAULTS[p] || '');
}
$('s-provider').addEventListener('change', updateProviderFields);

$('savebtn').addEventListener('click', async () => {
  const body = {
    provider: $('s-provider').value,
    model: $('s-model').value,
    assistant_name: $('s-name').value,
    wake_aliases: $('s-aliases').value,
    ack_text: $('s-ack').value,
    language: $('s-lang').value,
    ollama_url: $('s-ollama').value,
    fallback_url: $('s-fburl').value,
    fallback_model: $('s-fbmodel').value,
    safety: {
      mode: $('s-safety').value,
      sensitive_domains: $('s-sens').value.split(',')
        .map((d) => d.trim()).filter(Boolean),
    },
    telegram: {
      polling: $('s-tgpoll').value === '1',
      allow_chats: $('s-tgchats').value.split(',')
        .map((c) => c.trim()).filter(Boolean),
    },
  };
  if ($('s-akey').value.trim()) body.anthropic_key = $('s-akey').value.trim();
  if ($('s-okey').value.trim()) body.openai_key = $('s-okey').value.trim();
  if ($('s-ckey').value.trim()) body.custom_key = $('s-ckey').value.trim();
  if ($('s-fbkey').value.trim()) body.fallback_key = $('s-fbkey').value.trim();
  if ($('s-pin').value.trim()) body.safety.pin = $('s-pin').value.trim();
  if ($('s-tgtoken').value.trim()) {
    body.telegram.token = $('s-tgtoken').value.trim();
  }
  $('savestate').textContent = 'saving…';
  try {
    const res = await api('/settings', {
      method: 'POST', body: JSON.stringify(body),
    });
    SETTINGS = res.settings;
    ['s-akey', 's-okey', 's-ckey', 's-fbkey', 's-pin', 's-tgtoken'].forEach((id) => {
      $(id).value = '';
    });
    fillSettings();
    $('savestate').innerHTML = '<span class="ok">✅ saved</span>';
    toast('Settings saved');
  } catch (err) {
    $('savestate').innerHTML = '<span class="bad">' + esc(err.message) +
      '</span>';
    toast(err.message, true);
  }
});

$('testbtn').addEventListener('click', async () => {
  $('teststate').textContent = 'testing…';
  try {
    const res = await api('/test', { method: 'POST', body: '{}' });
    $('teststate').innerHTML = '<span class="ok">✅ ' + esc(res.provider) +
      ' / ' + esc(res.model) + ' → “' + esc(res.reply) + '”</span>';
  } catch (err) {
    $('teststate').innerHTML = '<span class="bad">' + esc(err.message) +
      '</span>';
  }
});

/* ------------------------------------------------------------- boot */

async function refreshStatus() {
  try {
    const data = await api('/data');
    SETTINGS = data.settings;
    DEFAULTS = data.defaults || {};
    const bot = data.bot || {};
    $('botstatus').textContent = bot.running
      ? ('✅ @' + bot.username + ' polling')
      : (bot.error ? '⚠️ ' + bot.error : 'bot idle');
  } catch (err) { /* keep previous */ }
}

async function boot() {
  await refreshStatus();
  fillSettings();
  addMsg('sys', 'Hi! Type a command, hold 🎤 to talk, or enable the wake ' +
                'word. Configure the AI engine under Settings first.');
  setInterval(refreshStatus, 20000);
}

boot();
