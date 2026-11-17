// Atlas service worker — deliberately minimal.
//
// Caches ONLY two public, static files: the offline screen and one icon.
// It never caches pages, user data, API responses, server actions or
// publishing requests: every request goes to the network as if there were
// no service worker. The one thing it adds is that a page navigation that
// fails because the device is offline shows /offline.html instead of the
// browser's error page.
const CACHE = "atlas-offline-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only top-level page loads. Everything else (API calls, server actions,
  // images, scripts, POSTs, cross-origin requests) is left untouched.
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached ?? new Response("Çevrimdışı", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }),
  );
});
