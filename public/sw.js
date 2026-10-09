// Offline shell only. Never cache authenticated APIs, journey tokens or patient data.
const CACHE = "masarak-shell-v1";
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(["/", "/icon.svg", "/manifest.webmanifest"]),
      ),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  ),
);
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      icon: "/icon.svg",
      tag: data.tag,
      data: { url: "/turn" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const target = windows.find(
          (w) => new URL(w.url).origin === location.origin,
        );
        if (target) {
          await target.navigate(new URL("/turn", location.origin).href);
          return target.focus();
        }
        return clients.openWindow("/turn");
      }),
  );
});
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (
    u.origin !== location.origin ||
    u.pathname.startsWith("/api") ||
    u.pathname.startsWith("/socket.io") ||
    u.search
  )
    return;
  if (event.request.mode === "navigate")
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
  else if (u.pathname.startsWith("/assets/"))
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(event.request);
        if (hit) return hit;
        const r = await fetch(event.request);
        if (r.ok) await c.put(event.request, r.clone());
        return r;
      }),
    );
});
