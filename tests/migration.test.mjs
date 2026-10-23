import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, ls } from "./helpers.mjs";
import { KEYS, anvilHistory } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

// Old (pre-v38) ANVIL save: abd instead of Cossack, old order, odd reps, kg on Back extension,
// no layout / cue flags, old 0.7 default volume, old history entries without `sets` or `day`.
const oldHistory = () => anvilHistory(6).map((h) => ({ date: h.date, notes: h.notes, lifts: h.lifts.map(({ sets, amrapReps, ...l }) => l) }));
const oldAnvil = () => ({
  programId: "anvil", dayIndex: 0,
  exercises: [
    { id: "squat", name: "Squat", sets: 3, reps: 7, rest: 120, weight: 60, block: "Day A", streak: 1, failStreak: 0, setsLog: [{ ok: true, miss: false }, { ok: false, miss: false }, { ok: false, miss: false }] },
    { id: "bench", name: "Bench Press", sets: 3, reps: 8, rest: 120, weight: 50, block: "Day A", streak: 0, failStreak: 0 },
    { id: "abd", name: "Side-lying abduction", sets: 3, reps: 12, rest: 45, weight: 0, bw: true, block: "Day A" },
    { id: "bext", name: "Back extension", sets: 3, reps: 10, rest: 75, weight: 5, bw: true, cap: 14, block: "Day A" },
    { id: "row", name: "Bent over row", sets: 3, reps: 8, rest: 90, weight: 40, block: "Day A" },
    { id: "curl", name: "Dumbbell curl", sets: 3, reps: 10, rest: 60, weight: 10, block: "Add-on" },
  ],
  history: oldHistory(),
  liftProgress: { squat: { reps: 7, weight: 60, streak: 1, failStreak: 0 }, bext: { reps: 10, weight: 5, streak: 0, failStreak: 0 }, rdl: { reps: 9, weight: 80, streak: 0, failStreak: 0 } },
  soundVolume: 0.7, cuePack: "coach",
});

test("old ANVIL save migrates: history kept byte-for-byte, Cossack replaces abd, v38 order, odd reps snapped, bext kg cleared", async () => {
  const raw = oldAnvil();
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: raw } });
  const s = await ls(app.page, KEYS.STATE);
  assert.deepEqual(s.history, raw.history, "history untouched");
  assert.deepEqual(s.exercises.map((e) => e.id), ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "curl"]);
  const by = Object.fromEntries(s.exercises.map((e) => [e.id, e]));
  assert.equal(by.squat.reps, 8);
  assert.equal(by.squat.weight, 60);
  assert.equal(by.squat.setsLog[0].ok, true, "in-progress set kept");
  assert.equal(by.bext.weight, 0); assert.equal(by.bext.finisher, true); assert.equal(by.bext.name, "Back extension (twist)");
  assert.equal(s.liftProgress.bext.weight, 0);
  assert.equal(s.liftProgress.rdl.reps, 10, "progress reps snapped up to the wave");
  assert.equal(s.soundVolume, 1); assert.equal(s.loudCuesV33, true); assert.equal(s.anvilLayoutV38, true);
  assert.equal(s.cuePack, "coach");
  assert.deepEqual(app.errors, []);
  // Old history renders in Progress + Session log without errors.
  await app.page.evaluate(() => { ui.panel = "settings"; ui.settingsTab = "progress"; render(); ui.settingsTab = "history"; render(); });
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("old EMBER feet-assist heaves progress (no levelIndex) lands on stage 1", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "ember", dayIndex: 1, exercises: [], history: [], liftProgress: { "em-heaves": { reps: 8, weight: 0, streak: 1, failStreak: 0 } } } } });
  const ex = await app.page.evaluate(() => state.exercises.find((e) => e.id === "em-heaves"));
  assert.equal(ex.levelIndex, 1); assert.equal(ex.name, "Heaves (feet assisted)"); assert.equal(ex.reps, 8);
  await app.close();
});

test("old one-day TITAN save is reseeded to A/B but keeps progress for matching lifts", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "titan", dayIndex: 0, exercises: [{ id: "tp-old", name: "Old lift", sets: 3, reps: 8 }], history: anvilHistory(2), liftProgress: { "tp-squat": { reps: 10, weight: 5, streak: 1, failStreak: 0 } } } } });
  const r = await app.page.evaluate(() => ({ ids: state.exercises.map((e) => e.id), sq: state.exercises[0], h: state.history.length }));
  assert.deepEqual(r.ids, ["tp-squat", "tp-bench", "tp-row", "tp-deadbug"]);
  assert.equal(r.sq.reps, 10); assert.equal(r.sq.weight, 5); assert.equal(r.h, 2);
  await app.close();
});

test("v39 GitHub token is dropped from sync settings; other sync settings kept", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "anvil", history: anvilHistory(1) }, [KEYS.SYNC]: { name: "Stewart", token: "ghp_old", lastSync: "2026-10-18T00:00:00.000Z" } } });
  const cfg = await ls(app.page, KEYS.SYNC);
  assert.equal(cfg.token, undefined); assert.equal(cfg.name, "Stewart"); assert.equal(cfg.lastSync, "2026-10-18T00:00:00.000Z");
  await app.close();
});

test("junk walk entries are ignored, good ones kept", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.WALKS]: [{ date: "2026-10-01", durationSec: 600, distanceKm: 1 }, null, { date: 5 }, { durationSec: 3 }] } });
  assert.equal(await app.page.evaluate(() => walks.length), 1);
  await app.close();
});

test("storage keys are unchanged", async () => {
  const app = await openApp(srv.url);
  const k = await app.page.evaluate(() => ({ STORAGE, WALK_STORAGE, SYNC_KEY, SYNC_TOKEN_KEY, RESTORE_OFFER_KEY }));
  assert.deepEqual(k, { STORAGE: KEYS.STATE, WALK_STORAGE: KEYS.WALKS, SYNC_KEY: KEYS.SYNC, SYNC_TOKEN_KEY: KEYS.TOKENS, RESTORE_OFFER_KEY: KEYS.OFFERED });
  await app.close();
});
