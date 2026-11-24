/* Receipts service worker.
 * Network-first for HTML navigations; cache-first for same-origin static files.
 * Google API / sign-in requests are never cached.
 * Tesseract CDN files may be cached at runtime after the first fetch.
 */
const CACHE_NAME = 'receipts-shell-v6';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './parse.js',
  './config.js',
  './queue.js',
  './drive.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

function isGoogleApi(url) {
  const host = url.hostname;
  return (
    host === 'accounts.google.com' ||
    host === 'apis.google.com' ||
    host === 'script.google.com' ||
    host.endsWith('.script.google.com') ||
    host === 'script.googleusercontent.com' ||
    host.endsWith('.googleusercontent.com') ||
    host === 'googleapis.com' ||
    host.endsWith('.googleapis.com') ||
    host.endsWith('.gstatic.com') ||
    host === 'www.google.com' ||
    host.endsWith('.google.com')
  );
}

function isRuntimeCdn(url) {
  const host = url.hostname;
  return (
    host === 'cdn.jsdelivr.net' ||
    host.endsWith('.jsdelivr.net') ||
    host === 'unpkg.com' ||
    host.endsWith('.unpkg.com') ||
    host === 'tessdata.projectnaptha.com' ||
    host.endsWith('.projectnaptha.com')
  );
}

function isNavigation(request, url) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  const path = url.pathname;
  return path.endsWith('.html') || path.endsWith('/');
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  if (isGoogleApi(url)) return;

  if (url.origin === self.location.origin && isNavigation(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isRuntimeCdn(url)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
