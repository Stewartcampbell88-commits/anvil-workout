// v58: Psoas sit-up replaces Psoas march on ANVIL Day B (same slot). March stays in Add-a-lift.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS, stewartState, anvilProgress } from "./fixtures.mjs";

const NAME = "Psoas sit-up";
let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const psoasHist = (st) => {
  const h = st.history;
  h[0] = { ...h[0], day: "B", lifts: [...h[0].lifts, { id: "psoas", name: "Psoas march", weight: 0, reps: 8, clean: true, sets: [{ ok: true, miss: false, reps: 8 }, { ok: true, miss: false, reps: 8 }, { ok: true, miss: false, reps: 8 }] }] };
  return st;
};

/** Pre-v58 Day B mid-session: psoas march in slot 4, no sit-up flag. */
const v57DayB = () => psoasHist(stewartState({
  dayIndex: 1,
  anvilXrdlV49: true,
  neckIsoV50: true,
  exercises: [
    { id: "rdl", name: "RDL", sets: 3, reps: 8, rest: 120, weight: 80, block: "Day B", streak: 0, failStreak: 0, setsLog: [{ ok: true, miss: false, reps: 8 }, { ok: false, miss: false }, { ok: false, miss: false }] },
    { id: "ohp", name: "Overhead press", sets: 3, reps: 8, rest: 90, weight: 40, block: "Day B" },
    { id: "lunge", name: "Bulgarian split squat", sets: 3, reps: 8, rest: 75, weight: 0, bw: true, bilateral: true, block: "Day B" },
    { id: "psoas", name: "Psoas march", sets: 3, reps: 8, rest: 45, weight: 0, bw: true, bilateral: true, block: "Day B", streak: 1, failStreak: 0 },
    { id: "lmr", name: "Landmine rotation", sets: 3, reps: 8, rest: 60, weight: 0, bw: true, bilateral: true, block: "Day B" },
    { id: "heaves", name: "Heaves", sets: 3, reps: 6, rest: 120, weight: -10, bw: true, block: "Day B" },
    { id: "bext", name: "Back extension (twist)", sets: 3, reps: 10, rest: 60, weight: 0, bw: true, block: "Day B" },
    { id: "neck", name: "Neck isometric (4-way)", sets: 2, reps: 10, rest: 30, weight: 0, bw: true, block: "Day B" },
    { id: "curl", name: "Dumbbell curl", sets: 3, reps: 10, rest: 60, weight: 10, block: "Add-on" },
  ],
  liftProgress: { ...anvilProgress(), psoas: { reps: 8, weight: 0, streak: 1, failStreak: 0 } },
  dayOrder: { "anvil:1": ["rdl", "ohp", "lunge", "psoas", "lmr", "heaves", "bext", "neck", "curl"] },
}));

test("ANVIL Day B program: Psoas sit-up in the old march slot; EMBER / TITAN unchanged", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => {
    const anvilB = getProgram("anvil").days[1].exercises.map((e) => e.id);
    const sit = getProgram("anvil").days[1].exercises.find((e) => e.id === "psoas-situp");
    const anyMarch = getProgram("anvil").days.some((d) => d.exercises.some((e) => e.id === "psoas"));
    const ember = getProgram("ember").days.map((d) => d.exercises.map((e) => e.id));
    const titan = getProgram("titan").days.map((d) => d.exercises.map((e) => e.id));
    return { anvilB, sit, anyMarch, ember, titan };
  });
  assert.deepEqual(r.anvilB, ["rdl", "ohp", "lunge", "psoas-situp", "lmr", "heaves", "bext", "neck"]);
  assert.equal(r.anyMarch, false);
  assert.equal(r.sit.name, NAME);
  assert.equal(r.sit.bw, true);
  assert.equal(r.sit.bilateral, true);
  assert.equal(r.sit.sets, 3);
  assert.equal(r.sit.reps, 8);
  assert.equal(r.sit.rest, 45);
  assert.equal(r.sit.cap, 12);
  assert.equal(r.sit.weight, 0);
  assert.deepEqual(r.ember, [["em-squat", "em-bench", "em-row", "em-cossack", "em-deadbug", "em-neck"], ["em-rdl", "em-bss", "em-press", "em-heaves", "em-plank", "em-neck"]]);
  assert.deepEqual(r.titan, [["tp-squat", "tp-bench", "tp-row", "tp-deadbug"], ["tp-rdl", "tp-press", "tp-lunge", "tp-heaves", "tp-plank"]]);
  await app.close();
});

test("Add-a-lift has both Psoas march and Psoas sit-up; how-to present for sit-up", async () => {
  const app = await openApp(srv.url);
  const lib = await app.page.evaluate(() => {
    const g = LIBRARY.find((x) => x.group === "Core / extras");
    return {
      march: g.lifts.find((l) => l.id === "psoas"),
      sit: g.lifts.find((l) => l.id === "psoas-situp"),
      howto: HOWTO["psoas-situp"],
    };
  });
  assert.equal(lib.march.name, "Psoas march");
  assert.equal(lib.sit.name, NAME);
  assert.equal(lib.sit.bilateral, true);
  assert.ok(lib.howto);
  const all = [...lib.howto.cues, ...lib.howto.mistakes].join(" ");
  for (const re of [/bench/i, /hug/i, /hip/i, /control/i, /pain|momentum/i]) assert.match(all, re);
  await app.page.evaluate(() => { setDay(1); ui.panel = "add"; render(); });
  assert.ok(await app.page.$('[data-act="pick"][data-id="psoas"]'));
  assert.ok(await app.page.$('[data-act="pick"][data-id="psoas-situp"]') === null, "sit-up already on Day B so hidden from pick");
  await app.page.evaluate(() => { ui.panel = "none"; setDay(0); ui.panel = "add"; render(); });
  assert.ok(await app.page.$('[data-act="pick"][data-id="psoas-situp"]'));
  await app.page.evaluate(() => { ui.panel = "none"; setDay(1); });
  await app.page.evaluate(() => openHowto(state.exercises.findIndex((e) => e.id === "psoas-situp")));
  const sheet = await app.page.evaluate(() => document.body.textContent);
  assert.match(sheet, /Stop if hip or back pain/i);
  assert.doesNotMatch(sheet, /No detailed guide for this lift yet/);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("v57 Day B save migrates: psoas → psoas-situp in the same slot; march progress/history kept", async () => {
  const raw = v57DayB();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const s = await ls(app.page, KEYS.STATE);
  assert.deepEqual(s.exercises.map((e) => e.id), ["rdl", "ohp", "lunge", "psoas-situp", "lmr", "heaves", "bext", "neck", "curl"]);
  const x = s.exercises[3];
  assert.equal(x.name, NAME);
  assert.equal(x.bw, true);
  assert.equal(x.bilateral, true);
  assert.equal(x.reps, 8);
  assert.equal(x.weight, 0);
  assert.equal(s.exercises[0].setsLog[0].ok, true, "in-progress RDL set kept");
  assert.deepEqual(s.liftProgress.psoas, raw.liftProgress.psoas, "old Psoas march progress kept");
  assert.equal(s.liftProgress["psoas-situp"], undefined, "sit-up starts fresh");
  assert.deepEqual(s.history, raw.history, "history byte-for-byte (incl. Psoas march)");
  assert.equal(s.anvilPsoasSitupV58, true);
  assert.deepEqual(s.dayOrder["anvil:1"], ["rdl", "ohp", "lunge", "psoas-situp", "lmr", "heaves", "bext", "neck", "curl"]);
  const card = await app.page.$eval("#ex-psoas-situp", (el) => el.textContent);
  assert.match(card, /Psoas sit-up/);
  assert.equal(await app.page.$("#ex-psoas"), null);
  await reload(app);
  assert.deepEqual((await ls(app.page, KEYS.STATE)).exercises.map((e) => e.id), ["rdl", "ohp", "lunge", "psoas-situp", "lmr", "heaves", "bext", "neck", "curl"]);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("migration is one-shot: after v58 a deliberately kept psoas / removed sit-up is not touched again", async () => {
  const raw = { ...v57DayB(), anvilPsoasSitupV58: true };
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const ids = (await ls(app.page, KEYS.STATE)).exercises.map((e) => e.id);
  assert.ok(ids.includes("psoas") && !ids.includes("psoas-situp"));
  await app.close();
});

test("Mobility seated psoas lift (mob-psoas) is unchanged", async () => {
  const app = await openApp(srv.url);
  const r = await app.page.evaluate(() => {
    const m = MOBILITY.find((e) => e.id === "mob-psoas");
    return { id: m.id, name: m.name };
  });
  assert.equal(r.id, "mob-psoas");
  assert.match(r.name, /Seated psoas lift/i);
  await app.close();
});
