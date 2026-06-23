/**
 * Service Worker — Remimazolam TCI Simulator (Eleveld 2025)
 * Cache-first for local assets, network-first for the Chart.js CDN.
 */

const CACHE_NAME = 'remimazolam-eleveld-v1.0.1';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './js/models.js',
  './js/remimazolam-eleveld-pkpd.js',
  './js/charts.js',
  './js/induction-engine.js',
  './js/tci-engine.js',
  './js/monitoring-engine.js',
  './js/main.js',
  './images/icon-192.png',
  './images/icon-512.png'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache local assets; ignore individual failures so install still succeeds.
      return Promise.allSettled(
        [...LOCAL_ASSETS, ...CDN_ASSETS].map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] cache skip:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isCDN = url.origin !== self.location.origin;

  if (isCDN) {
    // network-first for CDN, fall back to cache
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request))
    );
  } else {
    // cache-first for local assets
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
