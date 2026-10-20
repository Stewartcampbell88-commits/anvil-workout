import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, makeGas } from "./helpers.mjs";
import { KEYS, stewartState, walksFixture } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const syncAndWait = async (app, manual = true) => {
  await app.page.evaluate((m) => syncNow(m), manual);
  await app.page.waitForFunction(() => !syncBusy, { timeout: 5000 });
};

test("sync payload: name from program, full log + walks, wantToken, no PIN/token leakage", async () => {
  const gas = makeGas();
  const app = await openApp(srv.url, { gas, storage: { [KEYS.STATE]: stewartState(), [KEYS.WALKS]: walksFixture() } });
  await syncAndWait(app);
  assert.equal(app.net.posts.length, 1);
  const p = app.net.posts[0];
  assert.equal(p.name, "Stewart");
  assert.equal(p.appVersion, await app.page.evaluate(() => APP_VERSION));
  assert.equal(p.wantToken, true);
  assert.equal(p.deviceToken, undefined);
  assert.equal(p.data.history.length, 10);
  assert.equal(p.data.walks.length, 2);
  assert.equal(p.data.bodyWeightLog.length, 2);
  assert.ok(!("pin" in p) && !("pin" in p.data));
  const cfg = await ls(app.page, KEYS.SYNC);
  assert.ok(cfg.lastSync); assert.equal(cfg.pending, false);
  assert.equal(gas.get({ action: "restore", name: "Stewart", pin: "2468" }).data.history.length, 10);
  await app.close();
});

test("guard: an empty phone never syncs (would wipe the cloud copy)", async () => {
  const app = await openApp(srv.url, { gas: makeGas() });
  await syncAndWait(app, true);
  await syncAndWait(app, false);
  assert.equal(app.net.posts.length, 0);
  assert.match((await ls(app.page, KEYS.SYNC)).status, /Nothing to sync/);
  await app.close();
});

test("guard: after a restore, auto-sync holds until new activity; manual sync still works", async () => {
  const app = await openApp(srv.url, { gas: makeGas(), storage: { [KEYS.STATE]: stewartState(), [KEYS.SYNC]: { name: "Stewart", holdAfterRestore: true, lastSync: null } } });
  await app.page.evaluate(() => syncIfStale());
  await syncAndWait(app, false);
  assert.equal(app.net.posts.length, 0);
  await app.page.evaluate(() => newLocalActivity());
  await syncAndWait(app, false);
  assert.equal(app.net.posts.length, 1);
  await app.close();
});

test("enrolment: the phone stores the trusted token it's given and sends it next time", async () => {
  const gas = makeGas({ enrolUntil: new Date(Date.now() + 86400000).toISOString() });
  const app = await openApp(srv.url, { gas, storage: { [KEYS.STATE]: stewartState() } });
  await syncAndWait(app);
  const tok = (await ls(app.page, KEYS.TOKENS)).stewart;
  assert.match(tok, /^[0-9a-f-]{36}$/);
  await syncAndWait(app);
  assert.equal(app.net.posts[1].deviceToken, tok);
  await app.close();
});

test("offline / network error: marks pending and retries later, data untouched", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState() } }); // no gas → requests aborted
  await syncAndWait(app);
  const cfg = await ls(app.page, KEYS.SYNC);
  assert.equal(cfg.pending, true);
  assert.match(cfg.status, /will retry/);
  assert.equal((await ls(app.page, KEYS.STATE)).history.length, 10);
  await app.close();
});

test("logging a session triggers an automatic sync", async () => {
  const app = await openApp(srv.url, { gas: makeGas(), storage: { [KEYS.STATE]: stewartState({ dayIndex: 0 }) } });
  await app.page.evaluate(() => { const ex = state.exercises[0]; ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: ex.reps })); onLog(); });
  await app.page.waitForFunction(() => syncCfg.lastSync && !syncBusy, { timeout: 5000 });
  assert.equal(app.net.posts.length, 1);
  assert.equal(app.net.posts[0].data.history.length, 11);
  await app.close();
});

test("the sync name is pinned: switching program doesn't start overwriting someone else's cloud copy", async () => {
  const gas = makeGas();
  const app = await openApp(srv.url, { gas, storage: { [KEYS.STATE]: stewartState() } }); // no saved name; derived from ANVIL = Stewart
  await syncAndWait(app);
  assert.equal(app.net.posts[0].name, "Stewart");
  await app.page.evaluate(() => setProgram("ember", 0));
  await syncAndWait(app);
  assert.equal(app.net.posts[1].name, "Stewart", "still Stewart after switching to EMBER");
  assert.equal((await ls(app.page, KEYS.SYNC)).name, "Stewart");
  await app.close();
});
