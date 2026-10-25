// v49: Crossed-leg straight-leg forward fold / RDL replaces Single-leg RDL on ANVIL Day A (same slot).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState, anvilProgress } from "./fixtures.mjs";

const NAME = "Crossed-leg straight-leg forward fold / RDL";
let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const slrdlHist = (st) => {
  const h = st.history;
  h[0] = { ...h[0], day: "A", lifts: [...h[0].lifts, { id: "slrdl", name: "Single-leg RDL", weight: 7.5, reps: 6, clean: true, sets: [{ ok: true, miss: false, reps: 6 }, { ok: true, miss: false, reps: 6 }, { ok: true, miss: false, reps: 6 }] }] };
  return st;
};
// Stewart's phone today (v47/v48): on Day A mid-session, slrdl in slot 4 with progress, v38 layout flag, no v49 flag.
const v48DayA = () => slrdlHist(stewartState({
  dayIndex: 0,
  exercises: [
    { id: "squat", name: "Squat", sets: 3, reps: 8, rest: 120, weight: 69, block: "Day A", streak: 1, failStreak: 0, setsLog: [{ ok: true, miss: false, reps: 8 }, { ok: false, miss: false }, { ok: false, miss: false }] },
    { id: "bench", name: "Bench Press", sets: 3, reps: 8, rest: 120, weight: 50, block: "Day A", streak: 2, failStreak: 0 },
    { id: "row", name: "Bent over row", sets: 3, reps: 10, rest: 90, weight: 40, block: "Day A", streak: 0, failStreak: 0 },
    { id: "slrdl", name: "Single-leg RDL", sets: 3, reps: 6, rest: 75, weight: 7.5, bilateral: true, block: "Day A", streak: 1, failStreak: 0 },
    { id: "cossack", name: "Cossack", sets: 3, reps: 8, rest: 45, weight: 0, bw: true, block: "Day A", levelIndex: 1 },
    { id: "sgm", name: "Seated good morning", sets: 3, reps: 8, rest: 90, weight: 20, block: "Day A" },
    { id: "bext", name: "Back extension (twist)", sets: 3, reps: 10, rest: 60, weight: 0, bw: true, block: "Day A" },
    { id: "curl", name: "Dumbbell curl", sets: 3, reps: 10, rest: 60, weight: 10, block: "Add-on" },
  ],
  liftProgress: { ...anvilProgress(), slrdl: { reps: 6, weight: 7.5, streak: 1, failStreak: 0 } },
}));

test("ANVIL Day A program: new lift sits in Single-leg RDL's slot; kg stepper, per side, light start", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => getProgram("anvil").days[0].exercises.find((e) => e.id === "xrdl"));
  assert.equal(r.name, "Crossed-leg straight-leg forward fold / RDL");
  assert.equal(r.bw, undefined, "kg stepper (not bodyweight-only)");
  assert.equal(r.bilateral, true); assert.equal(r.weight, 5); assert.equal(r.sets, 3); assert.equal(r.reps, 6);
  const anyOld = await app.page.evaluate(() => PROGRAMS.find((p) => p.id === "anvil").days.some((d) => d.exercises.some((e) => e.id === "slrdl")));
  assert.equal(anyOld, false);
  await app.close();
});

test("v48 Day A save migrates: slrdl → xrdl in the same slot, everything else + slrdl progress/history kept", async () => {
  const raw = v48DayA();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const s = await ls(app.page, KEYS.STATE);
  assert.deepEqual(s.exercises.map((e) => e.id), ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "neck", "curl"]);
  const x = s.exercises[3];
  assert.equal(x.name, NAME); assert.equal(x.weight, 5); assert.equal(x.reps, 6); assert.equal(x.bilateral, true);
  assert.equal(s.exercises[0].setsLog[0].ok, true, "in-progress squat set kept");
  assert.equal(s.exercises[0].weight, 69);
  assert.deepEqual(s.liftProgress.slrdl, raw.liftProgress.slrdl, "old Single-leg RDL progress kept");
  assert.deepEqual(s.history, raw.history, "history byte-for-byte (incl. Single-leg RDL)");
  assert.equal(s.anvilXrdlV49, true);
  const card = await app.page.$eval("#ex-xrdl", (el) => el.textContent);
  assert.match(card, /Crossed-leg straight-leg forward fold \/ RDL/);
  assert.equal(await app.page.$("#ex-slrdl"), null);
  // Stable on reload
  await reload(app);
  assert.deepEqual((await ls(app.page, KEYS.STATE)).exercises.map((e) => e.id), ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "neck", "curl"]);
  // Old slrdl history still renders in Progress / Session log
  await app.page.evaluate(() => { ui.panel = "settings"; ui.settingsTab = "progress"; render(); ui.settingsTab = "history"; render(); });
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("migration is one-shot: after v49 a deliberately kept slrdl / removed xrdl is not touched again", async () => {
  const raw = { ...v48DayA(), anvilXrdlV49: true };
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const ids = (await ls(app.page, KEYS.STATE)).exercises.map((e) => e.id);
  assert.ok(ids.includes("slrdl") && !ids.includes("xrdl"));
  await app.close();
});

test("Stewart on Day B: switching to Day A shows the new lift; slrdl progress survives the switch", async () => {
  const raw = slrdlHist(stewartState({ liftProgress: { ...anvilProgress(), slrdl: { reps: 8, weight: 10, streak: 0, failStreak: 0 } } }));
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  await app.page.evaluate(() => setDay(0));
  const s = await ls(app.page, KEYS.STATE);
  assert.deepEqual(s.exercises.map((e) => e.id), ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "neck"]);
  assert.deepEqual(s.liftProgress.slrdl, { reps: 8, weight: 10, streak: 0, failStreak: 0 });
  assert.equal(s.history.length, raw.history.length);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("EMBER / TITAN saves are untouched by the v49 migration", async () => {
  for (const [pid, day, ids] of [["ember", 0, ["em-squat", "em-bench", "em-row", "em-deadbug", "em-neck"]], ["titan", 0, ["tp-squat", "tp-bench", "tp-row", "tp-deadbug"]]]) {
    const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: pid, dayIndex: day, exercises: [], history: [], liftProgress: {} } } });
    const s = await ls(app.page, KEYS.STATE);
    assert.deepEqual(s.exercises.map((e) => e.id), ids);
    assert.ok(!JSON.stringify(s.exercises).includes("xrdl"));
    await app.close();
  }
});

test("in the Add-a-lift list (Squat / hinge) and has a how-to with cues + flat-back safety", async () => {
  const app = await openApp(srv.url);
  const lib = await app.page.evaluate(() => LIBRARY.find((g) => g.group === "Squat / hinge").lifts.find((l) => l.id === "xrdl"));
  assert.equal(lib.name, NAME); assert.equal(lib.bilateral, true);
  // Visible in the add panel when not in the session (e.g. on Day B)
  await app.page.evaluate(() => { setDay(1); ui.panel = "add"; render(); });
  assert.ok(await app.page.$('[data-act="pick"][data-id="xrdl"]'));
  await app.page.evaluate(() => { ui.panel = "none"; setDay(0); });
  const h = await app.page.evaluate(() => { const ex = state.exercises.find((e) => e.id === "xrdl"); return { key: howtoKey(ex), g: HOWTO[howtoKey(ex)] }; });
  assert.equal(h.key, "xrdl");
  const all = h.g.cues.join(" ");
  for (const re of [/cross one leg in front/i, /straight/i, /hinge at the hips/i, /flat back/i, /hamstring/i, /switch the cross/i, /only go as deep as your back stays flat/i]) assert.match(all, re);
  await app.page.evaluate(() => openHowto(state.exercises.findIndex((e) => e.id === "xrdl")));
  const sheet = await app.page.evaluate(() => document.body.textContent);
  assert.match(sheet, /only go as deep as your back stays flat/i);
  assert.doesNotMatch(sheet, /No detailed guide for this lift yet/);
  assert.deepEqual(app.errors, []);
  await app.close();
});
