// Data-loss guards (the High findings from the code review).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload, sleep } from "./helpers.mjs";
import { KEYS, stewartState, anvilHistory, walksFixture } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

test("a crash while drawing the screen at startup never deletes saved data", async () => {
  const b = (await import("./helpers.mjs"));
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState() } });
  // Simulate a render bug on the next start.
  await app.page.evaluateOnNewDocument(() => {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    let n = 0;
    Object.defineProperty(Element.prototype, "innerHTML", { configurable: true, get(){ return d.get.call(this); }, set(v){ if (this.id === "app" && n++ < 3) throw new Error("boom"); d.set.call(this, v); } });
  });
  await app.page.reload({ waitUntil: "load" });
  await sleep(300);
  const s = await ls(app.page, KEYS.STATE);
  assert.ok(s, "anvil_app_v3 must survive");
  assert.equal(s.history.length, 10);
  await app.close();
});

test("unreadable saved data is kept in a rescue copy instead of being overwritten", async () => {
  const broken = JSON.stringify(stewartState()).slice(0, -5); // truncated JSON
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: broken } });
  // The user carries on and taps a set → app saves fresh state.
  await app.page.evaluate(() => markSet(0, 0));
  const rescue = await app.page.evaluate(() => localStorage.getItem("anvil_app_v3_rescue"));
  assert.ok(rescue, "rescue copy exists");
  assert.equal(JSON.parse(rescue).state, broken);
  await app.close();
});

test("first start of a new version keeps a pre-update snapshot of the saved data", async () => {
  const raw = stewartState();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const snap = await ls(app.page, "anvil_app_v3_snap");
  assert.ok(snap, "snapshot written");
  assert.deepEqual(JSON.parse(snap.state), raw);
  assert.equal(snap.version, await app.page.evaluate(() => APP_VERSION));
  await app.close();
});

test("history isn't silently trimmed at 60 sessions", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState({ history: anvilHistory(70), dayIndex: 0 }) } });
  await app.page.evaluate(() => { const ex = state.exercises[0]; ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: ex.reps })); logSession(); });
  assert.equal((await ls(app.page, KEYS.STATE)).history.length, 71);
  await app.close();
});

test("a walk in progress survives the app being closed / reloaded", async () => {
  const app = await openApp(srv.url);
  await app.page.evaluate(() => { ui.mainTab = "walk"; render(); toggleWalk(); walk.startedAt = Date.now() - 125000; walk.distanceKm = 0.4; persistActiveWalk(); });
  await reload(app);
  const w = await app.page.evaluate(() => ({ active: walk.active, el: walk.elapsedSec, km: walk.distanceKm }));
  assert.equal(w.active, true);
  assert.ok(w.km >= 0.4);
  await app.page.evaluate(() => toggleWalk());
  const saved = await ls(app.page, KEYS.WALKS);
  assert.equal(saved.length, 1);
  assert.ok(saved[0].durationSec >= 125);
  assert.equal(saved[0].distanceKm, 0.4);
  assert.equal(await app.page.evaluate(() => localStorage.getItem("anvil_walk_active_v1")), null);
  await app.close();
});

test("walk GPS: distance adds up fixes ≥6 m apart and ignores poor-accuracy fixes", async () => {
  const app = await openApp(srv.url);
  const km = await app.page.evaluate(() => {
    toggleWalk();
    const fix = (lat, lon, accuracy = 5) => onWalkPosition({ coords: { latitude: lat, longitude: lon, accuracy } });
    fix(-27.47, 153.02); fix(-27.471, 153.02); fix(-27.48, 153.02, 200); fix(-27.47101, 153.02); fix(-27.472, 153.02);
    const d = walk.distanceKm; walk.startedAt = Date.now() - 60000; toggleWalk(); return d;
  });
  assert.ok(Math.abs(km - 0.2224) < 0.003, `km ${km}`);
  assert.equal((await ls(app.page, KEYS.WALKS))[0].distanceKm, 0.22);
  await app.close();
});

test("walks under 30 s aren't saved", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.WALKS]: walksFixture() } });
  await app.page.evaluate(() => { toggleWalk(); toggleWalk(); });
  assert.equal((await ls(app.page, KEYS.WALKS)).length, 2);
  await app.close();
});

test("Session log renders history entries that have no notes (old/cloud data)", async () => {
  const h = anvilHistory(2); delete h[0].notes;
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState({ history: h }) } });
  await app.page.evaluate(() => { ui.panel = "settings"; ui.settingsTab = "history"; render(); });
  assert.deepEqual(app.errors, []);
  await app.close();
});
