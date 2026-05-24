const CACHE_NAME = "fleet-command-mobile-v4";
const CORE_ASSETS = [
  "/mobile.html",
  "/mobile.css",
  "/mobile.js",
  "/auth.js",
  "/manifest.webmanifest"
];
const isMobileAsset = request => {
  const path = new URL(request.url).pathname;
  return CORE_ASSETS.includes(path) || path.startsWith("/mobile");
};
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    if (url.pathname !== "/mobile.html") return;
    event.respondWith(fetch(request).catch(() => caches.match("/mobile.html")));
    return;
  }
  if (!isMobileAsset(request)) return;
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match("/mobile.html")))
  );
});