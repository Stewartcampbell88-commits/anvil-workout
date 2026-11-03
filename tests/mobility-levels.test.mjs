// v55 Mobility levels: every move gets a B / M / X (Beginner / Medium / Expert) picker. Medium = the v54 move.
// Saved per profile (mobilityLevels), persists, Export/Import + sync carry it; level swaps name + cue (timing only for
// Expert holds + single-leg bridge each side); running panel shows level + cue; history records the level per move.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, openApp, closeBrowser, ls, reload, makeGas } from "./helpers.mjs";
import { KEYS, stewartState } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });
const dayA = (extra = {}) => stewartState({ dayIndex: 0, anvilXrdlV49: true, neckIsoV50: true, ...extra });
async function openMob(storage){
  const app = await openApp(srv.url, { ...(storage?.gas ? { gas: storage.gas } : {}), storage: { [KEYS.STATE]: storage?.state || dayA() } });
  await app.page.evaluate(() => enterMobility());
  return app;
}
const pick = (p, id, l) => p.$eval(`#ex-mob-${id} [data-act="mob-level"][data-l="${l}"]`, (el) => el.click());
const card = (p, id) => p.$eval(`#ex-mob-${id}`, (el) => el.textContent);

test("all 12 moves default to Medium (= v54 move) and show a B / M / X picker; every move has a distinct B and X", async () => {
  const app = await openMob();
  const p = app.page;
  const r = await p.evaluate(() => ({
    lv: state.exercises.map((e) => e.mobLevel),
    same: state.exercises.every((e) => { const m = MOBILITY.find((x) => x.id === e.id); return e.name === m.name && e.note === m.note && workSecFor(e) === workSecFor(m); }),
    variants: MOBILITY.map((m) => [mobilityDef(m.id, "B").name, mobilityDef(m.id, "X").name, m.name]),
    secs: routineSeconds(state.exercises),
  }));
  assert.deepEqual(r.lv, Array(12).fill("M"));
  assert.equal(r.same, true, "Medium is exactly the v54 move");
  assert.equal(r.secs, 800, "default routine length unchanged");
  for (const [b, x, m] of r.variants) { assert.ok(b && x && b !== m && x !== m && b !== x, `${m} has its own B and X`); }
  const pickers = await p.$$eval(".mob-lvl", (els) => els.map((el) => [...el.querySelectorAll("button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join(" ")));
  assert.equal(pickers.length, 12);
  assert.ok(pickers.every((s) => s === "B M* X"));
  assert.match(await card(p, "catcow"), /Medium/);
  // Not on lift days
  await p.evaluate(() => exitMobility());
  assert.equal(await p.$$eval(".mob-lvl", (els) => els.length), 0);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("tap B / X: name + cue swap, saved per profile, survives reload; back to M clears it", async () => {
  const app = await openMob();
  const p = app.page;
  await pick(p, "catcow", "B");
  await pick(p, "hipflex", "X");
  assert.match(await card(p, "catcow"), /Cat-cow on forearms/);
  assert.match(await card(p, "catcow"), /Forearms and knees down/);
  assert.match(await card(p, "catcow"), /Beginner/);
  assert.match(await card(p, "hipflex"), /overhead side bend/);
  assert.match(await card(p, "hipflex"), /Expert/);
  assert.equal(await p.$eval('#ex-mob-catcow [data-l="B"]', (el) => el.classList.contains("on") && el.getAttribute("aria-pressed")), "true");
  let s = await ls(p, KEYS.STATE);
  assert.deepEqual(s.mobilityLevels, { "mob-catcow": "B", "mob-hipflex": "X" });
  assert.equal(await p.evaluate(() => workSecFor(state.exercises[3])), 30, "hip flexor X keeps its 30 s hold");
  await reload(app);
  assert.deepEqual(await p.evaluate(() => [state.mobile, state.exercises[0].name, state.exercises[0].mobLevel, state.exercises[3].mobLevel]), [true, "Cat-cow on forearms", "B", "X"]);
  // Leaving + re-opening Mobility keeps the levels
  await p.evaluate(() => { exitMobility(); enterMobility(); });
  assert.equal(await p.evaluate(() => state.exercises[0].name), "Cat-cow on forearms");
  await pick(p, "catcow", "M");
  s = await ls(p, KEYS.STATE);
  assert.deepEqual(s.mobilityLevels, { "mob-hipflex": "X" });
  assert.equal(await p.evaluate(() => state.exercises[0].name), "Cat-cow");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("timing changes only where Expert adds a hold; single-leg bridge runs each side 20 s with the switch timer", async () => {
  const app = await openMob();
  const p = app.page;
  const r = await p.evaluate(() => {
    for (let i = 0; i < 12; i++) setMobLevel(i, "B");
    const b = state.exercises.map((e) => [e.id.slice(4), workSecFor(e), runSides(e), switchSecFor(e), e.reps]);
    const bSecs = routineSeconds(state.exercises);
    for (let i = 0; i < 12; i++) setMobLevel(i, "X");
    const x = state.exercises.map((e) => [e.id.slice(4), workSecFor(e), runSides(e), switchSecFor(e), e.reps]);
    return { b, bSecs, x, xSecs: routineSeconds(state.exercises), label: targetLabel(state.exercises[4]) };
  });
  assert.equal(r.bSecs, 800, "Beginner = same timings as v54");
  assert.deepEqual(r.x, [["catcow", 65, 1, 0, 6], ["child", 30, 2, 10, 30], ["9090", 50, 1, 0, 8], ["hipflex", 30, 2, 10, 30], ["bridge", 20, 2, 10, 8],
    ["fig4", 30, 2, 10, 30], ["deadbug", 60, 1, 0, 5], ["wgs", 25, 2, 10, 4], ["openbook", 40, 2, 10, 5], ["ankle", 35, 2, 10, 8], ["wallslide", 40, 1, 0, 10], ["squat", 30, 1, 0, 30]]);
  assert.equal(r.xSecs, 800 + 25 + 10 + 20 + 30 + 20, "holds + single-leg bridge add time");
  assert.equal(r.label, "8 each side");
  assert.match(await card(p, "bridge"), /20s per side/);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("running panel shows the level name + its cue; bridge X runs side 1 → switch → side 2", async () => {
  const app = await openMob();
  const p = app.page;
  await p.evaluate(() => {
    const real = Date.now.bind(Date); window.__off = 0; Date.now = () => real() + window.__off;
    window.__adv = (ms) => { window.__off += ms; runTick(); };
  });
  await pick(p, "catcow", "X");
  await pick(p, "bridge", "X");
  await p.click('[data-act="run-start"]');
  let panel = await p.$eval(".run-panel", (el) => el.textContent);
  assert.match(panel, /Get ready/); assert.match(panel, /Cat-cow with 3 s holds/); assert.match(panel, /Expert/); assert.match(panel, /hold 3 s/);
  const next = () => p.evaluate(() => { window.__adv(Math.max(0, ui.run.endAt - Date.now()) + 50); const r = ui.run; return [r.phase, state.exercises[r.ei]?.id.slice(4), r.side, runLeftSec()]; });
  assert.deepEqual(await next(), ["work", "catcow", 1, 65]);
  const seq = [];
  for (let i = 0; i < 30; i++) { const ph = await next(); seq.push(ph); if (ph[1] === "fig4") break; }
  assert.deepEqual(seq.filter((s) => s[1] === "bridge"), [["next", "bridge", 1, 15], ["work", "bridge", 1, 20], ["switch", "bridge", 2, 10], ["work", "bridge", 2, 20]]);
  // Back at a Medium move the panel says Medium
  panel = await p.$eval(".run-panel", (el) => el.textContent);
  assert.match(panel, /Lying figure-4 stretch/); assert.match(panel, /Medium/);
  // The running move can't change level; a later one can
  await p.evaluate(() => window.__adv(Math.max(0, ui.run.endAt - Date.now()) + 50));
  assert.equal(await p.evaluate(() => setMobLevel(5, "B")), false);
  assert.equal(await p.evaluate(() => setMobLevel(11, "B")), true);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("history records the level per move; Export → Import and sync carry the levels; junk is ignored", async () => {
  const gas = makeGas();
  const app = await openMob({ gas });
  const p = app.page;
  await pick(p, "catcow", "B");
  await pick(p, "bridge", "X");
  await p.evaluate(() => { state.exercises.forEach((e, i) => { if (i < 6) e.setsLog.forEach((_, si) => markSet(i, si)); }); onLog(); });
  const s = await ls(p, KEYS.STATE);
  const h = s.history[0];
  assert.equal(h.type, "mobility");
  assert.deepEqual(h.lifts.map((l) => [l.id.slice(4), l.level, l.name]), [["catcow", "B", "Cat-cow on forearms"], ["child", "M", "Child’s pose with side reach"], ["9090", "M", "90/90 hip switches"],
    ["hipflex", "M", "Half-kneeling hip flexor stretch"], ["bridge", "X", "Single-leg glute bridge"], ["fig4", "M", "Lying figure-4 stretch"]]);
  assert.equal(h.lifts[4].eachSide, true);
  assert.deepEqual(s.mobilityLevels, { "mob-catcow": "B", "mob-bridge": "X" }, "levels stay for next time");
  await p.waitForFunction(() => syncCfg.lastSync && !syncBusy, { timeout: 5000 });
  assert.deepEqual(app.net.posts[app.net.posts.length - 1].data.mobilityLevels, { "mob-catcow": "B", "mob-bridge": "X" });
  await p.evaluate(() => { window.__exports = []; exportBackup(); });
  await p.waitForFunction(() => window.__exports.length > 0);
  const text = await p.evaluate(() => window.__exports[0]);
  assert.deepEqual(JSON.parse(text).mobilityLevels, { "mob-catcow": "B", "mob-bridge": "X" });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-")), "b.json"); fs.writeFileSync(file, text);
  const dst = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const input = await dst.page.$("#import-file");
  await dst.page.evaluate(() => importBackup());
  await input.uploadFile(file);
  await dst.page.waitForFunction(() => state.mobilityLevels?.["mob-bridge"] === "X", { timeout: 5000 });
  assert.deepEqual(await dst.page.evaluate(() => { enterMobility(); return [state.exercises[0].name, state.exercises[4].name, state.exercises[4].bilateral]; }), ["Cat-cow on forearms", "Single-leg glute bridge", true]);
  // Old backups (no levels) + junk → all Medium
  await dst.page.evaluate(() => { exitMobility(); applyBackup({ programId: "anvil", dayIndex: 0, history: [], liftProgress: {}, bodyWeightLog: [], mobilityLevels: { "mob-catcow": "Z", squat: "X", "mob-squat": "M", __proto__x: 1 } }); });
  assert.deepEqual(await dst.page.evaluate(() => [state.mobilityLevels, state.altExercises.every((e) => e.mobLevel === "M")]), [{}, true]);
  assert.deepEqual(await dst.page.evaluate(() => sanitizeMobLevels({ "mob-squat": "X", "mob-x": "B", "mob-child": "B" })), { "mob-squat": "X", "mob-child": "B" });
  await dst.close();
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("started move can't change level; Edit screen works over a level (no fake rename) and Reset keeps the level", async () => {
  const app = await openMob();
  const p = app.page;
  await p.evaluate(() => markSet(0, 0));
  assert.equal(await p.evaluate(() => setMobLevel(0, "X")), false);
  assert.match(await p.$eval("#toast", (el) => el.textContent), /before you start/);
  await p.evaluate(() => resetChecks());
  assert.equal(await p.evaluate(() => setMobLevel(0, "X")), true);
  // Open Edit on the X move and save without changes → no custom name / note stored
  await p.evaluate(() => { openExerciseEdit(0); saveExerciseEdit(); });
  let s = await ls(p, KEYS.STATE);
  assert.equal(s.exerciseEdits?.anvil?.["mob-catcow"], undefined, "level name isn't saved as a rename");
  // A work-timer edit lays over the level
  await p.evaluate(() => { openExerciseEdit(0); ui.editEx.workSec = 80; saveExerciseEdit(); });
  assert.deepEqual(await p.evaluate(() => [state.exercises[0].name, workSecFor(state.exercises[0])]), ["Cat-cow with 3 s holds", 80]);
  await p.evaluate(() => { setMobLevel(0, "B"); });
  assert.deepEqual(await p.evaluate(() => [state.exercises[0].name, workSecFor(state.exercises[0])]), ["Cat-cow on forearms", 80], "edit kept across levels");
  await p.evaluate(() => { openExerciseEdit(0); resetExerciseEditDraft(); saveExerciseEdit(); });
  s = await ls(p, KEYS.STATE);
  assert.deepEqual([s.exerciseEdits?.anvil?.["mob-catcow"], s.mobilityLevels["mob-catcow"]], [undefined, "B"]);
  assert.equal(await p.evaluate(() => workSecFor(state.exercises[0])), 40);
  assert.deepEqual(app.errors, []);
  await app.close();
});
