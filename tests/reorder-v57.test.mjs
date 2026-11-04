// v57: pick a slot when adding a lift; ↑/↓ reorder on cards; order persists per program + day.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });
const dayA = () => stewartState({ dayIndex: 0, anvilXrdlV49: true, neckIsoV50: true });
const ids = (p) => p.evaluate(() => state.exercises.map((e) => e.id));
const firstLib = (p) => p.evaluate(() => { const have = new Set(state.exercises.map((e) => e.id)); return LIBRARY.flatMap((g) => g.lifts).find((l) => !have.has(l.id)).id; });

test("place chooser: Top / After each / End (default End) and insert lands there", async () => {
  for (const [choice, expectAt] of [["0", 0], ["2", 2], ["end", null]]) {
    const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
    const p = app.page;
    const before = await ids(p);
    const lid = await firstLib(p);
    await p.click('[data-act="panel"][data-p="add"]');
    await p.click(`[data-act="pick"][data-id="${lid}"]`);
    const labels = await p.$$eval('[data-act="pick-at"]', (b) => b.map((x) => x.textContent));
    assert.equal(labels[0], "Top"); assert.equal(labels.at(-1), "End");
    assert.equal(labels.length, before.length + 1);
    assert.equal(await p.$eval('[data-act="pick-at"].on', (b) => b.textContent), "End");
    await p.click(`[data-act="pick-at"][data-at="${choice}"]`);
    await p.$eval('[data-act="confirm-add"]', (el) => el.click());
    const after = await ids(p);
    assert.equal(after.indexOf(lid), expectAt ?? before.length, choice);
    assert.deepEqual(after.filter((x) => x !== lid), before);
    assert.deepEqual(app.errors, []);
    await app.close();
  }
});

test("↑/↓ reorder, disabled at ends, persists after reload and day switch", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  const before = await ids(p);
  assert.equal(await p.$eval(`#ex-${before[0]} [data-act="move-ex"][data-d="-1"]`, (b) => b.disabled), true);
  assert.equal(await p.$eval(`#ex-${before.at(-1)} [data-act="move-ex"][data-d="1"]`, (b) => b.disabled), true);
  await p.click(`#ex-${before[0]} [data-act="move-ex"][data-d="1"]`);
  await p.click(`#ex-${before[3]} [data-act="move-ex"][data-d="-1"]`);
  const exp = [before[1], before[0], before[3], before[2], ...before.slice(4)];
  assert.deepEqual(await ids(p), exp);
  assert.deepEqual((await ls(p, KEYS.STATE)).exercises.map((e) => e.id), exp);
  await reload(app);
  assert.deepEqual(await ids(p), exp, "after reload");
  await p.evaluate(() => { setDay(1); setDay(0); });
  assert.deepEqual(await ids(p), exp, "after day switch");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("order rides in Export → Import; other profiles' seeds untouched; Mobility has no arrows", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await p.evaluate(() => moveExercise(0, 1));
  const exp = await ids(p);
  await p.evaluate(() => exportBackup());
  const raw = JSON.parse(await p.evaluate(() => window.__exports[0]));
  assert.deepEqual(raw.dayOrder["anvil:0"], exp);
  const seedEmber = await p.evaluate(() => seedProgram("ember", 0).map((e) => e.id));
  await p.evaluate(() => { state.dayOrder = {}; setDay(1); setDay(0); });
  assert.notDeepEqual(await ids(p), exp);
  await p.evaluate((r) => applyBackup(r), raw);
  await p.evaluate(() => { setDay(1); setDay(0); });
  assert.deepEqual(await ids(p), exp, "imported order");
  assert.deepEqual(await p.evaluate(() => seedProgram("ember", 0).map((e) => e.id)), seedEmber);
  await p.click('[data-act="mobility"]');
  assert.equal(await p.$('[data-act="move-ex"]'), null);
  assert.equal(await p.evaluate(() => moveExercise(0, 1)), false);
  assert.deepEqual(app.errors, []);
  await app.close();
});
