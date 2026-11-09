// v59: EMBER gets Cossack (Day A, after row) + Bulgarian split squat (Day B, after Plate RDL), nothing removed.
// Range-of-motion gate: before any kg increase the app asks "Full range of motion on every rep?" — No keeps the kg and asks again next time.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const ROW = (o = {}) => ({ id: "em-row", name: "Bent over row", sets: 3, reps: 6, rest: 60, weight: 2.5, block: "Day A", ...o });
const v58EmberA = () => ({
  programId: "ember", dayIndex: 0, neckIsoV50: true, anvilPsoasSitupV58: true,
  exercises: [
    { id: "em-squat", name: "Squat", sets: 3, reps: 8, rest: 75, weight: 5, block: "Day A", streak: 1, failStreak: 0, setsLog: [{ ok: true, miss: false, reps: 8 }, { ok: false, miss: false }, { ok: false, miss: false }] },
    { id: "em-bench", name: "Bench Press", sets: 3, reps: 6, rest: 90, weight: 20, block: "Day A" },
    ROW(),
    { id: "em-deadbug", name: "Dead bug", sets: 3, reps: 6, rest: 45, weight: 0, bw: true, bilateral: true, block: "Day A" },
    { id: "em-neck", name: "Neck isometric (4-way)", sets: 2, reps: 10, rest: 30, weight: 0, bw: true, block: "Day A" },
    { id: "curl", name: "Dumbbell curl", sets: 3, reps: 10, rest: 60, weight: 5, block: "Add-on" },
  ],
  history: [{ date: "2026-11-05T08:00:00.000Z", programId: "ember", day: "B", notes: ["x"], lifts: [{ id: "em-rdl", name: "Plate RDL", weight: 5, reps: 8, clean: true, sets: [] }] }],
  liftProgress: { "em-squat": { reps: 8, weight: 5, streak: 1, failStreak: 0 }, "em-rdl": { reps: 8, weight: 5, streak: 2, failStreak: 0 }, "em-deadbug": { reps: 10, weight: 0, streak: 1, failStreak: 0 } },
  // Alexis's own order: dead bug moved to the top on A; press before RDL on B
  dayOrder: { "ember:0": ["em-deadbug", "em-squat", "em-bench", "em-row", "em-neck", "curl"], "ember:1": ["em-press", "em-rdl", "em-heaves", "em-plank", "em-neck"] },
});

test("EMBER program: Cossack ladder after row on A, Bulgarian split squat after Plate RDL on B; ANVIL/TITAN unchanged", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => ({
    a: getProgram("ember").days[0].exercises.map((e) => e.id), b: getProgram("ember").days[1].exercises.map((e) => e.id),
    c: getProgram("ember").days[0].exercises.find((e) => e.id === "em-cossack"), s: getProgram("ember").days[1].exercises.find((e) => e.id === "em-bss"),
    anvil: getProgram("anvil").days.map((d) => d.exercises.map((e) => e.id)), titan: getProgram("titan").days.map((d) => d.exercises.map((e) => e.id)),
    hc: howtoKey({ id: "em-cossack" }), hs: howtoKey({ id: "em-bss" }),
    chain: [ceilingFor("ember", "em-cossack"), ceilingFor("ember", "em-bss")],
  }));
  assert.deepEqual(r.a, ["em-squat", "em-bench", "em-row", "em-cossack", "em-deadbug", "em-neck"]);
  assert.deepEqual(r.b, ["em-rdl", "em-bss", "em-press", "em-heaves", "em-plank", "em-neck"]);
  assert.equal(r.c.name, "Supported lateral squat"); assert.equal(r.c.cossackLadder, true); assert.equal(r.c.bilateral, true); assert.equal(r.c.levelIndex, 0); assert.equal(r.c.weight, 0);
  assert.equal(r.s.name, "Bulgarian split squat"); assert.deepEqual([r.s.sets, r.s.reps, r.s.weight, r.s.bw, r.s.bilateral], [3, 6, 0, true, true]);
  assert.deepEqual(r.anvil[0], ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "neck"]);
  assert.deepEqual(r.titan, [["tp-squat", "tp-bench", "tp-row", "tp-deadbug"], ["tp-rdl", "tp-press", "tp-lunge", "tp-heaves", "tp-plank"]]);
  assert.deepEqual([r.hc, r.hs], ["cossack", "lunge"]);
  assert.deepEqual(r.chain, [null, null], "new lifts are outside the EMBER balance chain");
  await app.close();
});

test("EMBER v58 save migrates: new lifts slot in after row / RDL, custom order + logs + progress kept; idempotent", async () => {
  const raw = v58EmberA();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  let s = await ls(app.page, KEYS.STATE);
  const A = ["em-deadbug", "em-squat", "em-bench", "em-row", "em-cossack", "em-neck", "curl"];
  assert.deepEqual(s.exercises.map((e) => e.id), ["em-squat", "em-bench", "em-row", "em-cossack", "em-deadbug", "em-neck", "curl"]);
  assert.equal(s.exercises[0].setsLog[0].ok, true, "in-progress squat set kept");
  assert.deepEqual(s.dayOrder["ember:0"], A);
  assert.deepEqual(s.dayOrder["ember:1"], ["em-press", "em-rdl", "em-bss", "em-heaves", "em-plank", "em-neck"]);
  assert.deepEqual(s.history, raw.history);
  for (const k of Object.keys(raw.liftProgress)) assert.deepEqual(s.liftProgress[k], raw.liftProgress[k]);
  assert.equal(s.emberSplitV59, true);
  // Day B honours the saved order with BSS right after the RDL; back on A uses Alexis's order with Cossack after row
  const b = await app.page.evaluate(() => { setDay(1); return state.exercises.map((e) => e.id); });
  assert.deepEqual(b, ["em-press", "em-rdl", "em-bss", "em-heaves", "em-plank", "em-neck"]);
  const a = await app.page.evaluate(() => { setDay(0); return state.exercises.map((e) => e.id); });
  assert.deepEqual(a, ["em-deadbug", "em-squat", "em-bench", "em-row", "em-cossack", "em-neck"]);
  // Idempotent: reload twice, still exactly one of each
  await reload(app); await reload(app);
  s = await ls(app.page, KEYS.STATE);
  assert.equal(s.exercises.filter((e) => e.id === "em-cossack").length, 1);
  assert.equal(s.dayOrder["ember:0"].filter((x) => x === "em-cossack").length, 1);
  assert.equal(s.dayOrder["ember:1"].filter((x) => x === "em-bss").length, 1);
  assert.deepEqual(app.errors, []);
  await app.close();
  // One-shot: after v59 a deliberately removed Cossack stays removed
  const raw2 = { ...v58EmberA(), emberSplitV59: true };
  const app2 = await openApp(srv.url, { storage: { [KEYS.STATE]: raw2 } });
  assert.ok(!(await ls(app2.page, KEYS.STATE)).exercises.some((e) => e.id === "em-cossack"));
  await app2.close();
});

test("EMBER Day B save (no custom order) gets BSS after Plate RDL; ANVIL save untouched", async () => {
  const exs = [{ id: "em-rdl", name: "Plate RDL", sets: 3, reps: 6, rest: 75, weight: 2.5, block: "Day B" }, { id: "em-press", name: "Overhead press", sets: 3, reps: 6, rest: 60, weight: 2.5, block: "Day B" }, { id: "em-plank", name: "Plank", sets: 3, reps: 30, rest: 45, weight: 0, bw: true, block: "Day B", note: "Seconds, not reps." }];
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "ember", dayIndex: 1, neckIsoV50: true, exercises: exs, history: [], liftProgress: {} } } });
  assert.deepEqual((await ls(app.page, KEYS.STATE)).exercises.map((e) => e.id), ["em-rdl", "em-bss", "em-press", "em-plank"]);
  await app.close();
});

/** One logged session where only `id` is done clean. rom = answers map or undefined; dry → just the ROM questions. */
async function sess(app, { pid = "ember", day = 0, id, patch = {}, progress = {}, rom, dry, reps }){
  return app.page.evaluate(({ pid, day, id, patch, progress, rom, dry, reps }) => {
    state.history = []; state.programId = pid; state.dayIndex = day;
    state.liftProgress = { ...captureProgress(seedProgram(pid, day)), ...progress };
    state.exercises = applyProgress(seedProgram(pid, day), state.liftProgress, pid).map((e) => e.id === id ? { ...e, ...patch } : e);
    state.liftProgress = captureProgress(state.exercises, state.liftProgress);
    const ex = state.exercises.find((e) => e.id === id);
    ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: reps ?? ex.reps }));
    ui.pendingHolds = null;
    if (dry) return logSession({ dry: true });
    const notes = logSession(rom ? { rom } : undefined);
    const o = state.exercises.find((e) => e.id === id);
    return { reps: o.reps, weight: o.weight, streak: o.streak, notes, hist: state.history[0] };
  }, { pid, day, id, patch, progress, rom, dry, reps });
}

test("ROM gate: Yes increases the kg as normal", async () => {
  const app = await openApp(srv.url);
  const asks = await sess(app, { id: "em-row", patch: { reps: 12, weight: 5, streak: 2 }, progress: { "em-bench": { reps: 8, weight: 20 } }, dry: true });
  assert.deepEqual(asks, [{ id: "em-row", name: "Bent over row", from: 5, to: 7.5 }]);
  const o = await sess(app, { id: "em-row", patch: { reps: 12, weight: 5, streak: 2 }, progress: { "em-bench": { reps: 8, weight: 20 } }, rom: { "em-row": true } });
  assert.deepEqual([o.weight, o.reps, o.streak], [7.5, 6, 0]);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("ROM gate: No holds the weight + target and asks again next session", async () => {
  const app = await openApp(srv.url);
  const o = await sess(app, { id: "em-row", patch: { reps: 12, weight: 5, streak: 2 }, progress: { "em-bench": { reps: 8, weight: 20 } }, rom: { "em-row": false } });
  assert.deepEqual([o.weight, o.reps, o.streak], [5, 12, 3]);
  assert.ok(o.notes.some((n) => /Weight stays\. Full range beats more weight\./.test(n)));
  assert.equal(o.hist.lifts[0].weight, 5);
  // Next session, clean again → the bump comes round again → the question is asked again
  const next = await app.page.evaluate(() => {
    const ex = state.exercises.find((e) => e.id === "em-row");
    ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: ex.reps }));
    return logSession({ dry: true });
  });
  assert.deepEqual(next.map((a) => [a.id, a.from, a.to]), [["em-row", 5, 7.5]]);
  // AMRAP bump (ANVIL squat) is gated too; bodyweight rep climbs never ask
  const am = await sess(app, { pid: "anvil", id: "squat", patch: { reps: 8, weight: 60, streak: 0 }, progress: { rdl: { reps: 8, weight: 100 } }, reps: 10, rom: { squat: false } });
  assert.deepEqual([am.weight, am.reps], [60, 8]);
  const bwAsk = await sess(app, { id: "em-deadbug", patch: { reps: 8, streak: 2 }, dry: true });
  assert.deepEqual(bwAsk, []);
  // Chain-held lift: no ROM question (it can't move anyway); balance popup still works
  const held = await sess(app, { id: "em-row", patch: { reps: 12, weight: 20, streak: 2 }, progress: { "em-bench": { reps: 8, weight: 20 }, "em-squat": { reps: 8, weight: 0 } }, dry: true });
  assert.deepEqual(held, []);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("ROM popup UI: Log → question → No keeps kg, then the balance/body-weight flow continues", async () => {
  const app = await openApp(srv.url);
  await app.page.evaluate(() => {
    setProgram("ember", 0);
    state.liftProgress = { ...state.liftProgress, "em-bench": { reps: 8, weight: 20 } };
    state.exercises = state.exercises.map((e) => e.id === "em-row" ? { ...e, reps: 12, weight: 5, streak: 2, setsLog: e.setsLog.map(() => ({ ok: true, miss: false, reps: 12 })) } : e);
    save(); render(); onLog();
  });
  assert.equal(await app.page.evaluate(() => ui.panel), "rom-ask");
  const txt = await app.page.$eval("[data-rom-q]", (el) => el.textContent);
  assert.equal(txt, "Full range of motion on every rep?");
  assert.equal(await app.page.evaluate(() => state.history.length), 0, "nothing logged before the answer");
  await app.page.click('[data-act="rom-no"]');
  const r = await app.page.evaluate(() => ({ panel: ui.panel, n: state.history.length, w: state.liftProgress["em-row"].weight, toast: document.getElementById("toast").textContent }));
  assert.equal(r.n, 1); assert.equal(r.w, 5); assert.equal(r.panel, "bodyweight");
  assert.match(r.toast, /Weight stays\. Full range beats more weight\./);
  assert.deepEqual(app.errors, []);
  await app.close();
});
