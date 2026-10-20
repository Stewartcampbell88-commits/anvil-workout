// Rest timer keeps real time (end timestamp), so a locked screen / backgrounded app doesn't stretch the rest.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser, sleep } from "./helpers.mjs";

let srv, app;
before(async () => {
  srv = await startServer();
  app = await openApp(srv.url);
  await app.page.evaluate(() => {
    const real = Date.now.bind(Date); window.__off = 0; Date.now = () => real() + window.__off;
    window.__cues = []; cueCountdown = (n) => window.__cues.push(n); cueComplete = () => window.__cues.push("GO");
  });
});
after(async () => { assert.deepEqual(app.errors, []); await app?.close(); srv?.server.close(); await closeBrowser(); });
beforeEach(async () => { await app.page.evaluate(() => { stopRest(); window.__off = 0; window.__cues = []; render(); }); });

const jump = (ms) => app.page.evaluate((ms) => { window.__off += ms; }, ms);
const st = () => app.page.evaluate(() => ({ remain: ui.remain, running: ui.running, go: ui.isGo, cues: window.__cues }));
// Timers are frozen while the screen is locked; on return the page becomes visible again.
const comeBack = () => app.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test("time spent with the screen locked counts: 90 s rest, 60 s away → ~30 s left on return", async () => {
  await app.page.evaluate(() => startRest(90));
  await jump(60000); await comeBack();
  const s = await st();
  assert.ok(s.remain <= 30 && s.remain >= 29, `remain ${s.remain}`);
  assert.equal(s.running, true);
  assert.deepEqual(s.cues, []);
});

test("overdue on return: GO fires once straight away, no stale 3-2-1, no repeat", async () => {
  await app.page.evaluate(() => startRest(30));
  await jump(45000); await comeBack();
  let s = await st();
  assert.equal(s.go, true); assert.equal(s.running, false); assert.equal(s.remain, 0);
  assert.deepEqual(s.cues, ["GO"]);
  await comeBack(); await sleep(1300);
  s = await st();
  assert.deepEqual(s.cues, ["GO"], "no double GO");
});

test("normal finish: 3, 2, 1, GO each exactly once", async () => {
  await app.page.evaluate(() => startRest(4));
  await sleep(4800);
  await comeBack();
  const s = await st();
  assert.deepEqual(s.cues, [3, 2, 1, "GO"]);
});

test("returning mid-countdown plays only the cue for the current second", async () => {
  await app.page.evaluate(() => startRest(20));
  await jump(17600); await comeBack(); await comeBack();
  const s = await st();
  assert.deepEqual(s.cues, [3]);
  assert.equal(s.remain, 3);
});

test("−15 / +15 move the end time while running", async () => {
  await app.page.evaluate(() => startRest(60));
  await jump(10000);
  await app.page.evaluate(() => adjustRest(15));
  let s = await st();
  assert.ok(s.remain >= 64 && s.remain <= 65, `remain ${s.remain}`);
  await app.page.evaluate(() => adjustRest(-15));
  await jump(20000); await comeBack();
  s = await st();
  assert.ok(s.remain >= 29 && s.remain <= 30, `remain ${s.remain}`);
});
