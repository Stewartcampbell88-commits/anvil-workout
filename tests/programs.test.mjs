import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, openApp, closeBrowser } from "./helpers.mjs";

let srv, app;
before(async () => { srv = await startServer(); app = await openApp(srv.url); });
after(async () => { await app?.close(); srv?.server.close(); await closeBrowser(); });

const days = (pid) => app.page.evaluate((pid) => getProgram(pid).days.map((d) => ({ label: d.label, ids: d.exercises.map((e) => e.id), names: d.exercises.map((e) => e.name) })), pid);

test("ANVIL Day A / Day B lists (Back extension (twist) then Neck isometric extra on both)", async () => {
  const d = await days("anvil");
  assert.deepEqual(d.map((x) => x.label), ["A", "B"]);
  assert.deepEqual(d[0].ids, ["squat", "bench", "row", "xrdl", "cossack", "sgm", "bext", "neck"]);
  assert.deepEqual(d[1].ids, ["rdl", "ohp", "lunge", "psoas", "lmr", "heaves", "bext", "neck"]);
  assert.equal(d[0].names[6], "Back extension (twist)");
  assert.equal(d[1].names[6], "Back extension (twist)");
});

test("EMBER Day A / Day B lists", async () => {
  const d = await days("ember");
  assert.deepEqual(d[0].ids, ["em-squat", "em-bench", "em-row", "em-deadbug", "em-neck"]);
  assert.deepEqual(d[1].ids, ["em-rdl", "em-press", "em-heaves", "em-plank", "em-neck"]);
});

test("TITAN Day A / Day B lists", async () => {
  const d = await days("titan");
  assert.deepEqual(d[0].ids, ["tp-squat", "tp-bench", "tp-row", "tp-deadbug"]);
  assert.deepEqual(d[1].ids, ["tp-rdl", "tp-press", "tp-lunge", "tp-heaves", "tp-plank"]);
});

test("Back extension (twist) is a bodyweight finisher with 0 kg and no AMRAP", async () => {
  const r = await app.page.evaluate(() => getProgram("anvil").days.map((d) => { const e = d.exercises.find((x) => x.id === "bext"); return { bw: e.bw, finisher: e.finisher, weight: e.weight, amrap: usesAmrap(e) }; }));
  for (const e of r) assert.deepEqual(e, { bw: true, finisher: true, weight: 0, amrap: false });
});

test("fresh install opens ANVIL Day A and renders every lift card with no page errors", async () => {
  const ids = await app.page.$$eval("article.card", (els) => els.map((e) => e.id));
  assert.deepEqual(ids, ["ex-squat", "ex-bench", "ex-row", "ex-xrdl", "ex-cossack", "ex-sgm", "ex-bext", "ex-neck"]);
  assert.deepEqual(app.errors, []);
});

test("switching program/day in the UI shows that day's lifts", async () => {
  for (const [pid, day, first] of [["ember", 1, "em-rdl"], ["titan", 0, "tp-squat"], ["titan", 1, "tp-rdl"], ["anvil", 1, "rdl"]]) {
    await app.page.evaluate((pid, day) => { setProgram(pid, 0); setDay(day); }, pid, day);
    const id = await app.page.$eval("article.card", (e) => e.id);
    assert.equal(id, "ex-" + first, `${pid} day ${day}`);
  }
  assert.deepEqual(app.errors, []);
});
