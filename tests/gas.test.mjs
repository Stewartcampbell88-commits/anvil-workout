// Unit tests for the Apps Script backend (backend/Code.gs) against an in-memory Sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGas, TEST_PIN } from "./helpers.mjs";
import { anvilHistory, walksFixture, bwFixture } from "./fixtures.mjs";

const payload = (name, n = 10, extra = {}) => ({ name, appVersion: "test", syncedAt: "2026-10-19T09:00:00.000Z", data: { programId: "anvil", history: anvilHistory(n), walks: walksFixture(), bodyWeightLog: bwFixture(), ...extra } });

test("health check", () => { assert.deepEqual(makeGas().get({}), { ok: true, service: "anvil-sheet-sync" }); });

test("sync writes Raw + Sessions/Bodyweight/Walks and de-duplicates a re-sync", () => {
  const g = makeGas();
  const r1 = g.post(payload("Stewart"));
  assert.equal(r1.ok, true);
  assert.ok(r1.added.sessions > 0);
  const r2 = g.post(payload("Stewart"));
  assert.deepEqual({ s: r2.added.sessions, b: r2.added.bodyweight, w: r2.added.walks }, { s: 0, b: 0, w: 0 });
  assert.equal(g.sheetRows("Raw").length, 2, "one Raw row per person");
});

test("unknown names and bad JSON are rejected", () => {
  const g = makeGas();
  assert.equal(g.post({ name: "Eve", data: {} }).error, "unknown name");
  assert.equal(g.post("{nope").error, "bad json");
});

test("restore needs the PIN; right PIN returns the full log + a device token", () => {
  const g = makeGas(); g.post(payload("Stewart"));
  assert.equal(g.get({ action: "restore", name: "Stewart" }).error, "pin required");
  const r = g.get({ action: "restore", name: "Stewart", pin: TEST_PIN });
  assert.equal(r.ok, true);
  assert.equal(r.data.history.length, 10);
  assert.match(r.deviceToken, /^[0-9a-f-]{36}$/);
  const t = g.get({ action: "restore", name: "Stewart", token: r.deviceToken });
  assert.equal(t.ok, true); assert.equal(t.deviceToken, undefined);
  assert.ok(!JSON.stringify([...g.props.values()]).includes(r.deviceToken), "only the token hash is stored");
});

test("5 wrong PINs lock restore; a token for another person doesn't work", () => {
  const g = makeGas(); g.post(payload("Stewart")); g.post(payload("Alexis"));
  const tok = g.get({ action: "restore", name: "Alexis", pin: TEST_PIN }).deviceToken;
  assert.equal(g.get({ action: "restore", name: "Stewart", token: tok }).error, "bad token");
  for (let i = 0; i < 3; i++) assert.equal(g.get({ action: "restore", name: "Stewart", pin: "0000" }).error, "wrong pin");
  assert.equal(g.get({ action: "restore", name: "Stewart", pin: "0000" }).error, "locked, try later");
  assert.equal(g.get({ action: "restore", name: "Stewart", pin: TEST_PIN }).error, "locked, try later");
});

test("enrolment: sync issues a token only while ENROL_UNTIL is in the future", () => {
  const open = makeGas({ enrolUntil: new Date(Date.now() + 86400000).toISOString() }); 
  const r = open.post({ ...payload("Marcus"), wantToken: true });
  assert.match(r.deviceToken, /^[0-9a-f-]{36}$/);
  assert.equal(open.post({ ...payload("Marcus"), wantToken: true, deviceToken: r.deviceToken }).deviceToken, undefined);
  const shut = makeGas({ enrolUntil: new Date(Date.now() - 1000).toISOString() });
  assert.equal(shut.post({ ...payload("Marcus"), wantToken: true }).deviceToken, undefined);
});

test("large logs are split across Raw cells and read back intact", () => {
  const g = makeGas();
  const big = payload("Stewart", 400);
  g.post(big);
  const raw = g.sheetRows("Raw")[1];
  assert.ok(raw[4] > 1, "multiple parts");
  const r = g.get({ action: "restore", name: "Stewart", pin: TEST_PIN });
  assert.deepEqual(r.data.history, big.data.history);
});

test("a smaller log never silently destroys the previous cloud copy (kept in RawArchive)", () => {
  const g = makeGas();
  g.post(payload("Stewart", 10));
  g.post(payload("Stewart", 1)); // e.g. a new phone that skipped Restore and logged one session
  const arch = g.sheetRows("RawArchive");
  assert.ok(arch.length >= 2, "archive row written");
  const row = arch[arch.length - 1];
  const body = row.slice(5).join("");
  assert.equal(JSON.parse(body).data.history.length, 10);
  // A normal growing sync doesn't archive.
  const g2 = makeGas(); g2.post(payload("Stewart", 10)); g2.post(payload("Stewart", 11));
  assert.equal(g2.sheetRows("RawArchive").length, 0);
});

test("a log from a different program under the same name is archived first", () => {
  const g = makeGas();
  g.post(payload("Alexis", 6, { programId: "ember" }));
  g.post(payload("Alexis", 8, { programId: "anvil" }));
  assert.ok(g.sheetRows("RawArchive").length >= 2);
});
