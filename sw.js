// キャッシュバージョン: 更新を配るときはこの数字を上げる
const CACHE_VERSION = 'party-v18';
const FILES = [
  './',
  './index.html',
  './hub.js',
  './ui.css',
  './core.html',
  './online.html',
  './online.js',
  './room.js',
  './mqtt.js',
  './g-core.js',
  './g-tap.js',
  './g-stop.js',
  './g-ise.js',
  './g-arena.js',
  './bots.js',
  './lib/qrcode.js',
  './lib/jsQR.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
