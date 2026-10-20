import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser } from "./helpers.mjs";

let srv, app;
before(async () => { srv = await startServer(); app = await openApp(srv.url); });
after(async () => { assert.deepEqual(app.errors, []); await app?.close(); srv?.server.close(); await closeBrowser(); });

/** Run one logged session where only lift `id` is done, every set at `reps` (number or per-set array). */
function sess({ pid = "anvil", day = 0, id, patch = {}, reps, progress = {} }){
  return app.page.evaluate(({ pid, day, id, patch, reps, progress }) => {
    state.history = []; state.liftProgress = {}; state.programId = pid; state.dayIndex = day;
    state.exercises = seedProgram(pid, day);
    state.liftProgress = { ...captureProgress(state.exercises), ...progress };
    state.exercises = applyProgress(seedProgram(pid, day), state.liftProgress, pid).map((e) => e.id === id ? { ...e, ...patch } : e);
    state.liftProgress = captureProgress(state.exercises, state.liftProgress);
    const ei = state.exercises.findIndex((e) => e.id === id);
    if (ei < 0) throw new Error("no lift " + id);
    const ex = state.exercises[ei];
    ex.setsLog = ex.setsLog.map((_, si) => { const r = Array.isArray(reps) ? reps[si] : (reps ?? ex.reps); return r >= ex.reps ? { ok: true, miss: false, reps: r } : { ok: false, miss: true, reps: r }; });
    ui.pendingHolds = null;
    const notes = logSession();
    const out = state.exercises.find((e) => e.id === id);
    return { ex: { reps: out.reps, weight: out.weight, streak: out.streak, failStreak: out.failStreak, levelIndex: out.levelIndex, name: out.name }, notes, prog: state.liftProgress[id], hist: state.history[0], holds: ui.pendingHolds };
  }, { pid, day, id, patch, reps, progress });
}
const W = (o) => ({ reps: o.ex.reps, weight: o.ex.weight, streak: o.ex.streak });

test("wave: clean session counts the streak (1/3) and keeps the target", async () => {
  const o = await sess({ id: "squat", patch: { reps: 8, weight: 60, streak: 0 } });
  assert.deepEqual(W(o), { reps: 8, weight: 60, streak: 1 });
  assert.ok(o.notes.some((n) => /clean streak 1\/3/.test(n)));
});

test("wave: 3rd clean climbs 6→8→10→12", async () => {
  for (const [from, to] of [[6, 8], [8, 10], [10, 12]]) {
    const o = await sess({ id: "squat", patch: { reps: from, weight: 60, streak: 2 }, progress: { rdl: { reps: 8, weight: 100 } } });
    assert.deepEqual(W(o), { reps: to, weight: 60, streak: 0 }, `${from}→${to}`);
  }
});

test("wave: 3rd clean at 12 → 3×6 +2.5 kg", async () => {
  const o = await sess({ id: "squat", patch: { reps: 12, weight: 60, streak: 2 }, progress: { rdl: { reps: 8, weight: 100 } } });
  assert.deepEqual(W(o), { reps: 6, weight: 62.5, streak: 0 });
  assert.deepEqual({ reps: o.prog.reps, weight: o.prog.weight }, { reps: 6, weight: 62.5 }, "liftProgress follows");
});

test("AMRAP: last set target+2 bumps +2.5 kg straight away and keeps reps", async () => {
  const o = await sess({ id: "squat", patch: { reps: 8, weight: 60, streak: 1 }, reps: [8, 8, 10], progress: { rdl: { reps: 8, weight: 100 } } });
  assert.deepEqual(W(o), { reps: 8, weight: 62.5, streak: 0 });
  assert.equal(o.hist.lifts[0].amrapReps, 10);
});

test("AMRAP +1 is not enough", async () => {
  const o = await sess({ id: "squat", patch: { reps: 8, weight: 60, streak: 0 }, reps: [8, 8, 9] });
  assert.deepEqual(W(o), { reps: 8, weight: 60, streak: 1 });
});

test("balance chain: bench can't pass squat — held at weight, streak parked at 3", async () => {
  const o = await sess({ id: "bench", patch: { reps: 12, weight: 60, streak: 2 }, progress: { squat: { reps: 8, weight: 60 } } });
  assert.deepEqual(W(o), { reps: 12, weight: 60, streak: 3 });
  assert.equal(o.holds.length, 1);
  assert.equal(o.holds[0].ceilingId, "squat");
});

test("balance chain: equal to the ceiling is allowed", async () => {
  const o = await sess({ id: "bench", patch: { reps: 12, weight: 57.5, streak: 2 }, progress: { squat: { reps: 8, weight: 60 } } });
  assert.deepEqual(W(o), { reps: 6, weight: 60, streak: 0 });
  assert.equal(o.holds, null);
});

test("balance chain: row → bench, and EMBER press → row", async () => {
  let o = await sess({ id: "row", patch: { reps: 12, weight: 40, streak: 2 }, progress: { bench: { reps: 8, weight: 40 } } });
  assert.equal(o.ex.weight, 40); assert.equal(o.holds[0].ceilingId, "bench");
  o = await sess({ pid: "ember", day: 1, id: "em-press", patch: { reps: 12, weight: 5, streak: 2 }, progress: { "em-row": { reps: 8, weight: 5 } } });
  assert.equal(o.ex.weight, 5); assert.equal(o.holds[0].ceilingId, "em-row");
});

test("balance chain: a 0 kg (bodyweight) squat doesn't cap EMBER bench", async () => {
  const o = await sess({ pid: "ember", id: "em-bench", patch: { reps: 12, weight: 20, streak: 2 }, progress: { "em-squat": { reps: 8, weight: 0 } } });
  assert.deepEqual(W(o), { reps: 6, weight: 22.5, streak: 0 });
  assert.equal(o.holds, null);
});

test("balance chain: TITAN plate bench progresses past a 0 kg squat and can reach the bar", async () => {
  let o = await sess({ pid: "titan", id: "tp-bench", patch: { reps: 12, weight: 2.5, streak: 2, levelIndex: 0 }, progress: { "tp-squat": { reps: 8, weight: 0 } } });
  assert.deepEqual(W(o), { reps: 6, weight: 5, streak: 0 });
  assert.equal(o.holds, null);
  o = await sess({ pid: "titan", id: "tp-bench", patch: { reps: 8, weight: 7.5, streak: 0, levelIndex: 0 }, reps: [8, 8, 10], progress: { "tp-squat": { reps: 8, weight: 0 } } });
  assert.equal(o.ex.weight, 10, "AMRAP bump not held by the bodyweight squat");
});

test("balance chain: unset / negative squat doesn't cap bench either; a loaded squat still does", async () => {
  let o = await sess({ pid: "ember", id: "em-bench", patch: { reps: 12, weight: 20, streak: 2 }, progress: { "em-squat": { reps: 8, weight: -5 } } });
  assert.equal(o.ex.weight, 22.5);
  o = await sess({ pid: "ember", id: "em-bench", patch: { reps: 12, weight: 20, streak: 2 }, progress: { "em-squat": { reps: 8, weight: 10 } } });
  assert.equal(o.ex.weight, 20); assert.equal(o.holds[0].ceilingId, "em-squat");
});

test("balance chain: rest of the chain unchanged — TITAN row capped by bench, EMBER row by bench", async () => {
  let o = await sess({ pid: "titan", id: "tp-row", patch: { reps: 12, weight: 2.5, streak: 2 }, progress: { "tp-bench": { reps: 8, weight: 2.5, levelIndex: 0 }, "tp-squat": { reps: 8, weight: 0 } } });
  assert.equal(o.ex.weight, 2.5); assert.equal(o.holds[0].ceilingId, "tp-bench");
  o = await sess({ pid: "ember", id: "em-row", patch: { reps: 12, weight: 20, streak: 2 }, progress: { "em-bench": { reps: 8, weight: 20 }, "em-squat": { reps: 8, weight: 0 } } });
  assert.equal(o.ex.weight, 20); assert.equal(o.holds[0].ceilingId, "em-bench");
});

test("3 failed sessions → reset week drops 2.5 kg", async () => {
  let o = await sess({ id: "squat", patch: { reps: 8, weight: 60, failStreak: 0 }, reps: [8, 8, 6] });
  assert.equal(o.ex.failStreak, 1); assert.equal(o.ex.weight, 60);
  o = await sess({ id: "squat", patch: { reps: 8, weight: 60, failStreak: 2 }, reps: [8, 7, 6] });
  assert.deepEqual({ w: o.ex.weight, f: o.ex.failStreak, r: o.ex.reps }, { w: 57.5, f: 0, r: 8 });
});

test("negative (assist) kg: wave bump moves toward 0 (less assist)", async () => {
  const o = await sess({ day: 1, id: "heaves", patch: { reps: 12, weight: -10, streak: 2 } });
  assert.deepEqual(W(o), { reps: 6, weight: -7.5, streak: 0 });
});

test("negative (assist) kg: − button goes below 0 to the −50 floor, shown as kg assist", async () => {
  const r = await app.page.evaluate(() => {
    setProgram("anvil", 1); const ei = state.exercises.findIndex((e) => e.id === "heaves");
    state.exercises[ei].weight = 0; for (let i = 0; i < 30; i++) bumpWeight(ei, -2.5);
    const card = document.getElementById("ex-heaves");
    return { w: state.exercises[ei].weight, kg: card.querySelector(".kg").textContent, lab: card.textContent.includes("kg assist"), prog: state.liftProgress.heaves.weight };
  });
  assert.deepEqual(r, { w: -50, kg: "−50", lab: true, prog: -50 });
});

test("negative (assist) kg: reset week adds assist (−2.5)", async () => {
  const o = await sess({ day: 1, id: "heaves", patch: { reps: 6, weight: -10, failStreak: 2 }, reps: [6, 5, 4] });
  assert.equal(o.ex.weight, -12.5);
});

test("Back extension (twist): finisher never gains kg, holds at 3×12", async () => {
  let o = await sess({ id: "bext", patch: { reps: 12, weight: 0, streak: 2 } });
  assert.deepEqual(W(o), { reps: 12, weight: 0, streak: 0 });
  assert.ok(o.notes.some((n) => /finisher — hold 3×12, no kg/.test(n)));
  o = await sess({ id: "bext", patch: { reps: 10, weight: 0, streak: 2 } });
  assert.deepEqual(W(o), { reps: 12, weight: 0, streak: 0 });
  o = await sess({ id: "bext", patch: { reps: 10, weight: 0, streak: 0 }, reps: [10, 10, 14] });
  assert.equal(o.ex.weight, 0, "no AMRAP kg on the finisher");
  assert.equal(o.hist.lifts[0].amrapReps, undefined);
});

test("heave ladder (TITAN): dead hang 20s → 30s → graduates to feet-assisted 3×6", async () => {
  let o = await sess({ pid: "titan", day: 1, id: "tp-heaves", patch: { reps: 20, streak: 2, levelIndex: 0 } });
  assert.equal(o.ex.reps, 30); assert.equal(o.ex.levelIndex, 0);
  o = await sess({ pid: "titan", day: 1, id: "tp-heaves", patch: { reps: 30, streak: 2, levelIndex: 0 } });
  assert.deepEqual({ r: o.ex.reps, l: o.ex.levelIndex, n: o.ex.name }, { r: 6, l: 1, n: "Heaves (feet assisted)" });
});

test("heave ladder: 3 clean at 12 graduates a stage (no kg)", async () => {
  const o = await sess({ pid: "ember", day: 1, id: "em-heaves", patch: { reps: 12, streak: 2, levelIndex: 2 }, progress: { "em-heaves": { reps: 12, weight: 0, streak: 2, failStreak: 0, levelIndex: 2 } } });
  assert.deepEqual({ r: o.ex.reps, l: o.ex.levelIndex, w: o.ex.weight, n: o.ex.name }, { r: 6, l: 3, w: 0, n: "Heaves" });
});

test("cossack ladder: 3 clean at 12 graduates to the next stage at 6", async () => {
  const o = await sess({ id: "cossack", patch: { reps: 12, streak: 2, levelIndex: 0 } });
  assert.deepEqual({ r: o.ex.reps, l: o.ex.levelIndex, n: o.ex.name }, { r: 6, l: 1, n: "Bodyweight Cossack (short)" });
});

test("TITAN plate bench: 3 clean at 3×12 with ≥10 kg graduates to Bench Press 3×6 @ 20 kg", async () => {
  const o = await sess({ pid: "titan", id: "tp-bench", patch: { reps: 12, weight: 10, streak: 2, levelIndex: 0 } });
  assert.deepEqual({ r: o.ex.reps, w: o.ex.weight, l: o.ex.levelIndex, n: o.ex.name }, { r: 6, w: 20, l: 1, n: "Bench Press" });
});

test("plank waves 20s → 30s → 20s, never kg", async () => {
  let o = await sess({ pid: "ember", day: 1, id: "em-plank", patch: { reps: 20, streak: 2 } });
  assert.deepEqual(W(o), { reps: 30, weight: 0, streak: 0 });
  o = await sess({ pid: "ember", day: 1, id: "em-plank", patch: { reps: 30, streak: 2 } });
  assert.deepEqual(W(o), { reps: 20, weight: 0, streak: 0 });
});

test("non-wave program (5×5): 3 clean at the cap → +2.5 kg", async () => {
  const o = await sess({ pid: "five-by-five", id: "squat", patch: { reps: 5, weight: 80, streak: 2 } });
  assert.deepEqual(W(o), { reps: 5, weight: 82.5, streak: 0 });
});

test("skipped / untouched lifts are not logged and keep their targets", async () => {
  const r = await app.page.evaluate(() => {
    setProgram("anvil", 0); resetChecks();
    const before = state.exercises.map((e) => [e.id, e.reps, e.weight, e.streak]);
    state.exercises[0].setsLog = state.exercises[0].setsLog.map(() => ({ ok: true, miss: false, reps: state.exercises[0].reps }));
    skipExercise(1);
    logSession();
    return { before, after: state.exercises.map((e) => [e.id, e.reps, e.weight, e.streak]), lifts: state.history[0].lifts.map((l) => l.id), notes: state.history[0].notes };
  });
  assert.deepEqual(r.lifts, ["squat"]);
  assert.deepEqual(r.after.slice(1), r.before.slice(1));
  assert.ok(r.notes.some((n) => /skipped/.test(n)));
});
