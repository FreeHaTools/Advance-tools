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
let wake = null;         // wake-word recognizer
let wakeWanted = false;
let capturing = false;   // wake mode: currently capturing a command

function srLang() {
  const lang = SETTINGS.language;
  return (lang && lang !== 'auto') ? lang : (navigator.language || 'en-US');
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

function pttStart() {
  if (!SR) { toast('This browser has no speech recognition — use Chrome.', true); return; }
  if (pttActive) return;
  stopWakeInternal();                  // one mic user at a time
  ptt = new SR();
  ptt.lang = srLang();
  ptt.interimResults = true;
  ptt.continuous = true;
  let finalText = '';
  ptt.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
      else interim += ev.results[i][0].transcript;
    }
    $('input').value = (finalText + ' ' + interim).trim();
    autosize();
  };
  ptt.onend = () => {
    pttActive = false;
    $('micbtn').classList.remove('rec');
    const text = $('input').value.trim();
    if (text) send(text);
    restartWakeIfWanted();
  };
  ptt.onerror = () => { /* onend follows */ };
  pttActive = true;
  $('micbtn').classList.add('rec');
  $('input').value = '';
  ptt.start();
}

function pttStop() {
  if (ptt && pttActive) { try { ptt.stop(); } catch (e) { /* already stopped */ } }
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
  const name = (SETTINGS.assistant_name || 'Nova').toLowerCase();
  return ['hey ' + name, 'hi ' + name, 'ok ' + name, name];
}

function startWake() {
  if (!SR) { toast('This browser has no speech recognition — use Chrome.', true);
             $('wakechk').checked = false; return; }
  wakeWanted = true;
  runWake();
}

function runWake() {
  if (!wakeWanted || pttActive) return;
  wake = new SR();
  wake.lang = srLang();
  wake.interimResults = false;
  wake.continuous = true;
  capturing = false;
  let captured = '';
  let captureTimer = null;
  $('wakestate').textContent = '👂 listening for wake word…';
  $('wakestate').className = '';

  wake.onresult = (ev) => {
    const text = ev.results[ev.results.length - 1][0].transcript
      .trim().toLowerCase();
    if (!capturing) {
      const phrase = wakePhrases().find((p) => text.includes(p));
      if (phrase) {
        capturing = true;
        captured = text.split(phrase).pop().trim();
        beep(990);
        $('wakestate').textContent = '🎙 yes? say your command…';
        $('wakestate').className = 'listening';
        if (captured) finishCapture();
        else captureTimer = setTimeout(finishCapture, 7000);
      }
    } else {
      captured = (captured + ' ' + text).trim();
      clearTimeout(captureTimer);
      captureTimer = setTimeout(finishCapture, 1200);
    }
    function finishCapture() {
      clearTimeout(captureTimer);
      capturing = false;
      $('wakestate').textContent = '👂 listening for wake word…';
      $('wakestate').className = '';
      const cmd = captured.trim();
      captured = '';
      if (cmd) { beep(660); send(cmd); }
    }
  };
  wake.onend = () => { setTimeout(runWake, 400); };   // auto-restart
  wake.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      wakeWanted = false;
      $('wakechk').checked = false;
      $('wakestate').textContent = '';
      toast('Microphone permission denied.', true);
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
  $('modelhint').textContent = 'Default: ' + (DEFAULTS[p] || '');
}
$('s-provider').addEventListener('change', updateProviderFields);

$('savebtn').addEventListener('click', async () => {
  const body = {
    provider: $('s-provider').value,
    model: $('s-model').value,
    assistant_name: $('s-name').value,
    language: $('s-lang').value,
    ollama_url: $('s-ollama').value,
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
    ['s-akey', 's-okey', 's-pin', 's-tgtoken'].forEach((id) => {
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
