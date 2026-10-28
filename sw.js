// Service worker: aplikacja działa bez internetu. Pliki aplikacji - najpierw sieć (świeża wersja), awaryjnie kopia.
// Czcionki Google - najpierw kopia. Zapytania do Apps Script przechodzą bez zmian (dane trzyma Magazyn).
const WERSJA = 'studniowka-v4';
const PLIKI = ['./', 'index.html', 'styl.css', 'app.js', 'logika.js', 'dane.js', 'api.js', 'demo.js', 'manifest.webmanifest',
  'ikony/ikona.svg', 'ikony/ikona-192.png', 'ikony/ikona-512.png', 'ikony/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== WERSJA).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(WERSJA).then(c => c.match(e.request).then(z => z || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, {cache: 'no-cache'})
      .then(r => { if (r.ok) { const kopia = r.clone(); caches.open(WERSJA).then(c => c.put(e.request, kopia)); } return r; })
      .catch(() => caches.match(e.request, {ignoreSearch: true}).then(z => z || caches.match('index.html')))
  );
});
