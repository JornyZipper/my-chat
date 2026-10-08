const CACHE = "my-chat-shell-v1";
const SHELL = ["/", "/index.html", "/style.css", "/app.js", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match("/")))
  );
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "My Chat", body: event.data?.text() || "Новое сообщение" }; }
  event.waitUntil(self.registration.showNotification(data.title || "My Chat", {
    body: data.body || "Новое сообщение",
    icon: data.icon || "/icon.svg",
    badge: data.badge || "/icon.svg",
    data: data.data || {}
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const userId = event.notification.data?.userId;
  event.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    const existing = list[0];
    if (existing) {
      existing.focus();
      existing.postMessage({type: "open_user", userId});
      return;
    }
    return clients.openWindow("/");
  }));
});
