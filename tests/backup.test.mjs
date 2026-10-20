import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, openApp, closeBrowser, ls } from "./helpers.mjs";
import { KEYS, stewartState, walksFixture } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });

const pick = (s) => ({ programId: s.programId, dayIndex: s.dayIndex, history: s.history, liftProgress: s.liftProgress, bodyWeightLog: s.bodyWeightLog, soundVolume: s.soundVolume, cuePack: s.cuePack });

test("Export → Import round-trip is lossless (sessions, progress, body weight, walks, settings)", async () => {
  const src = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState(), [KEYS.WALKS]: walksFixture() } });
  await src.page.evaluate(() => exportBackup());
  await src.page.waitForFunction(() => window.__exports.length > 0);
  const text = await src.page.evaluate(() => window.__exports[0]);
  const before = await ls(src.page, KEYS.STATE);
  const beforeWalks = await ls(src.page, KEYS.WALKS);
  const exps = await src.page.evaluate(() => state.exercises.map((e) => [e.id, e.reps, e.weight, e.streak, e.levelIndex]));
  await src.close();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-")), "anvil-backup.json");
  fs.writeFileSync(file, text);

  // A different phone with other data imports it.
  const dst = await openApp(srv.url, { storage: { [KEYS.STATE]: { programId: "ember", dayIndex: 0, history: [], liftProgress: {}, bodyWeightLog: [] } } });
  const input = await dst.page.$("#import-file");
  const chooser = dst.page.evaluate(() => importBackup());
  await chooser;
  await input.uploadFile(file);
  await dst.page.waitForFunction(() => state.history.length === 10, { timeout: 5000 });
  const after = await ls(dst.page, KEYS.STATE);
  assert.deepEqual(pick(after), pick(before));
  assert.deepEqual(await ls(dst.page, KEYS.WALKS), beforeWalks, "walks travel with the backup");
  assert.deepEqual(await dst.page.evaluate(() => state.exercises.map((e) => [e.id, e.reps, e.weight, e.streak, e.levelIndex])), exps);
  assert.deepEqual(dst.errors, []);
  await dst.close();
});

test("Export never contains the trusted-phone token or sync settings", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState(), [KEYS.TOKENS]: { stewart: "11111111-2222-4333-8444-555555555555" }, [KEYS.SYNC]: { name: "Stewart", lastSync: "2026-10-19T00:00:00.000Z" } } });
  await app.page.evaluate(() => exportBackup());
  await app.page.waitForFunction(() => window.__exports.length > 0);
  const text = await app.page.evaluate(() => window.__exports[0]);
  assert.ok(!text.includes("11111111-2222"), "token leaked into export");
  assert.ok(!/lastSync|deviceToken/.test(text));
  await app.close();
});

test("Import rejects a file that isn't ANVIL data and leaves data alone", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState() } });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-")), "junk.json");
  fs.writeFileSync(file, JSON.stringify({ history: "nope" }));
  const input = await app.page.$("#import-file");
  await app.page.evaluate(() => importBackup());
  await input.uploadFile(file);
  await app.page.waitForFunction(() => /Invalid backup/.test(document.getElementById("toast").textContent));
  assert.equal((await ls(app.page, KEYS.STATE)).history.length, 10);
  await app.close();
});

test("Import of an old backup without walks keeps this phone's walks", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: stewartState(), [KEYS.WALKS]: walksFixture() } });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-")), "old.json");
  const old = stewartState(); delete old.anvilLayoutV38;
  fs.writeFileSync(file, JSON.stringify(old));
  const input = await app.page.$("#import-file");
  await app.page.evaluate(() => importBackup());
  await input.uploadFile(file);
  await app.page.waitForFunction(() => /Backup restored/.test(document.getElementById("toast").textContent));
  assert.equal((await ls(app.page, KEYS.WALKS)).length, 2);
  await app.close();
});
