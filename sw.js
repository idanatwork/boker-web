const CACHE = 'boker-web-v4';
const VISION = 'boker-vision-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'js/ui.js', 'js/store.js', 'js/tasks.js', 'js/vision.js', 'js/pushups-logic.js', 'js/brush-logic.js', 'js/profile.js'];
const VISION_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== VISION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// רשת קודם, מטמון כגיבוי (כדי שעדכונים יגיעו מיד בשלב הפיתוח)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method === 'GET' && VISION_HOSTS.includes(u.hostname)) {
    // מודל הזיהוי וה-wasm: מטמון קודם, כדי שיעבדו גם בלי רשת בבוקר
    e.respondWith(caches.open(VISION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type !== 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'קום אח שלי', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'קום אח שלי', {
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
