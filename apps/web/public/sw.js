/* Only public same-origin application resources are cached. Never cache auth/API responses. */
const CACHE = 'asu-shell-v1';
const ROOT = new URL('/', self.location.origin).href;

function isPrivatePath(url) {
  return url.pathname.startsWith('/models/') || url.pathname.includes('/auth/') || url.pathname.includes('/rest/');
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : '';
}

// Vite's production HTML declares its entry modules, styles and modulepreloads.
// Stage those resources before promoting HTML. Keep older content-addressed
// assets for already-open clients rather than mixing releases or purging them.
async function cacheShell(response, navigationURL) {
  if (response.status !== 200 || response.redirected || !response.headers.get('content-type')?.includes('text/html')) return;
  const html = await response.clone().text(), resources = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) || []) {
    const script = /^<script\b/i.test(tag);
    if (!script && !attribute(tag, 'rel').split(/\s+/).some(rel => rel === 'stylesheet' || rel === 'modulepreload')) continue;
    const value = attribute(tag, script ? 'src' : 'href');
    if (!value) continue;
    const url = new URL(value, navigationURL);
    if (url.origin !== self.location.origin || isPrivatePath(url)) throw new Error('uncacheable-shell-entry');
    resources.add(url.href);
  }
  const staged = await Promise.all(Array.from(resources, async url => {
    const asset = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!asset.ok || asset.redirected || asset.type === 'opaque') throw new Error('shell-entry-unavailable');
    return [url, asset];
  }));
  const cache = await caches.open(CACHE);
  for (const [url, asset] of staged) await cache.put(url, asset);
  // Last write is the snapshot's commit point: no B HTML with missing B entry JS/CSS.
  await cache.put(ROOT, response.clone());
}

self.addEventListener('install', event => {
  event.waitUntil(Promise.all([
    fetch(ROOT, { cache: 'no-store' }).then(response => cacheShell(response, ROOT)),
    caches.open(CACHE).then(cache => cache.addAll(['/brand/asu-logo.svg', '/brand/asu-icon.svg', '/manifest.webmanifest'])),
  ]));
  self.skipWaiting();
});
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return;
  if (isPrivatePath(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // Do not turn OAuth callback query URLs or unrelated pages into the root shell.
        if (url.pathname === '/' && !url.search) await cacheShell(response, url.href).catch(() => {});
        return response;
      } catch {
        return await (await caches.open(CACHE)).match(ROOT) || Response.error();
      }
    })());
    return;
  }
  if (!/\.(js|css|woff2|svg|png)$/.test(url.pathname)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => await (await caches.open(CACHE)).match(request) || Response.error()));
});
