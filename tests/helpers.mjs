// Shared test harness: static server for the repo, headless Chrome (puppeteer-core),
// and a mock of the Google Apps Script backend that runs the REAL backend/Code.gs in a vm.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SYNC_HOST = "script.google.com";
export const TEST_PIN = "2468"; // test-only PIN for the mock backend (never the real family PIN)

const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".css":"text/css", ".json":"application/json",
  ".png":"image/png", ".svg":"image/svg+xml", ".mp3":"audio/mpeg", ".webmanifest":"application/manifest+json" };

export function startServer(root = ROOT){
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

let browserP = null;
export function browser(){
  browserP ||= puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"],
  });
  return browserP;
}
export async function closeBrowser(){ if (browserP) { const b = await browserP; browserP = null; await b.close(); } }

/* ---------------- Apps Script mock (runs backend/Code.gs) ---------------- */
export function codeGsPath(){
  return process.env.ANVIL_CODE_GS || path.join(ROOT, "backend", "Code.gs");
}
function makeSheet(name){
  const rows = []; // rows[r][c], 0-based
  const sh = {
    name, rows, hidden: [],
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    setFrozenRows(){}, hideColumns(c){ sh.hidden.push(c); },
    getRange(r, c, nr = 1, nc = 1){
      const rng = {
        getValues(){ const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = rows[r - 1 + i]?.[c - 1 + j]; row.push(v === undefined ? "" : v); } out.push(row); } return out; },
        setValues(vals){ for (let i = 0; i < nr; i++) { rows[r - 1 + i] ||= []; for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = vals[i][j]; } return rng; },
        setValue(v){ rows[r - 1] ||= []; rows[r - 1][c - 1] = v; return rng; },
        setFontWeight(){ return rng; }, setNumberFormat(){ return rng; },
      };
      return rng;
    },
  };
  return sh;
}
export function makeGas({ pin = TEST_PIN, enrolUntil = null } = {}){
  const props = new Map();
  if (pin) props.set("FAMILY_PIN_SHA256", crypto.createHash("sha256").update(pin).digest("hex"));
  if (enrolUntil) props.set("ENROL_UNTIL", enrolUntil);
  const cache = new Map();
  const sheets = new Map();
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name),
    getId: () => "mock-sheet",
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.has(k) ? props.get(k) : null, setProperty: (k, v) => { props.set(k, String(v)); }, deleteProperty: (k) => props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.has(k) ? cache.get(k) : null, put: (k, v) => { cache.set(k, String(v)); }, remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (alg, s) => [...crypto.createHash(alg).update(String(s), "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType(){ return this; }, getContent: () => s }) },
    Logger: { log(){} },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codeGsPath(), "utf8"), ctx, { filename: "Code.gs" });
  const api = {
    ctx, props, cache, sheets, ss,
    calls: [],
    get(params){ return JSON.parse(ctx.doGet({ parameter: params }).getContent()); },
    post(body){ const s = typeof body === "string" ? body : JSON.stringify(body); return JSON.parse(ctx.doPost({ postData: { contents: s } }).getContent()); },
    sheetRows(name){ const s = sheets.get(name); return s ? s.rows : []; },
  };
  return api;
}

/* ---------------- app page ---------------- */
/**
 * Open the app in a fresh incognito context.
 * opts.storage: {key: value(object|string)} seeded into localStorage before any app script runs (first load only).
 * opts.gas: makeGas() instance answering the sync/restore URL. Without it, sync calls get a network error.
 * opts.sw: keep the service worker (default: disabled so tests are deterministic).
 */
export async function openApp(baseUrl, opts = {}){
  const b = await browser();
  const context = await b.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  page.on("dialog", (d) => { (opts.onDialog ? opts.onDialog(d) : d.accept()); });
  const seed = {};
  for (const [k, v] of Object.entries(opts.storage || {})) seed[k] = typeof v === "string" ? v : JSON.stringify(v);
  await page.evaluateOnNewDocument((seed, keepSw) => {
    if (!keepSw) { try { delete Navigator.prototype.serviceWorker; } catch {} }
    try {
      if (!sessionStorage.getItem("__seeded")) {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        sessionStorage.setItem("__seeded", "1");
      }
    } catch {}
    // Capture exports instead of downloading.
    window.__exports = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { blob.text().then((t) => window.__exports.push(t)); return orig(blob); };
  }, seed, !!opts.sw);
  const gas = opts.gas;
  const net = { posts: [], gets: [] };
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const u = new URL(req.url());
    if (u.hostname !== SYNC_HOST) { req.continue(); return; }
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (!gas) { req.abort("internetdisconnected"); return; }
    try {
      let out;
      if (req.method() === "POST") { const body = req.postData() || ""; net.posts.push(JSON.parse(body)); out = gas.post(body); }
      else { const params = Object.fromEntries(u.searchParams); net.gets.push(params); out = gas.get(params); }
      req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(out) });
    } catch (e) { req.respond({ status: 500, headers: cors, body: String(e) }); }
  });
  await page.goto(baseUrl + (opts.path || ""), { waitUntil: "load" });
  await page.waitForFunction(() => !!document.querySelector("#app header"), { timeout: 10000 });
  return { page, context, errors, net, gas, async close(){ await context.close(); } };
}

export async function reload(app){
  await app.page.reload({ waitUntil: "load" });
  await app.page.waitForFunction(() => !!document.querySelector("#app header"), { timeout: 10000 });
}
export const ls = (page, key) => page.evaluate((k) => { const v = localStorage.getItem(k); try { return JSON.parse(v); } catch { return v; } }, key);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A realistic logged session entry (history[] item, newest-first array). */
export function sessionEntry(date, lifts, extra = {}){
  return { date, programId: "anvil", day: "A", notes: ["note"], lifts, ...extra };
}
