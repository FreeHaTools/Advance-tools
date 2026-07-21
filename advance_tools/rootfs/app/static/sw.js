/* Advance Tools service worker.
 *
 * This add-on controls locks, alarms and dashboards, so the caching policy is
 * deliberately paranoid:
 *
 *   * The cache is an ALLOW-LIST, not a deny-list. A request is only ever
 *     touched by this worker when it is a same-origin GET for a path under
 *     /static/ (or the manifest) AND that path ends in a static asset
 *     extension. Everything else - /api/, /d/, /tools/, every HTML document
 *     and every navigation - never reaches respondWith() at all, so the
 *     browser performs its normal network request as if no worker existed.
 *   * Cached assets use stale-while-revalidate: the cached copy is served
 *     immediately and a fresh copy is fetched in the background, so a stale
 *     asset can survive at most one page load.
 *   * The cache name carries the add-on version (substituted by main.py's
 *     /sw.js route), so every release starts a brand-new cache and the
 *     activate handler deletes the previous one.
 *
 * If registration fails - plain HTTP over the LAN, an old browser, a blocked
 * scope - nothing here runs and the app behaves exactly as it did before.
 */
'use strict';

/* Replaced with the running add-on version by the /sw.js route in main.py.
   The literal below is only what the raw file on disk contains. */
var APP_VERSION = '{{VERSION}}';

var CACHE_PREFIX = 'advance-tools-static-v';
var CACHE = CACHE_PREFIX + APP_VERSION;

/* --- the allow-list ----------------------------------------------------- */

var STATIC_PREFIX = '/static/';
var MANIFEST_PATH = '/manifest.webmanifest';

/* Note the absence of html/htm: dashboard and hub documents are never cached. */
var STATIC_EXT =
  /\.(?:css|js|mjs|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|webmanifest)$/i;

function isCacheable(request) {
  if (request.method !== 'GET') return false;
  // A navigation is a document load - always live, never cached.
  if (request.mode === 'navigate') return false;
  if (request.destination === 'document') return false;

  var url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === MANIFEST_PATH) return true;

  // Anything that is not literally under /static/ is out. That covers
  // /api/..., /d/<slug>/..., /tools/<id>/static/... and the service worker
  // and manifest routes themselves.
  if (url.pathname.indexOf(STATIC_PREFIX) !== 0) return false;
  if (/\.html?$/i.test(url.pathname)) return false;
  return STATIC_EXT.test(url.pathname);
}

/* --- lifecycle ---------------------------------------------------------- */

self.addEventListener('install', function (event) {
  // Nothing is pre-cached: assets are only stored once a page actually asks
  // for them. Activating straight away is safe because this worker cannot
  // change the response of any page, API call or dashboard.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((function () {
    return caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE && name.indexOf(CACHE_PREFIX) === 0) {
          return caches.delete(name);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    });
  })());
});

self.addEventListener('message', function (event) {
  var data = event.data;
  if (data === 'skipWaiting' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

/* --- fetch -------------------------------------------------------------- */

function cacheableResponse(response) {
  if (!response) return false;
  if (response.status !== 200) return false;
  if (response.type !== 'basic') return false;
  var type = response.headers.get('Content-Type') || '';
  // Belt and braces: even inside /static/, refuse to store an HTML body.
  return type.indexOf('text/html') === -1;
}

function staleWhileRevalidate(event) {
  var request = event.request;
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (cacheableResponse(response)) {
          cache.put(request, response.clone()).catch(function () { /* quota */ });
        }
        return response;
      }).catch(function () {
        return null;
      });

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network.then(function (response) {
        return response || new Response('', {
          status: 504,
          statusText: 'Offline and not cached'
        });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  if (!isCacheable(event.request)) return;   // stay completely transparent
  event.respondWith(staleWhileRevalidate(event));
});
