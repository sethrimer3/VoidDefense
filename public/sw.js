const CACHE = "void-defense-v1";
const STATIC_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./GameIcon-192.png", "./GameIcon.png"];

async function precacheApp(cache) {
  await cache.addAll(STATIC_SHELL);
  try {
    const res = await fetch("./index.html", { cache: "no-cache" });
    if (!res.ok) return;
    const html = await res.text();
    const seen = new Set();
    const queue = [];
    for (const m of html.matchAll(/(?:src|href)="(\.?\/assets\/[^"]+)"/g)) {
      const u = new URL(m[1], self.location.href).href;
      if (!seen.has(u)) {
        seen.add(u);
        queue.push(u);
      }
    }
    while (queue.length > 0) {
      const u = queue.shift();
      await cache.add(u).catch(() => {});
      if (!u.endsWith(".js") && !u.endsWith(".css")) continue;
      const r = await cache.match(u);
      if (!r) continue;
      const text = await r.text();
      for (const m of text.matchAll(/["'(](\.?\/?(?:assets\/)?[A-Za-z0-9_.-]+\.(?:js|css|ttf|woff2?))["')]/g)) {
        const dep = new URL(m[1], u).href;
        if (dep.startsWith(self.location.origin) && !seen.has(dep)) {
          seen.add(dep);
          queue.push(dep);
        }
      }
    }
  } catch {
    // ignore if offline during install
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(precacheApp).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
