const CACHE = 'boker-web-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// רשת קודם, מטמון כגיבוי (כדי שעדכונים יגיעו מיד בשלב הפיתוח)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'בוקר-ווב', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'בוקר-ווב', {
    body: d.body || '', tag: d.tag || 'alarm', renotify: true, requireInteraction: !!d.ring,
    lang: 'he', dir: 'rtl', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { alarmId: d.alarmId || null, ring: !!d.ring },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { alarmId, ring } = e.notification.data || {};
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = ring && alarmId ? `./?ring=${encodeURIComponent(alarmId)}` : './';
    if (all.length) {
      const c = all[0];
      await c.focus();
      if (ring && alarmId) c.postMessage({ type: 'ring', alarmId });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
