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
  const body = row.slice(6).join("");
  assert.equal(JSON.parse(body).data.history.length, 10);
  // A normal growing sync doesn't archive.
  const g2 = makeGas(); g2.post(payload("Stewart", 10)); g2.post(payload("Stewart", 11));
  assert.equal(g2.sheetRows("RawArchive").length, 0);
  // Restore still returns the latest copy; the archive is for manual recovery.
  assert.equal(g.get({ action: "restore", name: "Stewart", pin: TEST_PIN }).data.history.length, 1);
});

test("RawArchive is bounded", () => {
  const g = makeGas();
  for (let i = 0; i < 70; i++) { g.post(payload("Stewart", 3)); g.post(payload("Stewart", 2)); }
  assert.equal(g.sheetRows("RawArchive").length - 1, 60);
});

test("a log from a different program under the same name is archived first", () => {
  const g = makeGas();
  g.post(payload("Alexis", 6, { programId: "ember" }));
  g.post(payload("Alexis", 8, { programId: "anvil" }));
  assert.ok(g.sheetRows("RawArchive").length >= 2);
});

test("Sessions tab: duration_min appended at the end; old 10-column tabs/rows/clients keep working", () => {
  const g = makeGas();
  // An existing Sheet made by the old script: 10-column header + an old row.
  const sh = g.ss.insertSheet("Sessions");
  sh.rows.push(["key", "date", "person", "program", "day", "exercise", "weight_kg", "target_reps", "reps_per_set", "result"]);
  const hist = anvilHistory(2);
  hist[0].durationSec = 2730; // 45.5 min
  sh.rows.push([["Stewart", hist[1].date, "squat"].join("|"), hist[1].date, "Stewart", "ANVIL", "A", "Squat", 60, 8, "8, 8, 9", "ok"]);
  const r = g.post({ name: "Stewart", data: { programId: "anvil", history: hist } });
  assert.equal(r.ok, true);
  const rows = g.sheetRows("Sessions");
  assert.equal(rows[0][10], "duration_min");
  const fresh = rows.filter((x) => x[1] === hist[0].date);
  assert.ok(fresh.length >= 2);
  for (const x of fresh) { assert.equal(x.length, 11); assert.equal(x[10], 45.5); }
  assert.equal(rows[1][10] ?? "", "", "old row without a duration untouched");
  // An old client (no durationSec) still writes rows, with a blank duration.
  const g2 = makeGas(); g2.post(payload("Alexis", 2));
  assert.deepEqual(g2.sheetRows("Sessions")[0].slice(-1), ["duration_min"]);
  assert.equal(g2.sheetRows("Sessions")[1][10], "");
  // A later sync with a duration for an already-written session fills the blank (e.g. synced before the redeploy).
  const h3 = anvilHistory(1); g2.post({ name: "Marcus", data: { programId: "titan", history: h3 } });
  h3[0].durationSec = 1800; g2.post({ name: "Marcus", data: { programId: "titan", history: h3 } });
  for (const x of g2.sheetRows("Sessions").filter((x) => x[2] === "Marcus")) assert.equal(x[10], 30);
});

/* ---------- reps_per_set must stay text (Sheets turned "8, 8, 8" into 2008-08-08) ---------- */

const REPS_COL = 8; // 0-based index of reps_per_set in Sessions
const expectedReps = (hist, person) => {
  const m = {};
  for (const s of hist) s.lifts.forEach((l, i) => { m[[person, s.date, l.id || l.name || i].join("|")] = l.sets.map((x) => x.reps).join(", "); });
  return m;
};

test("Sessions: new reps_per_set cells are written as plain text, never auto-converted to dates", () => {
  const g = makeGas();
  const p = payload("Stewart", 4);
  g.post(p);
  const sh = g.sheets.get("Sessions");
  const want = expectedReps(p.data.history, "Stewart");
  const rows = g.sheetRows("Sessions").slice(1);
  assert.ok(rows.length > 0);
  rows.forEach((x, i) => {
    assert.equal(typeof x[REPS_COL], "string", "row " + (i + 2) + " is text, not " + x[REPS_COL]);
    assert.equal(x[REPS_COL], want[x[0]]);
    assert.equal(sh.fmtAt(i + 2, REPS_COL + 1), "@", "reps_per_set cell formatted as plain text");
    assert.equal(sh.fmtAt(i + 2, 1), "@", "key cell formatted as plain text");
  });
  // Bodyweight/Walks dedupe keys are plain text too.
  for (const t of ["Bodyweight", "Walks"]) {
    const s = g.sheets.get(t);
    for (let r = 2; r <= s.getLastRow(); r++) { assert.equal(s.fmtAt(r, 1), "@"); assert.equal(typeof s.rows[r - 1][0], "string"); }
  }
});

test("Sessions: reps_per_set cells already turned into dates are repaired from Raw on the next sync (idempotent, no rows lost)", () => {
  const g = makeGas();
  const ps = payload("Stewart", 4), pa = payload("Alexis", 3, { programId: "ember" });
  g.post(ps); g.post(pa);
  const rows = g.sheetRows("Sessions");
  const before = rows.length;
  // Simulate the cells the old script left behind: Dates, a bare number, and a formula-ish junk value.
  rows[1][REPS_COL] = new Date(Date.UTC(2008, 7, 8));
  rows[2][REPS_COL] = new Date(Date.UTC(2012, 9, 10));
  rows[3][REPS_COL] = 888;
  const alexisRow = rows.findIndex((x) => x[2] === "Alexis");
  rows[alexisRow][REPS_COL] = new Date(Date.UTC(2010, 9, 10));
  const keyOther = rows[5][0];
  // Next sync from ONE person repairs everyone's rows (source of truth = each person's Raw JSON).
  const r = g.post(ps);
  assert.equal(r.ok, true);
  assert.equal(r.added.sessions, 0);
  assert.equal(r.added.repaired, 4);
  const want = { ...expectedReps(ps.data.history, "Stewart"), ...expectedReps(pa.data.history, "Alexis") };
  const after = g.sheetRows("Sessions");
  assert.equal(after.length, before, "no rows added or deleted");
  assert.equal(after[5][0], keyOther, "row order unchanged");
  const sh = g.sheets.get("Sessions");
  after.slice(1).forEach((x, i) => {
    assert.equal(x[REPS_COL], want[x[0]], "row " + (i + 2));
    assert.equal(sh.fmtAt(i + 2, REPS_COL + 1), "@");
  });
  // Idempotent: nothing left to fix.
  assert.equal(g.post(ps).added.repaired, 0);
  assert.deepEqual(g.sheetRows("Sessions"), after);
});

test("repairRepsColumn() can be run by hand from the editor; rows with no Raw source are left alone", () => {
  const g = makeGas();
  g.post(payload("Marcus", 2, { programId: "titan" }));
  const sh = g.sheets.get("Sessions");
  sh.rows.push(["Ghost|2026-01-01|squat", "2026-01-01", "Ghost", "ANVIL", "A", "Squat", 60, 8, new Date(Date.UTC(2008, 7, 8)), "ok", ""]);
  g.sheetRows("Sessions")[1][REPS_COL] = new Date(Date.UTC(2008, 7, 8));
  assert.equal(typeof g.ctx.repairRepsColumn, "function");
  const n = g.ctx.repairRepsColumn();
  assert.equal(n, 1);
  const rows = g.sheetRows("Sessions");
  assert.equal(typeof rows[1][REPS_COL], "string");
  assert.ok(rows[rows.length - 1][REPS_COL] instanceof Date, "unknown key untouched (no source of truth)");
  assert.equal(g.ctx.repairRepsColumn(), 0);
});
