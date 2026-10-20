import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls } from "./helpers.mjs";

let srv, app;
before(async () => { srv = await startServer(); app = await openApp(srv.url); });
after(async () => { await app?.close(); srv?.server.close(); await closeBrowser(); });
beforeEach(async () => { await app.page.evaluate(() => { setProgram("anvil", 0); resetChecks(); stopRest(); render(); }); });

const setLog = (ei) => app.page.evaluate((ei) => state.exercises[ei].setsLog, ei);
const click = (sel) => app.page.$eval(sel, (b) => b.click());

test("minus / plus only change the set's reps, never complete or fail it", async () => {
  await click('[data-act="set-rep"][data-i="0"][data-s="0"][data-d="-1"]');
  await click('[data-act="set-rep"][data-i="0"][data-s="0"][data-d="-1"]');
  let log = await setLog(0);
  assert.deepEqual(log[0], { ok: false, miss: false, reps: 6 });
  await click('[data-act="set-rep"][data-i="0"][data-s="1"][data-d="1"]');
  log = await setLog(0);
  assert.deepEqual(log[1], { ok: false, miss: false, reps: 9 });
  assert.equal(await app.page.evaluate(() => ui.running), false, "rest timer must not start from −/+");
  const shown = await app.page.$eval('[data-act="set"][data-i="0"][data-s="0"]', (b) => { const c = b.cloneNode(true); c.querySelector(".set-label")?.remove(); return c.textContent.trim(); });
  assert.equal(shown, "6");
});

test("tapping the rep box completes the set (ok at/above target) and starts rest", async () => {
  await click('[data-act="set"][data-i="0"][data-s="0"]');
  const log = await setLog(0);
  assert.equal(log[0].ok, true);
  assert.equal(log[0].miss, false);
  assert.equal(log[0].reps, 8);
  assert.equal(await app.page.evaluate(() => ui.running), true);
  assert.equal(await app.page.evaluate(() => ui.remain), 120);
  assert.equal(await app.page.$eval('[data-act="set"][data-i="0"][data-s="0"]', (b) => b.closest(".set").classList.contains("ok")), true);
});

test("rep box below target marks a miss; tapping again clears but keeps adjusted reps", async () => {
  await click('[data-act="set-rep"][data-i="1"][data-s="0"][data-d="-1"]');
  await click('[data-act="set"][data-i="1"][data-s="0"]');
  let log = await setLog(1);
  assert.deepEqual(log[0], { ok: false, miss: true, reps: 7 });
  await click('[data-act="set"][data-i="1"][data-s="0"]');
  log = await setLog(1);
  assert.deepEqual(log[0], { ok: false, miss: false, reps: 7 });
});

test("reps can't go below 0 or above the lift's cap", async () => {
  const sgm = await app.page.evaluate(() => state.exercises.findIndex((e) => e.id === "sgm"));
  for (let i = 0; i < 10; i++) await app.page.evaluate((ei) => bumpSetReps(ei, 0, 1), sgm);
  assert.equal((await setLog(sgm))[0].reps, 12);
  for (let i = 0; i < 20; i++) await app.page.evaluate((ei) => bumpSetReps(ei, 0, -1), sgm);
  assert.equal((await setLog(sgm))[0].reps, 0);
});

test("set taps persist to localStorage (anvil_app_v3) immediately", async () => {
  await click('[data-act="set"][data-i="0"][data-s="2"]');
  const saved = await ls(app.page, "anvil_app_v3");
  assert.equal(saved.exercises[0].setsLog[2].ok, true);
});

test("Log session refuses a half-finished lift and a blank session", async () => {
  await click('[data-act="log"]');
  assert.match(await app.page.$eval("#toast", (t) => t.textContent), /Tick a set first/);
  await click('[data-act="set"][data-i="0"][data-s="0"]');
  await click('[data-act="log"]');
  assert.match(await app.page.$eval("#toast", (t) => t.textContent), /Finish or skip/);
  assert.equal(await app.page.evaluate(() => state.history.length), 0);
});

test("full session: log via UI → history entry with per-set reps, day advances to B", async () => {
  const n = await app.page.evaluate(() => state.exercises.length);
  for (let ei = 0; ei < n; ei++) {
    const sets = await app.page.evaluate((ei) => state.exercises[ei].sets, ei);
    for (let si = 0; si < sets; si++) await app.page.evaluate((ei, si) => markSet(ei, si), ei, si);
  }
  await click('[data-act="log"]');
  const st = await app.page.evaluate(() => ({ h: state.history[0], day: state.dayIndex, ids: state.exercises.map((e) => e.id), panel: ui.panel }));
  assert.equal(st.day, 1);
  assert.equal(st.ids[0], "rdl");
  assert.equal(st.h.day, "A");
  assert.equal(st.h.lifts.length, n);
  assert.deepEqual(st.h.lifts[0].sets, [{ ok: true, miss: false, reps: 8 }, { ok: true, miss: false, reps: 8 }, { ok: true, miss: false, reps: 8 }]);
  assert.equal(st.panel, "bodyweight");
  assert.deepEqual(app.errors, []);
});

test("rest timer counts down and −15/+15 adjust it", async () => {
  await app.page.evaluate(() => startRest(30));
  await app.page.evaluate(() => adjustRest(15));
  assert.equal(await app.page.evaluate(() => ui.remain), 45);
  await app.page.evaluate(() => adjustRest(-15));
  await new Promise((r) => setTimeout(r, 2200));
  const r = await app.page.evaluate(() => ui.remain);
  assert.ok(r <= 29 && r >= 27, `remain ${r}`);
  await app.page.evaluate(() => stopRest());
});
