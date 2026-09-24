const CACHE = "anvil-v18";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon.svg",
  "./sounds/three.mp3",
  "./sounds/two.mp3",
  "./sounds/one.mp3",
  "./sounds/go-coach.mp3",
  "./sounds/go-aussie.mp3",
  "./sounds/go-rude.mp3",
  "./sounds/go-adult.mp3",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => c.addAll(["./", "./index.html"]))));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html") || caches.match("./")))
  );
});
