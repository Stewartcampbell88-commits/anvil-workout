// ANVIL · Logging sets, progression (wave / AMRAP / ladders / balance chain), rest timer, updates, body weight.
// Classic script (shared global scope, no build step); load order is set in index.html.
// ---- Overall workout clock (v47): starts at the first logged set, runs off timestamps in its own
// K()-prefixed key, so screen lock / background / closing the app don't matter. Stops when the session is logged.
const WORKOUT_CLOCK_KEY = K("anvil_workout_clock_v1");
const CLOCK_IDLE_MS = 90 * 60 * 1000;   // no set for 90+ min → treat the session as forgotten
const CLOCK_TAIL_MS = 5 * 60 * 1000;    // ... and end it at last set + 5 min
function loadClock(){
  try {
    const c = JSON.parse(localStorage.getItem(WORKOUT_CLOCK_KEY) || "null");
    return (c && Number.isFinite(c.startedAt) && Number.isFinite(c.lastSetAt)) ? c : null;
  } catch { return null; }
}
function saveClock(c){ try { if (c) localStorage.setItem(WORKOUT_CLOCK_KEY, JSON.stringify(c)); else localStorage.removeItem(WORKOUT_CLOCK_KEY); } catch {} }
function clockClear(){ saveClock(null); syncClockTicker(); }
/** A set was just logged: start the clock (or restart it after a 90+ min gap) and note the time. */
function clockNoteSet(now = Date.now()){
  const c = loadClock();
  if (!c || now - c.lastSetAt > CLOCK_IDLE_MS) saveClock({ startedAt: now, lastSetAt: now });
  else saveClock({ ...c, lastSetAt: Math.max(c.lastSetAt, now) });
}
function clockEndAt(c, now = Date.now()){ return (now - c.lastSetAt > CLOCK_IDLE_MS) ? c.lastSetAt + CLOCK_TAIL_MS : now; }
function clockElapsedSec(now = Date.now()){
  const c = loadClock();
  return c ? Math.max(0, Math.floor((clockEndAt(c, now) - c.startedAt) / 1000)) : null;
}
/** Timing to save on a session (null when no set started the clock, e.g. sets ticked before v47). */
function workoutTiming(now = Date.now()){
  const c = loadClock();
  if (!c) return null;
  const durationSec = Math.max(0, Math.round((clockEndAt(c, now) - c.startedAt) / 1000));
  return { startedAt: new Date(c.startedAt).toISOString(), endedAt: new Date(c.startedAt + durationSec * 1000).toISOString(), durationSec };
}
function fmtClock(sec){
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}` : `${m}:${String(r).padStart(2,"0")}`;
}
function fmtDurMin(sec){
  const m = Math.max(1, Math.round((Number(sec) || 0) / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2,"0")} min`;
}
// Header clock: ticks once a second only while the page is visible and a clock is running.
let clockTimer = null;
function clockTick(){
  const sec = clockElapsedSec();
  if (sec == null) { syncClockTicker(); return; }
  document.querySelectorAll("[data-wclock]").forEach(el => { const t = fmtClock(sec); if (el.textContent !== t) el.textContent = t; });
}
function syncClockTicker(){
  const want = document.visibilityState !== "hidden" && !!loadClock() && !!document.querySelector("[data-wclock]");
  if (want && !clockTimer) clockTimer = setInterval(clockTick, 1000);
  else if (!want && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}
document.addEventListener("visibilitychange", () => { syncClockTicker(); if (document.visibilityState === "visible") clockTick(); });

function markSet(ei, si){
  const wasResolved = exerciseResolved(state.exercises[ei]);
  const prev = state.exercises[ei]?.setsLog?.[si];
  if (prev && !prev.ok && !prev.miss) clockNoteSet();
  state.exercises = state.exercises.map((ex,i) => {
    if (i!==ei) return ex;
    const log = ex.setsLog.map((s,j) => {
      if (j!==si) return s;
      const logged = s.ok || s.miss;
      if (!logged) {
        const r = s.reps ?? ex.reps;
        // Pass/fail only on rep-box tap: at/above target = ok, below = miss
        if (r >= ex.reps) return {ok:true, miss:false, reps:r};
        return {ok:false, miss:true, reps:r};
      }
      // Clear completion; keep any adjusted reps
      return s.reps != null ? {ok:false, miss:false, reps:s.reps} : {ok:false, miss:false};
    });
    return {...ex, skipped:false, setsLog:log};
  });
  const ex = state.exercises[ei];
  const justFinished = !wasResolved && exerciseResolved(ex) && !ex.skipped;
  if (justFinished) ensureExpandedEx().delete(ex.id);
  save(); render();
  return justFinished;
}
function bumpWeight(ei, d){
  state.exercises = state.exercises.map((ex,i) => i===ei ? {...ex, weight: clampKg(+(ex.weight+d).toFixed(1))} : ex);
  state.liftProgress = captureProgress(state.exercises, state.liftProgress);
  save(); render();
}
function bumpLevel(ei, d){
  state.exercises = state.exercises.map((ex,i) => {
    if (i!==ei || !ex.levels?.length) return ex;
    const next = Math.min(ex.levels.length-1, Math.max(0, (ex.levelIndex??0)+d));
    if (next === (ex.levelIndex??0)) return ex;
    let updated = {...ex, levelIndex: next};
    if (isHeaveLadder(updated)) {
      const stage = heaveStage(updated);
      updated = syncHeaveExercise({...updated, reps: stage.startReps, weight: 0, streak: 0, failStreak: 0});
    }
    if (isBenchLadder(updated)) {
      const stage = benchStage(updated);
      updated = syncBenchExercise({...updated, reps: stage.startReps, weight: stage.startWeight, streak: 0, failStreak: 0});
    }
    if (isCossackLadder(updated)) {
      const stage = cossackStage(updated);
      updated = syncCossackExercise({...updated, reps: stage.startReps, weight: stage.startWeight ?? 0, streak: 0, failStreak: 0});
    }
    return updated;
  });
  state.liftProgress = captureProgress(state.exercises, state.liftProgress);
  save(); render();
}
function skipExercise(ei){
  state.exercises = state.exercises.map((ex,i) => i===ei ? {...ex, skipped: !ex.skipped} : ex);
  save(); render();
}
function resetChecks(){
  state.exercises = state.exercises.map(ex => ({...ex, skipped:false, setsLog: blankSets(ex.sets)}));
  clearExpandedEx();
  clockClear();
  save(); render();
}
function setProgram(id, dayIndex=0){
  const program = getProgram(id);
  const day = Math.min(Math.max(0, dayIndex), program.days.length-1);
  const progress = captureProgress(state.exercises, state.liftProgress);
  state = {...state, programId: program.id, dayIndex: day, liftProgress: progress, exercises: applyProgress(seedProgram(program.id, day), progress, program.id)};
  clearExpandedEx();
  clockClear();
  save(); render();
}
function setDay(dayIndex){
  const program = getProgram(state.programId);
  const day = Math.min(Math.max(0, dayIndex), program.days.length-1);
  const progress = captureProgress(state.exercises, state.liftProgress);
  state.dayIndex = day;
  state.liftProgress = progress;
  state.exercises = applyProgress(seedProgram(state.programId, day), progress, state.programId);
  clearExpandedEx();
  clockClear();
  save(); render();
}
function addExercise(def){
  if (state.exercises.some(e => e.id === def.id)) return false;
  state.exercises = [...state.exercises, toExercise({...def, block: def.block || "Add-on"})];
  save(); return true;
}
function removeExercise(id){
  if (state.exercises.length <= 1) return false;
  state.exercises = state.exercises.filter(e => e.id !== id);
  save(); return true;
}
function logSession(){
  const notes = [];
  const lifts = [];
  const balanceHolds = [];
  const sessionExs = state.exercises;
  const progressSnap = state.liftProgress || {};
  const programId = state.programId;
  /** Apply a +kg bump or hold for balance. On hold: keep weight + reps, streak stays at 3 so next clean retries. */
  function takeKgBump(ex, nextWeight, nextReps, streakAfterOk, successNote){
    const hold = balanceKgHold(programId, ex, nextWeight, sessionExs, progressSnap);
    if (hold) {
      notes.push(`${ex.name}: held for balance — stays ${hold.weight} kg until ${hold.ceilingName} moves up (now ${hold.ceilingWeight} kg)`);
      balanceHolds.push(hold);
      return { weight: ex.weight, reps: ex.reps, streak: 3, held: true };
    }
    notes.push(successNote);
    return { weight: nextWeight, reps: nextReps, streak: streakAfterOk, held: false };
  }
  const exercises = state.exercises.map(ex => {
    const touched = ex.setsLog.some(s => s.ok || s.miss);
    if (ex.skipped || !touched) {
      if (ex.skipped) notes.push(`${ex.name}: skipped`);
      return {...ex, skipped:false, setsLog: blankSets(ex.sets)};
    }
    // Snapshot working targets before wave / progression bumps
    const workedWeight = ex.weight;
    const workedReps = ex.reps;
    const all = ex.setsLog.every(s => s.ok || s.miss);
    // Enforce: ok only when reps >= target; otherwise treat as miss
    const setsLog = ex.setsLog.map(s => {
      if (!s.ok && !s.miss) return s;
      const r = s.reps ?? ex.reps;
      if (r >= ex.reps) return {ok:true, miss:false, reps:r};
      return {ok:false, miss:true, reps:r};
    });
    const clean = all && setsLog.every(s => s.ok && !s.miss);
    const lastSet = setsLog[setsLog.length - 1];
    const lastReps = lastSet?.reps ?? ex.reps;
    const amrapHit = usesAmrap(ex) && clean && lastReps >= ex.reps + AMRAP_BONUS;
    const liftEntry = { id: ex.id, name: ex.name, weight: workedWeight, reps: workedReps, clean, sets: setsLog.map(s => ({ok:!!s.ok, miss:!!s.miss, reps:s.reps ?? null})) };
    if (usesAmrap(ex)) liftEntry.amrapReps = lastReps;
    lifts.push(liftEntry);
    if (!all) { notes.push(`${ex.name}: incomplete`); return {...ex, setsLog: blankSets(ex.sets)}; }
    if (!clean) {
      let failStreak = (ex.failStreak||0)+1;
      let {reps, weight} = ex;
      if (failStreak >= 3) {
        failStreak = 0;
        if (ex.bw) {
          if (weight !== 0) {
            weight = clampKg(+(weight-2.5).toFixed(1));
            notes.push(`${ex.name}: RESET WEEK — ${fmtKg(weight)} kg × ${reps}`);
          } else {
            if (reps>6) reps-=2;
            notes.push(`${ex.name}: RESET WEEK — reps back to ${reps}`);
          }
        } else {
          weight = clampKg(+(weight-2.5).toFixed(1));
          if (ex.cap) notes.push(`${ex.name}: RESET WEEK — ${fmtKg(weight)} kg × ${reps}`);
          else { if (reps>8) reps-=2; notes.push(`${ex.name}: RESET WEEK — ${fmtKg(weight)} kg × ${reps}`); }
        }
      } else notes.push(`${ex.name}: no-rep ${failStreak}/3 — stay at ${reps}`);
      return {...ex, streak:0, failStreak, reps, weight, setsLog: blankSets(ex.sets)};
    }
    if (isWaveProgram(state.programId, ex)) {
      // Ember / Anvil / Titan shared ladder: 6 → 8 → 10 → 12, then 6 +2.5kg
      // Heave ladder + TITAN plate-bench → barbell graduate
      // AMRAP last-set (+2 over target) bumps load immediately — skips wave climb this session
      // Balance chain only gates kg bumps (not wave climbs or stage graduates)
      let streak = (ex.streak||0) + 1;
      let {reps, weight} = ex;
      let levelIndex = ex.levelIndex ?? 0;
      if (amrapHit) {
        streak = 0;
        if (isBenchLadder(ex)) {
          const idx = levelIndex;
          const stage = BENCH_STAGES[Math.min(idx, BENCH_STAGES.length-1)];
          const last = idx >= BENCH_STAGES.length - 1;
          if (!last && !stage.useBar && reps === 12 && weight >= 10) {
            levelIndex = idx + 1;
            const nextStage = BENCH_STAGES[levelIndex];
            reps = nextStage.startReps; weight = nextStage.startWeight;
            notes.push(`${ex.name}: AMRAP ${lastReps} → graduated → ${nextStage.name}`);
          } else {
            const bumped = +(weight + 2.5).toFixed(1);
            const r = takeKgBump(ex, bumped, reps, 0, `${ex.name}: AMRAP ${lastReps} → +2.5kg · ${bumped}kg × ${reps}`);
            weight = r.weight; reps = r.reps; streak = r.streak;
          }
        } else {
          // Full heaves (final stage) and normal wave lifts: +2.5kg, keep reps
          const bumped = +(weight + 2.5).toFixed(1);
          const r = takeKgBump(ex, bumped, reps, 0, `${ex.name}: AMRAP ${lastReps} → +2.5kg · ${bumped}kg × ${reps}`);
          weight = r.weight; reps = r.reps; streak = r.streak;
        }
      } else if (streak < 3) {
        const sec = isPlankSeconds(ex);
        notes.push(`${ex.name}: clean streak ${streak}/3 at 3×${reps}${sec?"s":""}`);
      } else if (isHeaveLadder(ex)) {
        const idx = levelIndex;
        const stage = HEAVE_STAGES[Math.min(idx, HEAVE_STAGES.length-1)];
        const last = idx >= HEAVE_STAGES.length - 1;
        if (stage.seconds) {
          if (reps < 30) {
            reps = 30; streak = 0;
            notes.push(`${ex.name}: wave → 3×30s`);
          } else if (!last) {
            levelIndex = idx + 1; reps = 6; weight = 0; streak = 0;
            notes.push(`${ex.name}: graduated → ${HEAVE_STAGES[levelIndex].name}`);
          } else {
            reps = 20; streak = 0;
            notes.push(`${ex.name}: wave → 3×20s`);
          }
        } else {
          const atGraduatePoint = WAVE_REPS.indexOf(reps) === WAVE_REPS.length - 1;
          if (atGraduatePoint && !last) {
            levelIndex = idx + 1; reps = 6; weight = 0; streak = 0;
            notes.push(`${ex.name}: graduated → ${HEAVE_STAGES[levelIndex].name}`);
          } else {
            // Heave ladder kg bumps are skipped from the balance chain (BW / no clear ceiling)
            const step = nextWaveStep(reps, weight);
            reps = step.reps; weight = step.weight; streak = 0;
            notes.push(`${ex.name}: ${step.note}`);
          }
        }
      } else if (isCossackLadder(ex)) {
        const idx = levelIndex;
        const last = idx >= COSSACK_STAGES.length - 1;
        const atGraduatePoint = WAVE_REPS.indexOf(reps) === WAVE_REPS.length - 1;
        if (atGraduatePoint && !last) {
          levelIndex = idx + 1;
          const nextStage = COSSACK_STAGES[levelIndex];
          reps = nextStage.startReps; weight = nextStage.startWeight ?? 0; streak = 0;
          notes.push(`${ex.name}: graduated → ${nextStage.name}`);
        } else {
          const step = nextWaveStep(reps, weight);
          if (step.weight > weight) {
            const r = takeKgBump(ex, step.weight, step.reps, 0, `${ex.name}: ${step.note}`);
            weight = r.weight; reps = r.reps; streak = r.streak;
          } else {
            reps = step.reps; weight = step.weight; streak = 0;
            notes.push(`${ex.name}: ${step.note}`);
          }
        }
      } else if (isBenchLadder(ex)) {
        const idx = levelIndex;
        const stage = BENCH_STAGES[Math.min(idx, BENCH_STAGES.length-1)];
        const last = idx >= BENCH_STAGES.length - 1;
        const atTopWave = WAVE_REPS.indexOf(reps) === WAVE_REPS.length - 1;
        // 3 clean at 3×12 with plate weight ≥ 10 kg → Bench Press 3×6 @ 20 kg
        if (!last && !stage.useBar && atTopWave && weight >= 10) {
          levelIndex = idx + 1;
          const nextStage = BENCH_STAGES[levelIndex];
          reps = nextStage.startReps; weight = nextStage.startWeight; streak = 0;
          notes.push(`${ex.name}: graduated → ${nextStage.name}`);
        } else {
          const step = nextWaveStep(reps, weight);
          if (step.weight > weight) {
            const r = takeKgBump(ex, step.weight, step.reps, 0, `${ex.name}: ${step.note}`);
            weight = r.weight; reps = r.reps; streak = r.streak;
          } else {
            reps = step.reps; weight = step.weight; streak = 0;
            notes.push(`${ex.name}: ${step.note}`);
          }
        }
      } else if (isPlankSeconds(ex)) {
        if (reps < 30) {
          reps = 30; streak = 0;
          notes.push(`${ex.name}: wave → 3×30s`);
        } else {
          reps = 20; streak = 0;
          notes.push(`${ex.name}: wave → 3×20s (no kg)`);
        }
      } else if (ex.finisher) {
        const step = nextWaveStep(reps, weight);
        streak = 0;
        if (step.weight > weight) notes.push(`${ex.name}: finisher — hold 3×${reps}, no kg`);
        else { reps = step.reps; notes.push(`${ex.name}: ${step.note}`); }
      } else {
        const step = nextWaveStep(reps, weight);
        if (step.weight > weight) {
          const r = takeKgBump(ex, step.weight, step.reps, 0, `${ex.name}: ${step.note}`);
          weight = r.weight; reps = r.reps; streak = r.streak;
        } else {
          reps = step.reps; weight = step.weight; streak = 0;
          notes.push(`${ex.name}: ${step.note}`);
        }
      }
      let out = {...ex, streak, failStreak:0, reps, weight, levelIndex, setsLog: blankSets(ex.sets)};
      if (isHeaveLadder(out)) out = syncHeaveExercise(out);
      if (isBenchLadder(out)) out = syncBenchExercise(out);
      if (isCossackLadder(out)) out = syncCossackExercise(out);
      return out;
    }
    let {reps, weight} = ex;
    let levelIndex = ex.levelIndex ?? 0;
    if (amrapHit) {
      if (weight > 0 || !ex.bw) {
        const bumped = +(weight + 2.5).toFixed(1);
        const r = takeKgBump(ex, bumped, reps, 0, `${ex.name}: AMRAP ${lastReps} → +2.5kg · ${bumped}kg × ${reps}`);
        weight = r.weight; reps = r.reps;
        return {...ex, streak:r.streak, failStreak:0, reps, weight, levelIndex, setsLog: blankSets(ex.sets)};
      } else {
        reps = Math.max(ex.reps + 2, lastReps);
        notes.push(`${ex.name}: AMRAP ${lastReps} → reps ${reps}`);
      }
      return {...ex, streak:0, failStreak:0, reps, weight, levelIndex, setsLog: blankSets(ex.sets)};
    }
    const minLogged = Math.min(...setsLog.map(s => s.reps ?? ex.reps));
    // Carry-forward: all sets clean above target → raise range immediately
    if (minLogged > ex.reps) {
      reps = minLogged;
      notes.push(`${ex.name}: target → ${reps} (from logged sets)`);
      return {...ex, streak:1, failStreak:0, reps, weight, levelIndex, setsLog: blankSets(ex.sets)};
    }
    let streak = ex.streak+1;
    if (streak >= 3) {
      streak = 0;
      if (ex.levels?.length) {
        const last = levelIndex >= ex.levels.length-1;
        if (!last && reps >= (ex.cap||10)) { levelIndex += 1; reps = 5; notes.push(`${ex.name}: ${ex.levels[levelIndex]} · start at ${reps}`); }
        else { reps += 2; notes.push(`${ex.name}: reps → ${reps} · ${ex.levels[levelIndex]}`); }
      } else if (ex.bw) {
        if (ex.nocap || reps < (ex.cap||16)) { reps += 2; notes.push(`${ex.name}: reps → ${reps}`); }
        else {
          const bumped = +(weight+2.5).toFixed(1);
          const r = takeKgBump(ex, bumped, reps, 3, `${ex.name}: +2.5kg → ${bumped}`);
          weight = r.weight; reps = r.reps; streak = r.held ? 3 : 0;
        }
      } else if (ex.cap && reps >= ex.cap) {
        const bumped = +(weight+2.5).toFixed(1);
        const r = takeKgBump(ex, bumped, reps, 3, `${ex.name}: +2.5kg → ${bumped}`);
        weight = r.weight; reps = r.reps; streak = r.held ? 3 : 0;
      } else if (reps >= 12) {
        const bumped = +(weight+2.5).toFixed(1);
        const r = takeKgBump(ex, bumped, 8, 3, `${ex.name}: +2.5kg → ${bumped}, reps 8`);
        weight = r.weight; reps = r.reps; streak = r.held ? 3 : 0;
      }
      else { reps += 2; notes.push(`${ex.name}: reps → ${reps}`); }
    } else notes.push(`${ex.name}: clean ${streak}/3 at ${reps}`);
    return {...ex, streak, failStreak:0, reps, weight, levelIndex, setsLog: blankSets(ex.sets)};
  });
  state.exercises = exercises;
  state.liftProgress = captureProgress(exercises, state.liftProgress);
  const dayLabel = getProgram(programId)?.days?.[state.dayIndex]?.label || "";
  const timing = workoutTiming();
  state.history = [{date:new Date().toISOString(), programId, day: dayLabel, notes, lifts, ...(timing || {})}, ...state.history].slice(0,HISTORY_MAX);
  clockClear();
  ui.pendingHolds = balanceHolds.length ? balanceHolds : null;
  save();
  newLocalActivity();
  syncSoon();
  return notes;
}


async function applyUpdate(){
  const reg = ui.swReg || (await navigator.serviceWorker.getRegistration());
  const waiting = reg && reg.waiting;
  if (waiting) {
    ui.refreshing = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
    setTimeout(() => location.reload(), 1500);
    return;
  }
  try { await reg?.update(); } catch {}
  location.reload();
}

async function checkForUpdate(){
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) {
    toast("Updates need the web app", "Open the GitHub Pages link, not a downloaded file.");
    return;
  }
  ui.updateChecking = true;
  toast("Checking…");
  render();
  try {
    const reg = ui.swReg || (await navigator.serviceWorker.getRegistration());
    if (!reg) {
      toast("No service worker yet");
      ui.updateChecking = false;
      render();
      return;
    }
    await reg.update();
    await new Promise((r) => setTimeout(r, 600));
    const pending = Boolean(reg.waiting || (reg.installing && navigator.serviceWorker.controller));
    if (pending || ui.updateReady) {
      ui.updateReady = true;
      toast("Update available");
    } else {
      toast("You're on the latest");
    }
  } catch {
    toast("Check failed");
  }
  ui.updateChecking = false;
  render();
}

function toast(msg, desc){
  const el = document.getElementById("toast");
  el.textContent = desc ? `${msg} — ${desc}` : msg;
  el.classList.remove("hide");
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => el.classList.add("hide"), 2800);
}

function clearTick(){ if (tick) { clearInterval(tick); tick = null; } }
function cueGo(){
  ui.running = false; ui.isGo = true; ui.remain = 0; remainVal = 0;
  cueComplete();
  if (navigator.vibrate) navigator.vibrate([180,70,180,70,280]);
  render();
}
// Rest runs off an end timestamp, so time with the screen locked / app in the background still counts
// (phones freeze or throttle intervals). On return: overdue → GO once; mid-countdown → only that second's cue.
let restEndAt = 0;
function restLeft(){ return Math.max(0, Math.ceil((restEndAt - Date.now()) / 1000)); }
function restTick(){
  if (!ui.running || !restEndAt) return;
  const r = restLeft();
  if (r <= 0) { clearTick(); restEndAt = 0; cueGo(); return; }
  if ((r===3||r===2||r===1) && lastCue !== r) { lastCue = r; cueCountdown(r); if (navigator.vibrate) navigator.vibrate(80); }
  if (r !== remainVal) { remainVal = r; ui.remain = r; renderTimerOnly(); }
}
function startRest(sec){
  clearTick(); lastCue = -1; ui.isGo = false; remainVal = sec; ui.remain = sec; ui.running = true;
  restEndAt = Date.now() + sec * 1000;
  render();
  tick = setInterval(restTick, 250);
}
function stopRest(){ clearTick(); restEndAt = 0; ui.running=false; ui.remain=0; remainVal=0; ui.isGo=false; }
function adjustRest(d){
  if (ui.running && tick && restEndAt) {
    const next = Math.max(5, restLeft() + d);
    restEndAt = Date.now() + next * 1000;
    if (next > 3) lastCue = -1;
    remainVal = next; ui.remain = next; render(); return;
  }
  const base = remainVal > 0 ? remainVal : (ui.remain || 90);
  startRest(Math.max(5, base + d));
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") restTick(); });
window.addEventListener("focus", () => restTick());

function bumpSetReps(ei, si, delta){
  const ex0 = state.exercises[ei];
  if (!ex0 || ex0.skipped) return;
  state.exercises = state.exercises.map((ex,i) => {
    if (i!==ei) return ex;
    const target = ex.reps;
    const max = maxRep(ex) || 50;
    const log = ex.setsLog.map((s,j) => {
      if (j!==si) return s;
      const cur = s.reps ?? target;
      const next = Math.max(0, Math.min(max, cur + delta));
      // −/+ only adjust displayed reps; never mark complete/miss
      return {...s, reps:next};
    });
    return {...ex, setsLog:log};
  });
  save(); render();
}
function onMark(ei, si){
  unlockAudio();
  const before = state.exercises[ei].setsLog[si];
  const starting = !before.ok && !before.miss;
  const justFinished = markSet(ei, si);
  if (starting) startRest(state.exercises[ei].rest);
  if (justFinished) scheduleJumpToNextIncomplete();
}
function onLog(){
  const startedOpen = state.exercises.some(ex => {
    if (ex.skipped) return false;
    const touched = ex.setsLog.some(s => s.ok || s.miss);
    if (!touched) return false;
    return !ex.setsLog.every(s => s.ok || s.miss);
  });
  if (startedOpen) { toast("Finish or skip the lifts you started"); return; }
  const anyWork = state.exercises.some(ex => !ex.skipped && ex.setsLog.some(s => s.ok || s.miss));
  if (!anyWork) { toast("Tick a set first — blank lifts are skipped"); return; }
  const notes = logSession();
  const program = getProgram(state.programId);
  if (program.days.length > 1) {
    setDay((state.dayIndex + 1) % program.days.length);
  }
  toast("Session logged", notes.slice(0,3).join(" · "));
  clearExpandedEx();
  stopRest();
  if (ui.pendingHolds?.length) {
    ui.panel = "balance-hold";
  } else {
    const lastKg = state.bodyWeightLog[0]?.kg;
    ui.bwDraftKg = (typeof lastKg === "number" && lastKg > 0) ? lastKg : null;
    ui.bwLinkSession = true;
    ui.panel = "bodyweight";
  }
  render();
}
function dismissBalanceHold(){
  ui.pendingHolds = null;
  const lastKg = state.bodyWeightLog[0]?.kg;
  ui.bwDraftKg = (typeof lastKg === "number" && lastKg > 0) ? lastKg : null;
  ui.bwLinkSession = true;
  ui.panel = "bodyweight";
  render();
}

function openBodyWeightPrompt(linkSession){
  const lastKg = state.bodyWeightLog[0]?.kg;
  ui.bwDraftKg = (typeof lastKg === "number" && lastKg > 0) ? lastKg : null;
  ui.bwLinkSession = !!linkSession;
  ui.panel = "bodyweight";
  render();
}

function bumpBodyWeight(delta){
  const base = (typeof ui.bwDraftKg === "number" && ui.bwDraftKg > 0) ? ui.bwDraftKg : (state.bodyWeightLog[0]?.kg || 70);
  ui.bwDraftKg = Math.max(20, Math.min(300, +(base + delta).toFixed(1)));
  render();
}

function saveBodyWeight(){
  const kg = typeof ui.bwDraftKg === "number" ? +ui.bwDraftKg.toFixed(1) : 0;
  if (!(kg > 0)) { toast("Set your body weight"); return; }
  const date = (ui.bwLinkSession && state.history[0]?.date) ? state.history[0].date : new Date().toISOString();
  if (ui.bwLinkSession && state.history[0]) {
    state.history[0] = {...state.history[0], bodyWeightKg: kg};
  }
  state.bodyWeightLog = [{ date, kg }, ...(state.bodyWeightLog || [])].slice(0, BODYWEIGHT_MAX);
  newLocalActivity();
  save();
  toast("Body weight saved", `${kg} kg`);
  ui.bwLinkSession = false;
  ui.panel = "settings";
  ui.settingsTab = "progress";
  render();
}

function skipBodyWeight(){
  ui.bwLinkSession = false;
  ui.panel = "settings";
  ui.settingsTab = "progress";
  render();
}
