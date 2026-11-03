// ANVIL Mobility (v53): its own session next to Day A/B. 12 moves, no kg, timed holds with cues, each-side switch timer.
// Logging saves a type:"mobility" history entry and never touches Day A/B, liftProgress, wave, streaks or the balance chain.
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
const dayA = () => stewartState({ dayIndex: 0, anvilXrdlV49: true, neckIsoV50: true });
const idx = (page, id) => page.evaluate((id) => state.exercises.findIndex((e) => e.id === id), id);
const endTimer = (page) => page.evaluate(() => { restEndAt = Date.now() - 1; restTick(); return { mode: ui.restMode, remain: ui.remain, running: ui.running, hold: ui.hold }; });
const WANT = [
  ["Cat-cow", 8, false, false], ["Child’s pose with side reach", 30, true, true], ["90/90 hip switches", 8, false, true],
  ["Half-kneeling hip flexor stretch", 30, true, true], ["Glute bridge (2 s hold)", 10, false, false], ["Lying figure-4 stretch", 30, true, true],
  ["Dead bug", 6, false, true], ["World’s greatest stretch", 4, false, true], ["Thoracic open book", 6, false, true],
  ["Wall ankle rocks", 10, false, true], ["Wall slides", 10, false, false], ["Deep squat hold", 30, true, false],
];

test("12 moves in order, cue line each, no kg; Mobility button on ANVIL only; A/B lists untouched", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  const list = await p.evaluate(() => MOBILITY.map((m) => [m.name, m.reps, !!m.timed, !!m.bilateral, m.sets, m.weight, !!m.note, m.id.startsWith("mob-")]));
  assert.deepEqual(list.map((m) => m.slice(0, 4)), WANT);
  assert.ok(list.every((m) => m[4] === 1 && m[5] === 0 && m[6] && m[7]));
  assert.ok(await p.$('[data-act="mobility"]'));
  const prog = await p.evaluate(() => PROGRAMS.map((pr) => pr.days.flatMap((d) => d.exercises.map((e) => e.id)).filter((id) => id.startsWith("mob-")).length));
  assert.ok(prog.every((n) => n === 0), "not mixed into any program day");
  for (const pid of ["ember", "titan"]) { await p.evaluate((pid) => setProgram(pid, 0), pid); assert.equal(await p.$('[data-act="mobility"]'), null, pid); }
  await app.close();
});

test("open Mobility: banner, 12 cards, no kg / Add / Remove, Log mobility; tapping A comes back with Day A as it was", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  const beforeA = await p.evaluate(() => JSON.stringify(state.exercises));
  await p.click('[data-act="mobility"]');
  const r = await p.evaluate(() => ({ mobile: state.mobile, n: state.exercises.length, day: state.dayIndex, ids: state.exercises.map((e) => e.id) }));
  assert.deepEqual([r.mobile, r.n, r.day], [true, 12, 0]);
  const text = await p.$eval("#app", (el) => el.textContent);
  assert.match(text, /Pain-free, slow, no bouncing/); assert.match(text, /ANVIL · Mobility/); assert.match(text, /Log mobility/);
  assert.equal(await p.$('[data-act="weight"]'), null); assert.equal(await p.$('[data-p="add"]'), null);
  assert.match(await p.$eval("#ex-mob-child", (el) => el.textContent), /30s each side/);
  assert.equal(await p.$eval('[data-act="mobility"]', (el) => el.classList.contains("on")), true);
  await p.click('[data-act="day"][data-d="0"]');
  assert.equal(await p.evaluate(() => state.mobile), false);
  assert.equal(await p.evaluate(() => JSON.stringify(state.exercises)), beforeA, "Day A list byte-for-byte");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("timed each-side hold: hold side 1 (cues) → switch sides → hold side 2 → done → short rest; tap during hold = done now", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await p.evaluate(() => { window.__cue = []; for (const f of ["cueHoldStart", "cueSwitch", "cueComplete"]) { const o = window[f]; window[f] = () => { window.__cue.push(f); try { o(); } catch {} }; } enterMobility(); });
  const ei = await idx(p, "mob-child");
  await p.click('#ex-mob-child [data-act="set"]');
  let st = await p.evaluate(() => ({ mode: ui.restMode, remain: ui.remain, hold: ui.hold, lab: document.querySelector("[data-switch-lab]")?.textContent, clock: !!loadClock() }));
  assert.deepEqual([st.mode, st.remain, st.hold.side, st.lab, st.clock], ["hold", 30, 1, "Hold · side 1", true]);
  st = await endTimer(p);
  assert.deepEqual([st.mode, st.remain], ["switch", 10]);
  assert.equal(await p.evaluate((ei) => state.exercises[ei].setsLog[0].half, ei), true);
  st = await endTimer(p);
  assert.deepEqual([st.mode, st.remain, st.hold.side], ["hold", 30, 2]);
  st = await endTimer(p);
  assert.deepEqual([st.mode, st.remain], ["rest", 15]);
  assert.deepEqual(await p.evaluate((ei) => state.exercises[ei].setsLog[0], ei), { ok: true, miss: false, reps: 30 });
  assert.deepEqual(await p.evaluate(() => window.__cue), ["cueHoldStart", "cueComplete", "cueSwitch", "cueHoldStart", "cueComplete"]);
  // Deep squat (one side): tap starts 30 s hold; tap again = finished early
  await p.click('#ex-mob-squat [data-act="set"]');
  assert.deepEqual(await p.evaluate(() => [ui.restMode, ui.remain]), ["hold", 30]);
  await p.click('#ex-mob-squat [data-act="set"]');
  assert.deepEqual(await p.evaluate(() => [state.exercises.find((e) => e.id === "mob-squat").setsLog[0].ok, ui.restMode]), [true, "rest"]);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("rep moves tap to complete; each-side rep moves use the switch-sides timer", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await p.evaluate(() => enterMobility());
  await p.click('#ex-mob-catcow [data-act="set"]');
  assert.deepEqual(await p.evaluate(() => [state.exercises[0].setsLog[0].ok, ui.restMode, ui.remain]), [true, "rest", 15]);
  await p.click('#ex-mob-9090 [data-act="set"]');
  assert.deepEqual(await p.evaluate(() => [state.exercises[2].setsLog[0], ui.restMode, ui.remain]), [{ ok: false, miss: false, half: true }, "switch", 10]);
  await p.click('#ex-mob-9090 [data-act="set"]');
  assert.equal(await p.evaluate(() => state.exercises[2].setsLog[0].ok), true);
  await app.close();
});

test("Log mobility: history type 'mobility' with duration + skips; Day A/B, progress, streaks untouched; Sheet + sync get it", async () => {
  const gas = makeGas();
  const raw = dayA();
  const app = await openApp(srv.url, { gas, storage: { [KEYS.STATE]: raw } });
  const p = app.page;
  const before = await p.evaluate(() => ({ ex: JSON.stringify(state.exercises), lp: JSON.stringify(state.liftProgress), day: state.dayIndex }));
  await p.evaluate(() => {
    enterMobility();
    state.exercises.forEach((e, i) => { if (i < 10) e.setsLog.forEach((_, si) => markSet(i, si)); });
    skipExercise(10, "time"); skipExercise(11, "pain");
    const c = loadClock(); saveClock({ ...c, startedAt: c.startedAt - 14 * 60000 });
    onLog();
  });
  const s = await ls(p, KEYS.STATE);
  const h = s.history[0];
  assert.deepEqual([h.type, h.day, h.programId, h.lifts.length], ["mobility", "Mobility", "anvil", 10]);
  assert.ok(h.lifts.every((l) => l.id.startsWith("mob-") && l.weight === 0 && l.clean));
  assert.deepEqual(h.skips.map((x) => [x.id, x.reason]), [["mob-wallslide", "time"], ["mob-squat", "pain"]]);
  assert.ok(h.durationSec >= 14 * 60 && h.startedAt && h.endedAt);
  assert.match(h.notes[0], /^Mobility: 10\/12 moves · 2 skipped · 14 min/);
  assert.equal(s.history.length, raw.history.length + 1);
  assert.equal(s.mobility.active, false);
  assert.ok(s.mobility.exercises.every((e) => e.setsLog.every((x) => !x.ok && !x.miss) && !e.skipped), "mobility reset for next time");
  const after = await p.evaluate(() => ({ ex: JSON.stringify(state.exercises), lp: JSON.stringify(state.liftProgress), day: state.dayIndex, mobile: state.mobile }));
  assert.deepEqual([after.ex, after.lp, after.day, after.mobile], [before.ex, before.lp, before.day, false], "A/B rotation, lifts, progress untouched");
  assert.ok(!Object.keys(s.liftProgress).some((k) => k.startsWith("mob-")));
  assert.ok(!(await p.evaluate(() => progressLiftOptions().some((o) => o.id.startsWith("mob-")))), "not in lift graphs");
  await p.waitForFunction(() => syncCfg.lastSync && !syncBusy, { timeout: 5000 });
  const post = app.net.posts[app.net.posts.length - 1];
  assert.equal(post.data.history[0].type, "mobility");
  assert.ok(Array.isArray(post.data.mobility.exercises));
  const rows = gas.sheetRows("Sessions").filter((r) => r[4] === "Mobility");
  assert.equal(rows.length, 10, "Sessions tab rows, day = Mobility");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("mid-mobility survives reload; Export → Import carries it; old backups import; guards both ways", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  // Guard: a started lift session can't jump to Mobility
  await p.evaluate(() => markSet(0, 0));
  assert.equal(await p.evaluate(() => enterMobility()), false);
  assert.match(await p.$eval("#toast", (el) => el.textContent), /Log or Reset/);
  await p.evaluate(() => { resetChecks(); enterMobility(); markSet(0, 0); });
  await p.click('[data-act="day"][data-d="1"]');
  assert.equal(await p.evaluate(() => state.mobile), true, "started mobility can't jump to B");
  await reload(app);
  assert.deepEqual(await p.evaluate(() => [state.mobile, state.exercises[0].id, state.exercises[0].setsLog[0].ok, state.altExercises[0].id]), [true, "mob-catcow", true, "squat"]);
  await p.evaluate(() => { window.__exports = []; exportBackup(); });
  await p.waitForFunction(() => window.__exports.length > 0);
  const text = await p.evaluate(() => window.__exports[0]);
  const j = JSON.parse(text);
  assert.equal(j.exercises[0].id, "squat", "backup 'exercises' is always the A/B list");
  assert.equal(j.mobility.active, true); assert.equal(j.mobility.exercises.length, 12);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-")), "b.json"); fs.writeFileSync(file, text);
  const dst = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "ember", dayIndex: 0, history: [], liftProgress: {}, bodyWeightLog: [] } } });
  const input = await dst.page.$("#import-file");
  await dst.page.evaluate(() => importBackup());
  await input.uploadFile(file);
  await dst.page.waitForFunction(() => state.programId === "anvil", { timeout: 5000 });
  assert.deepEqual(await dst.page.evaluate(() => [state.mobile, state.exercises[0].setsLog[0].ok]), [true, true]);
  await dst.close();
  await p.evaluate(() => applyBackup({ programId: "anvil", dayIndex: 1, history: [], liftProgress: {}, bodyWeightLog: [] }));
  assert.deepEqual(await p.evaluate(() => [state.mobile, state.dayIndex, state.altExercises.length, state.altExercises[0].id]), [false, 1, 12, "mob-catcow"]);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("Edit screen on a move: seconds / reps / sets / rest / switch / name + cues, no kg; persists; Reset", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await p.evaluate(() => enterMobility());
  await p.click('#ex-mob-squat [data-act="edit-ex"]');
  const txt = await p.$eval('[aria-label="Edit exercise"]', (el) => el.textContent);
  assert.match(txt, /Target seconds/); assert.match(txt, /Notes \/ cues/);
  for (const f of ["weight", "repLow", "switchSec"]) assert.equal(await p.$(`[data-f="${f}"]`), null, f);
  assert.equal(await p.$('[data-act="edit-kg-step"]'), null);
  for (let i = 0; i < 3; i++) await p.click('[data-act="edit-step"][data-f="reps"][data-d="1"]');
  await p.click('[data-act="edit-save"]');
  assert.equal(await p.evaluate(() => state.exercises.find((e) => e.id === "mob-squat").reps), 45);
  await p.click('#ex-mob-fig4 [data-act="edit-ex"]');
  assert.ok(await p.$('[data-f="switchSec"]'), "each-side move has the switch timer");
  await p.$eval("[data-edit-name]", (el) => { el.value = ""; });
  await p.type("[data-edit-name]", "Figure-4");
  await p.click('[data-act="edit-save"]');
  await reload(app);
  const r = await p.evaluate(() => [state.mobile, state.exercises.find((e) => e.id === "mob-squat").reps, state.exercises.find((e) => e.id === "mob-fig4").name]);
  assert.deepEqual(r, [true, 45, "Figure-4"]);
  const s = await ls(p, KEYS.STATE);
  assert.deepEqual(s.exerciseEdits.anvil["mob-fig4"], { name: "Figure-4" });
  assert.ok(!Object.keys(s.liftProgress).some((k) => k.startsWith("mob-")));
  await p.click('#ex-mob-fig4 [data-act="edit-ex"]');
  await p.click('[data-act="edit-reset"]');
  await p.click('[data-act="edit-save"]');
  assert.equal(await p.evaluate(() => state.exercises.find((e) => e.id === "mob-fig4").name), "Lying figure-4 stretch");
  assert.deepEqual(app.errors, []);
  await app.close();
});
