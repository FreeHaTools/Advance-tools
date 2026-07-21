/* Advance Tools runtime — injected into every dashboard.
 *
 * Dashboard designer API (available as window.HAPanel):
 *   HAPanel.ready(cb)                      run cb once states are loaded
 *   HAPanel.state('light.bedroom')         current state object {state, attributes, ...}
 *   HAPanel.states()                       all allowed states {entity_id: {...}}
 *   HAPanel.on('light.bedroom', cb)        cb(state, entity_id) on every change ('*' = all)
 *   HAPanel.call(domain, service, data)    e.g. HAPanel.call('light','toggle',{entity_id:'light.x'})
 *   HAPanel.logout()                       end session, back to login
 *   HAPanel.connected                      true if HA link is live
 */
(function () {
  'use strict';
  const slug = (document.currentScript && document.currentScript.dataset.dashboard) || '';
  const listeners = new Map();   // entity_id|'*' -> Set<cb>
  const readyCbs = [];
  let states = {};
  let ws = null;
  let msgId = 0;
  let isReady = false;

  const API = {
    connected: false,
    ready(cb) { isReady ? cb() : readyCbs.push(cb); },
    state(id) { return states[id]; },
    states() { return states; },
    on(id, cb) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(cb);
      if (states[id]) cb(states[id], id);
      return () => listeners.get(id).delete(cb);
    },
    call(domain, service, data) {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1) return reject(new Error('not connected'));
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ type: 'call', id, domain, service, data: data || {} }));
      });
    },
    async logout() {
      await fetch('/api/logout', { method: 'POST' });
      location.href = '/';
    },
  };
  const pending = new Map();

  function emit(id, st) {
    (listeners.get(id) || []).forEach(cb => { try { cb(st, id); } catch (e) { console.error(e); } });
    (listeners.get('*') || []).forEach(cb => { try { cb(st, id); } catch (e) { console.error(e); } });
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/ws?d=${encodeURIComponent(slug)}`);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'states') {
        states = msg.states || {};
        API.connected = !!msg.connected;
        if (!isReady) { isReady = true; readyCbs.forEach(cb => cb()); readyCbs.length = 0; }
        Object.keys(states).forEach(id => emit(id, states[id]));
      } else if (msg.type === 'state') {
        states[msg.entity_id] = msg.state;
        emit(msg.entity_id, msg.state);
      } else if (msg.type === 'result' && pending.has(msg.id)) {
        pending.get(msg.id).resolve(); pending.delete(msg.id);
      } else if (msg.type === 'error' && pending.has(msg.id)) {
        pending.get(msg.id).reject(new Error(msg.error)); pending.delete(msg.id);
      }
    };
    ws.onclose = () => { API.connected = false; setTimeout(connect, 3000); };
  }
  connect();

  /* ---- kiosk guards: no back-navigation, no context menu, fullscreen on touch.
         Disabled in preview mode (?preview=1, used by the Designer). ---- */
  const _qs = new URLSearchParams(location.search);
  if (!_qs.has('preview') && !_qs.has('embedded')) {
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', () => history.pushState(null, '', location.href));
    document.addEventListener('contextmenu', e => e.preventDefault());
    let fsRequested = false;
    document.addEventListener('pointerdown', () => {
      if (fsRequested || document.fullscreenElement) return;
      fsRequested = true;
      const el = document.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || function(){}).call(el).catch?.(() => {});
    }, { once: false });
  }

  window.HAPanel = API;
})();
