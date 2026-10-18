/* global BUILD, SHELL */
// Cache names are isolated by deployment path, including GitHub Pages subpaths.
const ROOT = new URL('./', self.location.href);
const PREFIX = `vibloom-shell:${ROOT.pathname}:`;
const CACHE = PREFIX + BUILD;
const READY = new URL('__offline_ready__', ROOT).href;
const urls = SHELL.map(file => new URL(file, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (let start = 0; start < urls.length; start += 6) {
        await cache.addAll(urls.slice(start, start + 6).map(url => new Request(url, { cache: 'reload' })));
      }
      await cache.put(READY, new Response(BUILD));
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Retain older shells for tabs that still run an earlier bundle. Clean up
    // only when there are no open clients; no update ever reloads other tabs.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!clients.length) for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'OFFLINE_STATUS') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = !!await cache.match(READY);
    // Detect browser eviction of the shell before calling it ready.
    const ready = complete && (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({ ready });
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const relative = url.pathname.slice(ROOT.pathname.length);
  const navigation = request.mode === 'navigate' && (relative === '' || relative === 'index.html');
  const asset = !url.search && (relative.startsWith('assets/') || relative.startsWith('live2d/') || relative === 'vibloom-icon.png' || relative === 'manifest.webmanifest');
  if (!navigation && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), key = navigation ? new URL('index.html', ROOT).href : request;
    const cached = await cache.match(key);
    if (cached) return cached;
    if (asset) for (const name of await caches.keys()) {
      if (name === CACHE || !name.startsWith(PREFIX)) continue;
      const old = await (await caches.open(name)).match(key);
      if (old) return old;
    }
    const response = await fetch(request);
    if (asset && response.ok && response.status === 200) {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  })());
});
