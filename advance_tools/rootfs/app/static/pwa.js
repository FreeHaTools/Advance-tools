/* Advance Tools - PWA glue.
 *
 * Two jobs, both optional and both failure-tolerant:
 *   1. register the service worker (only ever in a secure context);
 *   2. render an "Install app" control into every element that carries the
 *      data-pwa-install attribute.
 *
 * The control is honest about what the current browser can do:
 *   Android / desktop Chromium  -> native install button (beforeinstallprompt)
 *   iOS Safari                  -> "Add to Home Screen via Share" hint
 *   plain HTTP (LAN, no proxy)  -> a dismissible note explaining why install
 *                                  is unavailable
 *   already installed           -> nothing at all
 *
 * Nothing in here changes app behaviour: if any of it throws, the page is
 * exactly the page it was before.
 */
(function () {
  'use strict';

  var DISMISS_KEY = 'at_pwa_note_dismissed';
  var hosts = [];
  var deferredPrompt = null;

  /* --- environment ------------------------------------------------------ */

  function matches(query) {
    try {
      return !!(window.matchMedia && window.matchMedia(query).matches);
    } catch (err) {
      return false;
    }
  }

  function isInstalled() {
    return matches('(display-mode: standalone)') ||
           matches('(display-mode: fullscreen)') ||
           matches('(display-mode: minimal-ui)') ||
           window.navigator.standalone === true;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function secure() {
    // isSecureContext covers https:// and localhost, which is exactly the set
    // of origins where service workers and install prompts are allowed.
    return window.isSecureContext === true;
  }

  function dismissed() {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch (err) { /* private mode - the note simply comes back */ }
  }

  /* --- service worker --------------------------------------------------- */

  function registerWorker() {
    if (!('serviceWorker' in navigator) || !secure()) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(function (err) {
        if (window.console && console.info) {
          console.info('Advance Tools: service worker not registered -',
                       (err && err.message) || err);
        }
      });
  }

  /* --- styles ----------------------------------------------------------- */

  var CSS =
    '.at-pwa{display:block}' +
    /* an author rule beats the UA stylesheet, so [hidden] needs restating */
    '.at-pwa[hidden]{display:none}' +
    '.at-pwa-btn{display:inline-flex;align-items:center;justify-content:center;' +
      'gap:8px;width:100%;min-height:44px;padding:10px 16px;border-radius:11px;' +
      'border:1px solid var(--line,#2a3550);cursor:pointer;font:inherit;' +
      'font-size:13px;font-weight:600;color:#fff;' +
      'background:linear-gradient(135deg,var(--acc,#4f8cff),var(--acc2,#7b5cff));' +
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
    '.at-pwa-btn:active{transform:scale(.985)}' +
    '.at-pwa-note{position:relative;display:block;border-radius:11px;' +
      'padding:10px 34px 10px 12px;font-size:11.5px;line-height:1.65;' +
      'color:var(--mut,#8b98b8);background:rgba(255,255,255,.04);' +
      'border:1px solid var(--line,#2a3550)}' +
    '.at-pwa-note b{color:var(--txt,#e8edf7);font-weight:600}' +
    '.at-pwa-x{position:absolute;top:2px;right:2px;width:32px;height:32px;' +
      'border:0;background:none;color:var(--mut,#8b98b8);font-size:15px;' +
      'line-height:1;cursor:pointer;border-radius:9px;' +
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
    '.at-pwa-x:hover{color:var(--txt,#e8edf7)}';

  function injectStyles() {
    if (document.getElementById('at-pwa-style')) return;
    var style = document.createElement('style');
    style.id = 'at-pwa-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* --- widgets ---------------------------------------------------------- */

  function installButton() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'at-pwa-btn';
    button.textContent = 'Install app';
    button.addEventListener('click', function () {
      var prompt = deferredPrompt;
      if (!prompt) { render(); return; }
      deferredPrompt = null;
      button.disabled = true;
      try {
        prompt.prompt();
      } catch (err) {
        render();
        return;
      }
      var choice = prompt.userChoice;
      if (choice && choice.then) {
        choice.then(function () { render(); }, function () { render(); });
      } else {
        render();
      }
    });
    return button;
  }

  function note(html) {
    var box = document.createElement('div');
    box.className = 'at-pwa-note';
    box.innerHTML = html;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'at-pwa-x';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', function () {
      dismiss();
      render();
    });
    box.appendChild(close);
    return box;
  }

  /* --- rendering -------------------------------------------------------- */

  function paint(host) {
    while (host.firstChild) host.removeChild(host.firstChild);
    host.classList.add('at-pwa');
    host.hidden = false;

    if (isInstalled()) { host.hidden = true; return; }

    // iOS never fires beforeinstallprompt; Add to Home Screen lives in the
    // Share menu and works over plain HTTP too.
    if (isIOS()) {
      if (dismissed()) { host.hidden = true; return; }
      host.appendChild(note(
        '<b>Install on your iPhone or iPad</b><br>' +
        'Tap the Share button in Safari, then choose ' +
        '&ldquo;Add to Home Screen&rdquo;.'));
      return;
    }

    if (deferredPrompt) { host.appendChild(installButton()); return; }

    if (!secure()) {
      if (dismissed()) { host.hidden = true; return; }
      host.appendChild(note(
        '<b>Install unavailable over plain HTTP</b><br>' +
        'Browsers only allow installing an app from an HTTPS address (or ' +
        'localhost). Reach Advance Tools through HTTPS to install it.'));
      return;
    }

    // Secure context but the browser has not offered an install (Firefox,
    // desktop Safari, or Chrome deciding the criteria are not met yet).
    // Say nothing rather than promise something that will not happen.
    host.hidden = true;
  }

  function render() {
    injectStyles();
    for (var i = 0; i < hosts.length; i++) {
      try {
        paint(hosts[i]);
      } catch (err) { /* never break the page over an install button */ }
    }
  }

  function collect() {
    hosts = [];
    var found = document.querySelectorAll('[data-pwa-install]');
    for (var i = 0; i < found.length; i++) hosts.push(found[i]);
    render();
  }

  /* --- boot ------------------------------------------------------------- */

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    render();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    render();
  });

  window.AdvanceToolsPWA = {
    refresh: collect,
    canInstall: function () { return !!deferredPrompt; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', collect);
  } else {
    collect();
  }

  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker);
})();
