// v50: Neck isometric (4-way) — timed extra on ANVIL + EMBER Day A and Day B. 5 s → +5 s per clean session → max 20 s.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState, anvilProgress } from "./fixtures.mjs";

const NAME = "Neck isometric (4-way)";
let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

/** Tick every neck set (optionally with logged seconds), log the session, return the new neck target + notes. */
const logNeck = (page, secs = null) => page.evaluate((secs) => {
  const ei = state.exercises.findIndex((e) => isNeckIso(e));
  state.exercises[ei].setsLog.forEach((_, si) => markSet(ei, si));
  if (secs != null) state.exercises[ei].setsLog = state.exercises[ei].setsLog.map((s) => ({ ...s, reps: secs }));
  const notes = logSession();
  const ex = state.exercises.find((e) => isNeckIso(e));
  return { reps: ex.reps, failStreak: ex.failStreak, weight: ex.weight, notes, lift: state.history[0].lifts.find((l) => l.id === ex.id) };
}, secs);

test("program: last extra on ANVIL A+B and EMBER A+B only; 2 sets × 5 s, bodyweight, no AMRAP, outside the balance chain", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => PROGRAMS.map((p) => ({ id: p.id, days: p.days.map((d) => d.exercises.filter((e) => isNeckIso(e)).map((e) => ({ id: e.id, last: d.exercises[d.exercises.length - 1].id === e.id, name: e.name, sets: e.sets, reps: e.reps, bw: e.bw, weight: e.weight, finisher: e.finisher, amrap: usesAmrap(e), secs: isPlankSeconds(e), label: targetLabel(e) }))) })));
  for (const p of r) {
    if (p.id === "anvil" || p.id === "ember") {
      const id = p.id === "anvil" ? "neck" : "em-neck";
      for (const d of p.days) assert.deepEqual(d, [{ id, last: true, name: NAME, sets: 2, reps: 5, bw: true, weight: 0, finisher: true, amrap: false, secs: true, label: "2 × 4-way · 5s each" }]);
    } else for (const d of p.days) assert.deepEqual(d, [], `${p.id} has no neck lift`);
  }
  const chain = await app.page.evaluate(() => [ceilingFor("anvil", "neck"), ceilingFor("ember", "em-neck"), JSON.stringify(BALANCE_CHAINS).includes("neck")]);
  assert.deepEqual(chain, [null, null, false]);
  await app.close();
});

test("progression: clean session +5 s each time, capped at 20 s and stays there; no kg", async () => {
  const app = await openApp(srv.url);
  const seen = [];
  for (let i = 0; i < 5; i++) { const r = await logNeck(app.page); seen.push(r.reps); assert.equal(r.weight, 0); }
  assert.deepEqual(seen, [10, 15, 20, 20, 20]);
  const r = await logNeck(app.page);
  assert.ok(r.notes.some((n) => /Neck isometric \(4-way\): max 20s each/.test(n)), r.notes.join(" | "));
  assert.deepEqual(r.lift.sets.map((s) => s.reps), [20, 20]);
  // Shared across days: Day B picks up the same target
  await app.page.evaluate(() => setDay(1));
  assert.equal(await app.page.evaluate(() => state.exercises.find((e) => e.id === "neck").reps), 20);
  assert.equal((await ls(app.page, KEYS.STATE)).liftProgress.neck.reps, 20);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("short holds: stay at target; 3 short sessions → back 5 s (never below 5 s); a set left blank = incomplete", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState({ dayIndex: 0, liftProgress: { ...anvilProgress(), neck: { reps: 15, weight: 0, streak: 0, failStreak: 0 } } }) } });
  assert.equal(await app.page.evaluate(() => state.exercises.find((e) => e.id === "neck").reps), 15);
  let r = await logNeck(app.page, 12); assert.deepEqual([r.reps, r.failStreak], [15, 1]);
  r = await logNeck(app.page, 12); assert.deepEqual([r.reps, r.failStreak], [15, 2]);
  r = await logNeck(app.page, 12); assert.deepEqual([r.reps, r.failStreak], [10, 0]);
  assert.ok(r.notes.some((n) => /RESET WEEK — back to 10s/.test(n)));
  r = await logNeck(app.page); assert.equal(r.reps, 15, "clean again → +5 s");
  // Only one of two sets ticked → incomplete, no change
  const inc = await app.page.evaluate(() => { const ei = state.exercises.findIndex((e) => e.id === "neck"); markSet(ei, 0); const notes = logSession(); return { reps: state.exercises[ei].reps, notes }; });
  assert.equal(inc.reps, 15); assert.ok(inc.notes.some((n) => /Neck isometric \(4-way\): incomplete/.test(n)));
  // Floor at 5 s
  await app.page.evaluate(() => { const ei = state.exercises.findIndex((e) => e.id === "neck"); state.exercises[ei] = { ...state.exercises[ei], reps: 5, failStreak: 2 }; });
  r = await logNeck(app.page, 3); assert.equal(r.reps, 5);
  await app.close();
});

// Stewart's phone today (v49): Day A mid-session with an extra Add-on, xrdl + v38 flags, no v50 flag.
const v49DayA = () => stewartState({
  dayIndex: 0, anvilXrdlV49: true,
  exercises: [
    { id: "squat", name: "Squat", sets: 3, reps: 8, rest: 120, weight: 69, block: "Day A", streak: 1, failStreak: 0, setsLog: [{ ok: true, miss: false, reps: 8 }, { ok: false, miss: false }, { ok: false, miss: false }] },
    { id: "bench", name: "Bench Press", sets: 3, reps: 8, rest: 120, weight: 50, block: "Day A", streak: 2, failStreak: 0 },
    { id: "row", name: "Bent over row", sets: 3, reps: 10, rest: 90, weight: 40, block: "Day A" },
    { id: "xrdl", name: "Crossed-leg straight-leg forward fold / RDL", sets: 3, reps: 6, rest: 75, weight: 5, bilateral: true, block: "Day A" },
    { id: "cossack", name: "Cossack", sets: 3, reps: 8, rest: 45, weight: 0, bw: true, block: "Day A", levelIndex: 1 },
    { id: "sgm", name: "Seated good morning", sets: 3, reps: 8, rest: 90, weight: 20, block: "Day A" },
    { id: "bext", name: "Back extension (twist)", sets: 3, reps: 10, rest: 60, weight: 0, bw: true, block: "Day A" },
    { id: "curl", name: "Dumbbell curl", sets: 3, reps: 10, rest: 60, weight: 10, block: "Add-on" },
  ],
});

test("v49 ANVIL save migrates: neck added after the programmed lifts (before add-ons); nothing else changes; one-shot", async () => {
  const raw = v49DayA();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const s = await ls(app.page, KEYS.STATE);
  assert.deepEqual(s.exercises.map((e) => e.id), ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "neck", "curl"]);
  const n = s.exercises[7];
  assert.deepEqual([n.name, n.sets, n.reps, n.weight, n.neckIso, n.finisher, n.setsLog.length], [NAME, 2, 5, 0, true, true, 2]);
  assert.equal(s.exercises[0].setsLog[0].ok, true, "in-progress squat set kept");
  assert.equal(s.exercises[0].weight, 69);
  assert.deepEqual(s.history, raw.history, "history byte-for-byte");
  for (const [k, v] of Object.entries(raw.liftProgress)) assert.deepEqual(s.liftProgress[k], v, `progress ${k} kept`);
  assert.equal(s.neckIsoV50, true);
  const card = await app.page.$eval("#ex-neck", (el) => el.textContent);
  assert.match(card, /Neck isometric \(4-way\)/); assert.match(card, /2 × 4-way · 5s each/); assert.match(card, /5s/);
  assert.equal(await app.page.$('#ex-neck [data-act="weight"]'), null, "no kg stepper");
  await reload(app);
  assert.deepEqual((await ls(app.page, KEYS.STATE)).exercises.map((e) => e.id), ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "neck", "curl"]);
  assert.deepEqual(app.errors, []);
  await app.close();
  // After v50 a removed neck stays removed
  const app2 = await openApp(srv.url, { storage: { [KEYS.STATE]: { ...v49DayA(), neckIsoV50: true } } });
  assert.ok(!(await ls(app2.page, KEYS.STATE)).exercises.some((e) => e.id === "neck"));
  await app2.close();
});

test("EMBER (Alexis) Day A + B saves get em-neck; TITAN untouched; existing neck progress kept", async () => {
  const em = (dayIndex, exercises) => ({ programId: "ember", dayIndex, exercises, history: [{ date: "2026-10-20T08:00:00.000Z", programId: "ember", day: "B", notes: ["x"], lifts: [] }], liftProgress: { "em-squat": { reps: 8, weight: 5, streak: 1, failStreak: 0 }, "em-neck": { reps: 15, weight: 0, streak: 0, failStreak: 1 } } });
  const dayA = [{ id: "em-squat", name: "Squat", sets: 3, reps: 8, rest: 75, weight: 5, block: "Day A" }, { id: "em-bench", name: "Bench Press", sets: 3, reps: 6, rest: 90, weight: 20, block: "Day A" }, { id: "em-row", name: "Bent over row", sets: 3, reps: 6, rest: 60, weight: 2.5, block: "Day A" }, { id: "em-deadbug", name: "Dead bug", sets: 3, reps: 6, rest: 45, weight: 0, bw: true, bilateral: true, block: "Day A" }];
  const dayB = [{ id: "em-rdl", name: "Plate RDL", sets: 3, reps: 6, rest: 75, weight: 2.5, block: "Day B" }, { id: "em-press", name: "Overhead press", sets: 3, reps: 6, rest: 60, weight: 2.5, block: "Day B" }, { id: "em-plank", name: "Plank", sets: 3, reps: 30, rest: 45, weight: 0, bw: true, block: "Day B", note: "Seconds, not reps." }];
  for (const [d, exs, ids] of [[0, dayA, ["em-squat", "em-bench", "em-row", "em-deadbug", "em-neck"]], [1, dayB, ["em-rdl", "em-press", "em-plank", "em-neck"]]]) {
    const raw = em(d, exs);
    const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
    const s = await ls(app.page, KEYS.STATE);
    assert.deepEqual(s.exercises.map((e) => e.id), ids);
    const n = s.exercises.find((e) => e.id === "em-neck");
    assert.deepEqual([n.reps, n.failStreak], [15, 1], "saved neck progress applied, not snapped to the wave");
    assert.equal(s.liftProgress["em-neck"].reps, 15);
    assert.deepEqual(s.history, raw.history);
    assert.equal(s.neckIsoV50, true);
    assert.deepEqual(app.errors, []);
    await app.close();
  }
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "titan", dayIndex: 0, exercises: [], history: [], liftProgress: {} } } });
  assert.ok(!JSON.stringify((await ls(app.page, KEYS.STATE)).exercises).includes("neck"));
  await app.close();
});

test("Add-a-lift (Core / extras) + how-to cues incl. stop if pain / dizziness / tingling", async () => {
  const app = await openApp(srv.url);
  const lib = await app.page.evaluate(() => LIBRARY.find((g) => g.group === "Core / extras").lifts.find((l) => l.id === "neck"));
  assert.deepEqual([lib.name, lib.sets, lib.reps, lib.neckIso], [NAME, 2, 5, true]);
  // Visible in the add panel on a program that doesn't have it (TITAN), and keeps its timed behaviour after reload
  await app.page.evaluate(() => { setProgram("titan", 0); ui.panel = "add"; render(); });
  assert.ok(await app.page.$('[data-act="pick"][data-id="neck"]'));
  await app.page.evaluate(() => { const l = LIBRARY.flatMap((g) => g.lifts).find((x) => x.id === "neck"); addExercise({ ...l }); ui.panel = "none"; render(); });
  await reload(app);
  assert.equal(await app.page.evaluate(() => targetLabel(state.exercises.find((e) => e.id === "neck"))), "2 × 4-way · 5s each");
  await app.page.evaluate(() => setProgram("anvil", 0));
  const h = await app.page.evaluate(() => { const ex = state.exercises.find((e) => e.id === "neck"); return { key: howtoKey(ex), em: howtoKey({ id: "em-neck" }), g: HOWTO[howtoKey(ex)] }; });
  assert.deepEqual([h.key, h.em, h.g.anim], ["neck", "neck", "neckiso"]);
  const all = h.g.cues.join(" ");
  for (const re of [/sit or stand tall/i, /chin neutral/i, /forehead/i, /side of your head/i, /back of your head/i, /no movement/i, /breathe/i, /50–70%/, /pain, dizziness, or tingling/i]) assert.match(all, re);
  await app.page.evaluate(() => openHowto(state.exercises.findIndex((e) => e.id === "neck")));
  const sheet = await app.page.evaluate(() => document.body.textContent);
  assert.match(sheet, /Stop if you feel pain, dizziness, or tingling/);
  assert.doesNotMatch(sheet, /No detailed guide for this lift yet/);
  assert.deepEqual(app.errors, []);
  await app.close();
});
