// DOMINO MGA — Push service worker (push-only, no offline cache)
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = { title: "DOMINO MGA", body: "Misy notification vaovao" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) {
    try { data.body = event.data?.text() || data.body; } catch {}
  }
  const title = data.title || "DOMINO MGA";
  const opts = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || ("dmga-" + Date.now()),
    data: { url: data.url || "/" },
    vibrate: [220, 110, 220],
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { try { await c.focus(); c.navigate(url); return; } catch {} }
    }
    await self.clients.openWindow(url);
  })());
});
