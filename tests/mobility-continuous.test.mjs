// Continuous Mobility routine (v54): Start runs every move hands-free — work timers (rep moves too), side 1 → switch →
// side 2, 15 s "Next: …" transitions, cues + 3-2-1, Pause/Resume, Skip (+ optional reason), Back, ±15 s, end summary → Log.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls } from "./helpers.mjs";
import { KEYS, stewartState } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });
const dayA = () => stewartState({ dayIndex: 0, anvilXrdlV49: true, neckIsoV50: true });
/** Open the app in Mobility with a controllable clock, cue spies and a fake wake lock. */
async function openMob(){
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  await app.page.evaluate(() => {
    const real = Date.now.bind(Date); window.__off = 0; Date.now = () => real() + window.__off;
    window.__adv = (ms) => { window.__off += ms; runTick(); };
    window.__cue = [];
    for (const f of ["cueHoldStart", "cueSwitch", "cueComplete", "cueCountdown"]) { const o = window[f]; window[f] = (...a) => { window.__cue.push(f); try { o(...a); } catch {} }; }
    window.__wake = 0;
    try { Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { window.__wake++; return { release: async () => {} }; } } }); } catch {}
    enterMobility();
  });
  return app;
}
const phase = (p) => p.evaluate(() => { const r = ui.run; if (!r) return null; const ex = state.exercises[r.ei]; return { phase: r.phase, id: ex?.id, side: r.side, left: runLeftSec(), paused: !!r.paused }; });
/** Jump to the end of the current phase (+50 ms) and return the new one. */
const nextPhase = async (p) => { await p.evaluate(() => window.__adv(Math.max(0, ui.run.endAt - Date.now()) + 50)); return phase(p); };

test("default work times: rep moves get a work timer; dead bug + 90/90 alternate in place (one block, no switch)", async () => {
  const app = await openMob();
  const r = await app.page.evaluate(() => state.exercises.map((e) => [e.id.slice(4), workSecFor(e), runSides(e), switchSecFor(e)]));
  assert.deepEqual(r, [["catcow", 40, 1, 0], ["child", 30, 2, 10], ["9090", 50, 1, 0], ["hipflex", 30, 2, 10], ["bridge", 40, 1, 0], ["fig4", 30, 2, 10],
    ["deadbug", 40, 1, 0], ["wgs", 25, 2, 10], ["openbook", 25, 2, 10], ["ankle", 25, 2, 10], ["wallslide", 40, 1, 0], ["squat", 30, 1, 0]]);
  assert.equal(await app.page.evaluate(() => routineSeconds(state.exercises)), 800);
  assert.match(await app.page.$eval('[data-act="run-start"]', (el) => el.textContent), /Start routine · ~13 min/);
  assert.match(await app.page.$eval("#ex-mob-deadbug", (el) => el.textContent), /6 each side, alternating/);
  await app.close();
});

test("Start runs all 12 moves hands-free in order, auto-marks green, ends with summary → Log mobility", async () => {
  const app = await openMob();
  const p = app.page;
  await p.click('[data-act="run-start"]');
  const seq = [];
  let ph = await phase(p);
  for (let guard = 0; ph && ph.phase !== "done" && guard < 100; guard++) { seq.push([ph.phase, ph.id.slice(4), ph.side, ph.left]); ph = await nextPhase(p); }
  assert.deepEqual(seq.slice(0, 10), [["next", "catcow", 1, 5], ["work", "catcow", 1, 40], ["next", "child", 1, 15], ["work", "child", 1, 30], ["switch", "child", 2, 10],
    ["work", "child", 2, 30], ["next", "9090", 1, 15], ["work", "9090", 1, 50], ["next", "hipflex", 1, 15], ["work", "hipflex", 1, 30]]);
  assert.equal(seq.reduce((t, s) => t + s[3], 0), 800, "phase lengths add up to the estimate");
  assert.equal(seq.filter((s) => s[0] === "switch").length, 6);
  assert.equal(ph.phase, "done");
  const s = await p.evaluate(() => ({ ok: state.exercises.every((e) => e.setsLog.every((x) => x.ok)), half: state.exercises.some((e) => e.setsLog.some((x) => x.half && !x.ok)), wake: window.__wake, cues: window.__cue }));
  assert.equal(s.ok, true, "every move green"); assert.equal(s.half, false);
  assert.ok(s.wake >= 1, "wake lock requested");
  assert.equal(s.cues.filter((c) => c === "cueSwitch").length, 6);
  assert.ok(s.cues.filter((c) => c === "cueComplete").length >= 19, "GO at each work start + end chime");
  const panel = await p.$eval(".run-panel", (el) => el.textContent);
  assert.match(panel, /Routine complete/); assert.match(panel, /12\/12 moves/);
  await p.click('.run-panel [data-act="log"]');
  const st = await ls(p, KEYS.STATE);
  assert.deepEqual([st.history[0].type, st.history[0].lifts.length, st.mobility.active], ["mobility", 12, false]);
  assert.ok(st.history[0].durationSec >= 795, `duration ${st.history[0].durationSec}`);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("Pause / Resume freezes the countdown; ±15 s; 3-2-1 ticks; tapping the current move = done now", async () => {
  const app = await openMob();
  const p = app.page;
  await p.evaluate(() => startRoutine());
  await nextPhase(p); // work catcow 40
  await p.evaluate(() => window.__adv(10000));
  assert.equal((await phase(p)).left, 30);
  await p.click('[data-act="run-pause"]');
  await p.evaluate(() => window.__adv(120000));
  let ph = await phase(p);
  assert.deepEqual([ph.phase, ph.id, ph.left, ph.paused], ["work", "mob-catcow", 30, true]);
  assert.match(await p.$eval("[data-run-cap]", (el) => el.textContent), /Paused/);
  await p.click('[data-act="run-pause"]');
  await p.click('[data-act="run-adj"][data-d="15"]');
  assert.equal((await phase(p)).left, 45);
  await p.click('[data-act="run-adj"][data-d="-15"]');
  await p.evaluate(() => { window.__cue = []; window.__adv(27500); window.__adv(1000); window.__adv(1000); });
  assert.deepEqual(await p.evaluate(() => window.__cue.filter((c) => c === "cueCountdown").length), 3);
  await p.click('#ex-mob-catcow [data-act="set"]');
  ph = await phase(p);
  assert.deepEqual([ph.phase, ph.id], ["next", "mob-child"]);
  assert.equal(await p.evaluate(() => state.exercises[0].setsLog[0].ok), true);
  await app.close();
});

test("Skip move (+ optional quick reason) and Back (restart this move / redo the previous one)", async () => {
  const app = await openMob();
  const p = app.page;
  await p.evaluate(() => startRoutine());
  await nextPhase(p); // work catcow
  await nextPhase(p); // next child
  await nextPhase(p); // work child s1
  await p.click('[data-act="run-skip"]');
  let ph = await phase(p);
  assert.deepEqual([ph.phase, ph.id, ph.left], ["next", "mob-9090", 5]);
  assert.equal(await p.evaluate(() => state.exercises[1].skipped), true);
  await p.click('[data-act="run-why"][data-r="pain"]');
  assert.equal(await p.evaluate(() => state.exercises[1].skipReason), "pain");
  await nextPhase(p); // work 9090
  await p.evaluate(() => window.__adv(10000));
  await p.click('[data-act="run-back"]'); // > 3 s in → restart 9090
  ph = await phase(p);
  assert.deepEqual([ph.phase, ph.id, ph.left], ["next", "mob-9090", 5]);
  await nextPhase(p); // work 9090 again, early
  await p.click('[data-act="run-back"]'); // ≤ 3 s in → previous move (child) redone, unskipped
  ph = await phase(p);
  assert.deepEqual([ph.phase, ph.id], ["next", "mob-child"]);
  assert.deepEqual(await p.evaluate(() => [state.exercises[1].skipped, state.exercises[1].skipReason, state.exercises[1].setsLog[0]]), [false, null, { ok: false, miss: false }]);
  assert.equal(await p.evaluate(() => state.exercises[0].setsLog[0].ok), true, "earlier moves stay green");
  await app.close();
});

test("screen locked: one long jump catches up quietly with exact timing; Stop keeps the green moves", async () => {
  const app = await openMob();
  const p = app.page;
  await p.evaluate(() => startRoutine());
  await p.evaluate(() => { window.__cue = []; window.__adv(5000 + 40000 + 15000 + 30000 + 10000 + 5000); }); // mid child side 2
  const ph = await phase(p);
  assert.deepEqual([ph.phase, ph.id, ph.side, ph.left], ["work", "mob-child", 2, 25]);
  assert.equal(await p.evaluate(() => window.__cue.filter((c) => c !== "cueCountdown").length), 0, "no burst of catch-up cues");
  assert.deepEqual(await p.evaluate(() => [state.exercises[0].setsLog[0].ok, state.exercises[1].setsLog[0].half]), [true, true]);
  await p.click('[data-act="run-stop"]');
  assert.deepEqual(await p.evaluate(() => [ui.run, state.exercises[0].setsLog[0].ok, state.mobile]), [null, true, true]);
  assert.match(await p.$eval('[data-act="run-start"]', (el) => el.textContent), /Start routine/);
  await app.close();
});

test("Edit: work timer for rep moves (seconds), used by the routine; manual tap mode unchanged when not started", async () => {
  const app = await openMob();
  const p = app.page;
  await p.click('#ex-mob-catcow [data-act="edit-ex"]');
  assert.equal(await p.$eval('[data-edit-val="workSec"]', (el) => el.textContent), "40s");
  for (let i = 0; i < 4; i++) await p.click('[data-act="edit-step"][data-f="workSec"][data-d="1"]');
  await p.click('[data-act="edit-save"]');
  assert.deepEqual((await ls(p, KEYS.STATE)).exerciseEdits.anvil["mob-catcow"], { workSec: 60 });
  await p.click('#ex-mob-squat [data-act="edit-ex"]');
  assert.equal(await p.$('[data-f="workSec"]'), null, "timed moves use their seconds instead");
  await p.click('.edit-actions [data-act="edit-cancel"]');
  await p.click('#ex-mob-deadbug [data-act="edit-ex"]');
  assert.equal(await p.$eval('[data-edit-val="switchSec"]', (el) => el.textContent), "Off");
  await p.click('.edit-actions [data-act="edit-cancel"]');
  // manual: tap cat-cow → green at once, normal 15 s rest; no routine
  await p.click('#ex-mob-catcow [data-act="set"]');
  assert.deepEqual(await p.evaluate(() => [state.exercises[0].setsLog[0].ok, ui.run ?? null, ui.restMode]), [true, null, "rest"]);
  await p.evaluate(() => { resetChecks(); stopRest(); startRoutine(); });
  const ph = await nextPhase(p);
  assert.deepEqual([ph.phase, ph.id, ph.left], ["work", "mob-catcow", 60]);
  assert.deepEqual(app.errors, []);
  await app.close();
});
