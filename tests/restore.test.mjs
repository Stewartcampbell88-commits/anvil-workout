import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, makeGas, reload, TEST_PIN } from "./helpers.mjs";
import { KEYS, anvilHistory, walksFixture, bwFixture, stewartState } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

function cloud(){
  const gas = makeGas();
  gas.post({ name: "Stewart", appVersion: "anvil-v43", syncedAt: "2026-10-19T09:00:00.000Z", data: { ...stewartState(), walks: walksFixture() } });
  return gas;
}
async function restoreVia(app, pin){
  await app.page.evaluate((pin) => { ui.restorePin = pin || ""; return restoreFromCloud(); }, pin);
  await app.page.waitForFunction(() => !ui.restoreBusy);
}

test("fresh install: banner offers restore; PIN restore fills the phone, trusts it, never stores the PIN", async () => {
  const gas = cloud();
  const app = await openApp(srv.url, { gas });
  assert.ok(await app.page.$("[data-act=restore-cloud]"), "restore banner shown on an empty phone");
  await app.page.type("[data-restore-pin]", TEST_PIN);
  await app.page.$eval("[data-act=restore-cloud]", (b) => b.click());
  await app.page.waitForFunction(() => state.history.length === 10, { timeout: 5000 });
  assert.equal(app.net.gets[0].pin, TEST_PIN);
  assert.equal(app.net.gets[0].name, "Stewart");
  assert.equal((await ls(app.page, KEYS.WALKS)).length, 2);
  assert.equal((await ls(app.page, KEYS.STATE)).bodyWeightLog.length, 2);
  assert.match((await ls(app.page, KEYS.TOKENS)).stewart, /^[0-9a-f-]{36}$/);
  const cfg = await ls(app.page, KEYS.SYNC);
  assert.equal(cfg.holdAfterRestore, true);
  assert.equal(cfg.name, "Stewart");
  const all = await app.page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("\n"));
  assert.ok(!all.includes(`"${TEST_PIN}"`), "PIN must never be written to localStorage");

  // Same phone later: trusted → token, no PIN.
  await app.page.evaluate(() => { localStorage.removeItem("anvil_app_v3"); });
  await reload(app);
  await restoreVia(app, "");
  assert.equal(app.net.gets.at(-1).pin, undefined);
  assert.match(app.net.gets.at(-1).token, /^[0-9a-f-]{36}$/);
  assert.equal(await app.page.evaluate(() => state.history.length), 10);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("wrong PIN: clear message, phone data untouched", async () => {
  const app = await openApp(srv.url, { gas: cloud(), storage: { [KEYS.STATE]: stewartState({ history: anvilHistory(3) }) } });
  await restoreVia(app, "1111");
  assert.match(await app.page.evaluate(() => ui.restoreMsg), /Wrong family PIN/);
  assert.equal((await ls(app.page, KEYS.STATE)).history.length, 3);
  await app.close();
});

test("revoked token: phone forgets it and asks for the PIN", async () => {
  const app = await openApp(srv.url, { gas: cloud(), storage: { [KEYS.TOKENS]: { stewart: "00000000-0000-4000-8000-000000000000" } } });
  await restoreVia(app, "");
  assert.equal(await app.page.evaluate(() => ui.restoreNeedPin), true);
  assert.equal((await ls(app.page, KEYS.TOKENS)).stewart, undefined);
  assert.match(await app.page.evaluate(() => ui.restoreMsg), /PIN/);
  await app.close();
});

test("locked after too many wrong PINs", async () => {
  const app = await openApp(srv.url, { gas: cloud() });
  for (let i = 0; i < 5; i++) await restoreVia(app, "9999");
  assert.match(await app.page.evaluate(() => ui.restoreMsg), /locked/i);
  await app.close();
});

test("cancelling the confirm leaves the phone alone", async () => {
  const app = await openApp(srv.url, { gas: cloud(), storage: { [KEYS.STATE]: stewartState({ history: anvilHistory(3) }) }, onDialog: (d) => d.dismiss() });
  await restoreVia(app, TEST_PIN);
  assert.equal((await ls(app.page, KEYS.STATE)).history.length, 3);
  assert.match(await app.page.evaluate(() => ui.restoreMsg), /cancelled/);
  await app.close();
});

test("restore over existing data keeps an undo copy of what was on the phone", async () => {
  const mine = stewartState({ history: anvilHistory(3) });
  const app = await openApp(srv.url, { gas: cloud(), storage: { [KEYS.STATE]: mine, [KEYS.WALKS]: walksFixture().slice(0, 1) } });
  await restoreVia(app, TEST_PIN);
  assert.equal(await app.page.evaluate(() => state.history.length), 10);
  const undo = await ls(app.page, "anvil_app_v3_undo");
  assert.ok(undo, "undo copy written");
  assert.equal(JSON.parse(undo.state).history.length, 3);
  assert.equal(JSON.parse(undo.walks).length, 1);
  await app.close();
});
