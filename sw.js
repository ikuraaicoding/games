// キャッシュバージョン: 更新を配るときはこの数字を上げる(version.js の更新日時も一緒に)
const CACHE_VERSION = 'party-v34';
const FILES = [
  './',
  './index.html',
  './hub.js',
  './version.js',
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
  './avatar.js',
  './pfx.js',
  './g-arena.js',
  './bots.js',
  './lib/qrcode.js',
  './lib/jsQR.js',
  './lib/pixi.min.js',
  './lib/pixi-unsafe-eval.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  // ブラウザの一時保存を通さず、必ず最新のファイルを取りにいく(古いファイルが混ざらないように)
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
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
