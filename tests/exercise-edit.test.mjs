// Edit an exercise (v51): pencil on each card + in the Remove list → sheet with kg increase, sets/reps, rep range,
// rest, working kg, name + cues. Edits are per program + lift id, persist, ride in Export/Import + sync, and drive progression.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState, anvilProgress } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const dayA = () => stewartState({ dayIndex: 0, anvilXrdlV49: true, neckIsoV50: true });
/** Open the sheet for a lift, change the draft, Save. Returns the save result. */
const editLift = (page, id, patch) => page.evaluate((id, patch) => {
  openExerciseEdit(state.exercises.findIndex((e) => e.id === id));
  Object.assign(ui.editEx, patch);
  return saveExerciseEdit();
}, id, patch);
/** Tick every set of one lift (optionally with logged reps), log the session, return the lift after progression. */
const logLift = (page, id, reps = null) => page.evaluate((id, reps) => {
  const ei = state.exercises.findIndex((e) => e.id === id);
  state.exercises[ei].setsLog.forEach((_, si) => markSet(ei, si));
  if (reps != null) state.exercises[ei].setsLog = state.exercises[ei].setsLog.map((s) => ({ ...s, reps }));
  const notes = logSession();
  const ex = state.exercises.find((e) => e.id === id);
  return { reps: ex.reps, weight: ex.weight, streak: ex.streak, failStreak: ex.failStreak, sets: ex.sets, notes };
}, id, reps);

test("pencil on every open card and in the Remove list; sheet shows the six field groups; Cancel changes nothing", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  const ids = await p.evaluate(() => state.exercises.map((e) => e.id));
  for (const id of ids) assert.ok(await p.$(`#ex-${id} [data-act="edit-ex"]`), `pencil on ${id}`);
  const before = await ls(p, KEYS.STATE);
  await p.click('#ex-squat [data-act="edit-ex"]');
  const txt = await p.$eval('[aria-label="Edit exercise"]', (el) => el.textContent);
  for (const t of ["kg increase per bump", "Current working kg", "Sets", "Target reps", "Rep range before kg goes up", "Rest between sets", "Name", "Notes / cues", "Reset to default", "Save", "Cancel"]) assert.match(txt, new RegExp(t.replace(/[()]/g, "\\$&")), t);
  assert.equal(await p.$eval('[data-edit-name]', (el) => el.value), "Squat");
  assert.deepEqual(await p.$$eval('[data-act="edit-reps"]', (b) => b.map((x) => x.textContent)), ["6", "8", "10", "12"]);
  await p.click('[data-act="edit-step"][data-f="sets"][data-d="1"]');
  await p.click('.edit-actions [data-act="edit-cancel"]');
  assert.equal(await p.$('[aria-label="Edit exercise"]'), null);
  assert.deepEqual(await ls(p, KEYS.STATE), before, "Cancel saved nothing");
  // Remove list has Edit too
  await p.click('[data-act="panel"][data-p="remove"]');
  await p.click('.rm [data-act="edit-ex"]');
  assert.ok(await p.$('[aria-label="Edit exercise"]'));
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("Save through the sheet: kg step, sets, range, rest, kg, name + cues persist (reload, day switch), id + history kept", async () => {
  const raw = dayA();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const p = app.page;
  await p.click('#ex-squat [data-act="edit-ex"]');
  await p.click('[data-act="edit-kg-step"][data-v="5"]');
  await p.click('[data-act="edit-step"][data-f="weight"][data-d="1"]'); // 69 → 74 (steps of 5)
  await p.click('[data-act="edit-step"][data-f="sets"][data-d="1"]');   // 3 → 4
  await p.click('[data-act="edit-step"][data-f="repLow"][data-d="1"]'); // 6 → 7
  await p.click('[data-act="edit-step"][data-f="repLow"][data-d="1"]'); // 7 → 8
  await p.click('[data-act="edit-step"][data-f="rest"][data-d="1"]');   // 120 → 135
  await p.$eval("[data-edit-name]", (el) => { el.value = ""; });
  await p.type("[data-edit-name]", "Back squat");
  await p.type("[data-edit-note]", "Brace hard");
  await p.click('[data-act="edit-save"]');
  const s = await ls(p, KEYS.STATE);
  assert.deepEqual(s.exerciseEdits, { anvil: { squat: { kgStep: 5, repLow: 8, repTop: 12, sets: 4, rest: 135, name: "Back squat", note: "Brace hard" } } });
  const sq = s.exercises.find((e) => e.id === "squat");
  assert.deepEqual([sq.name, sq.note, sq.sets, sq.setsLog.length, sq.rest, sq.weight, sq.reps, sq.kgStep], ["Back squat", "Brace hard", 4, 4, 135, 74, 8, 5]);
  assert.equal(s.liftProgress.squat.weight, 74);
  assert.deepEqual(s.history, raw.history, "history untouched");
  const card = await p.$eval("#ex-squat", (el) => el.textContent);
  assert.match(card, /Back squat/); assert.match(card, /4 × 8/); assert.match(card, /Brace hard/);
  assert.equal(await p.$eval('#ex-squat [data-act="weight"][data-d="5"]', () => true), true, "card kg stepper uses the 5 kg step");
  await reload(app);
  const sq2 = await p.evaluate(() => state.exercises.find((e) => e.id === "squat"));
  assert.deepEqual([sq2.name, sq2.sets, sq2.rest, sq2.weight, sq2.kgStep, sq2.repLow, sq2.repTop], ["Back squat", 4, 135, 74, 5, 8, 12]);
  await p.evaluate(() => { setDay(1); setDay(0); });
  const sq3 = await p.evaluate(() => state.exercises.find((e) => e.id === "squat"));
  assert.deepEqual([sq3.name, sq3.sets, sq3.setsLog.length, sq3.rest, sq3.weight, sq3.kgStep], ["Back squat", 4, 4, 135, 74, 5], "day switch re-seeds with edits");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("progression uses the edits: rungs 8→10→12 then +5 kg back to 8; AMRAP +5; reset week −5; balance chain still gates", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  assert.equal(await editLift(p, "squat", { kgStep: 5, repLow: 8, repTop: 12 }), true);
  await p.evaluate(() => { const i = state.exercises.findIndex((e) => e.id === "squat"); state.exercises[i] = { ...state.exercises[i], reps: 12, weight: 60, streak: 2 }; });
  let r = await logLift(p, "squat");
  assert.deepEqual([r.reps, r.weight], [8, 65]);
  assert.ok(r.notes.some((n) => /wave → 3×8 \+5kg → 65kg/.test(n)), r.notes.join(" | "));
  await p.evaluate(() => setDay(0));
  await p.evaluate(() => { const i = state.exercises.findIndex((e) => e.id === "squat"); state.exercises[i] = { ...state.exercises[i], streak: 2 }; });
  r = await logLift(p, "squat"); assert.deepEqual([r.reps, r.weight], [10, 65], "8 → 10 rung");
  await p.evaluate(() => setDay(0));
  r = await logLift(p, "squat", 12); assert.deepEqual([r.reps, r.weight], [10, 70], "AMRAP +2 → +5 kg");
  await p.evaluate(() => setDay(0));
  await p.evaluate(() => { const i = state.exercises.findIndex((e) => e.id === "squat"); state.exercises[i] = { ...state.exercises[i], failStreak: 2 }; });
  r = await logLift(p, "squat", 5); assert.deepEqual([r.weight, r.failStreak], [65, 0], "reset week drops one 5 kg step");
  // Balance: bench 5 kg step would pass squat (65) → held
  await p.evaluate(() => setDay(0));
  await editLift(p, "bench", { kgStep: 5 });
  await p.evaluate(() => { const i = state.exercises.findIndex((e) => e.id === "bench"); state.exercises[i] = { ...state.exercises[i], reps: 12, weight: 63, streak: 2 }; });
  r = await logLift(p, "bench");
  assert.equal(r.weight, 63); assert.ok(r.notes.some((n) => /held for balance/.test(n)));
  // Unedited lifts unchanged: row still 2.5 kg on the default wave
  await p.evaluate(() => setDay(0));
  await p.evaluate(() => { const i = state.exercises.findIndex((e) => e.id === "row"); state.exercises[i] = { ...state.exercises[i], reps: 12, weight: 40, streak: 2 }; });
  r = await logLift(p, "row"); assert.deepEqual([r.reps, r.weight], [6, 42.5]);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("edited range snaps target reps onto the new rungs; 1.25 kg microplates work", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await editLift(p, "row", { repLow: 5, repTop: 9, reps: 10, kgStep: 1.25 });
  const row = await p.evaluate(() => { const e = state.exercises.find((x) => x.id === "row"); return { reps: e.reps, rungs: waveRepsFor(e), kg: kgStepFor(e) }; });
  assert.deepEqual(row, { reps: 9, rungs: [5, 7, 9], kg: 1.25 });
  await p.evaluate(() => { const i = state.exercises.findIndex((e) => e.id === "row"); state.exercises[i] = { ...state.exercises[i], weight: 40, streak: 2 }; });
  const r = await logLift(p, "row");
  assert.deepEqual([r.reps, r.weight], [5, 41.25]);
  assert.equal((await ls(p, KEYS.STATE)).liftProgress.row.reps, 5);
  await reload(app);
  assert.equal(await p.evaluate(() => state.exercises.find((e) => e.id === "row").reps), 5, "load doesn't snap 5 back to the 6–12 wave");
  assert.equal(await p.evaluate(() => fmtKg(41.25)), "41.25");
  await app.close();
});

test("neck isometric: edit seconds step + max (no kg fields); progression follows them", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await p.click('#ex-neck [data-act="edit-ex"]');
  const txt = await p.$eval('[aria-label="Edit exercise"]', (el) => el.textContent);
  assert.match(txt, /Increase per clean session/); assert.match(txt, /Maximum hold/);
  assert.equal(await p.$('[data-act="edit-kg-step"]'), null); assert.equal(await p.$('[data-f="weight"]'), null); assert.equal(await p.$('[data-f="repLow"]'), null);
  await p.click('[data-act="edit-step"][data-f="secStep"][data-d="-1"]'); // 5 → 4
  for (let i = 0; i < 2; i++) await p.click('[data-act="edit-step"][data-f="secMax"][data-d="-1"]'); // 20 → 10
  await p.click('[data-act="edit-save"]');
  assert.deepEqual((await ls(p, KEYS.STATE)).exerciseEdits.anvil.neck, { secStep: 4, secMax: 10 });
  const seen = [];
  for (let i = 0; i < 3; i++) { seen.push((await logLift(p, "neck")).reps); await p.evaluate(() => setDay(0)); }
  assert.deepEqual(seen, [9, 10, 10]);
  assert.match(await p.$eval("#ex-neck", (el) => el.textContent), /Max 10s/);
  await app.close();
});

test("per profile: ANVIL edits don't touch EMBER / 5×5 lifts (same ids); BW lift keeps negative assist kg", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await editLift(p, "squat", { kgStep: 5, sets: 4, rest: 150 });
  await p.evaluate(() => setProgram("five-by-five", 0));
  const fx = await p.evaluate(() => { const e = state.exercises.find((x) => x.id === "squat"); return [e.sets, e.rest, kgStepFor(e)]; });
  assert.deepEqual(fx, [5, 180, 2.5], "5×5 squat keeps its own 5×5 defaults");
  await p.evaluate(() => setProgram("ember", 0));
  const em = await p.evaluate(() => { const e = state.exercises.find((x) => x.id === "em-squat"); return [e.sets, e.rest, kgStepFor(e)]; });
  assert.deepEqual(em, [3, 75, 2.5]);
  await editLift(p, "em-squat", { kgStep: 1 });
  await p.evaluate(() => setProgram("anvil", 1));
  await editLift(p, "heaves", { weight: -15 });
  const s = await ls(p, KEYS.STATE);
  assert.deepEqual(Object.keys(s.exerciseEdits).sort(), ["anvil", "ember"]);
  assert.equal(s.exerciseEdits.ember["em-squat"].kgStep, 1);
  assert.equal(s.exerciseEdits.anvil.squat.kgStep, 5);
  assert.equal(s.liftProgress.heaves.weight, -15);
  await app.close();
});

test("Reset to default restores program settings (kg kept) and clears the saved edit; blank name is refused", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await editLift(p, "bench", { kgStep: 5, sets: 2, rest: 60, name: "Flat bench", note: "Pause", repLow: 8, repTop: 10, reps: 10, weight: 52.5 });
  assert.equal(await editLift(p, "bench", { name: "   " }), false);
  assert.match(await p.$eval(".edit-msg", (el) => el.textContent), /Name can’t be blank/);
  await p.click('.edit-actions [data-act="edit-cancel"]');
  await p.click('#ex-bench [data-act="edit-ex"]');
  await p.click('[data-act="edit-reset"]');
  assert.match(await p.$eval(".edit-msg", (el) => el.textContent), /Defaults loaded/);
  await p.click('[data-act="edit-save"]');
  const s = await ls(p, KEYS.STATE);
  assert.equal(s.exerciseEdits.anvil, undefined, "no leftover edit");
  const b = s.exercises.find((e) => e.id === "bench");
  assert.deepEqual([b.name, b.note, b.sets, b.setsLog.length, b.rest, b.weight, b.reps, b.kgStep, b.repLow], ["Bench Press", undefined, 3, 3, 120, 52.5, 10, undefined, undefined]);
  await app.close();
});

test("edits ride in Export → Import and the sync payload; old backups import; bad values are dropped", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await editLift(p, "squat", { kgStep: 5, name: "Back squat" });
  const want = { anvil: { squat: { kgStep: 5, name: "Back squat" } } };
  assert.deepEqual(await p.evaluate(() => syncPayload().data.exerciseEdits), want);
  await p.evaluate(() => { window.__exports = []; exportBackup(); });
  await p.waitForFunction(() => window.__exports.length > 0);
  const text = await p.evaluate(() => window.__exports[0]);
  assert.deepEqual(JSON.parse(text).exerciseEdits, want);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-")), "b.json"); fs.writeFileSync(file, text);
  const dst = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "ember", dayIndex: 0, history: [], liftProgress: {}, bodyWeightLog: [] } } });
  const input = await dst.page.$("#import-file");
  await dst.page.evaluate(() => importBackup());
  await input.uploadFile(file);
  await dst.page.waitForFunction(() => state.programId === "anvil", { timeout: 5000 });
  assert.deepEqual((await ls(dst.page, KEYS.STATE)).exerciseEdits, want);
  assert.equal(await dst.page.evaluate(() => state.exercises.find((e) => e.id === "squat")?.name), "Back squat");
  await dst.close();
  // An old (pre-v51) backup has no exerciseEdits → {} and nothing breaks
  await p.evaluate(() => applyBackup({ programId: "anvil", dayIndex: 0, history: [], liftProgress: { squat: { reps: 8, weight: 50, streak: 0, failStreak: 0 } }, bodyWeightLog: [] }));
  assert.deepEqual(await p.evaluate(() => state.exerciseEdits), {});
  assert.equal(await p.evaluate(() => kgStepFor(state.exercises.find((e) => e.id === "squat"))), 2.5);
  // Junk is sanitised
  const bad = await p.evaluate(() => sanitizeEdits({ anvil: { squat: { kgStep: 0, sets: 0, rest: -5, repLow: 12, repTop: 6, name: "  ", note: 5 }, bench: { kgStep: -2.5 }, row: { kgStep: 2, sets: 4.5, secMax: 2 } }, nope: { squat: { kgStep: 5 } }, ember: [] }));
  assert.deepEqual(bad, { anvil: { row: { kgStep: 2 } } });
  assert.deepEqual(app.errors, []);
  await app.close();
});
