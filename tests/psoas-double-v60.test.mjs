// v60: ANVIL Day B Psoas sit-up → Double-leg psoas sit-up (same id, same slot, no "each side").
// Add-a-lift keeps the single-leg Psoas sit-up (psoas-situp-single) and Psoas march alongside it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState, anvilProgress } from "./fixtures.mjs";

const DOUBLE = "Double-leg psoas sit-up";
const DOUBLE_NOTE = "Lie on a bench or floor. Hook both feet (under a bar, KB, strap or partner). Knees slightly bent. Sit up by flexing at the hips, keep the back long; lower with control.";
const OLD_NOTE = "Lie on a bench. Hug one knee to the chest. Hook the working foot (KB handle, dumbbell, strap, or just hang). Sit up by flexing that hip; lower with control. Each side.";
let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const hist = (st) => {
  st.history[0] = { ...st.history[0], day: "B", lifts: [...st.history[0].lifts, { id: "psoas-situp", name: "Psoas sit-up", weight: 0, reps: 10, clean: true, sets: [{ ok: true, miss: false, reps: 10 }, { ok: true, miss: false, reps: 10 }, { ok: true, miss: false, reps: 10 }] }] };
  return st;
};
/** v59 Day B save: single-leg sit-up (bilateral, old note) mid-session with a half-ticked set; custom order. */
const v59DayB = () => hist(stewartState({
  dayIndex: 1, anvilXrdlV49: true, neckIsoV50: true, anvilPsoasSitupV58: true, emberSplitV59: true,
  exercises: [
    { id: "rdl", name: "RDL", sets: 3, reps: 8, rest: 120, weight: 80, block: "Day B" },
    { id: "psoas-situp", name: "Psoas sit-up", sets: 3, reps: 10, rest: 45, weight: 0, bw: true, bilateral: true, cap: 12, block: "Day B", note: OLD_NOTE, streak: 2, failStreak: 0, setsLog: [{ ok: true, miss: false, reps: 10 }, { ok: false, miss: false, half: true }, { ok: false, miss: false }] },
    { id: "ohp", name: "Overhead press", sets: 3, reps: 8, rest: 90, weight: 40, block: "Day B" },
    { id: "lunge", name: "Bulgarian split squat", sets: 3, reps: 8, rest: 75, weight: 0, bw: true, bilateral: true, block: "Day B" },
    { id: "lmr", name: "Landmine rotation", sets: 3, reps: 8, rest: 60, weight: 0, bw: true, bilateral: true, block: "Day B" },
    { id: "heaves", name: "Heaves", sets: 3, reps: 6, rest: 120, weight: -10, bw: true, block: "Day B" },
    { id: "bext", name: "Back extension (twist)", sets: 3, reps: 10, rest: 60, weight: 0, bw: true, block: "Day B" },
    { id: "neck", name: "Neck isometric (4-way)", sets: 2, reps: 10, rest: 30, weight: 0, bw: true, block: "Day B" },
  ],
  liftProgress: { ...anvilProgress(), "psoas-situp": { reps: 10, weight: 0, streak: 2, failStreak: 0 } },
  dayOrder: { "anvil:1": ["rdl", "psoas-situp", "ohp", "lunge", "lmr", "heaves", "bext", "neck"] },
}));

test("ANVIL Day B program: Double-leg psoas sit-up in the same slot, not each side", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => {
    const d = getProgram("anvil").days[1].exercises;
    const x = d.find((e) => e.id === "psoas-situp");
    return { ids: d.map((e) => e.id), x, sw: switchSecFor(x), howto: HOWTO[howtoKey(x)] };
  });
  assert.deepEqual(r.ids, ["rdl", "ohp", "lunge", "psoas-situp", "lmr", "heaves", "bext", "neck"]);
  assert.equal(r.x.name, DOUBLE); assert.equal(r.x.note, DOUBLE_NOTE); assert.equal(r.x.bilateral, false);
  assert.deepEqual([r.x.sets, r.x.reps, r.x.cap, r.x.rest, r.x.weight, r.x.block], [3, 8, 12, 45, 0, "Day B"]);
  assert.equal(r.sw, 0, "no switch-sides countdown");
  assert.match(r.howto.cues.join(" "), /both feet/i);
  await app.close();
});

test("Add-a-lift lists Double-leg psoas sit-up AND single-leg Psoas sit-up (each side) AND Psoas march", async () => {
  const app = await openApp(srv.url);
  const lib = await app.page.evaluate(() => {
    const g = LIBRARY.find((x) => x.group === "Core / extras").lifts;
    const pick = (id) => g.find((l) => l.id === id);
    return { dbl: pick("psoas-situp"), single: pick("psoas-situp-single"), march: pick("psoas"), hs: HOWTO[howtoKey({ id: "psoas-situp-single" })] };
  });
  assert.equal(lib.dbl.name, DOUBLE); assert.equal(lib.dbl.bilateral, false); assert.equal(lib.dbl.note, DOUBLE_NOTE);
  assert.equal(lib.single.name, "Psoas sit-up"); assert.equal(lib.single.bilateral, true); assert.equal(lib.single.note, OLD_NOTE);
  assert.equal(lib.march.name, "Psoas march");
  assert.match(lib.hs.cues.join(" "), /hugged knee/i);
  // On Day A (neither is programmed) both sit-ups + march are pickable; on Day B the single-leg one still is
  await app.page.evaluate(() => { setDay(0); ui.panel = "add"; render(); });
  for (const id of ["psoas-situp", "psoas-situp-single", "psoas"]) assert.ok(await app.page.$(`[data-act="pick"][data-id="${id}"]`), id);
  await app.page.evaluate(() => { ui.panel = "none"; setDay(1); ui.panel = "add"; render(); });
  assert.ok(await app.page.$('[data-act="pick"][data-id="psoas-situp-single"]'));
  // Adding the single-leg one runs each side (switch-sides on)
  const sw = await app.page.evaluate(() => { const l = LIBRARY.flatMap((g) => g.lifts).find((x) => x.id === "psoas-situp-single"); addExercise(l); const e = state.exercises.find((x) => x.id === "psoas-situp-single"); return [e.name, switchSecFor(e) > 0]; });
  assert.deepEqual(sw, ["Psoas sit-up", true]);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("v59 save migrates: same lift becomes double-leg; progress, history, order and logged sets kept; idempotent", async () => {
  const raw = v59DayB();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  let s = await ls(app.page, KEYS.STATE);
  const ids = ["rdl", "psoas-situp", "ohp", "lunge", "lmr", "heaves", "bext", "ws-copenhagen", "neck"]; // v61 weekly special slot before neck
  assert.deepEqual(s.exercises.map((e) => e.id), ids);
  const x = s.exercises[1];
  assert.equal(x.name, DOUBLE); assert.equal(x.note, DOUBLE_NOTE); assert.equal(x.bilateral, false);
  assert.deepEqual([x.reps, x.streak], [10, 2]);
  assert.equal(x.setsLog[0].ok, true, "logged set kept");
  assert.equal(x.setsLog[1].half, undefined, "half-tick cleared (no sides any more)");
  assert.deepEqual(s.liftProgress["psoas-situp"], raw.liftProgress["psoas-situp"]);
  assert.deepEqual(s.history, raw.history);
  assert.deepEqual(s.dayOrder, raw.dayOrder);
  assert.equal(s.anvilPsoasDoubleV60, true);
  assert.match(await app.page.$eval("#ex-psoas-situp", (el) => el.textContent), /Double-leg psoas sit-up/);
  await reload(app); await reload(app);
  s = await ls(app.page, KEYS.STATE);
  assert.deepEqual(s.exercises.map((e) => e.id), ids);
  assert.equal(s.exercises[1].name, DOUBLE);
  assert.deepEqual(app.errors, []);
  await app.close();
  // One-shot: once flagged, a user's own rename is left alone
  const raw2 = v59DayB(); raw2.anvilPsoasDoubleV60 = true;
  const app2 = await openApp(srv.url, { storage: { [KEYS.STATE]: raw2 } });
  assert.equal((await ls(app2.page, KEYS.STATE)).exercises[1].name, "Psoas sit-up");
  await app2.close();
});

test("EMBER save is untouched by the v60 migration", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "ember", dayIndex: 1, emberSplitV59: true, exercises: [], history: [], liftProgress: {} } } });
  const s = await ls(app.page, KEYS.STATE);
  assert.ok(!JSON.stringify(s.exercises).includes("psoas"));
  await app.close();
});
