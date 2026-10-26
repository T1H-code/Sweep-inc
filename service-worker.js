// Sweep OS – Service Worker
// Bei jeder inhaltlichen Änderung an index.html diese Versionsnummer erhöhen,
// sonst laden Nutzer weiterhin die alte, gecachte Version.
const CACHE_VERSION = 'sweep-os-v28';
const CACHE_NAME = `sweep-os-cache-${CACHE_VERSION}`;

// Der App-Shell: alles, was für den Offline-Start nötig ist.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Wichtig: cache.addAll() bricht KOMPLETT ab, sobald auch nur eine einzige
      // Datei fehlt (z.B. ein noch nicht hochgeladenes Icon) - dann wird gar nichts
      // gecacht und die App startet offline überhaupt nicht. Deshalb jede Datei
      // einzeln versuchen; fehlende/fehlerhafte Dateien werden übersprungen statt
      // die gesamte Installation zu blockieren.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[Sweep OS SW] Konnte nicht vorab cachen (übersprungen):', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nur GET-Requests behandeln; POST (z.B. Supabase-Sync) immer normal ans Netz.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-Origin-Requests (z.B. Supabase-Backend für "gbuch") NICHT cachen,
  // einfach ans Netz durchreichen. Schlägt offline fehl – das ist gewollt,
  // da diese Funktionen ohnehin eine Verbindung brauchen.
  if (url.origin !== self.location.origin) {
    return;
  }

  // v18: Mailflow (Ordner "mailflow/") hat einen eigenen Service Worker –
  // nichts davon hier abfangen oder cachen, sonst würde die Sweep-OS-Startseite
  // überschrieben bzw. statt Mailflow angezeigt.
  const scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.startsWith(scopePath + 'mailflow/') || url.pathname === scopePath + 'mailflow') {
    return;
  }

  // Navigations-Requests (Adressleiste, Reload, "Zum Home-Bildschirm"-Start):
  // v11: Network-first mit kurzem Timeout. Online bekommt man so sofort die neueste
  // index.html (kein "alte Version bis zum zweiten Start" mehr); offline oder bei
  // langsamem Netz greift nach 3 s die gecachte Version.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const net = await Promise.race([
          fetch(request, { cache: 'no-store' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
        if (net && net.ok) {
          cache.put('./index.html', net.clone());
          return net;
        }
        throw new Error('HTTP ' + (net && net.status));
      } catch (e) {
        const cached = await cache.match('./index.html') || await caches.match('./index.html');
        return cached || fetch(request);
      }
    })());
    return;
  }

  // Alle anderen same-origin Requests: Cache-first, im Hintergrund aktualisieren.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
