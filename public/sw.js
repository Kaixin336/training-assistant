// Only public fallback assets are cached. Journal pages, APIs, photos and auth
// responses are always fetched from the network and are never stored here.
const CACHE = "kai-offline-v4";
const ASSETS = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/maskable-512.png"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of ASSETS) {
      const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
      if (!response.ok || response.redirected) throw new Error("Offline assets unavailable");
      const type = response.headers.get("content-type") || "";
      if (path.endsWith(".png") ? !type.includes("image/png") : !type.includes("text/html")) throw new Error("Unexpected offline asset");
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if ((key.startsWith("kai-offline-") || key.startsWith("form-offline-")) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match("/offline.html")) || new Response("请连接网络后重新打开训练助手。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    ));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then(cached => cached || fetch(request)));
  }
});
