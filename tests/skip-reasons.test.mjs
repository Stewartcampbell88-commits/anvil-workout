// Skip → "why?" sheet (v48): 10 reasons, Other + note, Cancel aborts; reason saved on the session.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, openApp, closeBrowser, ls, reload } from "./helpers.mjs";
import { KEYS } from "./fixtures.mjs";

const LABELS = ["Injury", "Pain or discomfort", "Fatigue", "Time constraint", "Equipment unavailable", "Load too heavy",
  "Technique breakdown", "Trained elsewhere", "Illness", "Other (add note)"];
let srv, app;
before(async () => { srv = await startServer(); app = await openApp(srv.url); });
after(async () => { assert.deepEqual(app.errors, []); await app?.close(); srv?.server.close(); await closeBrowser(); });
beforeEach(async () => { await app.page.evaluate(() => { setProgram("anvil", 0); resetChecks(); stopRest(); state.history = []; save(); ui.panel = "none"; ui.skipAsk = null; render(); }); });

const click = (sel) => app.page.$eval(sel, (b) => b.click());
const sheetLabels = () => app.page.$$eval(".skip-why-list [data-act=skip-why]", (bs) => bs.map((b) => b.textContent.replace(/^\d+/, "").trim()));
const doFirstLift = () => app.page.evaluate(() => { state.exercises[0].setsLog = state.exercises[0].setsLog.map(() => ({ ok: true, miss: false, reps: state.exercises[0].reps })); save(); });

test("Skip opens the why sheet with exactly the 10 reasons in order; lift is not skipped yet", async () => {
  await click('[data-act="skip"][data-i="1"]');
  assert.deepEqual(await sheetLabels(), LABELS);
  assert.equal(await app.page.evaluate(() => state.exercises[1].skipped), false);
  assert.ok(await app.page.$("[data-act=skip-cancel].skip-why-cancel"), "Cancel button");
  const big = await app.page.$$eval(".skip-why-list [data-act=skip-why]", (bs) => bs.every((b) => b.getBoundingClientRect().height >= 44));
  assert.ok(big, "tap targets ≥ 44px");
});

test("Cancel aborts the skip", async () => {
  await click('[data-act="skip"][data-i="1"]');
  await click(".skip-why-cancel");
  const r = await app.page.evaluate(() => ({ skipped: state.exercises[1].skipped, panel: ui.panel, sheet: !!document.querySelector(".skip-why-list") }));
  assert.deepEqual(r, { skipped: false, panel: "none", sheet: false });
});

test("picking a reason skips the lift, shows it on the card, persists, and Unskip clears it without asking", async () => {
  await click('[data-act="skip"][data-i="1"]');
  await click('[data-act="skip-why"][data-r="time"]');
  let ex = await app.page.evaluate(() => state.exercises[1]);
  assert.equal(ex.skipped, true); assert.equal(ex.skipReason, "time"); assert.equal(ex.skipNote, undefined);
  assert.match(await app.page.$eval("#ex-" + ex.id, (c) => c.textContent), /Skipped: Time constraint/);
  await reload(app);
  ex = await app.page.evaluate(() => state.exercises[1]);
  assert.equal(ex.skipReason, "time", "survives reload");
  await click('[data-act="skip"][data-i="1"]'); // Unskip
  ex = await app.page.evaluate(() => state.exercises[1]);
  assert.equal(ex.skipped, false); assert.equal(ex.skipReason, undefined);
  assert.equal(await app.page.$(".skip-why-list"), null, "no sheet on unskip");
});

test("Other shows a note field; note is saved (trimmed, capped) with the skip", async () => {
  await click('[data-act="skip"][data-i="2"]');
  assert.equal(await app.page.$("[data-skip-note]"), null);
  await click('.skip-why-list [data-act="skip-why"][data-r="other"]');
  assert.ok(await app.page.$("[data-skip-note]"), "note field visible");
  assert.equal(await app.page.evaluate(() => state.exercises[2].skipped), false, "not skipped until saved");
  await app.page.type("[data-skip-note]", "  knee   niggle ");
  await click(".skip-why-save");
  const ex = await app.page.evaluate(() => state.exercises[2]);
  assert.deepEqual([ex.skipped, ex.skipReason, ex.skipNote], [true, "other", "knee niggle"]);
});

test("logged session stores skips + readable note; progression identical to a plain skip", async () => {
  const plain = await app.page.evaluate(() => {
    window.__snap = JSON.stringify({ ex: state.exercises, lp: state.liftProgress });
    state.exercises[0].setsLog = state.exercises[0].setsLog.map(() => ({ ok: true, miss: false, reps: state.exercises[0].reps }));
    skipExercise(1); logSession();
    return { ex: state.exercises.map((e) => [e.id, e.reps, e.weight, e.streak, e.failStreak]), prog: state.liftProgress, lifts: state.history[0].lifts };
  });
  await app.page.evaluate(() => { const s = JSON.parse(window.__snap); state.exercises = s.ex; state.liftProgress = s.lp; state.history = []; save(); render(); });
  await doFirstLift();
  await click('[data-act="skip"][data-i="1"]');
  await click('[data-act="skip-why"][data-r="equipment"]');
  const r = await app.page.evaluate(() => {
    logSession();
    return { ex: state.exercises.map((e) => [e.id, e.reps, e.weight, e.streak, e.failStreak]), prog: state.liftProgress, lifts: state.history[0].lifts, h: state.history[0],
      leftover: state.exercises.some((e) => "skipReason" in e || "skipNote" in e) };
  });
  assert.deepEqual(r.ex, plain.ex); assert.deepEqual(r.prog, plain.prog);
  assert.deepEqual(r.lifts.map((l) => l.id), plain.lifts.map((l) => l.id));
  const name = r.h.skips[0].name;
  assert.deepEqual(r.h.skips, [{ id: r.ex[1][0], name, reason: "equipment", reasonText: "Equipment unavailable" }]);
  assert.ok(r.h.notes.includes(`${name}: Skipped: Equipment unavailable`));
  assert.equal(r.leftover, false, "reason cleared for next session");
  // Session log shows it
  await app.page.evaluate(() => { ui.panel = "settings"; ui.settingsTab = "history"; render(); });
  assert.match(await app.page.$eval(".settings-detail", (d) => d.textContent), /Skipped: Equipment unavailable/);
});

test("old data / plain skip (no reason) still works; bad reason ids are ignored", async () => {
  const r = await app.page.evaluate(() => {
    skipExercise(1); const a = { ...state.exercises[1] }; skipExercise(1);
    skipExercise(2, "nonsense", "x"); const b = { ...state.exercises[2] };
    const h = hydrate([{ ...state.exercises[3], skipped: true, skipReason: "bogus" }, { ...state.exercises[4], skipped: false, skipReason: "time" }]);
    return { a: [a.skipped, a.skipReason ?? null], b: [b.skipped, b.skipReason ?? null, b.skipNote ?? null], h: h.map((e) => e.skipReason ?? null) };
  });
  assert.deepEqual(r.a, [true, null]);
  assert.deepEqual(r.b, [true, null, null]);
  assert.deepEqual(r.h, [null, null]);
});

test("skip reasons travel in Export → Import and in the sync payload", async () => {
  await doFirstLift();
  await app.page.evaluate(() => { skipExercise(1, "other", "school camp"); logSession(); });
  const want = await app.page.evaluate(() => state.history[0].skips);
  assert.equal(want[0].note, "school camp");
  assert.deepEqual(await app.page.evaluate(() => syncPayload().data.history[0].skips), want);
  await app.page.evaluate(() => { window.__exports = []; exportBackup(); });
  await app.page.waitForFunction(() => window.__exports.length > 0);
  const text = await app.page.evaluate(() => window.__exports[0]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-")), "b.json"); fs.writeFileSync(file, text);
  const dst = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "ember", dayIndex: 0, history: [], liftProgress: {}, bodyWeightLog: [] } } });
  const input = await dst.page.$("#import-file");
  await dst.page.evaluate(() => importBackup());
  await input.uploadFile(file);
  await dst.page.waitForFunction(() => state.history.length === 1, { timeout: 5000 });
  assert.deepEqual((await ls(dst.page, KEYS.STATE)).history[0].skips, want);
  assert.deepEqual(dst.errors, []);
  await dst.close();
});
