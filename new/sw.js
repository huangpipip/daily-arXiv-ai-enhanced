const STATIC_CACHE = 'ctcmp-static-v2';
const RUNTIME_CACHE = 'ctcmp-runtime-v2';
const CACHE_PREFIX = 'ctcmp-';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=1.1.4',
  './shell.js?v=1.1.2',
  './app.webmanifest',
  '../js/app.js?v=1.1.0',
  '../js/auth-config.js',
  '../js/auth.js',
  '../js/data-config.js',
  '../assets/icons/favicon-32.png',
  '../assets/icons/apple-touch-icon.png',
  '../assets/icons/ctcmp-app-icon-192.png',
  '../assets/icons/ctcmp-app-icon-512.png',
  '../assets/icons/ctcmp-app-icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => Promise.allSettled(APP_SHELL.map(async url => {
        const request = new Request(url, { cache: 'reload' });
        const response = await fetch(request);
        if (!isCacheableResponse(response)) return;
        await cache.put(request, await removeRedirectMetadata(response));
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheableResponse(response) {
  return response && (response.ok || response.type === 'opaque');
}

async function removeRedirectMetadata(response) {
  if (!response.redirected || response.type === 'opaque') return response;

  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');

  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isPdfRequest(url) {
  return url.pathname.toLowerCase().endsWith('.pdf') || url.pathname.toLowerCase().includes('/pdf/');
}

function isStaticRequest(request, url) {
  if (request.mode === 'navigate') return true;
  if (isPdfRequest(url)) return false;
  return ['style', 'script', 'font', 'image', 'manifest'].includes(request.destination);
}

function cacheKeyFor(request) {
  if (request.mode === 'navigate') return new Request(new URL('./index.html', self.registration.scope));
  return request;
}

function staleWhileRevalidate(event) {
  const { request } = event;
  const cacheName = request.mode === 'navigate' ? STATIC_CACHE : RUNTIME_CACHE;
  const cacheKey = cacheKeyFor(request);
  const networkUpdate = caches.open(cacheName).then(async cache => {
    const response = await fetch(request, { cache: 'no-cache' });
    if (!isCacheableResponse(response)) return response;

    const cacheableResponse = await removeRedirectMetadata(response);
    await cache.put(cacheKey, cacheableResponse.clone());
    return cacheableResponse;
  });

  event.waitUntil(networkUpdate.catch(() => undefined));

  return caches.match(cacheKey).then(cachedResponse => {
    if (cachedResponse) return cachedResponse;
    return networkUpdate.catch(async error => {
      if (request.mode === 'navigate') {
        const fallback = await caches.match(new URL('./index.html', self.registration.scope));
        if (fallback) return fallback;
      }
      throw error;
    });
  });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!isStaticRequest(event.request, url)) return;

  event.respondWith(staleWhileRevalidate(event));
});
