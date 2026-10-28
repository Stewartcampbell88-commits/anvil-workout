// Switch-sides timer (v52): "each side" (bilateral) lifts — first tap on a set = side 1 done → short countdown + cue;
// second tap logs the set and starts normal rest. No L/R log boxes, progression unchanged. Time editable (0 = off).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });
const dayA = () => stewartState({ dayIndex: 0, anvilXrdlV49: true, neckIsoV50: true });
/** Make xrdl the active lift (earlier lifts skipped) and spy on the switch cue. */
const focusXrdl = (page) => page.evaluate(() => {
  window.__sw = 0; const orig = window.cueSwitch; window.cueSwitch = () => { window.__sw++; try { orig(); } catch {} };
  state.exercises.forEach((e, i) => { if (e.id !== "xrdl" && i < state.exercises.findIndex((x) => x.id === "xrdl")) skipExercise(i); });
  return state.exercises.findIndex((e) => e.id === "xrdl");
});

test("single-side lifts come from the existing 'each side' (bilateral) flag; default 10 s; others off", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const r = await app.page.evaluate(() => Object.fromEntries(state.exercises.map((e) => [e.id, switchSecFor(e)])));
  assert.equal(r.xrdl, 10); assert.equal(r.cossack, 10);
  for (const id of ["squat", "bench", "row", "sgm", "bext", "neck"]) assert.equal(r[id], 0, id);
  const lib = await app.page.evaluate(() => LIBRARY.flatMap((g) => g.lifts).filter((l) => l.bilateral).every((l) => switchSecFor(l) === 10));
  assert.equal(lib, true);
  await app.close();
});

test("tap 1 = side 1: set stays open (Side 2), Switch sides countdown + cue; tap 2 logs it and normal rest starts", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  const ei = await focusXrdl(p);
  await p.click(`#ex-xrdl [data-act="set"][data-s="0"]`);
  let st = await p.evaluate((ei) => ({ log: state.exercises[ei].setsLog, mode: ui.restMode, remain: ui.remain, running: ui.running, sw: window.__sw, clock: !!loadClock() }), ei);
  assert.deepEqual(st.log[0], { ok: false, miss: false, half: true });
  assert.equal(st.log.length, 3, "still 3 set boxes — no L/R split");
  assert.deepEqual([st.mode, st.remain, st.running, st.sw, st.clock], ["switch", 10, true, 1, true]);
  assert.match(await p.$eval("#ex-xrdl", (el) => el.textContent), /Switch sides/);
  assert.match(await p.$eval('#ex-xrdl [data-s="0"].set-hit', (el) => el.textContent), /Side 2/);
  assert.match(await p.$eval("#timer-bar-label", (el) => el.textContent), /^Switch sides · /);
  // countdown ends → GO for side 2
  await p.evaluate(() => { restEndAt = Date.now() - 1; restTick(); });
  assert.deepEqual(await p.evaluate(() => [ui.isGo, document.querySelector("[data-switch-lab]")?.textContent]), [true, "Side 2 — go"]);
  await p.click(`#ex-xrdl [data-act="set"][data-s="0"]`);
  st = await p.evaluate((ei) => ({ s0: state.exercises[ei].setsLog[0], mode: ui.restMode, remain: ui.remain, sw: window.__sw }), ei);
  assert.deepEqual(st.s0, { ok: true, miss: false, reps: 6 });
  assert.deepEqual([st.mode, st.remain, st.sw], ["rest", 75, 1], "normal rest (75 s) after the set, no second switch cue");
  // Tap again clears the set as before
  await p.click(`#ex-xrdl [data-act="set"][data-s="0"]`);
  assert.deepEqual(await p.evaluate((ei) => state.exercises[ei].setsLog[0], ei), { ok: false, miss: false, reps: 6 });
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("progression + logged session identical to a plain tap; a half-done lift blocks Log session", async () => {
  const run = async (twoTaps) => {
    const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
    const p = app.page;
    const ei = await focusXrdl(p);
    await p.evaluate((ei) => { state.exercises[ei] = { ...state.exercises[ei], streak: 2 }; }, ei);
    if (twoTaps) for (let si = 0; si < 3; si++) { await p.evaluate((ei, si) => { onMark(ei, si); onMark(ei, si); }, ei, si); }
    else await p.evaluate((ei) => { for (let si = 0; si < 3; si++) markSet(ei, si); }, ei);
    const out = await p.evaluate(() => { logSession(); const x = state.exercises.find((e) => e.id === "xrdl"); return { ex: [x.reps, x.weight, x.streak, x.setsLog], lift: state.history[0].lifts.find((l) => l.id === "xrdl") }; });
    await app.close();
    return out;
  };
  const a = await run(true), b = await run(false);
  assert.deepEqual(a, b);
  assert.deepEqual(a.ex.slice(0, 3), [8, 5, 0]);
  assert.equal(a.lift.sets.length, 3); assert.ok(a.lift.sets.every((s) => !("half" in s)));
  // Only side 1 done → Log refuses (like any started lift)
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const ei = await focusXrdl(app.page);
  const n = await app.page.evaluate((ei) => { onMark(ei, 0); const before = state.history.length; onLog(); return [before, state.history.length]; }, ei);
  assert.equal(n[0], n[1], "nothing logged");
  assert.match(await app.page.$eval("#toast", (el) => el.textContent), /Finish or skip/);
  await app.close();
});

test("Edit screen: switch time only on single-side lifts; 15 s used; 0 = off (one tap logs); persists", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await p.click('#ex-squat [data-act="edit-ex"]');
  assert.equal(await p.$('[data-f="switchSec"]'), null, "not on two-sided lifts");
  await p.click('.edit-actions [data-act="edit-cancel"]');
  await p.click('#ex-xrdl [data-act="edit-ex"]');
  assert.equal(await p.$eval('[data-edit-val="switchSec"]', (el) => el.textContent), "10s");
  await p.click('[data-act="edit-step"][data-f="switchSec"][data-d="1"]');
  await p.click('[data-act="edit-save"]');
  assert.deepEqual((await ls(p, KEYS.STATE)).exerciseEdits.anvil.xrdl, { switchSec: 15 });
  let ei = await focusXrdl(p);
  await p.evaluate((ei) => onMark(ei, 0), ei);
  assert.equal(await p.evaluate(() => ui.remain), 15);
  await p.evaluate(() => stopRest());
  await p.click('#ex-xrdl [data-act="edit-ex"]');
  for (let i = 0; i < 3; i++) await p.click('[data-act="edit-step"][data-f="switchSec"][data-d="-1"]');
  assert.equal(await p.$eval('[data-edit-val="switchSec"]', (el) => el.textContent), "Off");
  await p.click('[data-act="edit-save"]');
  assert.deepEqual((await ls(p, KEYS.STATE)).exerciseEdits.anvil.xrdl, { switchSec: 0 });
  await p.evaluate((ei) => onMark(ei, 1), ei);
  assert.deepEqual(await p.evaluate((ei) => [state.exercises[ei].setsLog[1].ok, ui.restMode, ui.remain, window.__sw], ei), [true, "rest", 75, 1], "off → one tap logs the set");
  await reload(app);
  assert.equal(await p.evaluate(() => switchSecFor(state.exercises.find((e) => e.id === "xrdl"))), 0);
  // Reset to default brings back 10 s
  await p.click('#ex-xrdl [data-act="edit-ex"]');
  await p.click('[data-act="edit-reset"]');
  await p.click('[data-act="edit-save"]');
  assert.equal((await ls(p, KEYS.STATE)).exerciseEdits.anvil, undefined);
  assert.equal(await p.evaluate(() => switchSecFor(state.exercises.find((e) => e.id === "xrdl"))), 10);
  assert.deepEqual(app.errors, []);
  await app.close();
});
