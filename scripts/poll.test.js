/* poll.test.js — headless test for static/poll.js.
 *
 * Runs on plain node with no dependencies:
 *     node scripts/poll.test.js
 *
 * Builds a fake window/document (visibility, focus, page lifecycle) and a fake
 * clock, loads poll.js into a vm sandbox, and asserts the behaviour the module
 * promises. Exits non-zero on the first failed assertion.
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* ----------------------------------------------------------- fake clock */

function makeClock() {
  let now = 0, seq = 0;
  const jobs = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      jobs.set(id, { at: now + (ms || 0), fn });
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    /* Advance the clock, firing due timers in order. */
    tick(ms) {
      const end = now + ms;
      for (;;) {
        let next = null, nextId = null;
        for (const [id, j] of jobs) {
          if (j.at <= end && (next === null || j.at < next.at)) { next = j; nextId = id; }
        }
        if (!next) break;
        jobs.delete(nextId);
        now = next.at;
        next.fn();
      }
      now = end;
    },
    pending() { return jobs.size; },
  };
}

/* ------------------------------------------------- fake window/document */

function makeEnv() {
  const clock = makeClock();
  const listeners = { win: {}, doc: {} };

  const bus = (bag) => ({
    addEventListener(type, fn) { (bag[type] || (bag[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      const a = bag[type] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
  });

  const document = Object.assign(bus(listeners.doc), {
    visibilityState: 'visible',
    hasFocus: () => document._focused,
    _focused: true,
  });

  const window = Object.assign(bus(listeners.win), {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    IntersectionObserver: null,   // exercise the graceful fallback path
  });

  const fire = (which, type) => {
    const bag = which === 'win' ? listeners.win : listeners.doc;
    (bag[type] || []).slice().forEach((fn) => fn({ type }));
  };

  const env = {
    clock, window, document,
    hide() { document.visibilityState = 'hidden'; fire('doc', 'visibilitychange'); },
    show() { document.visibilityState = 'visible'; fire('doc', 'visibilitychange'); },
    blur() { document._focused = false; fire('win', 'blur'); },
    focus() { document._focused = true; fire('win', 'focus'); },
    pagehide() { fire('win', 'pagehide'); },
    pageshow() { fire('win', 'pageshow'); },
  };

  const src = fs.readFileSync(path.join(__dirname, '..', 'advance_tools', 'rootfs', 'app', 'static', 'poll.js'), 'utf8');
  vm.runInNewContext(src, { window, document, console });
  env.PMPoll = window.PMPoll;
  return env;
}

/* ------------------------------------------------------------ assertions */

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '  (expected ' + expected + ', got ' + actual + ')');
}
function section(name) { console.log('\n' + name); }

/* --------------------------------------------------------------- tests */

section('1. immediate first run, then steady 1000ms cadence');
{
  const env = makeEnv();
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; });
  eq(runs, 1, 'runs once immediately on start');
  env.clock.tick(1000); eq(runs, 2, 'runs again after 1 interval');
  env.clock.tick(3000); eq(runs, 5, 'runs 3 more times over 3 intervals');
  eq(env.PMPoll.stats()[0].interval, 1000, 'reported interval is the base interval');
  env.PMPoll.stopAll();
}

section('2. no overlap when fn is slow — ticks are skipped, not queued');
{
  const env = makeEnv();
  let starts = 0, resolve = null;
  env.PMPoll.every(1000, () => {
    starts++;
    return { then: (okFn) => { resolve = okFn; } };   // promise-like, never settles yet
  });
  eq(starts, 1, 'first run started');
  env.clock.tick(5000);
  eq(starts, 1, 'no second run started while the first is still in flight (5 ticks elapsed)');
  resolve();                                          // first run finally settles
  eq(starts, 1, 'settling does not immediately re-run');
  env.clock.tick(1000);
  eq(starts, 2, 'exactly ONE run after settling — 4 missed ticks were skipped, not queued');
  env.PMPoll.stopAll();
}

section('3. stops when hidden, resumes with an IMMEDIATE run');
{
  const env = makeEnv();
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; });
  eq(runs, 1, 'initial run');
  env.hide();
  env.clock.tick(60000);
  eq(runs, 1, 'zero runs across 60 s while document is hidden');
  eq(env.clock.pending(), 0, 'no timer left armed while hidden');
  env.show();
  eq(runs, 2, 'resume fires an immediate refresh (no stale data)');
  env.clock.tick(1000); eq(runs, 3, 'normal cadence resumes after that');
  env.PMPoll.stopAll();
}

section('3b. REGRESSION: created while already hidden must still load once');
{
  // Security Center shipped stuck on "Loading..." in v2.16.0 because the very
  // first fetch was visibility-gated: a page opened in a background tab, or a
  // tablet booting with its screen off, never rendered until someone focused
  // it. The first run must always happen; only the repeat is gated.
  const env = makeEnv();
  env.hide();                       // hidden BEFORE the handle is created
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; });
  eq(runs, 1, 'first load happens even though the page is hidden');
  env.clock.tick(60000);
  eq(runs, 1, 'but it does NOT keep polling while hidden');
  eq(env.clock.pending(), 0, 'no timer armed while hidden');
  env.show();
  eq(runs, 2, 'becoming visible refreshes');
  env.clock.tick(1000); eq(runs, 3, 'normal cadence afterwards');
  env.PMPoll.stopAll();
}

{
  // The opt-out still works for callers that really want lazy start.
  const env = makeEnv();
  env.hide();
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; }, { runImmediately: false });
  eq(runs, 0, 'runImmediately:false skips the primed run while hidden');
  env.show();
  eq(runs, 1, 'and starts on first visibility');
  env.PMPoll.stopAll();
}

section('4. page lifecycle: pagehide stops, pageshow resumes (tablet screen off)');
{
  const env = makeEnv();
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; });
  env.pagehide();
  env.clock.tick(3600000);
  eq(runs, 1, 'zero runs across 1 hour after pagehide');
  env.pageshow();
  eq(runs, 2, 'pageshow resumes with an immediate run');
  env.PMPoll.stopAll();
}

section('5. focus backoff multiplies the interval');
{
  const env = makeEnv();
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; }, { blurFactor: 3 });
  runs = 0;
  env.blur();
  eq(env.PMPoll.stats()[0].interval, 3000, 'interval x3 while visible but unfocused');
  env.clock.tick(9000);
  eq(runs, 3, '9 s unfocused => 3 runs instead of 9');
  env.focus();
  eq(env.PMPoll.stats()[0].interval, 1000, 'interval back to base once focused');
  runs = 0;
  env.clock.tick(3000);
  eq(runs, 3, '3 s focused => 3 runs (full speed restored)');
  env.PMPoll.stopAll();
}

section('6. error backoff grows exponentially to the cap and recovers');
{
  const env = makeEnv();
  let mode = 'fail';
  const p = env.PMPoll.every(1000, () => (mode === 'fail'
    ? { then: (o, e) => e() }
    : { then: (o) => o() }));
  const iv = () => env.PMPoll.stats()[0].interval;
  eq(iv(), 2000, 'after 1 failure: 2x base');
  env.clock.tick(2000); eq(iv(), 4000, 'after 2 failures: 4x base');
  env.clock.tick(4000); eq(iv(), 5000, 'after 3 failures: capped at 5x base');
  env.clock.tick(5000); eq(iv(), 5000, 'stays at the 5x cap — backend is not hammered');
  mode = 'ok';
  env.clock.tick(5000);
  eq(iv(), 1000, 'first success resets straight back to the base interval');
  eq(p.errors, 0, 'error counter cleared');
  env.PMPoll.stopAll();
}

section('7. stop() really stops, and runNow() forces a refresh');
{
  const env = makeEnv();
  let runs = 0;
  const h = env.PMPoll.every(1000, () => { runs++; });
  env.clock.tick(2000); eq(runs, 3, 'running normally');
  h.runNow(); eq(runs, 4, 'runNow() fires an extra run on demand');
  h.stop();
  env.clock.tick(600000);
  eq(runs, 4, 'no runs at all across 10 minutes after stop()');
  eq(env.clock.pending(), 0, 'no timers left armed after stop()');
  eq(env.PMPoll.stats().length, 0, 'handle removed from stats()');
  env.show(); env.focus();
  env.clock.tick(10000);
  eq(runs, 4, 'a stopped handle is not revived by visibility/focus events');
}

section('8. setInterval() retunes a live handle');
{
  const env = makeEnv();
  let runs = 0;
  const h = env.PMPoll.every(1000, () => { runs++; });
  runs = 0;
  h.setInterval(5000);
  eq(env.PMPoll.stats()[0].interval, 5000, 'base interval updated');
  env.clock.tick(10000);
  eq(runs, 2, '10 s at the new 5 s interval => 2 runs');
  env.PMPoll.stopAll();
}

section('9. multiple handles are independent; stopAll() clears everything');
{
  const env = makeEnv();
  let a = 0, b = 0;
  env.PMPoll.every(1000, () => { a++; }, { name: 'a' });
  env.PMPoll.every(2000, () => { b++; }, { name: 'b' });
  env.clock.tick(4000);
  eq(a, 5, 'handle a ran on its own 1 s cadence');
  eq(b, 3, 'handle b ran on its own 2 s cadence');
  eq(env.PMPoll.stats().length, 2, 'stats() reports both handles');
  env.PMPoll.stopAll();
  eq(env.PMPoll.stats().length, 0, 'stopAll() cleared every handle');
  env.clock.tick(10000);
  eq(a + b, 8, 'nothing ran after stopAll()');
}

section('10. no IntersectionObserver => graceful fallback (still polls)');
{
  const env = makeEnv();          // makeEnv sets IntersectionObserver = null
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; }, { el: { fake: 'element' } });
  env.clock.tick(3000);
  eq(runs, 4, 'polls normally when IntersectionObserver is unavailable');
  env.PMPoll.stopAll();
}

section('11. IntersectionObserver: off-screen element stops polling');
{
  const env = makeEnv();
  let cb = null;
  env.window.IntersectionObserver = function (fn) {
    cb = fn;
    this.observe = function () {};
    this.disconnect = function () {};
  };
  let runs = 0;
  env.PMPoll.every(1000, () => { runs++; }, { el: { fake: 'element' } });
  env.clock.tick(2000); eq(runs, 3, 'polling while on screen');
  cb([{ isIntersecting: false }]);
  env.clock.tick(60000);
  eq(runs, 3, 'zero runs while the element is scrolled out of view');
  cb([{ isIntersecting: true }]);
  eq(runs, 4, 'scrolling back into view fires an immediate refresh');
  env.PMPoll.stopAll();
}

/* --------------------------------------------------------------- result */

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
