// A phone on the live v43 single-file build taps Update now and lands on this build with all its data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, gitTree, ROOT, sleep } from "./helpers.mjs";
import { KEYS, stewartState, walksFixture } from "./fixtures.mjs";

const LIVE_REV = process.env.ANVIL_LIVE_REV || "92670ed"; // anvil-v43 (live when this suite was written)
let srv, old;
before(async () => { old = gitTree(LIVE_REV); srv = await startServer(old); });
after(async () => { srv?.server.close(); await closeBrowser(); });

test(`update from live (${LIVE_REV}) keeps every saved byte that matters`, async () => {
  const app = await openApp(srv.url, { sw: true, storage: { [KEYS.STATE]: stewartState({ dayIndex: 0 }), [KEYS.WALKS]: walksFixture(), [KEYS.SYNC]: { name: "Stewart", lastSync: new Date().toISOString() }, [KEYS.TOKENS]: { stewart: "11111111-2222-4333-8444-555555555555" } } });
  const p = app.page;
  await p.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active) && !!navigator.serviceWorker.controller; }, { timeout: 15000 }).catch(async () => { await p.reload({ waitUntil: "load" }); });
  const oldVersion = await p.evaluate(() => APP_VERSION);
  // Mid-session on the old build: two sets ticked, one set's reps dialled down.
  await p.evaluate(() => { markSet(0, 0); markSet(0, 1); bumpSetReps(1, 0, -2); });
  const before = await ls(p, KEYS.STATE);
  const beforeOther = await p.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), [KEYS.WALKS, KEYS.SYNC, KEYS.TOKENS]);

  srv.setRoot(ROOT); // deploy
  await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await sleep(1500);
  await p.evaluate(() => applyUpdate()).catch(() => {});
  await sleep(2500);
  await p.waitForFunction(() => typeof APP_VERSION !== "undefined" && !!document.querySelector("#app header"), { timeout: 15000 });
  const newVersion = await p.evaluate(() => APP_VERSION);
  assert.notEqual(newVersion, oldVersion);
  assert.ok(await p.evaluate(() => !!document.querySelector('script[src^="js/core.js"]')), "split build is running");
  const after = await ls(p, KEYS.STATE);
  assert.deepEqual(after.history, before.history);
  assert.deepEqual(after.liftProgress, before.liftProgress);
  assert.deepEqual(after.bodyWeightLog, before.bodyWeightLog);
  assert.deepEqual(after.exercises.map((e) => e.setsLog), before.exercises.map((e) => e.setsLog), "in-progress sets survive the update");
  assert.deepEqual([after.programId, after.dayIndex, after.soundVolume, after.cuePack], [before.programId, before.dayIndex, before.soundVolume, before.cuePack]);
  assert.deepEqual(await p.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), [KEYS.WALKS, KEYS.SYNC, KEYS.TOKENS]).then((v) => [v[0], JSON.parse(v[1]).name, v[2]]), [beforeOther[0], "Stewart", beforeOther[2]]);
  assert.deepEqual(JSON.parse((await ls(p, "anvil_app_v3_snap")).state).history, before.history, "pre-update snapshot taken");
  const names = await p.evaluate(() => caches.keys());
  assert.deepEqual(names, [newVersion], "old cache cleaned up");
  assert.deepEqual(app.errors, []);
  await app.close();
});
