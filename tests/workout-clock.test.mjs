// Background overall-workout clock (v47): starts at the first logged set, timestamp-based, saved on each session.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, openApp, closeBrowser, ls, reload, makeGas, sleep } from "./helpers.mjs";
import { KEYS, stewartState } from "./fixtures.mjs";

const CLOCK = "anvil_workout_clock_v1";
const MIN = 60000;
let srv, app;
before(async () => { srv = await startServer(); app = await openApp(srv.url); });
after(async () => { await app?.close(); srv?.server.close(); await closeBrowser(); });
beforeEach(async () => { await app.page.evaluate(() => { setProgram("anvil", 0); resetChecks(); stopRest(); state.history = []; save(); ui.panel = "none"; render(); }); });

const click = (sel) => app.page.$eval(sel, (b) => b.click());
const fillSession = (page) => page.evaluate(() => { state.exercises.forEach((ex, ei) => ex.setsLog.forEach((_, si) => { if (!state.exercises[ei].setsLog[si].ok) markSet(ei, si); })); });

test("no clock until the first rep-box tap; skips and −/+ don't start it; first tap stores startedAt", async () => {
  assert.equal(await ls(app.page, CLOCK), null);
  await click('[data-act="skip"][data-i="1"]');
  await click('[data-act="set-rep"][data-i="0"][data-s="0"][data-d="1"]');
  assert.equal(await ls(app.page, CLOCK), null, "skip / rep dial must not start the clock");
  const t0 = Date.now();
  await click('[data-act="set"][data-i="0"][data-s="0"]');
  const c1 = await ls(app.page, CLOCK);
  assert.ok(c1 && c1.startedAt >= t0 - 50 && c1.startedAt <= Date.now() + 50, "startedAt is a timestamp of the first set");
  await sleep(30);
  await click('[data-act="set"][data-i="0"][data-s="1"]');
  const c2 = await ls(app.page, CLOCK);
  assert.equal(c2.startedAt, c1.startedAt, "later sets keep the start");
  assert.ok(c2.lastSetAt > c1.lastSetAt, "later sets move lastSetAt");
});

test("header shows elapsed time next to the set count; survives a reload (timestamp-based)", async () => {
  assert.equal(await app.page.$("[data-wclock]"), null, "nothing shown before the first set");
  await app.page.evaluate((m) => { localStorage.setItem(K("anvil_workout_clock_v1"), JSON.stringify({ startedAt: Date.now() - 23 * m - 41000, lastSetAt: Date.now() - m })); render(); }, MIN);
  const txt = await app.page.$eval(".sub", (e) => e.textContent);
  assert.match(txt, /sets · 23:4[1-3]$/);
  await reload(app);
  await sleep(1100);
  assert.match(await app.page.$eval("[data-wclock]", (e) => e.textContent), /^23:4[2-4]$/, "keeps counting after reopen, ticks each second");
  await app.page.evaluate((m) => { localStorage.setItem(K("anvil_workout_clock_v1"), JSON.stringify({ startedAt: Date.now() - 62 * m - 5000, lastSetAt: Date.now() - m })); render(); }, MIN);
  assert.match(await app.page.$eval("[data-wclock]", (e) => e.textContent), /^1:02:0[5-7]$/);
});

test("Log session saves startedAt / endedAt / durationSec, clears the clock, and the Session log shows it", async () => {
  await fillSession(app.page);
  await app.page.evaluate((m) => { const c = JSON.parse(localStorage.getItem(K("anvil_workout_clock_v1"))); c.startedAt = Date.now() - 47 * m; localStorage.setItem(K("anvil_workout_clock_v1"), JSON.stringify(c)); }, MIN);
  await click('[data-act="log"]');
  const h = await app.page.evaluate(() => state.history[0]);
  assert.ok(Math.abs(h.durationSec - 47 * 60) <= 2, `durationSec ${h.durationSec}`);
  assert.equal(new Date(h.endedAt).getTime() - new Date(h.startedAt).getTime(), h.durationSec * 1000);
  assert.equal(await ls(app.page, CLOCK), null, "clock cleared after save");
  const saved = await ls(app.page, KEYS.STATE);
  assert.equal(saved.history[0].durationSec, h.durationSec, "persisted in anvil_app_v3");
  await app.page.evaluate(() => { ui.panel = "settings"; ui.settingsTab = "history"; render(); });
  assert.match(await app.page.$eval(".settings-detail", (e) => e.textContent), /47 min/);
  await app.page.evaluate(() => { ui.settingsTab = "progress"; render(); });
  assert.match(await app.page.$eval(".settings-detail", (e) => e.textContent), /Workout time\s*min\s*Last\s*47 min/);
  assert.equal(await app.page.$("[data-wclock]"), null, "header clock gone after logging");
});

test("a session left open 90+ min with no set activity ends at last set + 5 min", async () => {
  await fillSession(app.page);
  await app.page.evaluate((m) => { localStorage.setItem(K("anvil_workout_clock_v1"), JSON.stringify({ startedAt: Date.now() - 600 * m, lastSetAt: Date.now() - 540 * m })); render(); }, MIN);
  assert.match(await app.page.$eval("[data-wclock]", (e) => e.textContent), /^1:05:00$/, "frozen at last set + 5 min");
  await click('[data-act="log"]');
  const h = await app.page.evaluate(() => state.history[0]);
  assert.equal(h.durationSec, 65 * 60);
});

test("a set after a 90+ min gap starts a fresh clock; Reset clears it; old sessions without duration still list", async () => {
  await app.page.evaluate((m) => { localStorage.setItem(K("anvil_workout_clock_v1"), JSON.stringify({ startedAt: Date.now() - 600 * m, lastSetAt: Date.now() - 500 * m })); });
  const t0 = Date.now();
  await click('[data-act="set"][data-i="0"][data-s="0"]');
  assert.ok((await ls(app.page, CLOCK)).startedAt >= t0 - 50);
  await click('[data-act="reset"]');
  assert.equal(await ls(app.page, CLOCK), null);
  await app.page.evaluate(() => { state.history = [{ date: "2026-10-01T08:00:00.000Z", programId: "anvil", day: "A", notes: ["old"], lifts: [] }]; ui.panel = "settings"; ui.settingsTab = "history"; render(); });
  assert.match(await app.page.$eval(".settings-detail", (e) => e.textContent), /old/);
  assert.deepEqual(app.errors, []);
});

test("duration travels in the sync payload and the Sheet's Sessions tab gets duration_min", async () => {
  const gas = makeGas();
  const a = await openApp(srv.url, { gas, storage: { [KEYS.STATE]: stewartState({ dayIndex: 0 }), [KEYS.SYNC]: { name: "Stewart" } } });
  await fillSession(a.page);
  await a.page.evaluate((m) => { const c = JSON.parse(localStorage.getItem(K("anvil_workout_clock_v1"))); c.startedAt = Date.now() - 30 * m; localStorage.setItem(K("anvil_workout_clock_v1"), JSON.stringify(c)); }, MIN);
  await a.page.$eval('[data-act="log"]', (b) => b.click());
  await a.page.waitForFunction(() => true);
  for (let i = 0; i < 40 && !a.net.posts.length; i++) await sleep(100);
  const post = a.net.posts.at(-1);
  assert.ok(Math.abs(post.data.history[0].durationSec - 1800) <= 2);
  const rows = gas.sheetRows("Sessions");
  assert.equal(rows[0].at(-1), "duration_min");
  const newest = rows.filter((r) => r[1] === post.data.history[0].date);
  assert.ok(newest.length > 0);
  for (const r of newest) assert.equal(r[10], 30);
  const old = rows.filter((r) => r[1] !== post.data.history[0].date && r[0] !== "key");
  for (const r of old) assert.equal(r[10] ?? "", "", "older sessions without a duration stay blank");
  await a.close();
});

test("old backups without durations import; durations round-trip through Export → Import", async () => {
  const st = stewartState();
  st.history[0] = { ...st.history[0], startedAt: "2026-10-20T08:00:00.000Z", endedAt: "2026-10-20T08:52:00.000Z", durationSec: 3120 };
  const src = await openApp(srv.url, { storage: { [KEYS.STATE]: st } });
  await src.page.evaluate(() => exportBackup());
  await src.page.waitForFunction(() => window.__exports.length > 0);
  const text = await src.page.evaluate(() => window.__exports[0]);
  await src.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-"));
  const file = path.join(dir, "new.json"); fs.writeFileSync(file, text);
  const oldFile = path.join(dir, "old.json"); fs.writeFileSync(oldFile, JSON.stringify(stewartState()));
  for (const [f, want] of [[file, 3120], [oldFile, undefined]]) {
    const dst = await openApp(srv.url);
    const input = await dst.page.$("#import-file");
    await dst.page.evaluate(() => importBackup());
    await input.uploadFile(f);
    await dst.page.waitForFunction(() => state.history.length === 10, { timeout: 5000 });
    assert.equal(await dst.page.evaluate(() => state.history[0].durationSec), want);
    await dst.page.evaluate(() => { ui.panel = "settings"; ui.settingsTab = "history"; render(); });
    if (want) assert.match(await dst.page.$eval(".settings-detail", (e) => e.textContent), /52 min/);
    assert.deepEqual(dst.errors, []);
    await dst.close();
  }
});
