// The operator board's service worker (the board installed as an app): its push notifications (gateway/push.cjs) shown,
// a click opening the board at that machine. Nothing is cached: the board is live or nothing.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Kval MachineScope', {
      body: d.body || '',
      tag: d.tag,
      renotify: !!d.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: d.url || '/?board' },
      requireInteraction: d.kind === 'error' || d.kind === 'call' || d.kind === 'escalated',
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/?board', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const board = list.find((c) => new URL(c.url).search.includes('board'));
      if (board) return board.focus().then((c) => (c && c.navigate ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    })
  );
});
