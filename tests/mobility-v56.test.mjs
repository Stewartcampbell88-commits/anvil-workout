// v56 Mobility: seated psoas lift over roller (move 5, after the hip flexor stretch, B/M/X) + pose pictures on
// 5 moves (cat-cow, hip flexor, figure-4, dead bug, wall slides). Other moves = text cues only, no <img>.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, openApp, closeBrowser, ls, ROOT } from "./helpers.mjs";
import { KEYS, stewartState } from "./fixtures.mjs";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv?.server.close(); await closeBrowser(); });
const dayA = (extra = {}) => stewartState({ dayIndex: 0, anvilXrdlV49: true, neckIsoV50: true, ...extra });
const PICS = ["catcow", "hipflex", "fig4", "deadbug", "wallslide"];

test("psoas move sits after the hip flexor stretch, each side with switch, own B / M / X", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  const r = await p.evaluate(() => {
    enterMobility();
    const i = state.exercises.findIndex((e) => e.id === "mob-psoas");
    const at = (l) => { const d = mobilityDef("mob-psoas", l); return [d.name, d.reps, workSecFor(d), runSides(d), switchSecFor(d)]; };
    return { i, prev: state.exercises[i - 1].id, b: at("B"), m: at("M"), x: at("X"), xNote: mobilityDef("mob-psoas", "X").note };
  });
  assert.deepEqual([r.i, r.prev], [4, "mob-hipflex"]);
  assert.deepEqual(r.b, ["Seated psoas lift (knee bent)", 8, 30, 2, 10]);
  assert.deepEqual(r.m, ["Seated psoas lift over roller", 10, 40, 2, 10]);
  assert.deepEqual(r.x, ["Seated psoas lift (straight leg, 2 s hold)", 8, 50, 2, 10]);
  assert.match(r.xNote, /hold 2 s/);
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("v55 saved levels + an in-progress 12-move list keep their moves (id-based); psoas joins at Medium", async () => {
  const twelve = ["catcow", "child", "9090", "hipflex", "bridge", "fig4", "deadbug", "wgs", "openbook", "ankle", "wallslide", "squat"]
    .map((id) => ({ id: "mob-" + id, reps: 1, sets: 1, mobLevel: id === "bridge" ? "X" : id === "fig4" ? "B" : "M", setsLog: [{ ok: id === "fig4", miss: false }] }));
  const st = dayA({ mobilityLevels: { "mob-bridge": "X", "mob-fig4": "B" }, mobility: { active: true, exercises: twelve } });
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: st } });
  const r = await app.page.evaluate(() => ({ mobile: state.mobile, n: state.exercises.length,
    lv: Object.fromEntries(state.exercises.map((e) => [e.id.slice(4), e.mobLevel])), fig4ok: state.exercises.find((e) => e.id === "mob-fig4").setsLog[0].ok,
    bridge: state.exercises[5].name }));
  assert.equal(r.mobile, true); assert.equal(r.n, 13);
  assert.equal(r.lv.bridge, "X"); assert.equal(r.lv.fig4, "B"); assert.equal(r.lv.psoas, "M"); assert.equal(r.lv.hipflex, "M");
  assert.equal(r.fig4ok, true, "progress on fig4 kept");
  assert.equal(r.bridge, "Single-leg glute bridge");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("pose pictures: 5 moves show one on the card (loads), all other moves have no <img>; running panel shows it", async () => {
  const app = await openApp(srv.url, { storage: { [KEYS.STATE]: dayA() } });
  const p = app.page;
  await p.evaluate(() => enterMobility());
  await p.evaluate(() => Promise.all([...document.querySelectorAll("img.mob-img")].map((i) => { i.loading = "eager"; return i.decode().catch(() => {}); })));
  const cards = await p.$$eval("article.card", (els) => els.map((el) => [el.id.slice(7), [...el.querySelectorAll("img")].map((i) => [i.getAttribute("src"), i.naturalWidth])]));
  for (const [id, imgs] of cards) {
    if (PICS.includes(id)) { assert.equal(imgs.length, 1, id); assert.equal(imgs[0][0], `img/mobility/${id}.webp`); assert.ok(imgs[0][1] > 0, `${id} picture loads`); }
    else assert.equal(imgs.length, 0, `${id}: text cues only`);
  }
  await p.evaluate(() => startRoutine());
  assert.equal(await p.$eval(".run-panel img.run-img", (i) => i.getAttribute("src")), "img/mobility/catcow.webp");
  await p.evaluate(() => { ui.run.ei = 1; render(); });
  assert.equal(await p.$(".run-panel img"), null, "child's pose: no picture yet");
  await p.evaluate(() => { ui.run.ei = 4; render(); });
  assert.equal(await p.$(".run-panel img"), null, "psoas: no picture yet");
  assert.deepEqual(app.errors, []);
  await app.close();
});

test("the 5 pictures are precached by sw.js, exist and are small webp", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  for (const id of PICS) {
    const f = path.join(ROOT, "img", "mobility", id + ".webp");
    assert.ok(sw.includes(`"./img/mobility/${id}.webp"`), id);
    const b = fs.readFileSync(f);
    assert.equal(b.subarray(8, 12).toString(), "WEBP"); assert.ok(b.length < 80000);
  }
});
