/**
 * ANVIL Sheet Sync — Google Apps Script web app.
 *
 * Receives each phone's full ANVIL/EMBER/TITAN log (POST, text/plain JSON) and writes:
 *   Raw        one row per person, latest full JSON (split across cells if > 45k chars)
 *   Sessions   one row per lift per session (deduped); duration_min (last column, v47+) is that
 *              whole workout's length, repeated on each lift row; blank for older sessions/clients
 *   Bodyweight one row per weigh-in (deduped, latest kg wins)
 *   Walks      one row per walk (deduped)
 *   RawArchive the previous Raw copy, kept whenever a sync would shrink the log (fewer sessions,
 *              walks or weigh-ins) or switch program under the same name — so a new phone that
 *              skipped Restore, or a phone synced under the wrong name, can't silently destroy
 *              the only full cloud copy. Newest ARCHIVE_MAX rows kept.
 *
 * GET  ?action=restore&name=Stewart|Alexis|Marcus&pin=NNNN   → {ok, name, syncedAt, appVersion, data, deviceToken} (Restore from cloud)
 * GET  ?action=restore&name=...&token=<device token>          → same, no PIN needed (trusted phone; no new token)
 * GET  ?action=forget&name=...&token=<device token>           → {ok, removed} (drops that one trusted-phone token)
 * GET  (no action)                                            → health check
 *
 * Trusted phones (device tokens) — so the family's own phones restore without typing the PIN:
 *   A device token is a random UUID held only by that phone (localStorage). The script keeps
 *   only its SHA-256, in Script Property DEVICE_TOKENS_<NAME> (JSON list, newest last, max 10).
 *   Tokens are issued (reply field deviceToken):
 *     - on a successful restore with the right family PIN (a new phone needs the PIN once), and
 *     - on a sync POST that asks for one (wantToken:true, sends no valid token, has real data),
 *       ONLY while Script Property ENROL_UNTIL (ISO date, e.g. 2026-10-27T23:59:59+10:00) is in
 *       the future. After that, only PIN-restore issues tokens. Unset/invalid → no enrolment.
 *   A wrong token on restore counts toward the same 5-tries/10-min lockout as a wrong PIN.
 *
 * Family PIN (restore only; sync POST stays PIN-free and write-only):
 *   The PIN itself is never stored here. Put its SHA-256 (lowercase hex) in
 *   Project Settings → Script Properties → key FAMILY_PIN_SHA256.
 *   Get the hex on the box with:  ANVIL_FAMILY_PIN=1234 ./pin-hash.sh   (or any sha256 of the digits, no newline)
 *   Missing property → {ok:false,error:"pin not set"}; wrong PIN → "wrong pin";
 *   5 wrong tries for one name within 10 min → "locked, try later" (CacheService).
 *
 * Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Security note: there is no login from the phones. The /exec URL is long and unguessable,
 * and only the names below are accepted; anyone who learns the URL could still post a log
 * under one of these names, but reading a log back (?action=restore) needs the family PIN
 * or a trusted-phone token (enrolment window or a previous PIN restore).
 * Re-deploying with a new deployment gives a new URL if it leaks.
 */

const ALLOWED = { stewart: "Stewart", alexis: "Alexis", marcus: "Marcus" };
const MAX_BYTES = 2 * 1024 * 1024;   // reject bodies over 2 MB
const CHUNK = 45000;                 // Sheets cell limit is 50,000 chars
const SHEET_NAME = "ANVIL Logs";
const PROGRAM_NAMES = { anvil: "ANVIL", ember: "EMBER", titan: "TITAN" };
const PIN_PROP = "FAMILY_PIN_SHA256";
const PIN_MAX_FAILS = 5;             // wrong tries per name ...
const PIN_WINDOW_S = 600;            // ... within 10 minutes → locked
const TOKEN_PROP_PREFIX = "DEVICE_TOKENS_"; // + STEWART / ALEXIS / MARCUS
const ENROL_PROP = "ENROL_UNTIL";
const TOKENS_MAX = 10;               // per name; oldest dropped
const ARCHIVE_MAX = 60;              // RawArchive rows kept (all names), oldest dropped

const TABS = {
  Raw:        ["person", "updatedAt", "appVersion", "chars", "parts", "json_1"],
  RawArchive: ["person", "archivedAt", "updatedAt", "appVersion", "chars", "parts", "json_1"],
  Sessions:   ["key", "date", "person", "program", "day", "exercise", "weight_kg", "target_reps", "reps_per_set", "result", "duration_min"],
  Bodyweight: ["key", "date", "person", "kg"],
  Walks:      ["key", "date", "person", "minutes", "km"],
};

function doGet(e) {
  const q = (e && e.parameter) || {};
  const action = String(q.action || "").trim().toLowerCase();
  if (!action) return json_({ ok: true, service: "anvil-sheet-sync" });
  if (action !== "restore" && action !== "forget") return json_({ ok: false, error: "unknown action" });
  try {
    const person = ALLOWED[String(q.name || "").trim().toLowerCase()];
    if (!person) return json_({ ok: false, error: "unknown name" });
    if (action === "forget") return json_({ ok: true, removed: withLock_(function () { return removeToken_(person, q.token); }) });
    const gate = checkAccess_(person, q.pin, q.token);
    if (gate.error) return json_(gate.error);
    const out = readRaw_(book_(), person);
    if (gate.via === "pin") out.deviceToken = withLock_(function () { return issueToken_(person); });
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = e && e.postData && e.postData.contents;
    if (!body) return json_({ ok: false, error: "empty body" });
    if (body.length > MAX_BYTES) return json_({ ok: false, error: "too large" });

    let p;
    try { p = JSON.parse(body); } catch (err) { return json_({ ok: false, error: "bad json" }); }
    const slug = String((p && p.name) || "").trim().toLowerCase();
    const person = ALLOWED[slug];
    if (!person) return json_({ ok: false, error: "unknown name" });
    const data = (p.data && typeof p.data === "object") ? p.data : {};

    lock.waitLock(20000);
    const ss = book_();
    const res = {
      raw: writeRaw_(ss, person, p, body),
      sessions: writeSessions_(ss, person, data),
      bodyweight: writeBodyweight_(ss, person, data),
      walks: writeWalks_(ss, person, data),
    };
    const reply = { ok: true, person: person, added: res };
    // One-time enrolment of the family's existing phones (see header).
    if (p.wantToken === true && enrolOpen_() && hasRealData_(data) && !tokenValid_(person, p.deviceToken)) {
      reply.deviceToken = issueToken_(person);
    }
    return json_(reply);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ---------- family PIN + trusted-phone tokens ---------- */

/**
 * Restore gate. Returns {via:"token"|"pin"} or {error:{ok:false,error:...}}.
 * A valid token wins; else a PIN is checked; a bad token with no PIN counts as a failed try.
 */
function checkAccess_(person, pinParam, tokenParam) {
  const cache = CacheService.getScriptCache();
  const key = "pinfail:" + person.toLowerCase();
  const fails = Number(cache.get(key)) || 0;
  if (fails >= PIN_MAX_FAILS) return { error: { ok: false, error: "locked, try later" } };
  const token = String(tokenParam == null ? "" : tokenParam).trim();
  const pin = String(pinParam == null ? "" : pinParam).trim();
  if (token && tokenValid_(person, token)) { cache.remove(key); return { via: "token" }; }
  if (pin) { const e = checkPin_(person, pin); return e ? { error: e } : { via: "pin" }; }
  if (token) {
    const n = fails + 1;
    cache.put(key, String(n), PIN_WINDOW_S);
    return { error: { ok: false, error: n >= PIN_MAX_FAILS ? "locked, try later" : "bad token" } };
  }
  const want = String(PropertiesService.getScriptProperties().getProperty(PIN_PROP) || "").trim();
  return { error: { ok: false, error: /^[0-9a-fA-F]{64}$/.test(want) ? "pin required" : "pin not set" } };
}

function tokenProp_(person) { return TOKEN_PROP_PREFIX + person.toUpperCase(); }

function tokenList_(person) {
  try {
    const v = JSON.parse(PropertiesService.getScriptProperties().getProperty(tokenProp_(person)) || "[]");
    return Array.isArray(v) ? v.filter(function (x) { return x && typeof x.h === "string"; }) : [];
  } catch (e) { return []; }
}

function tokenValid_(person, token) {
  const t = String(token == null ? "" : token).trim();
  if (!/^[0-9a-fA-F-]{32,64}$/.test(t)) return false;
  const h = sha256Hex_(t.toLowerCase());
  let ok = false;
  tokenList_(person).forEach(function (x) { if (safeEq_(x.h, h)) ok = true; });
  return ok;
}

/** New random token for this phone; stores only its hash. Returns the token (sent once, to that phone). */
function issueToken_(person) {
  const t = Utilities.getUuid().toLowerCase();
  const list = tokenList_(person);
  list.push({ h: sha256Hex_(t), at: new Date().toISOString() });
  while (list.length > TOKENS_MAX) list.shift();
  PropertiesService.getScriptProperties().setProperty(tokenProp_(person), JSON.stringify(list));
  return t;
}

function removeToken_(person, token) {
  if (!tokenValid_(person, token)) return false;
  const h = sha256Hex_(String(token).trim().toLowerCase());
  const list = tokenList_(person).filter(function (x) { return !safeEq_(x.h, h); });
  PropertiesService.getScriptProperties().setProperty(tokenProp_(person), JSON.stringify(list));
  return true;
}

function enrolOpen_() {
  const v = String(PropertiesService.getScriptProperties().getProperty(ENROL_PROP) || "").trim();
  const until = v ? new Date(v).getTime() : NaN;
  return isFinite(until) && Date.now() < until;
}

function hasRealData_(data) {
  return (Array.isArray(data.history) && data.history.length > 0) ||
         (Array.isArray(data.walks) && data.walks.length > 0) ||
         (Array.isArray(data.bodyWeightLog) && data.bodyWeightLog.length > 0);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}

/** Returns null when the PIN is right, otherwise the error reply. */
function checkPin_(person, pinParam) {
  const want = String(PropertiesService.getScriptProperties().getProperty(PIN_PROP) || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return { ok: false, error: "pin not set" };
  const cache = CacheService.getScriptCache();
  const key = "pinfail:" + person.toLowerCase();
  const fails = Number(cache.get(key)) || 0;
  if (fails >= PIN_MAX_FAILS) return { ok: false, error: "locked, try later" };
  const pin = String(pinParam == null ? "" : pinParam).trim();
  if (!pin) return { ok: false, error: "pin required" };
  if (/^\d{4,6}$/.test(pin) && safeEq_(sha256Hex_(pin), want)) {
    cache.remove(key);
    return null;
  }
  const n = fails + 1;
  cache.put(key, String(n), PIN_WINDOW_S);
  return { ok: false, error: n >= PIN_MAX_FAILS ? "locked, try later" : "wrong pin" };
}

function sha256Hex_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = (b + 256) % 256; return (v < 16 ? "0" : "") + v.toString(16); }).join("");
}

function safeEq_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- spreadsheet ---------- */

function book_() {
  // 1) Script created from inside a Sheet (Extensions → Apps Script): use that Sheet.
  try { const a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; } catch (e) {}
  // 2) Standalone script: reuse the Sheet it created before, or create one.
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("SHEET_ID");
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const ss = SpreadsheetApp.create(SHEET_NAME);
  props.setProperty("SHEET_ID", ss.getId());
  return ss;
}

function tab_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight("bold");
    sh.setFrozenRows(1);
    if (name !== "Raw" && name !== "RawArchive") sh.hideColumns(1); // dedupe key column
    const blank = ss.getSheetByName("Sheet1");
    if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  }
  return sh;
}

function keyIndex_(sh) {
  const n = sh.getLastRow() - 1;
  const map = {};
  if (n <= 0) return map;
  const keys = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < keys.length; i++) map[String(keys[i][0])] = i + 2;
  return map;
}

function append_(sh, rows) {
  if (!rows.length) return 0;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}

/* ---------- tabs ---------- */

function writeRaw_(ss, person, p, body) {
  const sh = tab_(ss, "Raw");
  const parts = splitBody_(body);
  const row = [person, String(p.syncedAt || new Date().toISOString()), String(p.appVersion || ""), body.length, parts.length].concat(parts);
  // header grows if more chunks are needed
  const width = Math.max(sh.getLastColumn(), row.length);
  if (sh.getLastColumn() < row.length) {
    const hdr = [];
    for (let c = 6; c <= row.length; c++) hdr.push("json_" + (c - 5));
    sh.getRange(1, 6, 1, hdr.length).setValues([hdr]).setFontWeight("bold");
  }
  while (row.length < width) row.push("");
  const n = sh.getLastRow() - 1;
  let at = 0;
  if (n > 0) {
    const names = sh.getRange(2, 1, n, 1).getValues();
    for (let i = 0; i < names.length; i++) if (names[i][0] === person) { at = i + 2; break; }
  }
  if (at) archiveIfShrinking_(ss, sh, at, p);
  if (!at) at = sh.getLastRow() + 1;
  const rng = sh.getRange(at, 1, 1, row.length);
  rng.setNumberFormat("@"); // plain text: no date/number/formula conversion of JSON chunks
  rng.setValues([row]);
  return parts.length;
}

/** Count the list sizes in a log's data (missing → 0). */
function logSizes_(data) {
  const d = (data && typeof data === "object") ? data : {};
  const n = function (k) { return Array.isArray(d[k]) ? d[k].length : 0; };
  return { history: n("history"), walks: n("walks"), bodyWeightLog: n("bodyWeightLog"), programId: String(d.programId || "") };
}

/** Before Raw row `at` is overwritten: copy it to RawArchive if the incoming log is smaller or another program. */
function archiveIfShrinking_(ss, sh, at, incoming) {
  const head = sh.getRange(at, 1, 1, 5).getValues()[0];
  const parts = Math.max(1, Number(head[4]) || 1);
  const cells = sh.getRange(at, 6, 1, parts).getValues()[0].map(function (c) { return c == null ? "" : String(c); });
  const body = cells.join("");
  if (!body) return false;
  let old = null;
  try { old = JSON.parse(body); } catch (e) { old = null; }
  const a = logSizes_(old && old.data), b = logSizes_(incoming && incoming.data);
  const shrinks = !old || b.history < a.history || b.walks < a.walks || b.bodyWeightLog < a.bodyWeightLog ||
                  (a.programId && b.programId && a.programId !== b.programId);
  if (!shrinks) return false;
  const arch = tab_(ss, "RawArchive");
  const row = [head[0], new Date().toISOString(), String(head[1] || ""), String(head[2] || ""), body.length, cells.length].concat(cells);
  if (arch.getLastColumn() < row.length) {
    const hdr = [];
    for (let c = 7; c <= row.length; c++) hdr.push("json_" + (c - 6));
    arch.getRange(1, 7, 1, hdr.length).setValues([hdr]).setFontWeight("bold");
  }
  const rng = arch.getRange(arch.getLastRow() + 1, 1, 1, row.length);
  rng.setNumberFormat("@");
  rng.setValues([row]);
  while (arch.getLastRow() - 1 > ARCHIVE_MAX) arch.deleteRow(2);
  return true;
}

/** Split the JSON into <= CHUNK pieces; never start a piece with a char Sheets might reinterpret. */
function splitBody_(body) {
  const parts = [];
  let i = 0;
  while (i < body.length) {
    let end = Math.min(i + CHUNK, body.length);
    while (end < body.length && end > i + 1 && /^[=+\-@'\s]/.test(body.charAt(end))) end--;
    parts.push(body.slice(i, end));
    i = end;
  }
  return parts;
}

/** Latest full log for one person, reassembled from the Raw tab. */
function readRaw_(ss, person) {
  const sh = ss.getSheetByName("Raw");
  if (!sh || sh.getLastRow() < 2) return { ok: false, error: "no backup", name: person };
  const n = sh.getLastRow() - 1;
  const names = sh.getRange(2, 1, n, 1).getValues();
  let at = 0;
  for (let i = 0; i < names.length; i++) if (names[i][0] === person) { at = i + 2; break; }
  if (!at) return { ok: false, error: "no backup", name: person };
  const head = sh.getRange(at, 1, 1, 5).getValues()[0];
  const parts = Math.max(1, Number(head[4]) || 1);
  const cells = sh.getRange(at, 6, 1, parts).getValues()[0];
  const body = cells.map(function (c) { return c == null ? "" : String(c); }).join("");
  let p;
  try { p = JSON.parse(body); } catch (err) { return { ok: false, error: "backup unreadable", name: person }; }
  const cellDate = head[1] instanceof Date ? head[1].toISOString() : String(head[1] || "");
  return {
    ok: true,
    name: person,
    syncedAt: String((p && p.syncedAt) || cellDate),
    appVersion: String((p && p.appVersion) || head[2] || ""),
    data: (p && p.data && typeof p.data === "object") ? p.data : {},
  };
}

/** Workout length in minutes (1 decimal) from a session's durationSec; "" when missing (older app versions). */
function durMin_(s) { const v = Number(s && s.durationSec); return (isFinite(v) && v > 0) ? Math.round(v / 6) / 10 : ""; }

function writeSessions_(ss, person, data) {
  const sh = tab_(ss, "Sessions");
  const DUR_COL = TABS.Sessions.length; // 11: appended at the end so old rows/columns keep their places
  // A Sheet made by the pre-v47 script has a 10-column header: add the new heading once.
  if (String(sh.getRange(1, DUR_COL).getValues()[0][0] || "") !== "duration_min") {
    sh.getRange(1, DUR_COL).setValue("duration_min");
  }
  const have = keyIndex_(sh);
  const n = sh.getLastRow() - 1;
  const durCells = n > 0 ? sh.getRange(2, DUR_COL, n, 1).getValues() : [];
  const rows = [];
  const hist = Array.isArray(data.history) ? data.history : [];
  hist.forEach(function (s) {
    if (!s || !s.date || !Array.isArray(s.lifts)) return;
    const program = PROGRAM_NAMES[s.programId] || String(s.programId || PROGRAM_NAMES[data.programId] || "");
    const dur = durMin_(s);
    s.lifts.forEach(function (l, idx) {
      if (!l) return;
      const key = [person, s.date, l.id || l.name || idx].join("|");
      if (have[key] > 0) { // already written: only fill a blank duration (e.g. row written before this column existed)
        const cell = durCells[have[key] - 2];
        if (dur !== "" && cell && (cell[0] === "" || cell[0] == null)) { sh.getRange(have[key], DUR_COL).setValue(dur); cell[0] = dur; }
        return;
      }
      if (have[key]) return;
      have[key] = -1;
      const sets = Array.isArray(l.sets) ? l.sets : null;
      const repsPerSet = sets ? sets.map(function (x) { return (x && x.reps != null) ? x.reps : ""; }).join(", ")
                              : (l.amrapReps != null ? "last set " + l.amrapReps : "");
      let result = l.clean ? "ok" : "miss";
      if (sets && sets.some(function (x) { return !x || (!x.ok && !x.miss); })) result = "incomplete";
      rows.push([key, s.date, person, program, s.day || "", l.name || l.id || "",
                 num_(l.weight), num_(l.reps), repsPerSet, result, dur]);
    });
  });
  rows.sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
  return append_(sh, rows);
}

function writeBodyweight_(ss, person, data) {
  const sh = tab_(ss, "Bodyweight");
  const have = keyIndex_(sh);
  const rows = [];
  const log = Array.isArray(data.bodyWeightLog) ? data.bodyWeightLog : [];
  log.forEach(function (b) {
    if (!b || !b.date || typeof b.kg !== "number") return;
    const key = [person, b.date].join("|");
    if (have[key] > 0) { sh.getRange(have[key], 4).setValue(b.kg); return; }
    if (have[key]) return;
    have[key] = -1;
    rows.push([key, b.date, person, b.kg]);
  });
  rows.reverse(); // app stores newest first
  return append_(sh, rows);
}

function writeWalks_(ss, person, data) {
  const sh = tab_(ss, "Walks");
  const have = keyIndex_(sh);
  const rows = [];
  const walks = Array.isArray(data.walks) ? data.walks : [];
  walks.forEach(function (w) {
    if (!w || !(w.startedAt || w.date)) return;
    const key = [person, w.startedAt || w.date].join("|");
    if (have[key]) return;
    have[key] = -1;
    rows.push([key, w.date || w.startedAt, person,
               Math.round((Number(w.durationSec) || 0) / 6) / 10,
               Math.round((Number(w.distanceKm) || 0) * 100) / 100]);
  });
  rows.reverse();
  return append_(sh, rows);
}

/* ---------- utils ---------- */

function num_(v) { const n = Number(v); return isFinite(n) ? n : ""; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor (▶ testPost) to check the Sheet fills in before deploying. */
function testPost() {
  const sample = {
    name: "Stewart", appVersion: "test", syncedAt: new Date().toISOString(),
    data: {
      programId: "anvil",
      history: [{ date: "2026-10-19T08:00:00.000Z", programId: "anvil", day: "Day A", durationSec: 2820,
        lifts: [{ id: "squat", name: "Squat", weight: 60, reps: 8, clean: true,
                  sets: [{ ok: true, reps: 8 }, { ok: true, reps: 8 }, { ok: true, reps: 9 }] }] }],
      bodyWeightLog: [{ date: "2026-10-19", kg: 85.2 }],
      walks: [{ date: "2026-10-19T07:00:00.000Z", startedAt: "2026-10-19T06:30:00.000Z", durationSec: 1800, distanceKm: 2.4 }],
    },
  };
  const out = doPost({ postData: { contents: JSON.stringify(sample) } });
  Logger.log(out.getContent());
}

/** Run from the editor (▶ testPinSetup) to check FAMILY_PIN_SHA256 is set (never logs the value). */
function testPinSetup() {
  const v = String(PropertiesService.getScriptProperties().getProperty(PIN_PROP) || "").trim().toLowerCase();
  Logger.log(/^[0-9a-f]{64}$/.test(v) ? PIN_PROP + " is set (64 hex chars)" : PIN_PROP + " missing or not a 64-char hex SHA-256");
}

/** Run from the editor (▶ testRestoreNoPin): should log {"ok":false,"error":"pin required"} (or "pin not set"). */
function testRestoreNoPin() {
  Logger.log(doGet({ parameter: { action: "restore", name: "Stewart" } }).getContent().slice(0, 500));
}

/** Run from the editor (▶ testEnrolSetup): shows enrolment window + trusted-phone counts (never logs tokens/hashes). */
function testEnrolSetup() {
  const v = String(PropertiesService.getScriptProperties().getProperty(ENROL_PROP) || "").trim();
  const t = v ? new Date(v).getTime() : NaN;
  Logger.log(!v ? ENROL_PROP + " not set → sync never issues tokens (PIN-restore still does)"
    : !isFinite(t) ? ENROL_PROP + " is not a valid date: use e.g. 2026-10-27T23:59:59+10:00"
    : ENROL_PROP + " = " + new Date(t).toISOString() + (enrolOpen_() ? " (OPEN: syncing phones get a token)" : " (closed)"));
  Object.keys(ALLOWED).forEach(function (k) {
    const list = tokenList_(ALLOWED[k]);
    Logger.log(ALLOWED[k] + ": " + list.length + " trusted phone token(s)" +
      (list.length ? ", newest issued " + list[list.length - 1].at : ""));
  });
}
