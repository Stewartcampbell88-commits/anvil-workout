const CACHE = "anvil-v52";
// The preview copy (/anvil-preview/, formerly /preview/) runs on the same origin as live, and Cache Storage is per origin: give it its own
// cache names and make each flavour delete only its own old caches.
const PREVIEW = /\/(anvil-)?preview\//.test(self.location.pathname);
const CACHE_NAME = PREVIEW ? "anvil-preview-" + CACHE : CACHE;
const mine = (k) => PREVIEW ? k.startsWith("anvil-preview-") : !k.startsWith("anvil-preview-");
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css?v=anvil-v52",
  "./js/core.js?v=anvil-v52",
  "./js/walk.js?v=anvil-v52",
  "./js/audio.js?v=anvil-v52",
  "./js/state.js?v=anvil-v52",
  "./js/session.js?v=anvil-v52",
  "./js/progress.js?v=anvil-v52",
  "./js/render.js?v=anvil-v52",
  "./js/howto.js?v=anvil-v52",
  "./js/main.js?v=anvil-v52",
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
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL).catch(() => c.addAll(["./", "./index.html"]))));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && mine(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.open(CACHE_NAME).then(async (c) => (await c.match(event.request)) || (event.request.mode === "navigate" && ((await c.match("./index.html")) || (await c.match("./")))) || Response.error()))
  );
});
