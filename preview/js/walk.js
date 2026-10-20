// ANVIL · Walk tab: timer, GPS distance (Haversine), weekly strip. Storage key anvil_walks_v1.
// Classic script (shared global scope, no build step); load order is set in index.html.
const WALK_STORAGE = K("anvil_walks_v1");
const WALK_MIN_SAVE_SEC = 30;
const WALK_MIN_MOVE_M = 6;
const WALK_MAX_ACC_M = 50;
let walks = [];
let walk = {
  active: false,
  startedAt: null,
  elapsedSec: 0,
  distanceKm: 0,
  watchId: null,
  lastPos: null,
  geoMsg: "",
  wakeLock: null,
  tick: null,
};

function loadWalks(){
  try {
    const raw = JSON.parse(localStorage.getItem(WALK_STORAGE) || "[]");
    walks = Array.isArray(raw) ? raw.filter(w => w && typeof w.date === "string" && typeof w.durationSec === "number") : [];
  } catch { walks = []; }
}
function saveWalks(){
  try { localStorage.setItem(WALK_STORAGE, JSON.stringify(walks)); } catch {}
}
// A walk in progress is kept on disk too, so closing/reloading the app (or Update now) mid-walk doesn't lose it.
const WALK_ACTIVE_KEY = K("anvil_walk_active_v1");
function persistActiveWalk(){
  try {
    if (!walk.active || !walk.startedAt) { localStorage.removeItem(WALK_ACTIVE_KEY); return; }
    localStorage.setItem(WALK_ACTIVE_KEY, JSON.stringify({ startedAt: walk.startedAt, distanceKm: walk.distanceKm, lastPos: walk.lastPos }));
  } catch {}
}
function resumeActiveWalk(){
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(WALK_ACTIVE_KEY) || "null"); } catch {}
  if (!saved || !Number.isFinite(saved.startedAt)) return false;
  const age = Date.now() - saved.startedAt;
  if (!(age >= 0 && age < 24 * 3600 * 1000)) { try { localStorage.removeItem(WALK_ACTIVE_KEY); } catch {} return false; }
  startWalkSession(saved.startedAt);
  walk.distanceKm = Number(saved.distanceKm) || 0;
  if (saved.lastPos && Number.isFinite(saved.lastPos.lat) && Number.isFinite(saved.lastPos.lon)) walk.lastPos = saved.lastPos;
  onWalkTick();
  persistActiveWalk();
  return true;
}

function fmtWalkDuration(sec){
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
  return `${m}:${String(r).padStart(2,"0")}`;
}

function brisbaneTodayISO(){
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone:"Australia/Brisbane", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
}
function brisbaneWeekdayShort(d = new Date()){
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone:"Australia/Brisbane", weekday:"short" }).format(d);
  } catch {
    return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  }
}
function mondayOfThisWeekISO(){
  const today = brisbaneTodayISO();
  const wd = brisbaneWeekdayShort();
  const idx = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wd] ?? 1;
  const fromMon = (idx + 6) % 7;
  const [y, m, d] = today.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) - fromMon * 86400000;
  const t = new Date(utc);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,"0")}-${String(t.getUTCDate()).padStart(2,"0")}`;
}
function thisWeekISOs(){
  const mon = mondayOfThisWeekISO();
  const [y, m, d] = mon.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length:7 }, (_, i) => {
    const t = new Date(base + i * 86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,"0")}-${String(t.getUTCDate()).padStart(2,"0")}`;
  });
}
function haversineKm(a, b){
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function acquireWakeLock(){
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      walk.wakeLock = await navigator.wakeLock.request("screen");
      walk.wakeLock.addEventListener("release", () => {});
    }
  } catch {}
}
async function releaseWakeLock(){
  try { await walk.wakeLock?.release(); } catch {}
  walk.wakeLock = null;
}

function updateWalkLiveDom(){
  document.querySelectorAll("[data-walk-time]").forEach((el) => { el.textContent = fmtWalkDuration(walk.elapsedSec); });
  document.querySelectorAll("[data-walk-dist]").forEach((el) => { el.textContent = `${walk.distanceKm.toFixed(2)} km`; });
}

function onWalkTick(){
  if (!walk.active || !walk.startedAt) return;
  walk.elapsedSec = Math.max(0, Math.floor((Date.now() - walk.startedAt) / 1000));
  updateWalkLiveDom();
}

function onWalkPosition(pos){
  if (!walk.active) return;
  const coords = pos?.coords;
  if (!coords) return;
  const acc = Number(coords.accuracy);
  if (Number.isFinite(acc) && acc > WALK_MAX_ACC_M) return;
  const next = { lat: coords.latitude, lon: coords.longitude };
  if (!Number.isFinite(next.lat) || !Number.isFinite(next.lon)) return;
  if (walk.lastPos) {
    const km = haversineKm(walk.lastPos, next);
    const meters = km * 1000;
    if (meters >= WALK_MIN_MOVE_M) {
      walk.distanceKm += km;
      walk.lastPos = next;
      persistActiveWalk();
      updateWalkLiveDom();
    }
  } else {
    walk.lastPos = next;
  }
  if (walk.geoMsg) {
    walk.geoMsg = "";
    if (ui.mainTab === "walk") render();
  }
}

function onWalkGeoError(err){
  if (!walk.active) return;
  if (err && (err.code === 1 || /denied/i.test(String(err.message || "")))) {
    walk.geoMsg = "Allow location for distance";
  } else {
    walk.geoMsg = "Location unavailable — time still tracks";
  }
  if (ui.mainTab === "walk") render();
}

function startWalkSession(resumeFrom){
  if (walk.active) return;
  walk.active = true;
  walk.startedAt = Number.isFinite(resumeFrom) ? resumeFrom : Date.now();
  walk.elapsedSec = 0;
  walk.distanceKm = 0;
  walk.lastPos = null;
  walk.geoMsg = "";
  if (walk.tick) clearInterval(walk.tick);
  walk.tick = setInterval(onWalkTick, 250);
  persistActiveWalk();
  acquireWakeLock();
  if (navigator.geolocation) {
    try {
      walk.watchId = navigator.geolocation.watchPosition(onWalkPosition, onWalkGeoError, {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      });
    } catch {
      walk.geoMsg = "Location unavailable — time still tracks";
    }
  } else {
    walk.geoMsg = "Location unavailable — time still tracks";
  }
}

function stopWalkSession(){
  if (!walk.active) return;
  onWalkTick();
  const durationSec = walk.elapsedSec;
  const distanceKm = Math.round(walk.distanceKm * 100) / 100;
  const startedAt = walk.startedAt ? new Date(walk.startedAt).toISOString() : new Date().toISOString();
  const date = brisbaneTodayISO();

  if (walk.watchId != null && navigator.geolocation) {
    try { navigator.geolocation.clearWatch(walk.watchId); } catch {}
  }
  walk.watchId = null;
  if (walk.tick) clearInterval(walk.tick);
  walk.tick = null;
  releaseWakeLock();
  walk.active = false;
  walk.startedAt = null;
  walk.lastPos = null;
  persistActiveWalk();

  if (durationSec >= WALK_MIN_SAVE_SEC) {
    walks.unshift({ date, durationSec, distanceKm, startedAt });
    if (walks.length > WALKS_MAX) walks.length = WALKS_MAX;
    saveWalks();
    newLocalActivity();
    syncSoon();
    toast("Walk saved", `${fmtWalkDuration(durationSec)} · ${distanceKm.toFixed(2)} km`);
  } else {
    toast("Walk discarded", "Under 30s — not saved");
  }
  walk.elapsedSec = 0;
  walk.distanceKm = 0;
  walk.geoMsg = "";
}

function toggleWalk(){
  if (walk.active) stopWalkSession();
  else startWalkSession();
  render();
}

function walksOnDate(iso){
  return walks.filter((w) => w.date === iso);
}

function renderWalkBody(){
  const days = thisWeekISOs();
  const labels = ["M","T","W","T","F","S","S"];
  const today = brisbaneTodayISO();
  const doneDays = days.filter((d) => walksOnDate(d).length > 0).length;
  const weekStrip = days.map((d, i) => {
    const on = walksOnDate(d).length > 0;
    const isToday = d === today;
    return `<div class="walk-day${on?" on":""}" title="${esc(d)}"${isToday?` style="box-shadow:0 0 0 1px var(--primary)"`:""}>
      <span class="wd">${labels[i]}</span>
      <span class="wd-dot" aria-hidden="true"></span>
    </div>`;
  }).join("");

  const timeText = fmtWalkDuration(walk.active ? walk.elapsedSec : 0);
  const distText = `${(walk.active ? walk.distanceKm : 0).toFixed(2)} km`;
  const geo = walk.geoMsg ? `<p class="walk-geo">${esc(walk.geoMsg)}</p>` : "";
  const cta = walk.active
    ? `<button type="button" class="walk-cta danger" data-act="walk-toggle">Stop</button>`
    : `<button type="button" class="walk-cta primary" data-act="walk-toggle">Start</button>`;

  const weekSet = new Set(days);
  const recent = walks.filter((w) => weekSet.has(w.date) || w.date === today).slice(0, 20);
  // Also include a few more recent if week empty / thin
  const histSource = recent.length ? recent : walks.slice(0, 12);
  const hist = histSource.length
    ? histSource.map((w) => {
        const when = (() => {
          try {
            return new Date(w.startedAt).toLocaleString("en-AU", {
              timeZone:"Australia/Brisbane", weekday:"short", day:"numeric", month:"short",
              hour:"2-digit", minute:"2-digit"
            });
          } catch { return w.date; }
        })();
        return `<div class="walk-row"><div><strong>${esc(fmtWalkDuration(w.durationSec))}</strong>
          <p class="note" style="margin:0">${esc(when)}</p></div>
          <span class="meta">${Number(w.distanceKm||0).toFixed(2)} km</span></div>`;
      }).join("")
    : `<p class="note" style="margin:.75rem 0 0">No walks yet — tap Start.</p>`;

  return `
    <section class="panel">
      <div class="row" style="align-items:center">
        <p class="tiny" style="margin:0">This week</p>
        <span class="meta" style="font-weight:700;color:var(--fg)">${doneDays}/7</span>
      </div>
      <div class="walk-week" aria-label="Walk days this week">${weekStrip}</div>
    </section>
    <section class="card walk-readout" style="margin-top:.75rem">
      <p class="tiny" style="margin:0">Time</p>
      <p class="big" data-walk-time style="font-size:3.25rem">${esc(timeText)}</p>
      <p class="tiny" style="margin:1rem 0 0">Distance</p>
      <p class="big" data-walk-dist style="font-size:2rem;margin-top:.35rem">${esc(distText)}</p>
      ${geo}
    </section>
    ${cta}
    <section class="panel" style="margin-top:.75rem">
      <p class="tiny">Recent</p>
      <div class="walk-hist">${hist}</div>
    </section>
    <p class="foot">GPS needs permission and HTTPS. Distance may pause indoors or with poor signal. Tracking stops if the browser suspends the tab — keep ANVIL open while walking.</p>
  `;
}
