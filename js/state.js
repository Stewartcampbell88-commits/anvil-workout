// ANVIL · App state, load/save + migrations (key anvil_app_v3), safety copies, Sheet sync, Export/Import, Restore from cloud.
// Classic script (shared global scope, no build step); load order is set in index.html.
let state = {
  programId: "anvil",
  dayIndex: 0,
  exercises: seedProgram("anvil", 0),
  history: [],
  liftProgress: {},
  bodyWeightLog: [],
  soundVolume: 1.0,
  cuePack: "chime",
  loudCuesV33: true,
};
let ui = { remain:0, running:false, isGo:false, panel:"none", settingsTab:"program", pending:null, pickSets:3, pickReps:8, installHint:false, installed:false, toastTimer:null, swReg:null, updateReady:false, updateChecking:false, refreshing:false, appVersion: APP_VERSION, progressLiftId:null, progressRange:"1m", bwDraftKg:null, bwLinkSession:false, pendingHolds:null, expandedEx:new Set(), mainTab:"workout" };
let remainVal = 0, lastCue = -1, tick = null, deferredInstall = null;
try {
  ui.installed = window.matchMedia("(display-mode: standalone)").matches || Boolean(navigator.standalone) || /ANVIL-APP/.test(navigator.userAgent) || location.hostname === "appassets.androidplatform.net";
} catch {}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
});
window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  ui.installed = true;
  render();
});

function clampVolume(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return 1.0;
  return Math.max(0, Math.min(1, n));
}
function normalizeCuePack(id){
  const mapped = CUE_PACK_ALIASES[id] || id;
  return CUE_PACKS[mapped] ? mapped : "chime";
}
// Safety copies (extra keys only; the main keys and formats are unchanged).
// _snap: the saved data as it was before this app version first touched it (undo for a bad migration).
// _rescue: saved data that couldn't be read, kept instead of being overwritten.
// _undo: what was on the phone just before an Import / Restore from cloud replaced it.
const SNAP_KEY = STORAGE + "_snap", RESCUE_KEY = STORAGE + "_rescue", UNDO_KEY = STORAGE + "_undo";
function stashCopy(key, extra){
  try {
    const st = localStorage.getItem(STORAGE);
    if (!st) return false;
    localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), version: APP_VERSION, ...extra, state: st, walks: localStorage.getItem(WALK_STORAGE) }));
    return true;
  } catch { return false; }
}
function rescueSaved(reason){
  try {
    const st = localStorage.getItem(STORAGE);
    if (!st) return;
    const prev = JSON.parse(localStorage.getItem(RESCUE_KEY) || "null");
    if (prev && prev.state === st) return;
    stashCopy(RESCUE_KEY, { reason: String(reason && reason.message || reason || "") });
  } catch {}
}
function load(){
  const rawText = (() => { try { return localStorage.getItem(STORAGE); } catch { return null; } })();
  try {
    if (rawText) {
      let snap = null; try { snap = JSON.parse(localStorage.getItem(SNAP_KEY) || "null"); } catch {}
      if (!snap || snap.version !== APP_VERSION) stashCopy(SNAP_KEY);
    }
    const raw = JSON.parse(rawText || "null");
    if (!raw) return;
    const program = getProgram(raw.programId || "anvil");
    const dayIndex = Math.min(Math.max(0, raw.dayIndex||0), program.days.length-1);
    let liftProgress = raw.liftProgress || {};
    // Snap odd ANVIL/EMBER targets (e.g. stuck 7 → 8) in saved progress
    if (program.id === "anvil" || program.id === "ember" || program.id === "titan") {
      const snapped = {};
      for (const [id, p] of Object.entries(liftProgress)) {
        if (!p || typeof p !== "object") { snapped[id] = p; continue; }
        const skipSnap = id === "em-plank" || id === "em-heaves" || id === "tp-plank" || id === "tp-heaves";
        const reps = (!skipSnap && p.reps != null && !WAVE_REPS.includes(p.reps)) ? snapWaveRep(p.reps) : p.reps;
        snapped[id] = reps === p.reps ? p : {...p, reps};
      }
      liftProgress = snapped;
    }
    const seeded = seedProgram(program.id, dayIndex);
    const seedById = Object.fromEntries(seeded.map(e => [e.id, e]));
    let baseExs = hydrate(raw.exercises) || seeded;
    // Old TITAN was one full-body session — reseed when saved lifts don't match A/B ids
    if (program.id === "titan") {
      const seedIds = new Set(seeded.map(e => e.id));
      if (!baseExs.some(e => seedIds.has(e.id))) baseExs = seeded;
    }
    // Preserve heaveLadder / benchLadder / cossackLadder / levels from seed when rehydrating saved sessions
    baseExs = baseExs.map(ex => {
      const seed = seedById[ex.id];
      if (!seed) return ex;
      let out = ex;
      if (seed.heaveLadder) out = {...out, heaveLadder:true, levels: seed.levels};
      if (seed.benchLadder) out = {...out, benchLadder:true, levels: seed.levels};
      if (seed.cossackLadder) out = {...out, cossackLadder:true, bilateral:true, levels: seed.levels};
      if (seed.finisher) out = {...out, finisher:true, name: seed.name, note: seed.note, block: seed.block, cap: undefined, weight: Math.min(0, Number(out.weight)||0)};
      if (seed.id === "slrdl") out = {...out, bilateral:true, note: seed.note};
      return out;
    });
    // ANVIL Day A v30: programmed abd → cossack ladder (keep Add-on abd if no seed cossack)
    if (program.id === "anvil" && seedById["cossack"] && !baseExs.some(e => e.id === "cossack")) {
      let swapped = false;
      baseExs = baseExs.map(ex => {
        if (!swapped && ex.id === "abd") {
          swapped = true;
          return toExercise({...seedById["cossack"]});
        }
        return ex;
      });
      if (!swapped) {
        // Insert cossack in seed order if abd was already removed
        const seeded = seedProgram(program.id, dayIndex);
        const orderIds = seeded.map(e => e.id);
        const have = new Set(baseExs.map(e => e.id));
        for (const sid of orderIds) {
          if (!have.has(sid) && sid === "cossack") {
            const idx = orderIds.indexOf(sid);
            const insertAt = Math.min(idx, baseExs.length);
            baseExs = [...baseExs.slice(0, insertAt), toExercise({...seedById["cossack"]}), ...baseExs.slice(insertAt)];
            break;
          }
        }
      }
    }
    // ANVIL v38 layout: reorder current day to seed order (Single-leg RDL A, Back extension last on A+B); keep extra add-ons after
    let layoutChanged = false;
    if (program.id === "anvil" && raw.anvilLayoutV38 !== true) {
      const savedById = Object.fromEntries(baseExs.map(e => [e.id, e]));
      const seedIds = new Set(seeded.map(e => e.id));
      const ordered = seeded.map(se => savedById[se.id] || se);
      const extras = baseExs.filter(e => !seedIds.has(e.id));
      baseExs = [...ordered, ...extras];
      layoutChanged = true;
    }
    if (liftProgress.bext && Number(liftProgress.bext.weight) > 0) liftProgress = {...liftProgress, bext:{...liftProgress.bext, weight:0}};
    const legacyCueDefault = raw.soundVolume === 0.7;
    const needsCueMigration = raw.loudCuesV33 !== true;
    state = {
      programId: program.id,
      dayIndex,
      liftProgress,
      exercises: applyProgress(baseExs, liftProgress, program.id),
      history: raw.history || [],
      bodyWeightLog: Array.isArray(raw.bodyWeightLog) ? raw.bodyWeightLog : [],
      // Preserve an explicit mute or custom preference; only promote the old default once.
      soundVolume: clampVolume(needsCueMigration && legacyCueDefault ? 1.0 : (raw.soundVolume ?? 1.0)),
      cuePack: normalizeCuePack(raw.cuePack),
      loudCuesV33: true,
    };
    if (normalizeWaveTargets() || needsCueMigration || layoutChanged) save();
  } catch (e) {
    rescueSaved(e);
    ui.loadFailed = true;
  }
}
function save(){
  try { saveState(); }
  catch (e) { try { toast("Couldn’t save on this phone", "Storage is full — Export a backup now"); } catch {} }
}
function saveState(){
  localStorage.setItem(STORAGE, JSON.stringify({
    programId: state.programId, dayIndex: state.dayIndex,
    exercises: state.exercises, history: state.history, liftProgress: state.liftProgress,
    bodyWeightLog: state.bodyWeightLog || [],
    soundVolume: clampVolume(state.soundVolume), cuePack: normalizeCuePack(state.cuePack),
    loudCuesV33: true, anvilLayoutV38: true,
  }));
}

function backupPayload(){
  return {
    programId: state.programId, dayIndex: state.dayIndex,
    exercises: state.exercises, history: state.history, liftProgress: state.liftProgress,
    bodyWeightLog: state.bodyWeightLog || [],
    soundVolume: clampVolume(state.soundVolume), cuePack: normalizeCuePack(state.cuePack),
    loudCuesV33: true,
  };
}

function looksLikeAppState(obj){
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (obj.exercises !== undefined && !Array.isArray(obj.exercises)) return false;
  if (obj.history !== undefined && !Array.isArray(obj.history)) return false;
  if (obj.bodyWeightLog !== undefined && !Array.isArray(obj.bodyWeightLog)) return false;
  if (obj.liftProgress !== undefined && (typeof obj.liftProgress !== "object" || obj.liftProgress === null || Array.isArray(obj.liftProgress))) return false;
  if (obj.programId !== undefined && typeof obj.programId !== "string") return false;
  if (obj.dayIndex !== undefined && typeof obj.dayIndex !== "number") return false;
  if (obj.soundVolume !== undefined && typeof obj.soundVolume !== "number") return false;
  if (obj.cuePack !== undefined && typeof obj.cuePack !== "string") return false;
  return Array.isArray(obj.exercises) || Array.isArray(obj.history) || Array.isArray(obj.bodyWeightLog) || typeof obj.programId === "string" || (obj.liftProgress && typeof obj.liftProgress === "object") || typeof obj.soundVolume === "number" || typeof obj.cuePack === "string";
}

// ---- Sync to Stewart's private Google Sheet (Apps Script web app, no key on the phone) ----
// The /exec URL is unguessable; the script only accepts the names Stewart / Alexis / Marcus.
const SHEET_SYNC_URL = ANVIL_PREVIEW ? "" : "https://script.google.com/macros/s/AKfycbwXJL-PWyoeOJ9Y49HixIIJwY18kQNb80Fjzo5P27QqHeskt7-NjuMtL30qgZVii-Rs/exec";
const SYNC_KEY = K("anvil-sync-v1");
const SYNC_PROGRAM_NAME = { anvil:"Stewart", ember:"Alexis", titan:"Marcus" };
let syncCfg = { name:"", lastSync:null, status:"", pending:false };
let syncBusy = false;
function loadSync(){
  try { syncCfg = {...syncCfg, ...(JSON.parse(localStorage.getItem(SYNC_KEY)||"{}"))}; } catch {}
  if (syncCfg.token) { delete syncCfg.token; saveSync(); } // drop old GitHub token from v39
}
function saveSync(){ try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg)); } catch {} }
// Trusted-phone token(s) from the cloud script, per name ({stewart:"uuid"}). Lets this phone restore
// without the family PIN. Own key: never part of Export/Import backups or the synced log.
const SYNC_TOKEN_KEY = K("anvil_sync_token_v1");
function tokenMap(){ try { const m = JSON.parse(localStorage.getItem(SYNC_TOKEN_KEY) || "{}"); return (m && typeof m === "object" && !Array.isArray(m)) ? m : {}; } catch { return {}; } }
function deviceToken(name){ const t = tokenMap()[String(name || "").trim().toLowerCase()]; return typeof t === "string" && /^[0-9a-f-]{32,64}$/i.test(t) ? t : ""; }
function setDeviceToken(name, token){
  const k = String(name || "").trim().toLowerCase(); if (!k) return;
  const m = tokenMap();
  if (token && /^[0-9a-f-]{32,64}$/i.test(token)) m[k] = String(token); else delete m[k];
  try { localStorage.setItem(SYNC_TOKEN_KEY, JSON.stringify(m)); } catch {}
}
function syncName(){ return String(syncCfg.name || SYNC_PROGRAM_NAME[state?.programId] || "").trim(); }
function syncPayload(){
  const name = syncName(), tok = deviceToken(name);
  return { name, appVersion: APP_VERSION, syncedAt: new Date().toISOString(), wantToken: true, ...(tok ? { deviceToken: tok } : {}), data: { ...backupPayload(), walks: walks || [] } };
}
function syncStatusRefresh(){ const el=document.querySelector("[data-sync-status]"); if (el) el.textContent = syncStatusText(); }
function syncStatusText(){
  const last = syncCfg.lastSync ? `Last synced ${new Date(syncCfg.lastSync).toLocaleString()}` : "Never synced";
  return syncCfg.status ? `${last} · ${syncCfg.status}` : last;
}
async function syncNow(manual){
  if (!SHEET_SYNC_URL) { if (manual) { syncCfg.status = "Sync not set up yet"; saveSync(); syncStatusRefresh(); } return; }
  if (!syncName()) { if (manual) { syncCfg.status = "Add a name first"; saveSync(); syncStatusRefresh(); } return; }
  // Never let an empty phone overwrite the cloud copy.
  if (localDataEmpty()) { if (manual) { syncCfg.status = "Nothing to sync yet"; saveSync(); syncStatusRefresh(); } return; }
  // Just restored from cloud: wait for a new session/walk before auto-syncing.
  if (syncCfg.holdAfterRestore && !manual) return;
  if (syncBusy) return;
  if (!navigator.onLine) { syncCfg.pending = true; syncCfg.status = "Offline — will retry"; saveSync(); syncStatusRefresh(); return; }
  syncBusy = true; syncCfg.status = "Syncing…"; syncStatusRefresh();
  // text/plain = "simple" request, so no CORS preflight (Apps Script can't answer OPTIONS)
  const sentAs = syncName();
  const body = JSON.stringify(syncPayload());
  const opts = { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, body, redirect:"follow", cache:"no-store" };
  try {
    let res = null;
    try { res = await fetch(SHEET_SYNC_URL, opts); }
    catch (e) {
      // Response unreadable (CORS on the redirect) — resend blind; Apps Script still records it.
      await fetch(SHEET_SYNC_URL, {...opts, mode:"no-cors"});
      res = null;
    }
    if (res) {
      if (!res.ok) throw new Error(`Error ${res.status}`);
      let j = null; try { j = await res.json(); } catch {}
      if (j && j.ok === false) throw new Error(j.error === "unknown name" ? "Name must be Stewart, Alexis or Marcus" : (j.error || "Rejected"));
      if (j && typeof j.deviceToken === "string") setDeviceToken(j.person || syncName(), j.deviceToken);
      syncCfg.status = "";
    } else syncCfg.status = "Sent";
    syncCfg.lastSync = new Date().toISOString(); syncCfg.pending = false;
    // Pin who this phone syncs as, so switching program later can't start overwriting another person's cloud copy.
    if (!syncCfg.name && sentAs) syncCfg.name = sentAs;
  } catch (e) {
    syncCfg.pending = true;
    syncCfg.status = (e && e.message && !/fetch|network|load failed/i.test(e.message)) ? `${e.message} — will retry` : "Network error — will retry";
  } finally { syncBusy = false; saveSync(); syncStatusRefresh(); }
}
function syncSoon(){ setTimeout(() => { syncNow(false); }, 800); }
function newLocalActivity(){ if (syncCfg.holdAfterRestore) { syncCfg.holdAfterRestore = false; saveSync(); } }
function localDataEmpty(){
  return !(state?.history?.length) && !(walks?.length) && !(state?.bodyWeightLog?.length);
}
function syncIfStale(){
  if (!SHEET_SYNC_URL || !syncName() || syncCfg.holdAfterRestore) return;
  const age = syncCfg.lastSync ? Date.now() - new Date(syncCfg.lastSync).getTime() : Infinity;
  if (syncCfg.pending || age > 24*3600*1000) syncNow(false);
}
window.addEventListener("online", () => { if (syncCfg.pending) syncNow(false); });

function exportBackup(){
  const data = JSON.stringify({ ...backupPayload(), walks: walks || [] }, null, 2);
  const d = new Date();
  const name = `anvil-backup-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}.json`;
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Backup exported", name);
}

function importBackup(){
  const input = document.getElementById("import-file");
  if (!input) return;
  input.value = "";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!looksLikeAppState(raw)) {
        toast("Invalid backup", "That file doesn’t look like ANVIL data.");
        return;
      }
      if (!confirm("Replace all workout data with this backup? This cannot be undone.")) return;
      applyBackup(raw);
      toast("Backup restored");
      render();
    } catch {
      toast("Import failed", "Could not read that JSON file.");
    }
  };
  input.click();
}

// Shared by Import (file) and Restore from cloud. Walks are replaced only when the backup has them.
function applyBackup(raw){
      if (!localDataEmpty()) stashCopy(UNDO_KEY, { reason: "before import/restore" });
      localStorage.setItem(STORAGE, JSON.stringify({
        programId: raw.programId || "anvil",
        dayIndex: typeof raw.dayIndex === "number" ? raw.dayIndex : 0,
        exercises: Array.isArray(raw.exercises) ? raw.exercises : [],
        history: Array.isArray(raw.history) ? raw.history : [],
        liftProgress: raw.liftProgress && typeof raw.liftProgress === "object" ? raw.liftProgress : {},
        bodyWeightLog: Array.isArray(raw.bodyWeightLog) ? raw.bodyWeightLog : [],
        soundVolume: clampVolume(raw.soundVolume ?? 1.0),
        cuePack: normalizeCuePack(raw.cuePack),
        loudCuesV33: true,
      }));
      if (Array.isArray(raw.walks)) {
        walks = raw.walks.filter(w => w && typeof w.date === "string" && typeof w.durationSec === "number").slice(0, WALKS_MAX);
        saveWalks();
      }
      load();
      clockClear();
      stopRest();
      ui.panel = "none";
      ui.pending = null;
}

// Preview only: one-way copy of the live app's data (same origin) into the preview's own keys. Never writes live keys.
function copyLiveIntoPreview(){
  if (!ANVIL_PREVIEW) return false;
  let st = null, wk = null;
  try { st = JSON.parse(localStorage.getItem("anvil_app_v3") || "null"); } catch {}
  try { wk = JSON.parse(localStorage.getItem("anvil_walks_v1") || "null"); } catch {}
  if (!looksLikeAppState(st)) { toast("No live ANVIL data in this browser", "Open the preview in the same browser as the app"); return false; }
  if (!confirm("Copy your real ANVIL data into the Preview? Your real app is not changed.")) return false;
  applyBackup({ ...st, ...(Array.isArray(wk) ? { walks: wk } : {}) });
  toast("Copied into Preview", `${(st.history || []).length} sessions`);
  render();
  return true;
}

// ---- Restore from cloud (reads the latest Raw copy back from the Google Sheet) ----
const RESTORE_OFFER_KEY = K("anvil-restore-offered-v1");
function restoreOffered(){ try { return localStorage.getItem(RESTORE_OFFER_KEY) === "1"; } catch { return true; } }
function markRestoreOffered(){ try { localStorage.setItem(RESTORE_OFFER_KEY, "1"); } catch {} }
function showRestoreBanner(){ return !!SHEET_SYNC_URL && !ui.restoreBannerHidden && !restoreOffered() && localDataEmpty(); }
function restoreNameValue(){
  const el = document.querySelector("[data-restore-name]");
  return String(ui.restoreName || (el && el.value) || syncName() || "").trim();
}
// Family PIN: kept in memory only for this screen; never written to localStorage.
function restorePinValue(){
  const el = document.querySelector("[data-restore-pin]");
  return String(ui.restorePin || (el && el.value) || "").replace(/\D/g, "").slice(0, 6);
}
function restoreTrusted(){ return !ui.restoreNeedPin && !!deviceToken(restoreNameValue()); }
function restorePinField(mt){
  if (restoreTrusted()) return `<p class="note" style="margin-top:${mt}">✓ This phone is trusted — no PIN needed</p>`;
  return `<label class="note" style="display:block;margin-top:${mt}">Family PIN
          <input data-restore-pin type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="4–6 digits" value="${esc(ui.restorePin || "")}" style="width:100%;margin-top:.25rem;padding:.6rem;border-radius:.6rem;border:1px solid #444;background:transparent;color:inherit;font:inherit;letter-spacing:.2em">
        </label>`;
}
function restoreStatus(msg){ ui.restoreMsg = msg; document.querySelectorAll("[data-restore-status]").forEach(el => { el.textContent = msg; }); }
async function restoreFromCloud(){
  if (ui.restoreBusy) return;
  if (!SHEET_SYNC_URL) { restoreStatus("Cloud sync isn’t set up yet"); return; }
  const name = restoreNameValue();
  ui.restoreName = name;
  if (!name) { restoreStatus("Enter a name first"); return; }
  // Trusted phone: use its token, no PIN. Otherwise (or if the token was refused) the PIN is needed.
  const tok = ui.restoreNeedPin ? "" : deviceToken(name);
  const pin = tok ? "" : restorePinValue();
  if (!tok && !/^\d{4,6}$/.test(pin)) {
    if (!document.querySelector("[data-restore-pin]")) { ui.restoreNeedPin = true; ui.restoreMsg = `Enter the family PIN for ${name}`; render(); return; }
    restoreStatus("Enter the family PIN (4–6 digits)"); return;
  }
  if (!navigator.onLine) { restoreStatus("You’re offline — connect and try again"); return; }
  ui.restoreBusy = true; restoreStatus("Checking cloud…");
  try {
    const cred = tok ? `token=${encodeURIComponent(tok)}` : `pin=${encodeURIComponent(pin)}`;
    const res = await fetch(`${SHEET_SYNC_URL}?action=restore&name=${encodeURIComponent(name)}&${cred}&t=${Date.now()}`, { method:"GET", redirect:"follow", cache:"no-store" });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    let j = null; try { j = await res.json(); } catch { throw new Error("Couldn’t read the cloud reply"); }
    if (j && j.ok === true && typeof j.deviceToken === "string") setDeviceToken(j.name || name, j.deviceToken); // PIN accepted → trust this phone
    if (!j || j.ok !== true) {
      const err = j && j.error;
      if (err === "bad token") { // trust revoked/expired: forget it and ask for the PIN
        setDeviceToken(name, ""); ui.restoreNeedPin = true; ui.restoreMsg = "This phone isn’t trusted any more — enter the family PIN";
        render(); return;
      }
      throw new Error(err === "unknown name" ? "Name must be Stewart, Alexis or Marcus"
        : err === "no backup" ? `No cloud backup for ${name} yet`
        : err === "wrong pin" ? "Wrong family PIN — check it and try again"
        : (err && /^locked/i.test(err)) ? "Too many wrong PINs — locked for 10 minutes, try later"
        : (err === "pin not set" || err === "pin required") ? "Cloud restore isn’t set up yet (family PIN missing on the script)"
        : err === "unknown action" ? "Cloud script needs updating" : (err || "Restore failed"));
    }
    const data = (j.data && typeof j.data === "object") ? j.data : {};
    const sessions = Array.isArray(data.history) ? data.history.length : 0;
    const walkN = Array.isArray(data.walks) ? data.walks.length : 0;
    const bwN = Array.isArray(data.bodyWeightLog) ? data.bodyWeightLog.length : 0;
    if (!looksLikeAppState(data) || (!sessions && !walkN && !bwN)) throw new Error(`The cloud backup for ${j.name || name} is empty`);
    const when = j.syncedAt ? fmtWhen(j.syncedAt) : "an unknown date";
    const summary = `${sessions} session${sessions===1?"":"s"}${walkN ? ` · ${walkN} walk${walkN===1?"":"s"}` : ""}${bwN ? ` · ${bwN} weigh-in${bwN===1?"":"s"}` : ""}`;
    restoreStatus(`Found ${j.name || name}’s backup from ${when}: ${summary}`);
    if (!confirm(`Replace this phone's data with the cloud backup from ${when}?\n\n${j.name || name}: ${summary}.\nThis cannot be undone.`)) { restoreStatus("Restore cancelled"); return; }
    applyBackup(data);
    syncCfg.name = j.name || name;
    syncCfg.holdAfterRestore = true; // don't push until a new session/walk is logged
    syncCfg.pending = false;
    syncCfg.status = "Restored from cloud";
    saveSync();
    markRestoreOffered();
    ui.restoreBannerHidden = true;
    ui.restorePin = "";
    ui.restoreNeedPin = false;
    ui.restoreMsg = `Restored ${summary} from ${when}`;
    toast("Restored from cloud", summary);
    render();
  } catch (e) {
    restoreStatus((e && e.message && !/fetch|network|load failed/i.test(e.message)) ? e.message : "Network error — try again");
  } finally {
    ui.restoreBusy = false;
    if (ui.restorePin === "") document.querySelectorAll("[data-restore-pin]").forEach(el => { el.value = ""; });
  }
}
