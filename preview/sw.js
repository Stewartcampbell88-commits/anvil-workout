// Retired: the preview moved to /anvil-preview/. This worker replaces the old /anvil-workout/preview/ one,
// removes itself and its caches, and sends any open window back to the live app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("anvil-preview-")).map((k) => caches.delete(k)));
    } catch (e) {}
    try { await self.clients.claim(); } catch (e) {}
    const wins = await self.clients.matchAll({ type: "window" });
    await self.registration.unregister();
    const live = new URL("../", self.registration.scope).href;
    await Promise.all(wins.map((c) => c.navigate(live).catch(() => {})));
  })());
});
