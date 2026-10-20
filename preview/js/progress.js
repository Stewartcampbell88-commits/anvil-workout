// ANVIL · Progress charts (Settings → Progress).
// Classic script (shared global scope, no build step); load order is set in index.html.
function liftSeries(liftId){
  const pts = [];
  for (let i = (state.history||[]).length - 1; i >= 0; i--) {
    const h = state.history[i];
    if (!Array.isArray(h.lifts)) continue;
    const hit = h.lifts.find(l => l.id === liftId);
    if (!hit) continue;
    { const w = Number(hit.weight); const r = Number(hit.reps); pts.push({ t: h.date, weight: Number.isFinite(w) ? w : 0, reps: Number.isFinite(r) ? r : 0, clean: !!hit.clean, name: hit.name }); }
  }
  return pts;
}

function bodySeries(){
  const log = state.bodyWeightLog || [];
  const pts = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (!e || !(Number(e.kg) > 0)) continue;
    pts.push({ t: e.date, y: Number(e.kg) });
  }
  return pts;
}

function progressLiftOptions(){
  const map = new Map();
  for (const h of (state.history || [])) {
    if (!Array.isArray(h.lifts)) continue;
    for (const l of h.lifts) {
      if (!l?.id) continue;
      map.set(l.id, l.name || l.id);
    }
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function isRepsChartLift(pts){
  if (!pts.length) return false;
  const last = pts[pts.length - 1];
  // Non-zero includes negative assist kg — chart those as load, not reps
  const hasLoad = (w) => Number.isFinite(w) && w !== 0;
  const allZeroW = pts.every(p => !hasLoad(p.weight));
  return allZeroW || !hasLoad(last.weight);
}

const CHART_DATA = {};
const PROGRESS_RANGES = { "last3": { label:"Last 3", days:0, last:3, walkWeeks:3, desc:"last 3" }, "1m": { label:"1 month", days:30, walkWeeks:5, desc:"1 month" }, "6m": { label:"6 months", days:182, walkWeeks:26, desc:"6 months" }, "1y": { label:"1 year", days:365, walkWeeks:52, desc:"1 year" } };
function fmtNum(v){
  if (!Number.isFinite(v)) return "—";
  const r = Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(Math.abs(v))) : Math.abs(v).toFixed(1);
  return (v < 0 ? "−" : "") + r;
}
function fmtSigned(v){
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05) return "0";
  return (v > 0 ? "+" : "") + fmtNum(v);
}
function fmtShortDate(t){
  try { return new Date(t).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane",day:"numeric",month:"short"}); }
  catch { return ""; }
}
function fmtDayDate(t){
  try { return new Date(t).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short"}); }
  catch { return ""; }
}
function curRange(){ return PROGRESS_RANGES[ui.progressRange] || PROGRESS_RANGES["1m"]; }
// pts oldest → newest; "Last 3" = last 3 entries of that series
function inRange(pts){
  const r = curRange();
  const ok = pts.filter(p => Number.isFinite(new Date(p.t).getTime()));
  if (r.last) return ok.slice(-r.last);
  const cut = Date.now() - r.days * 86400000;
  return ok.filter(p => new Date(p.t).getTime() >= cut);
}
// Monotone cubic (Fritsch–Carlson): smooth, never overshoots the real values
function smoothPath(c){
  const n = c.length, f1 = (v) => v.toFixed(1);
  if (n < 3) return c.map((p, i) => `${i ? "L" : "M"}${f1(p.x)} ${f1(p.y)}`).join("");
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = c[i+1].x - c[i].x || 1e-6; m[i] = (c[i+1].y - c[i].y) / dx[i]; }
  t[0] = m[0]; t[n-1] = m[n-2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i-1] * m[i] <= 0 ? 0 : (3 * (dx[i-1] + dx[i])) / ((2 * dx[i] + dx[i-1]) / m[i-1] + (dx[i] + 2 * dx[i-1]) / m[i]);
  let d = `M${f1(c[0].x)} ${f1(c[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f1(c[i].x + h)} ${f1(c[i].y + t[i] * h)} ${f1(c[i+1].x - h)} ${f1(c[i+1].y - t[i+1] * h)} ${f1(c[i+1].x)} ${f1(c[i+1].y)}`;
  }
  return d;
}
function niceStep(span, target){
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}
function movingAvg(ys, win){
  return ys.map((_, i) => {
    const s = ys.slice(Math.max(0, i - win + 1), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
}
// points: [{t, y, read, pr?, hollow?}] oldest → newest
function svgLineChart(id, points, { unit = "", trend = 0, zeroLine = false } = {}){
  if (!points.length) return `<p class="chart-empty">No data in this range.</p>`;
  const W = 240, H = 150, padL = 30, padR = 10, padT = 12, padB = 22;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
  const ms = points.map(p => new Date(p.t).getTime());
  const ys = points.map(p => p.y);
  const trendYs = trend && points.length >= 3 ? movingAvg(ys, trend) : null;
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (zeroLine && lo < 0) hi = Math.max(hi, 0);
  if (zeroLine && hi > 0 && lo < 0) { /* zero inside */ }
  if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
  const step = niceStep(hi - lo, 3);
  let yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;
  if (yMax - yMin < step) yMax = yMin + step;
  let tMin = Math.min(...ms), tMax = Math.max(...ms);
  const single = tMax - tMin < 3600000;
  const X = (t) => single ? (x0 + x1) / 2 : x0 + ((t - tMin) / (tMax - tMin)) * (x1 - x0);
  const Y = (v) => y1 - ((v - yMin) / (yMax - yMin)) * (y1 - y0);
  const f1 = (n) => n.toFixed(1);
  let grid = "";
  for (let v = yMin; v <= yMax + step / 2; v += step) {
    const yy = Y(v);
    const isZero = Math.abs(v) < step / 100;
    grid += `<line x1="${x0}" y1="${f1(yy)}" x2="${x1}" y2="${f1(yy)}" stroke="${isZero && zeroLine ? "var(--muted)" : "var(--border)"}" stroke-width="${isZero && zeroLine ? 1 : 0.75}"${isZero && zeroLine ? ' stroke-dasharray="3 3"' : ""}/>`;
    grid += `<text x="${x0 - 4}" y="${f1(yy + 3.5)}" fill="var(--muted)" font-size="9.5" text-anchor="end">${esc(fmtNum(v))}</text>`;
  }
  let xt = "";
  const tickTs = single ? [ms[0]] : [tMin, (tMin + tMax) / 2, tMax];
  tickTs.forEach((t, i) => {
    const anchor = single ? "middle" : i === 0 ? "start" : i === 2 ? "end" : "middle";
    xt += `<text x="${f1(X(t))}" y="${H - 6}" fill="var(--muted)" font-size="9.5" text-anchor="${anchor}">${esc(fmtShortDate(t))}</text>`;
  });
  const coords = points.map((p, i) => ({ x: X(ms[i]), y: Y(p.y) }));
  const path = smoothPath(coords);
  const area = coords.length > 1 ? `${path}L${f1(coords[coords.length-1].x)} ${y1}L${f1(coords[0].x)} ${y1}Z` : "";
  const trendPath = trendYs ? smoothPath(trendYs.map((v, i) => ({ x: coords[i].x, y: Y(v) }))) : "";
  const showDots = points.length <= 40;
  const dots = points.map((p, i) => {
    const c = coords[i];
    if (p.pr) return `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="4.5" fill="var(--surface)" stroke="var(--done)" stroke-width="2"/>`;
    if (!showDots && i !== points.length - 1) return "";
    return p.hollow
      ? `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="3" fill="var(--surface)" stroke="var(--primary)" stroke-width="1.5"/>`
      : `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="3" fill="var(--primary)"/>`;
  }).join("");
  const hits = points.map((p, i) => `<circle class="chart-hit" data-act="chart-pt" data-c="${esc(id)}" data-i="${i}" cx="${f1(coords[i].x)}" cy="${f1(coords[i].y)}" r="11" fill="transparent"/>`).join("");
  CHART_DATA[id] = points.map((p, i) => ({ x: coords[i].x, y: coords[i].y, read: p.read }));
  const last = points[points.length - 1];
  const gid = `g-${id}`;
  const lc = coords[coords.length - 1];
  const tagTxt = `${fmtNum(last.y)}${unit === "kg" ? " kg" : ""}`;
  const tagW = tagTxt.length * 6 + 10;
  const tagX = Math.min(x1 - tagW / 2, Math.max(x0 + tagW / 2, lc.x));
  const tagY = lc.y - 12 < y0 + 2 ? lc.y + 18 : lc.y - 12;
  const latestTag = `<circle cx="${f1(lc.x)}" cy="${f1(lc.y)}" r="7" fill="var(--primary)" fill-opacity=".25"/><circle cx="${f1(lc.x)}" cy="${f1(lc.y)}" r="4" fill="var(--primary)" stroke="var(--fg)" stroke-width="1.5"/>
    <rect x="${f1(tagX - tagW / 2)}" y="${f1(tagY - 10)}" width="${tagW}" height="14" rx="7" fill="var(--primary)"/><text x="${f1(tagX)}" y="${f1(tagY + 0.5)}" fill="var(--primary-fg)" font-size="9.5" font-weight="700" text-anchor="middle">${esc(tagTxt)}</text>`;
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} chart">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".42"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xt}
    ${area ? `<path d="${area}" fill="url(#${gid})"/>` : ""}
    ${trendPath ? `<path d="${trendPath}" fill="none" stroke="var(--fg)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 3" stroke-linecap="round"/>` : ""}
    <path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${latestTag}
    <circle data-chart-hl="${esc(id)}" cx="${f1(coords[coords.length-1].x)}" cy="${f1(coords[coords.length-1].y)}" r="6" fill="none" stroke="var(--fg)" stroke-width="1.5" opacity="0"/>
    ${hits}
  </svg>
  <p class="chart-read" data-chart-read="${esc(id)}">${esc(last.read || "")}<span class="muted"> · tap a point</span></p>`;
}
function svgBarChart(id, bars, { unit = "" } = {}){
  if (!bars.length || bars.every(b => !b.y)) return `<p class="chart-empty">No walks in this range.</p>`;
  const W = 240, H = 130, padL = 26, padR = 6, padT = 10, padB = 22;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
  const hi = Math.max(...bars.map(b => b.y), 0.1);
  const step = niceStep(hi, 3);
  const yMax = Math.ceil(hi / step) * step;
  const Y = (v) => y1 - (v / yMax) * (y1 - y0);
  const f1 = (n) => n.toFixed(1);
  let grid = "";
  for (let v = 0; v <= yMax + step / 2; v += step) {
    grid += `<line x1="${x0}" y1="${f1(Y(v))}" x2="${x1}" y2="${f1(Y(v))}" stroke="var(--border)" stroke-width="0.75"/><text x="${x0 - 4}" y="${f1(Y(v) + 3.5)}" fill="var(--muted)" font-size="9.5" text-anchor="end">${esc(fmtNum(v))}</text>`;
  }
  const slot = (x1 - x0) / bars.length;
  const bw = Math.max(3, Math.min(18, slot * 0.66));
  let out = "", lab = "";
  const labEvery = Math.ceil(bars.length / 4);
  CHART_DATA[id] = [];
  bars.forEach((b, i) => {
    const cx = x0 + slot * (i + 0.5);
    const top = Y(b.y);
    out += `<rect x="${f1(cx - bw / 2)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(Math.max(0, y1 - top))}" rx="2" fill="var(--primary)" fill-opacity="${b.current ? 1 : 0.6}"/>`;
    out += `<rect class="chart-hit" data-act="chart-pt" data-c="${esc(id)}" data-i="${i}" x="${f1(cx - slot / 2)}" y="${y0}" width="${f1(slot)}" height="${f1(y1 - y0)}" fill="transparent"/>`;
    if ((bars.length - 1 - i) % labEvery === 0) lab += `<text x="${f1(cx)}" y="${H - 6}" fill="var(--muted)" font-size="9.5" text-anchor="middle">${esc(b.label)}</text>`;
    CHART_DATA[id].push({ x: cx, y: top, read: b.read });
  });
  const last = bars[bars.length - 1];
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} per week">${grid}${out}${lab}
    <circle data-chart-hl="${esc(id)}" cx="0" cy="0" r="0" opacity="0"/></svg>
  <p class="chart-read" data-chart-read="${esc(id)}">${esc(last.read)}<span class="muted"> · tap a bar</span></p>`;
}
function showChartPoint(id, i){
  const d = CHART_DATA[id]?.[i];
  if (!d) return;
  const read = document.querySelector(`[data-chart-read="${id}"]`);
  if (read) read.textContent = d.read || "";
  const hl = document.querySelector(`[data-chart-hl="${id}"]`);
  if (hl && hl.getAttribute("r") !== "0") { hl.setAttribute("cx", d.x.toFixed(1)); hl.setAttribute("cy", d.y.toFixed(1)); hl.setAttribute("opacity", "1"); }
}
function isoToUtcMs(iso){ const [y, m, d] = String(iso).split("-").map(Number); return Date.UTC(y, (m||1) - 1, d||1); }
function utcMsToIso(ms){ const t = new Date(ms); return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,"0")}-${String(t.getUTCDate()).padStart(2,"0")}`; }
function walkWeekBars(){
  const thisMon = isoToUtcMs(mondayOfThisWeekISO());
  const weeks = curRange().walkWeeks;
  const bars = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const start = thisMon - k * 7 * 86400000, end = start + 7 * 86400000;
    const ws = walks.filter(w => { const t = isoToUtcMs(w.date); return t >= start && t < end; });
    const km = ws.reduce((a, w) => a + (Number(w.distanceKm) || 0), 0);
    const min = ws.reduce((a, w) => a + (Number(w.durationSec) || 0), 0) / 60;
    const d = new Date(start);
    const label = `${d.getUTCDate()} ${d.toLocaleString("en-AU",{month:"short",timeZone:"UTC"})}`;
    bars.push({ km, min, n: ws.length, label, current: k === 0, read: `${k === 0 ? "This week" : `Week of ${label}`} · ${ws.length} walk${ws.length === 1 ? "" : "s"} · ${km.toFixed(1)} km · ${Math.round(min)} min` });
  }
  const useKm = bars.some(b => b.km >= 0.05);
  bars.forEach(b => { b.y = useKm ? b.km : b.min; });
  return { bars, unit: useKm ? "km" : "min" };
}
function headline(delta, unit, from, to, good){
  const col = !Number.isFinite(delta) || Math.abs(delta) < 0.05 ? "var(--fg)" : good == null ? "var(--fg)" : (good ? "var(--done)" : "var(--miss)");
  return `<div class="headline"><span class="hl-val" style="color:${col}">${esc(fmtSigned(delta))}${unit ? ` <small>${esc(unit)}</small>` : ""}</span><span class="hl-sub">over ${esc(curRange().desc)} · ${esc(fmtNum(from))} → ${esc(fmtNum(to))}</span></div>`;
}
function statRow(items){
  return `<div class="stat-row">${items.map(s => `<div class="stat"><span class="stat-lab">${esc(s.lab)}</span><span class="stat-val"${s.color ? ` style="color:${s.color}"` : ""}>${esc(s.val)}</span></div>`).join("")}</div>`;
}
