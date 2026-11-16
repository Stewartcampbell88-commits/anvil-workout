// v62: balance chain allowance — a lift may run up to CHAIN_ALLOWANCE_KG (40) over its capping lift.
// Over the cap → reminder on the card every session + in the post-log popup; past cap + 40 → held as before.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser } from "./helpers.mjs";

let srv, app;
before(async () => { srv = await startServer(); app = await openApp(srv.url); });
after(async () => { assert.deepEqual(app.errors, []); await app?.close(); srv?.server.close(); await closeBrowser(); });

function sess({ pid = "anvil", day = 0, id, patch = {}, reps, progress = {}, rom }){
  return app.page.evaluate(({ pid, day, id, patch, reps, progress, rom }) => {
    state.history = []; state.programId = pid; state.dayIndex = day;
    state.liftProgress = { ...captureProgress(seedProgram(pid, day)), ...progress };
    state.exercises = applyProgress(seedProgram(pid, day), state.liftProgress, pid).map((e) => e.id === id ? { ...e, ...patch } : e);
    state.liftProgress = captureProgress(state.exercises, state.liftProgress);
    const ex = state.exercises.find((e) => e.id === id);
    ex.setsLog = ex.setsLog.map(() => ({ ok: true, miss: false, reps: reps ?? ex.reps }));
    ui.pendingHolds = null; ui.pendingAhead = null;
    const asks = logSession({ dry: true });
    const notes = logSession(rom ? { rom } : undefined);
    const o = state.exercises.find((e) => e.id === id);
    return { weight: o.weight, reps: o.reps, streak: o.streak, notes, asks, holds: ui.pendingHolds, ahead: ui.pendingAhead };
  }, { pid, day, id, patch, reps, progress, rom });
}

test("single constant: CHAIN_ALLOWANCE_KG = 40", async () => {
  assert.equal(await app.page.evaluate(() => CHAIN_ALLOWANCE_KG), 40);
});

test("row can go past bench (cap) and keeps progressing up to bench + 40", async () => {
  // row 40 → 42.5 over bench 40: allowed, reminder in the popup list
  let o = await sess({ id: "row", patch: { reps: 12, weight: 40, streak: 2 }, progress: { bench: { reps: 8, weight: 40 }, squat: { reps: 8, weight: 100 } } });
  assert.deepEqual([o.weight, o.reps, o.streak], [42.5, 6, 0]);
  assert.equal(o.holds, null);
  assert.equal(o.ahead.length, 1);
  assert.deepEqual([o.ahead[0].ceilingName, o.ahead[0].gap, o.ahead[0].limit], ["Bench Press", 2.5, 80]);
  assert.ok(o.notes.some((n) => /Ahead of Bench Press by 2\.5 kg — Bench Press is holding this back/.test(n)));
  // further over (77.5 → 80 = exactly cap + 40): still allowed
  o = await sess({ id: "row", patch: { reps: 12, weight: 77.5, streak: 2 }, progress: { bench: { reps: 8, weight: 40 }, squat: { reps: 8, weight: 100 } } });
  assert.equal(o.weight, 80); assert.equal(o.holds, null); assert.equal(o.ahead[0].gap, 40);
  // past the limit: held, streak parked, same wording
  o = await sess({ id: "row", patch: { reps: 12, weight: 80, streak: 2 }, progress: { bench: { reps: 8, weight: 40 }, squat: { reps: 8, weight: 100 } } });
  assert.deepEqual([o.weight, o.reps, o.streak], [80, 12, 3]);
  assert.equal(o.holds[0].ceilingId, "bench"); assert.equal(o.holds[0].limit, 80);
  assert.ok(o.notes.some((n) => /held for balance.*Bench Press is holding this back/.test(n)));
  assert.equal(o.ahead, null);
});

test("other programs too: EMBER press over row, TITAN row over bench; AMRAP bump within allowance", async () => {
  let o = await sess({ pid: "ember", day: 1, id: "em-press", patch: { reps: 12, weight: 5, streak: 2 }, progress: { "em-row": { reps: 8, weight: 5 } } });
  assert.equal(o.weight, 7.5); assert.equal(o.ahead[0].ceilingId, "em-row");
  o = await sess({ pid: "titan", id: "tp-row", patch: { reps: 12, weight: 2.5, streak: 2 }, progress: { "tp-bench": { reps: 8, weight: 2.5, levelIndex: 0 }, "tp-squat": { reps: 8, weight: 0 } } });
  assert.equal(o.weight, 5); assert.equal(o.ahead[0].ceilingId, "tp-bench");
  o = await sess({ id: "bench", patch: { reps: 8, weight: 60, streak: 0 }, reps: 10, progress: { squat: { reps: 8, weight: 60 } } });
  assert.equal(o.weight, 62.5, "AMRAP +2.5 kg past squat allowed"); assert.equal(o.ahead[0].ceilingId, "squat");
});

test("ROM comes first: within the allowance the ROM question is asked; No keeps the kg and no chain reminder fires", async () => {
  const o = await sess({ id: "row", patch: { reps: 12, weight: 40, streak: 2 }, progress: { bench: { reps: 8, weight: 40 }, squat: { reps: 8, weight: 100 } }, rom: { row: false } });
  assert.deepEqual(o.asks.map((a) => a.id), ["row"]);
  assert.equal(o.weight, 40); assert.equal(o.ahead, null);
  // Past the limit: no ROM question (it can't move)
  const h = await sess({ id: "row", patch: { reps: 12, weight: 80, streak: 2 }, progress: { bench: { reps: 8, weight: 40 }, squat: { reps: 8, weight: 100 } } });
  assert.deepEqual(h.asks, []);
});

test("card reminder shows every session while ahead; gone when level; popup order ROM → chain → body weight", async () => {
  const card = await app.page.evaluate(() => {
    setProgram("anvil", 0);
    state.exercises = state.exercises.map((e) => e.id === "bench" ? { ...e, weight: 60 } : e.id === "row" ? { ...e, weight: 67.5 } : e);
    state.liftProgress = captureProgress(state.exercises, state.liftProgress);
    setDay(0); render();
    return document.querySelector("#ex-row [data-chain-ahead]")?.textContent;
  });
  assert.match(card, /Ahead of Bench Press by 7\.5 kg — Bench Press is holding this back/);
  const none = await app.page.evaluate(() => { state.exercises = state.exercises.map((e) => e.id === "row" ? { ...e, weight: 60 } : e); render(); return document.querySelector("#ex-row [data-chain-ahead]"); });
  assert.equal(none, null);
  // Full flow: row 60 @ 12 → bump to 62.5 over bench 60
  await app.page.evaluate(() => {
    state.exercises = state.exercises.map((e) => e.id === "row" ? { ...e, reps: 12, weight: 60, streak: 2, setsLog: e.setsLog.map(() => ({ ok: true, miss: false, reps: 12 })) } : e);
    state.liftProgress = { ...state.liftProgress, squat: { reps: 8, weight: 100, streak: 0, failStreak: 0 } };
    render(); onLog();
  });
  assert.equal(await app.page.evaluate(() => ui.panel), "rom-ask");
  await app.page.click('[data-act="rom-yes"]');
  assert.equal(await app.page.evaluate(() => ui.panel), "balance-hold");
  const txt = await app.page.$$eval("[data-chain-line]", (els) => els.map((e) => e.textContent).join(" | "));
  assert.match(txt, /Bent over row → 62\.5 kg — ahead of Bench Press by 2\.5 kg\. Bench Press is holding this back/);
  assert.match(await app.page.evaluate(() => document.querySelector('[aria-label="Ahead of the chain"] h2').textContent), /Ahead of the chain/);
  await app.page.click('[data-act="dismiss-hold"]');
  assert.equal(await app.page.evaluate(() => ui.panel), "bodyweight");
  // Next session the card still reminds (row 62.5 vs bench 60)
  const again = await app.page.evaluate(() => { ui.panel = "none"; setDay(0); render(); return document.querySelector("#ex-row [data-chain-ahead]")?.textContent; });
  assert.match(again, /Ahead of Bench Press by 2\.5 kg/);
});
