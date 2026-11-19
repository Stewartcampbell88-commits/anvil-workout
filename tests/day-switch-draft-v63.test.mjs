// v63 bug fix: switching days mid-session wiped the unlogged session (ticked sets, adjusted reps, kg, skips, added lifts).
// Each day now keeps its own draft; switching back restores it (also after reload). Logging clears only that day's draft.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

/** Day A mid-session: squat 2 sets ticked (2nd with +1 rep), bench kg +2.5, row skipped, curl added with a set ticked. */
const startDayA = (app) => app.page.evaluate(() => {
  setProgram("anvil", 0);
  const sq = state.exercises.findIndex((e) => e.id === "squat");
  markSet(sq, 0); bumpSetReps(sq, 1, 1); markSet(sq, 1);
  const be = state.exercises.findIndex((e) => e.id === "bench");
  bumpWeight(be, 2.5);
  skipExercise(state.exercises.findIndex((e) => e.id === "row"), "time");
  addExercise(LIBRARY.flatMap((g) => g.lifts).find((l) => l.id === "curl"));
  markSet(state.exercises.findIndex((e) => e.id === "curl"), 0);
  return snap();
  function snap(){ return JSON.parse(JSON.stringify(state.exercises.map((e) => ({ id: e.id, w: e.weight, sk: !!e.skipped, log: e.setsLog })))); }
});
const snapA = (app) => app.page.evaluate(() => JSON.parse(JSON.stringify(state.exercises.map((e) => ({ id: e.id, w: e.weight, sk: !!e.skipped, log: e.setsLog })))));

test("repro: Day A → Day B → Day A keeps ticked sets, rep tweaks, kg, skips and added lifts", async () => {
  const app = await openApp(srv.url);
  const before = await startDayA(app);
  await app.page.click('[data-act="day"][data-d="1"]');
  assert.equal(await app.page.evaluate(() => state.dayIndex), 1);
  assert.ok(await app.page.evaluate(() => state.exercises.every((e) => e.setsLog.every((s) => !s.ok && !s.miss))), "Day B starts clean");
  await app.page.click('[data-act="day"][data-d="0"]');
  assert.deepEqual(await snapA(app), before);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("each day keeps its own draft; both survive a reload", async () => {
  const app = await openApp(srv.url);
  const a = await startDayA(app);
  const b = await app.page.evaluate(() => { setDay(1); const i = state.exercises.findIndex((e) => e.id === "rdl"); markSet(i, 0); return JSON.parse(JSON.stringify(state.exercises.map((e) => ({ id: e.id, w: e.weight, sk: !!e.skipped, log: e.setsLog })))); });
  await app.page.evaluate(() => setDay(0));
  assert.deepEqual(await snapA(app), a);
  await reload(app);
  assert.equal(await app.page.evaluate(() => state.dayIndex), 0);
  assert.deepEqual(await snapA(app), a, "Day A draft after reload");
  await app.page.evaluate(() => setDay(1));
  assert.deepEqual(await snapA(app), b, "Day B draft after reload + switch");
  await reload(app);
  await app.page.evaluate(() => setDay(0));
  assert.deepEqual(await snapA(app), a, "Day A still there after another reload");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("switching program and back keeps the draft too", async () => {
  const app = await openApp(srv.url);
  const a = await startDayA(app);
  await app.page.evaluate(() => { setProgram("ember", 0); setProgram("anvil", 0); });
  assert.deepEqual(await snapA(app), a);
  await app.close();
});

test("logging a session clears only that day's draft; progression unchanged", async () => {
  const app = await openApp(srv.url);
  await startDayA(app);
  // Day B draft, then back to A and log A
  await app.page.evaluate(() => { setDay(1); markSet(state.exercises.findIndex((e) => e.id === "rdl"), 0); setDay(0); });
  const r = await app.page.evaluate(() => {
    // finish the started lifts so Log is allowed
    state.exercises = state.exercises.map((e) => e.setsLog.some((s) => s.ok || s.miss) ? { ...e, setsLog: e.setsLog.map((s) => s.ok || s.miss ? s : { ok: true, miss: false, reps: e.reps }) } : e);
    onLog();
    return { day: state.dayIndex, rdl: state.exercises.find((e) => e.id === "rdl").setsLog[0].ok, drafts: Object.keys(state.dayDrafts || {}), hist: state.history[0].lifts.map((l) => l.id), squat: state.liftProgress.squat };
  });
  assert.equal(r.day, 1, "log moves on to Day B");
  assert.equal(r.rdl, true, "Day B draft restored after logging A");
  assert.deepEqual(r.drafts, [], "no drafts left (A logged, B is on screen)");
  assert.ok(r.hist.includes("squat") && r.hist.includes("curl"));
  assert.equal(r.squat.streak, 1, "squat counted one clean session (normal progression)");
  // Back to A: fresh, nothing carried over from the logged session
  const a = await app.page.evaluate(() => { ui.panel = "none"; setDay(0); return state.exercises.some((e) => e.setsLog.some((s) => s.ok || s.miss) || e.skipped || e.id === "curl"); });
  assert.equal(a, false);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("a draft stays in step with progress logged elsewhere (shared lift ids) and the Weekly special slot", async () => {
  const app = await openApp(srv.url);
  // 5×5: squat on both days. Tick a set on A, switch to B, log B (squat bumps), back to A → ticks kept, new squat target
  const r = await app.page.evaluate(() => {
    setProgram("five-by-five", 0);
    markSet(state.exercises.findIndex((e) => e.id === "bench"), 0);
    setDay(1);
    state.exercises = state.exercises.map((e) => ({ ...e, streak: e.id === "squat" ? 2 : e.streak, setsLog: e.setsLog.map(() => ({ ok: true, miss: false, reps: e.reps })) }));
    const sqBefore = state.exercises.find((e) => e.id === "squat").weight;
    logSession(); setDay(0);
    return { bench: state.exercises.find((e) => e.id === "bench").setsLog[0].ok, sq: state.exercises.find((e) => e.id === "squat").weight, sqBefore, prog: state.liftProgress.squat.weight };
  });
  assert.equal(r.bench, true);
  assert.equal(r.sq, r.prog, "draft picks up the newer squat target");
  assert.ok(r.sq > r.sqBefore);
  // ANVIL Day B draft with the special ticked survives a round trip
  const w = await app.page.evaluate(() => {
    setProgram("anvil", 1);
    const i = state.exercises.findIndex((e) => isWeeklySpecial(e)); markSet(i, 0);
    setDay(0); setDay(1);
    const sp = state.exercises.find((e) => isWeeklySpecial(e));
    return [state.exercises.filter((e) => isWeeklySpecial(e)).length, sp.setsLog.some((s) => s.ok || s.half)];
  });
  assert.deepEqual(w, [1, true]);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("old saves without drafts load fine; nothing in progress → no draft stored", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "anvil", dayIndex: 0, exercises: [], history: [], liftProgress: {} } } });
  const d = await app.page.evaluate(() => { setDay(1); setDay(0); return state.dayDrafts; });
  assert.deepEqual(d, {});
  assert.deepEqual((await ls(app.page, KEYS.STATE)).dayDrafts, {});
  assert.deepEqual(app.errors, []);
  await app.close();
});
