// The preview build (/anvil-preview/) shares the origin (and so localStorage + Cache Storage) with live. It must stay isolated.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { startServer, openApp, closeBrowser, ls, previewSite, makeGas, browser, sleep, ROOT } from "./helpers.mjs";
import { KEYS, stewartState, walksFixture } from "./fixtures.mjs";

let srv, site;
before(async () => { site = previewSite(); srv = await startServer(site); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const liveSeed = () => ({ [KEYS.STATE]: stewartState(), [KEYS.WALKS]: walksFixture(), [KEYS.SYNC]: { name: "Stewart", lastSync: "2026-10-19T00:00:00.000Z" }, [KEYS.TOKENS]: { stewart: "11111111-2222-4333-8444-555555555555" } });
const dumpLive = (page) => page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), Object.values(KEYS));

test("preview starts with its own empty data, writes only anvil-preview:* keys, never touches live keys", async () => {
  const gas = makeGas();
  const app = await openApp(srv.url, { gas, path: "anvil-preview/", storage: liveSeed() });
  const liveBefore = await dumpLive(app.page);
  assert.equal(await app.page.evaluate(() => ANVIL_PREVIEW), true);
  assert.equal(await app.page.evaluate(() => state.history.length), 0);
  assert.match(await app.page.$eval("header", (h) => h.textContent), /Preview/);
  await app.page.evaluate(() => { const ex = state.exercises[0]; ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: ex.reps })); onLog(); toggleWalk(); walk.startedAt = Date.now() - 60000; toggleWalk(); });
  await app.page.evaluate(() => syncNow(true));
  await app.page.evaluate(() => { ui.restorePin = "2468"; return restoreFromCloud(); });
  await sleep(1200);
  assert.deepEqual(await dumpLive(app.page), liveBefore, "live keys byte-identical");
  assert.equal((await ls(app.page, "anvil-preview:anvil_app_v3")).history.length, 1);
  assert.equal((await ls(app.page, "anvil-preview:anvil_walks_v1")).length, 1);
  assert.equal(app.net.posts.length + app.net.gets.length, 0, "preview never calls the Sheet script");
  const keys = await app.page.evaluate(() => Object.keys(localStorage));
  for (const k of keys) assert.ok(Object.values(KEYS).includes(k) || k.startsWith("anvil-preview:") || k.startsWith("anvil_app_v3_"), `unexpected key ${k}`);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("'Copy my real data into Preview' is a one-way copy", async () => {
  const app = await openApp(srv.url, { path: "anvil-preview/", storage: liveSeed() });
  const liveBefore = await dumpLive(app.page);
  await app.page.evaluate(() => copyLiveIntoPreview());
  assert.equal(await app.page.evaluate(() => state.history.length), 10);
  assert.equal((await ls(app.page, "anvil-preview:anvil_walks_v1")).length, 2);
  await app.page.evaluate(() => { const ex = state.exercises[0]; ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: ex.reps })); logSession(); });
  assert.deepEqual(await dumpLive(app.page), liveBefore);
  await app.close();
});

test("live app at the root still uses the real keys", async () => {
  const app = await openApp(srv.url, { storage: liveSeed() });
  assert.equal(await app.page.evaluate(() => [ANVIL_PREVIEW, STORAGE, state.history.length].join()), "false,anvil_app_v3,10");
  await app.close();
});

test("preview and live service workers keep separate caches and don't delete each other's", async () => {
  const b = await browser();
  const ctx = await b.createBrowserContext();
  const page = await ctx.newPage();
  const ready = () => page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(location.href); return !!(r && r.active); }, { timeout: 10000 });
  await page.goto(srv.url, { waitUntil: "load" }); await ready(); await sleep(500);
  await page.goto(srv.url + "anvil-preview/", { waitUntil: "load" }); await ready(); await sleep(800);
  const names = await page.evaluate(() => caches.keys());
  const v = await page.evaluate(() => APP_VERSION);
  assert.ok(names.includes(v), `live cache kept: ${names}`);
  assert.ok(names.includes("anvil-preview-" + v), `preview cache: ${names}`);
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort());
  assert.deepEqual(regs, ["/", "/anvil-preview/"]);
  await ctx.close();
});

test("legacy /preview/ path is still detected as preview (safety)", async () => {
  const s2 = previewSite({ oldPreviewAt: "old/preview" }); const srv2 = await startServer(s2);
  const app = await openApp(srv2.url, { path: "old/preview/", storage: liveSeed() });
  assert.equal(await app.page.evaluate(() => [ANVIL_PREVIEW, STORAGE].join()), "true,anvil-preview:anvil_app_v3");
  await app.close(); srv2.server.close();
});

test("a phone stuck on the old /preview/ build gets its worker + caches removed and lands on the live app", async () => {
  // Before: the old preview build is installed at /preview/ (its SW + anvil-preview-* cache), live at /.
  const old = previewSite(); fs.rmSync(path.join(old, "preview"), { recursive: true });
  execFileSync(path.join(ROOT, "scripts", "make-preview.sh"), [path.join(old, "preview")], { stdio: "ignore" });
  const s2 = await startServer(old);
  const b = await browser(); const ctx = await b.createBrowserContext(); const page = await ctx.newPage();
  const regs = () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort());
  await page.goto(s2.url, { waitUntil: "load" }); await sleep(800);
  await page.goto(s2.url + "preview/", { waitUntil: "load" });
  await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(location.href); return !!(r && r.active) && new URL(r.scope).pathname === "/preview/"; }, { timeout: 10000 });
  await sleep(800);
  assert.deepEqual(await regs(), ["/", "/preview/"]);
  assert.ok((await page.evaluate(() => caches.keys())).some((k) => k.startsWith("anvil-preview-")));
  // After: this repo's preview/ (redirect page + retiring worker) is published. Reopen the stuck page.
  s2.setRoot(previewSite());
  await page.goto(s2.url + "preview/", { waitUntil: "load" });
  await page.waitForFunction(() => location.pathname === "/" && !!document.querySelector("#app header"), { timeout: 10000 });
  await sleep(800);
  assert.deepEqual(await regs(), ["/"]);
  assert.equal((await page.evaluate(() => caches.keys())).filter((k) => k.startsWith("anvil-preview-")).length, 0);
  assert.equal(await page.evaluate(() => ANVIL_PREVIEW), false);
  await ctx.close(); s2.server.close();
});

test("the retiring /preview/ worker unregisters itself", async () => {
  const s2 = await startServer(previewSite());
  const b = await browser(); const ctx = await b.createBrowserContext(); const page = await ctx.newPage();
  await page.goto(s2.url + "favicon.svg", { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.register("/preview/sw.js", { scope: "/preview/" }));
  await page.goto(s2.url + "preview/manifest.json", { waitUntil: "load" }).catch(() => {});
  await sleep(1500);
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname));
  assert.ok(!regs.includes("/preview/"), `still registered: ${regs}`);
  await ctx.close(); s2.server.close();
});
