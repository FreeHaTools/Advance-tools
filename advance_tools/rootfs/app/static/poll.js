/* poll.js — PMPoll: a tiny, dependency-free, visibility-aware polling helper.
 *
 * Why this exists
 * ---------------
 * Advance Tools runs its admin tools in an iframe inside the hub, and its
 * dashboards run on cheap wall tablets. Plain `setInterval(fetch, 3000)` keeps
 * hammering the backend forever: when the tool is hidden behind another tool,
 * when the browser tab is backgrounded, and when the tablet's screen is off.
 * On a 744-entity home that is thousands of pointless requests per hour.
 *
 * PMPoll replaces those loops. It only polls while somebody can actually see
 * the thing being polled, and it never lets requests stack up.
 *
 * Behaviour
 * ---------
 *  - Self-scheduling: the next run is scheduled only after the previous one
 *    SETTLES. If `fn` returns a promise and that promise takes longer than the
 *    interval, ticks are SKIPPED, never queued. No overlap, ever.
 *  - Visibility: polling stops while `document.visibilityState === 'hidden'`.
 *  - Intersection: if `opts.el` is given and IntersectionObserver exists,
 *    polling also stops while that element is scrolled/hidden out of view.
 *    Without IntersectionObserver the element is treated as always visible.
 *    Tools pass `el: document.body`. That is deliberate: the hub hides the
 *    tool iframe with `display:none` and never unloads it, and a document
 *    inside a display:none iframe does NOT reliably report
 *    visibilityState === 'hidden'. Its <body> does collapse to a zero-size
 *    rect though, so IntersectionObserver catches exactly that case.
 *  - Resume is IMMEDIATE: whenever a handle goes from inactive to active it
 *    runs `fn` right away, so the user never looks at stale data.
 *  - Focus backoff: visible but the window is not focused => the interval is
 *    multiplied by `opts.blurFactor` (default 3). Full speed once focused.
 *  - Error backoff: each failed run doubles the interval, capped at
 *    `opts.maxErrorFactor` x base (default 5). The first success resets it,
 *    so a briefly-down backend is not hammered.
 *  - Page lifecycle: stops on `pagehide` / `freeze`, resumes on `pageshow` /
 *    `resume`. This is what actually matters when a tablet's screen goes off.
 *
 * API
 * ---
 *   var h = PMPoll.every(3000, fn, { el: node, name: 'overview' });
 *   h.stop();                 // stop for good
 *   h.runNow();               // force an immediate run (no-op while running)
 *   h.setInterval(10000);     // change the base interval, reschedule
 *   PMPoll.stopAll();
 *   PMPoll.stats();           // [{ name, runs, errors, base, interval, active }]
 *
 * `fn` may be sync or return a promise. A thrown error or a rejected promise
 * counts as a failure for the error backoff; nothing else is done with it.
 *
 * Written for the Fire tablet's older Chromium: ES5-ish, no optional chaining,
 * no async/await, no build step. Load it before the code that uses it.
 */
(function (window, document) {
  'use strict';

  if (window.PMPoll) return;

  var handles = [];

  /* Global page state, shared by every handle. */
  var frozen = false;
  var focused = true;
  try { focused = document.hasFocus ? document.hasFocus() : true; }
  catch (e) { focused = true; }

  function pageVisible() {
    return document.visibilityState !== 'hidden';
  }

  /* ------------------------------------------------------------ handle */

  function Handle(ms, fn, opts) {
    opts = opts || {};
    this.name = opts.name || 'poll';
    this.fn = fn;
    this.base = Math.max(50, ms | 0);
    this.blurFactor = opts.blurFactor > 0 ? opts.blurFactor : 3;
    this.maxErrorFactor = opts.maxErrorFactor > 0 ? opts.maxErrorFactor : 5;
    this.el = opts.el || null;

    this.runs = 0;
    this.errors = 0;
    this.busy = false;
    this.stopped = false;
    this.timer = null;
    this.seen = true;          // element is on screen (assume yes until told no)
    this.wasActive = false;
    // The very first run always happens, even on a hidden page. Skipping it
    // would leave a screen showing "Loading…" until someone focuses the tab,
    // which is exactly what a background tab or a tablet booting with its
    // screen off does. One request is cheap; a stuck screen is not. Only the
    // repeating schedule after it is visibility-gated.
    this.primed = opts.runImmediately === false;
    this.io = null;

    this._observe();
  }

  /* Watch the element, when we can. Without IntersectionObserver we simply
     keep `seen` true and fall back to document visibility only. */
  Handle.prototype._observe = function () {
    if (!this.el || !window.IntersectionObserver) return;
    var self = this;
    try {
      this.io = new window.IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        self.seen = !!(e && e.isIntersecting);
        self.sync();
      });
      this.io.observe(this.el);
    } catch (err) {
      this.io = null;          // pathological browser: degrade gracefully
    }
  };

  Handle.prototype.active = function () {
    return !this.stopped && !frozen && this.seen && pageVisible();
  };

  /* Current effective delay: base x focus penalty x error penalty. */
  Handle.prototype.delay = function () {
    var f = focused ? 1 : this.blurFactor;
    var e = 1;
    for (var i = 0; i < this.errors; i++) {
      e *= 2;
      if (e >= this.maxErrorFactor) { e = this.maxErrorFactor; break; }
    }
    return Math.round(this.base * f * e);
  };

  Handle.prototype._clear = function () {
    if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
  };

  Handle.prototype._schedule = function () {
    this._clear();
    if (!this.active() || this.busy) return;
    var self = this;
    this.timer = window.setTimeout(function () {
      self.timer = null;
      self._run();
    }, this.delay());
  };

  /* `force` runs even on a hidden page. Used only by the very first load and
     by the explicit runNow() — never by the repeating schedule, so a hidden
     page still performs exactly one request and then goes quiet. */
  Handle.prototype._run = function (force) {
    if (this.busy || (!force && !this.active())) return;
    this.busy = true;
    this.runs++;
    var self = this, p = null;
    try { p = this.fn(); }
    catch (err) { this._settle(false); return; }
    if (p && typeof p.then === 'function') {
      p.then(function () { self._settle(true); },
             function () { self._settle(false); });
    } else {
      this._settle(true);
    }
  };

  Handle.prototype._settle = function (ok) {
    this.busy = false;
    if (ok) this.errors = 0;
    else if (this.errors < 16) this.errors++;
    this._schedule();
  };

  /* Called whenever page/element state may have changed. Going inactive ->
     active fires an immediate run; anything else just reschedules. */
  Handle.prototype.sync = function () {
    var now = this.active();
    if (!this.primed) {                  // first run: always, visible or not
      this.primed = true;
      this.wasActive = now;
      this._clear();
      this._run(true);                   // _settle() schedules or stops
      return;
    }
    if (now && !this.wasActive) {
      this.wasActive = true;
      this._clear();
      this._run();                       // _settle() schedules the next tick
      return;
    }
    this.wasActive = now;
    if (!now) this._clear();
    else this._schedule();
  };

  Handle.prototype.runNow = function () {
    if (this.stopped || this.busy) return;
    this.primed = true;
    this._clear();
    this._run(true);                     // explicit refresh: honour it always
  };

  Handle.prototype.setInterval = function (ms) {
    this.base = Math.max(50, ms | 0);
    if (!this.busy) this._schedule();
  };

  Handle.prototype.stop = function () {
    this.stopped = true;
    this.wasActive = false;
    this._clear();
    if (this.io) { try { this.io.disconnect(); } catch (e) {} this.io = null; }
    var i = handles.indexOf(this);
    if (i >= 0) handles.splice(i, 1);
  };

  /* ------------------------------------------------- global page events */

  function syncAll() {
    for (var i = 0; i < handles.length; i++) handles[i].sync();
  }

  function onFocus(v) {
    return function () { focused = v; syncAll(); };
  }

  function onFrozen(v) {
    return function () { frozen = v; syncAll(); };
  }

  document.addEventListener('visibilitychange', syncAll);
  window.addEventListener('focus', onFocus(true));
  window.addEventListener('blur', onFocus(false));
  window.addEventListener('pageshow', onFrozen(false));
  window.addEventListener('pagehide', onFrozen(true));
  window.addEventListener('resume', onFrozen(false));
  window.addEventListener('freeze', onFrozen(true));

  /* ---------------------------------------------------------------- API */

  window.PMPoll = {
    /* Start polling. Runs `fn` immediately if the handle is active. */
    every: function (ms, fn, opts) {
      var h = new Handle(ms, fn, opts);
      handles.push(h);
      h.sync();
      return h;
    },

    stopAll: function () {
      while (handles.length) handles[0].stop();
    },

    /* Small debug counter so this module is verifiable from the console. */
    stats: function () {
      var out = [];
      for (var i = 0; i < handles.length; i++) {
        var h = handles[i];
        out.push({
          name: h.name,
          runs: h.runs,
          errors: h.errors,
          base: h.base,
          interval: h.delay(),
          active: h.active(),
        });
      }
      return out;
    },
  };
})(window, document);
