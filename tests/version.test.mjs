// Release hygiene: version bump consistency, precache coverage, and a real offline service-worker run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, openApp, closeBrowser, ROOT, sleep } from "./helpers.mjs";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const appVersion = () => {
  const src = [read("index.html"), ...listJs().map(read)].join("\n");
  const m = src.match(/const APP_VERSION = "([^"]+)"/); return m && m[1];
};
const cacheName = () => { const m = read("sw.js").match(/const CACHE = "([^"]+)"/); return m && m[1]; };
const precache = () => { const m = read("sw.js").match(/const SHELL = \[([\s\S]*?)\];/); return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]); };
function listJs(){ const d = path.join(ROOT, "js"); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".js")).map((f) => "js/" + f) : []; }
const localAssets = () => {
  const html = read("index.html");
  const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  return refs.map((u) => u.replace(/^\.\//, ""));
};
const noQuery = (u) => u.split("?")[0];

test("APP_VERSION matches sw.js CACHE (bump both together)", () => {
  const v = appVersion();
  assert.match(v, /^anvil-v\d+$/);
  assert.equal(cacheName(), v);
});

test("README/About show no stale hard-coded version elsewhere", () => {
  const v = appVersion();
  const others = [...(read("index.html") + listJs().map(read).join("")).matchAll(/anvil-v(\d+)/g)].map((m) => "anvil-v" + m[1]).filter((x) => x !== v);
  assert.deepEqual([...new Set(others)], []);
});

test("every local file index.html loads is precached by sw.js, and every precached file exists", () => {
  const shell = precache().map((u) => u.replace(/^\.\//, ""));
  for (const a of localAssets()) assert.ok(shell.includes(a), `sw.js SHELL is missing ${a}`);
  for (const f of shell) if (f) assert.ok(fs.existsSync(path.join(ROOT, noQuery(f))), `precached file not found: ${f}`);
});

test("split files carry ?v=<APP_VERSION> so a stale HTTP-cached part can't mix with a new index.html", () => {
  const v = appVersion();
  for (const a of localAssets().filter((a) => /^(js|css)\//.test(a))) assert.equal(a.split("?v=")[1], v, a);
  for (const a of precache().filter((a) => /(js|css)\//.test(a))) assert.equal(a.split("?v=")[1], v, a);
});

test("every js/*.js file is loaded by index.html (no orphan or missing module)", () => {
  const loaded = localAssets().map(noQuery).filter((a) => a.endsWith(".js"));
  assert.deepEqual([...listJs()].sort(), [...loaded].sort());
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

test("service worker installs, precaches, and the app opens offline", async () => {
  const app = await openApp(srv.url, { sw: true });
  await app.page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }, { timeout: 10000 });
  const v = appVersion();
  await app.page.waitForFunction(async (v) => { const c = await caches.open(v); return (await c.keys()).length > 0; }, { timeout: 10000 }, v);
  await sleep(500);
  const keys = await app.page.evaluate(async (v) => (await (await caches.open(v)).keys()).map((r) => new URL(r.url).pathname), v);
  for (const a of localAssets()) assert.ok(keys.includes("/" + noQuery(a)), `not in cache: ${a}`);
  await app.page.setOfflineMode(true);
  await app.page.reload({ waitUntil: "load" });
  await app.page.waitForFunction(() => !!document.querySelector("#app header"), { timeout: 10000 });
  assert.equal(await app.page.$$eval("article.card", (e) => e.length), 7);
  assert.deepEqual(app.errors, []);
  await app.close();
});
