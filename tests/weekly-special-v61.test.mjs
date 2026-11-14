// v61: ANVIL Day B "Weekly special" trial slot — one move, 2 Day B sessions each, then rotates (loops).
// Logged to history, never progressed; "Keep it" makes it a normal Day B lift; rotation state saved + exported.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState, anvilProgress } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const ORDER = ["copenhagen", "sl-bridge", "tib-raise", "suitcase", "birddog-row"];
/** Log one Day B session with every lift (incl. the special) done clean. Returns the special that was on screen. */
const logDayB = (app) => app.page.evaluate(() => {
  setProgram("anvil", 1);
  const sp = state.exercises.find((e) => isWeeklySpecial(e));
  state.exercises = state.exercises.map((e) => ({ ...e, setsLog: e.setsLog.map(() => ({ ok: true, miss: false, reps: e.reps })) }));
  logSession();
  return { id: sp?.id, ws: JSON.parse(JSON.stringify(state.weeklySpecial.anvil)), hist: state.history[0] };
});

test("Day B has the special before the neck finisher; Day A / EMBER / TITAN don't; card shows badge, session, next up", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => {
    setProgram("anvil", 1);
    const b = state.exercises.map((e) => e.id);
    const sp = state.exercises.find((e) => isWeeklySpecial(e));
    const card = document.querySelector("#ex-ws-copenhagen")?.textContent.replace(/\s+/g, " ");
    setDay(0); const a = state.exercises.map((e) => e.id);
    setProgram("ember", 1); const em = state.exercises.map((e) => e.id);
    setProgram("titan", 1); const ti = state.exercises.map((e) => e.id);
    return { b, sp, card, a, em, ti, sw: switchSecFor(sp) };
  });
  assert.deepEqual(r.b, ["rdl", "ohp", "lunge", "psoas-situp", "lmr", "heaves", "bext", "ws-copenhagen", "neck"]);
  assert.equal(r.sp.name, "Copenhagen hold (short lever)");
  assert.deepEqual([r.sp.sets, r.sp.reps, r.sp.bilateral, r.sp.block], [3, 15, true, "Weekly special"]);
  assert.match(r.sp.note, /mid lever.*long lever/i);
  assert.ok(r.sw > 0, "bilateral → switch-sides countdown");
  assert.match(r.card, /Weekly special/); assert.match(r.card, /\(session 1 of 2\)/); assert.match(r.card, /Next up: Single-leg glute bridge/); assert.match(r.card, /Keep it/);
  for (const list of [r.a, r.em, r.ti]) assert.ok(!list.some((id) => id.startsWith("ws-")));
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("rotates after 2 Day B sessions, in order, and loops back to move 1", async () => {
  const app = await openApp(srv.url);
  const seen = [];
  for (let i = 0; i < 11; i++) seen.push((await logDayB(app)).id);
  assert.deepEqual(seen, ["copenhagen", "copenhagen", "sl-bridge", "sl-bridge", "tib-raise", "tib-raise", "suitcase", "suitcase", "birddog-row", "birddog-row", "copenhagen"].map((k) => "ws-" + k));
  // Day A sessions don't count
  const c = await app.page.evaluate(() => { const before = JSON.stringify(state.weeklySpecial.anvil); setProgram("anvil", 0); state.exercises[0].setsLog = state.exercises[0].setsLog.map(() => ({ ok: true, miss: false, reps: state.exercises[0].reps })); logSession(); return [before, JSON.stringify(state.weeklySpecial.anvil)]; });
  assert.equal(c[0], c[1]);
  // Session 2 label after one logged session
  await app.page.evaluate(() => { setProgram("anvil", 1); render(); });
  assert.match(await app.page.$eval("[data-ws-badge]", (el) => el.textContent), /session 2 of 2/);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("special is logged to history but never progresses: no kg, no wave, no streak, no ROM question, no balance hold", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => {
    state.weeklySpecial = { anvil: { idx: 3, count: 0, kept: [] } }; // Suitcase hold (bar), kg stepper
    setProgram("anvil", 1);
    let ei = state.exercises.findIndex((e) => e.id === "ws-suitcase");
    state.exercises[ei] = { ...state.exercises[ei], weight: 30, streak: 2 };
    const ex = state.exercises[ei];
    ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: 30 })); // way over target + AMRAP-sized last set
    const asks = logSession({ dry: true });
    ui.pendingHolds = null;
    const notes = logSession();
    const lift = state.history[0].lifts.find((l) => l.id === "ws-suitcase");
    const prog = state.liftProgress["ws-suitcase"];
    return { asks, notes, lift, prog, amrap: usesAmrap(ex), holds: ui.pendingHolds };
  });
  assert.deepEqual(r.asks, []);
  assert.equal(r.amrap, false);
  assert.equal(r.holds, null);
  assert.equal(r.lift.special, true); assert.equal(r.lift.weight, 30); assert.equal(r.lift.sets.length, 3);
  assert.deepEqual([r.prog.weight, r.prog.reps, r.prog.streak], [30, 20, 2], "kg / target / streak untouched");
  assert.ok(r.notes.some((n) => /Suitcase hold \(bar\): weekly special logged/.test(n)));
  // Skip allowed: skipped special still counts the Day B session and records the skip
  const s = await app.page.evaluate(() => { setProgram("anvil", 1); const ei = state.exercises.findIndex((e) => isWeeklySpecial(e)); skipExercise(ei, "time"); state.exercises[0].setsLog = state.exercises[0].setsLog.map(() => ({ ok: true, miss: false, reps: state.exercises[0].reps })); logSession(); return state.history[0].skips; });
  assert.equal(s[0].id, "ws-suitcase");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("Keep it: adds the move to Day B as a normal lift (stays after day switches), rotation skips it", async () => {
  const app = await openApp(srv.url);
  await app.page.evaluate(() => { setProgram("anvil", 1); render(); });
  await app.page.click('[data-act="ws-keep"]');
  const r = await app.page.evaluate(() => {
    const now = state.exercises.map((e) => e.id);
    setDay(0); setDay(1);
    const after = state.exercises.map((e) => e.id);
    const kept = state.exercises.find((e) => e.id === "copenhagen");
    return { now, after, kept, ws: state.weeklySpecial.anvil, toast: document.getElementById("toast").textContent };
  });
  assert.deepEqual(r.now, ["rdl", "ohp", "lunge", "psoas-situp", "lmr", "heaves", "bext", "copenhagen", "ws-sl-bridge", "neck"]);
  assert.deepEqual(r.after, r.now);
  assert.equal(r.kept.weeklySpecial, undefined); assert.equal(r.kept.block, "Day B"); assert.equal(r.kept.bilateral, true);
  assert.deepEqual(r.ws.kept, ["copenhagen"]);
  assert.match(r.toast, /kept on Day B/);
  // Kept lift progresses like a normal lift (seconds wave: 15 → 30 s after 3 clean)
  const k = await app.page.evaluate(() => { const ei = state.exercises.findIndex((e) => e.id === "copenhagen"); state.exercises[ei] = { ...state.exercises[ei], streak: 2 }; const ex = state.exercises[ei]; ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: ex.reps })); logSession(); return state.liftProgress.copenhagen; });
  assert.equal(k.reps, 30);
  // Rotation loops without the kept move
  const seen = [];
  for (let i = 0; i < 9; i++) seen.push((await logDayB(app)).id);
  assert.ok(!seen.includes("ws-copenhagen"));
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("migration: existing Day B save gets the slot without touching progress / order; idempotent; one-shot state init", async () => {
  const raw = stewartState({
    dayIndex: 1, anvilXrdlV49: true, neckIsoV50: true, anvilPsoasSitupV58: true, emberSplitV59: true, anvilPsoasDoubleV60: true,
    exercises: [
      { id: "rdl", name: "RDL", sets: 3, reps: 8, rest: 120, weight: 80, block: "Day B", setsLog: [{ ok: true, miss: false, reps: 8 }, { ok: false, miss: false }, { ok: false, miss: false }] },
      { id: "heaves", name: "Heaves", sets: 3, reps: 6, rest: 120, weight: -10, bw: true, block: "Day B" },
      { id: "ohp", name: "Overhead press", sets: 3, reps: 8, rest: 90, weight: 40, block: "Day B" },
      { id: "neck", name: "Neck isometric (4-way)", sets: 2, reps: 10, rest: 30, weight: 0, bw: true, block: "Day B" },
      { id: "curl", name: "Dumbbell curl", sets: 3, reps: 10, rest: 60, weight: 10, block: "Add-on" },
    ],
    liftProgress: anvilProgress(),
    dayOrder: { "anvil:1": ["rdl", "heaves", "ohp", "neck", "curl"] },
  });
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  let s = await ls(app.page, KEYS.STATE);
  const ids = ["rdl", "heaves", "ohp", "ws-copenhagen", "neck", "curl"];
  assert.deepEqual(s.exercises.map((e) => e.id), ids);
  assert.equal(s.exercises[0].setsLog[0].ok, true);
  assert.deepEqual(s.liftProgress, raw.liftProgress);
  assert.deepEqual(s.dayOrder, raw.dayOrder);
  assert.deepEqual(s.history, raw.history);
  assert.equal(s.anvilWeeklySpecialV61, true);
  assert.deepEqual(s.weeklySpecial, { anvil: { idx: 0, count: 0, kept: [] } });
  await reload(app); await reload(app);
  s = await ls(app.page, KEYS.STATE);
  assert.deepEqual(s.exercises.map((e) => e.id), ids);
  assert.deepEqual(app.errors, []);
  await app.close();
  // Saved mid-rotation state is honoured (not reset) on load
  const raw2 = { ...raw, anvilWeeklySpecialV61: true, weeklySpecial: { anvil: { idx: 2, count: 1, kept: [] } } };
  const app2 = await openApp(srv.url, { storage: { [KEYS.STATE]: raw2 } });
  s = await ls(app2.page, KEYS.STATE);
  assert.ok(s.exercises.some((e) => e.id === "ws-tib-raise"));
  assert.deepEqual(s.weeklySpecial.anvil, { idx: 2, count: 1, kept: [] });
  await app2.close();
});

test("Export includes rotation state; Import restores it", async () => {
  const app = await openApp(srv.url);
  const payload = await app.page.evaluate(() => { state.weeklySpecial = { anvil: { idx: 4, count: 1, kept: ["sl-bridge"] } }; save(); return backupPayload(); });
  assert.deepEqual(payload.weeklySpecial, { anvil: { idx: 4, count: 1, kept: ["sl-bridge"] } });
  await app.page.evaluate(() => exportBackup());
  await new Promise((r) => setTimeout(r, 200));
  const exported = JSON.parse((await app.page.evaluate(() => window.__exports))[0]);
  assert.deepEqual(exported.weeklySpecial, payload.weeklySpecial);
  const r = await app.page.evaluate((b) => { state.weeklySpecial = {}; applyBackup({ ...b, dayIndex: 1 }); return { ws: state.weeklySpecial, ids: state.exercises.map((e) => e.id) }; }, exported);
  assert.deepEqual(r.ws, { anvil: { idx: 4, count: 1, kept: ["sl-bridge"] } });
  assert.ok(r.ids.includes("ws-birddog-row") && r.ids.includes("sl-bridge"));
  assert.deepEqual(app.errors, []);
  await app.close();
});
