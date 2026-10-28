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
  state.exercises = state.exercises.map((ex,i) => i===ei ? {...ex, weight: clampKg(+(ex.weight+d).toFixed(2))} : ex);
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
/** Toggle skip. Skipping can carry a reason id (SKIP_REASONS) + note for "other"; unskipping clears both. */
function skipExercise(ei, reason, note){
  state.exercises = state.exercises.map((ex,i) => {
    if (i!==ei) return ex;
    const { skipReason, skipNote, ...rest } = ex;
    if (ex.skipped) return {...rest, skipped:false};
    const r = skipReasonId(reason), n = r === "other" ? cleanSkipNote(note) : "";
    return {...rest, skipped:true, ...(r ? { skipReason:r } : {}), ...(n ? { skipNote:n } : {})};
  });
  save(); render();
}
/** Skip button: a skipped lift unskips at once; otherwise ask why first (Cancel = no skip). */
function onSkipTap(ei){
  const ex = state.exercises[ei];
  if (!ex) return;
  if (ex.skipped) { skipExercise(ei); afterSkipToggle(ei); return; }
  ui.skipAsk = { ei, other:false, note:"" };
  ui.panel = "skip-why";
  render();
}
function chooseSkipReason(reason){
  const ask = ui.skipAsk;
  if (!ask || !skipReasonId(reason)) return;
  if (reason === "other" && !ask.other) { ui.skipAsk = {...ask, other:true}; render(); document.querySelector("[data-skip-note]")?.focus(); return; }
  const note = reason === "other" ? (document.querySelector("[data-skip-note]")?.value ?? ask.note ?? "") : "";
  ui.skipAsk = null; ui.panel = "none";
  skipExercise(ask.ei, reason, note);
  afterSkipToggle(ask.ei);
}
function cancelSkip(){ ui.skipAsk = null; ui.panel = "none"; render(); }
function afterSkipToggle(ei){ if (ei===currentIndex(state.exercises)) { stopRest(); render(); } }
function resetChecks(){
  state.exercises = state.exercises.map(({skipReason, skipNote, ...ex}) => ({...ex, skipped:false, setsLog: blankSets(ex.sets)}));
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
  state.exercises = [...state.exercises, applyEdits(toExercise({...def, block: def.block || "Add-on"}), state.programId, state.exerciseEdits)];
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
  const skips = [];
  const exercises = state.exercises.map(({skipReason, skipNote, ...ex}) => {
    const touched = ex.setsLog.some(s => s.ok || s.miss);
    if (ex.skipped || !touched) {
      if (ex.skipped) {
        const why = skipReasonText(skipReason, skipNote);
        notes.push(why ? `${ex.name}: Skipped: ${why}` : `${ex.name}: skipped`);
        const r = skipReasonId(skipReason), n = cleanSkipNote(skipNote);
        skips.push({ id: ex.id, name: ex.name, ...(r ? { reason: r, reasonText: why } : {}), ...(r === "other" && n ? { note: n } : {}) });
      }
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
    if (!clean && isNeckIso(ex)) {
      // Neck iso: 3 short sessions → drop 5 s (never below 5 s). No kg involved.
      let failStreak = (ex.failStreak||0)+1;
      let reps = ex.reps;
      if (failStreak >= 3) {
        failStreak = 0;
        reps = Math.max(NECK_START, reps - neckStepFor(ex));
        notes.push(`${ex.name}: RESET WEEK — back to ${reps}s each`);
      } else notes.push(`${ex.name}: short hold ${failStreak}/3 — stay at ${reps}s`);
      return {...ex, streak:0, failStreak, reps, weight:0, setsLog: blankSets(ex.sets)};
    }
    if (isNeckIso(ex)) {
      // Neck iso (v50): every clean session adds 5 s per direction, capped at 20 s. Outside the kg wave / balance chain.
      const nMax = neckMaxFor(ex);
      const reps = Math.min(nMax, Math.max(NECK_START, (Number(ex.reps)||NECK_START) + neckStepFor(ex)));
      notes.push(reps > ex.reps ? `${ex.name}: hold → ${reps}s each` : `${ex.name}: max ${nMax}s each — hold there`);
      return {...ex, streak:0, failStreak:0, reps, weight:0, setsLog: blankSets(ex.sets)};
    }
    if (!clean) {
      let failStreak = (ex.failStreak||0)+1;
      let {reps, weight} = ex;
      if (failStreak >= 3) {
        failStreak = 0;
        if (ex.bw) {
          if (weight !== 0) {
            weight = clampKg(+(weight-kgStepFor(ex)).toFixed(2));
            notes.push(`${ex.name}: RESET WEEK — ${fmtKg(weight)} kg × ${reps}`);
          } else {
            if (reps>6) reps-=2;
            notes.push(`${ex.name}: RESET WEEK — reps back to ${reps}`);
          }
        } else {
          weight = clampKg(+(weight-kgStepFor(ex)).toFixed(2));
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
      const kgStep = kgStepFor(ex), rungs = waveRepsFor(ex), topRung = rungs[rungs.length - 1];
      if (amrapHit) {
        streak = 0;
        if (isBenchLadder(ex)) {
          const idx = levelIndex;
          const stage = BENCH_STAGES[Math.min(idx, BENCH_STAGES.length-1)];
          const last = idx >= BENCH_STAGES.length - 1;
          if (!last && !stage.useBar && reps >= topRung && weight >= 10) {
            levelIndex = idx + 1;
            const nextStage = BENCH_STAGES[levelIndex];
            reps = nextStage.startReps; weight = nextStage.startWeight;
            notes.push(`${ex.name}: AMRAP ${lastReps} → graduated → ${nextStage.name}`);
          } else {
            const bumped = +(weight + kgStep).toFixed(2);
            const r = takeKgBump(ex, bumped, reps, 0, `${ex.name}: AMRAP ${lastReps} → +${fmtStep(kgStep)}kg · ${bumped}kg × ${reps}`);
            weight = r.weight; reps = r.reps; streak = r.streak;
          }
        } else {
          // Full heaves (final stage) and normal wave lifts: +2.5kg, keep reps
          const bumped = +(weight + kgStep).toFixed(2);
          const r = takeKgBump(ex, bumped, reps, 0, `${ex.name}: AMRAP ${lastReps} → +${fmtStep(kgStep)}kg · ${bumped}kg × ${reps}`);
          weight = r.weight; reps = r.reps; streak = r.streak;
        }
      } else if (streak < 3) {
        const sec = isPlankSeconds(ex);
        notes.push(`${ex.name}: clean streak ${streak}/3 at ${ex.sets}×${reps}${sec?"s":""}`);
      } else if (isHeaveLadder(ex)) {
        const idx = levelIndex;
        const stage = HEAVE_STAGES[Math.min(idx, HEAVE_STAGES.length-1)];
        const last = idx >= HEAVE_STAGES.length - 1;
        if (stage.seconds) {
          if (reps < 30) {
            reps = 30; streak = 0;
            notes.push(`${ex.name}: wave → 3×30s`);
          } else if (!last) {
            levelIndex = idx + 1; reps = rungs[0]; weight = 0; streak = 0;
            notes.push(`${ex.name}: graduated → ${HEAVE_STAGES[levelIndex].name}`);
          } else {
            reps = 20; streak = 0;
            notes.push(`${ex.name}: wave → 3×20s`);
          }
        } else {
          const atGraduatePoint = reps >= topRung;
          if (atGraduatePoint && !last) {
            levelIndex = idx + 1; reps = rungs[0]; weight = 0; streak = 0;
            notes.push(`${ex.name}: graduated → ${HEAVE_STAGES[levelIndex].name}`);
          } else {
            // Heave ladder kg bumps are skipped from the balance chain (BW / no clear ceiling)
            const step = nextWaveStep(reps, weight, ex);
            reps = step.reps; weight = step.weight; streak = 0;
            notes.push(`${ex.name}: ${step.note}`);
          }
        }
      } else if (isCossackLadder(ex)) {
        const idx = levelIndex;
        const last = idx >= COSSACK_STAGES.length - 1;
        const atGraduatePoint = reps >= topRung;
        if (atGraduatePoint && !last) {
          levelIndex = idx + 1;
          const nextStage = COSSACK_STAGES[levelIndex];
          reps = nextStage.startReps; weight = nextStage.startWeight ?? 0; streak = 0;
          notes.push(`${ex.name}: graduated → ${nextStage.name}`);
        } else {
          const step = nextWaveStep(reps, weight, ex);
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
        const atTopWave = reps >= topRung;
        // 3 clean at 3×12 with plate weight ≥ 10 kg → Bench Press 3×6 @ 20 kg
        if (!last && !stage.useBar && atTopWave && weight >= 10) {
          levelIndex = idx + 1;
          const nextStage = BENCH_STAGES[levelIndex];
          reps = nextStage.startReps; weight = nextStage.startWeight; streak = 0;
          notes.push(`${ex.name}: graduated → ${nextStage.name}`);
        } else {
          const step = nextWaveStep(reps, weight, ex);
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
        const step = nextWaveStep(reps, weight, ex);
        streak = 0;
        if (step.weight > weight) notes.push(`${ex.name}: finisher — hold ${ex.sets}×${reps}, no kg`);
        else { reps = step.reps; notes.push(`${ex.name}: ${step.note}`); }
      } else {
        const step = nextWaveStep(reps, weight, ex);
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
    const kgStep = kgStepFor(ex), sKg = fmtStep(kgStep);
    // Edited rep range (v51): top replaces the built-in cap / 12, low is where reps restart after a kg bump
    const capTop = ex.repTop ?? ex.cap, restartReps = ex.repLow ?? 8;
    if (amrapHit) {
      if (weight > 0 || !ex.bw) {
        const bumped = +(weight + kgStep).toFixed(2);
        const r = takeKgBump(ex, bumped, reps, 0, `${ex.name}: AMRAP ${lastReps} → +${sKg}kg · ${bumped}kg × ${reps}`);
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
        if ((ex.nocap && ex.repTop == null) || reps < (capTop||16)) { reps += 2; notes.push(`${ex.name}: reps → ${reps}`); }
        else {
          const bumped = +(weight+kgStep).toFixed(2);
          const r = takeKgBump(ex, bumped, reps, 3, `${ex.name}: +${sKg}kg → ${bumped}`);
          weight = r.weight; reps = r.reps; streak = r.held ? 3 : 0;
        }
      } else if (capTop && reps >= capTop && ex.repTop == null) {
        const bumped = +(weight+kgStep).toFixed(2);
        const r = takeKgBump(ex, bumped, reps, 3, `${ex.name}: +${sKg}kg → ${bumped}`);
        weight = r.weight; reps = r.reps; streak = r.held ? 3 : 0;
      } else if (reps >= (ex.repTop ?? 12)) {
        const bumped = +(weight+kgStep).toFixed(2);
        const r = takeKgBump(ex, bumped, restartReps, 3, `${ex.name}: +${sKg}kg → ${bumped}, reps ${restartReps}`);
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
  state.history = [{date:new Date().toISOString(), programId, day: dayLabel, notes, lifts, ...(skips.length ? { skips } : {}), ...(timing || {})}, ...state.history].slice(0,HISTORY_MAX);
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
function startRest(sec, mode){
  clearTick(); lastCue = -1; ui.isGo = false; remainVal = sec; ui.remain = sec; ui.running = true;
  ui.restMode = mode === "switch" ? "switch" : "rest";
  restEndAt = Date.now() + sec * 1000;
  render();
  tick = setInterval(restTick, 250);
}
function stopRest(){ clearTick(); restEndAt = 0; ui.running=false; ui.remain=0; remainVal=0; ui.isGo=false; ui.restMode="rest"; }
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
/** v52: first tap on a single-side set = side 1 done (set stays open, marked half). No pass/fail, no progression. */
function markHalf(ei, si){
  clockNoteSet();
  state.exercises = state.exercises.map((ex,i) => i!==ei ? ex : {...ex, skipped:false, setsLog: ex.setsLog.map((s,j) => j===si ? {...s, half:true} : s)});
  save(); render();
}
function onMark(ei, si){
  unlockAudio();
  const ex0 = state.exercises[ei];
  const before = ex0.setsLog[si];
  const starting = !before.ok && !before.miss;
  const sw = switchSecFor(ex0);
  if (starting && !before.half && sw > 0 && !ex0.skipped) {
    markHalf(ei, si);
    startRest(sw, "switch");
    cueSwitch();
    if (navigator.vibrate) navigator.vibrate([120,60,120]);
    return;
  }
  const justFinished = markSet(ei, si);
  if (starting) startRest(state.exercises[ei].rest);
  if (justFinished) scheduleJumpToNextIncomplete();
}
function onLog(){
  const startedOpen = state.exercises.some(ex => {
    if (ex.skipped) return false;
    const touched = ex.setsLog.some(s => s.ok || s.miss || s.half);
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

// ---- v51 Edit an exercise (pencil on each card + in the Remove list) ----
/** What the Edit sheet shows for this lift. */
function editKind(ex){
  const timed = isPlankSeconds(ex), neck = isNeckIso(ex);
  return {
    neck, timed,
    ladder: isStageLadder(ex),
    wave: isWaveProgram(state.programId, ex) && !timed,
    kg: !timed,                       // working kg (BW lifts too — negative = assisted)
    kgStep: !timed && !ex.finisher,   // finishers never add kg
    range: !timed,
    names: !isStageLadder(ex),        // ladder names/notes follow the stage
    switch: !!ex.bilateral,           // "each side" lifts get the switch-sides timer
  };
}
/** Built-in (unedited) rep range for a lift: wave rungs 6–12, or the old double-progression cap. */
function baseRange(ex){
  const plain = applyEdits(ex, state.programId, {});
  if (isWaveProgram(state.programId, plain)) { const r = waveRepsFor(plain); return [r[0], r[r.length - 1]]; }
  const top = plain.cap || 12;
  return [Math.min(plain.reps || 8, 8, top), top];
}
function editDraftFrom(ex, ei){
  const k = editKind(ex), [bl, bt] = baseRange(ex);
  return {
    ei, id: ex.id, name: ex.name, note: ex.note || "", sets: ex.sets, reps: ex.reps, repsPick: ex.reps, rest: ex.rest,
    weight: Number(ex.weight) || 0, kgStep: kgStepFor(ex),
    repLow: ex.repLow ?? (k.wave ? waveRepsFor(ex)[0] : bl), repTop: ex.repTop ?? (k.wave ? waveRepsFor(ex).slice(-1)[0] : bt),
    secStep: neckStepFor(ex), secMax: neckMaxFor(ex), switchSec: switchSecFor(ex), msg: "",
  };
}
function openExerciseEdit(ei){
  const ex = state.exercises[ei];
  if (!ex) return;
  ui.editEx = editDraftFrom(ex, ei);
  ui.panel = "edit-ex";
  render();
}
function cancelExerciseEdit(){ ui.editEx = null; ui.panel = "none"; render(); }
function draftRungs(d){ return waveRepsFor({repLow: d.repLow, repTop: d.repTop}); }
function editStep(field, dir){
  const d = ui.editEx; if (!d) return;
  const ex = state.exercises[d.ei]; if (!ex) return;
  const k = editKind(ex);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  d.msg = "";
  if (field === "sets") d.sets = clamp(d.sets + dir, 1, 10);
  else if (field === "rest") d.rest = clamp(Math.round((d.rest + dir * 15) / 15) * 15, 15, 600);
  else if (field === "weight") d.weight = clamp(+(d.weight + dir * d.kgStep).toFixed(2), KG_FLOOR, 500);
  else if (field === "repLow") { d.repLow = clamp(d.repLow + dir, 1, 50); if (d.repTop < d.repLow) d.repTop = d.repLow; }
  else if (field === "repTop") d.repTop = clamp(d.repTop + dir, d.repLow, 60);
  else if (field === "secStep") d.secStep = clamp(d.secStep + dir, 1, 30);
  else if (field === "switchSec") d.switchSec = clamp(Math.round((d.switchSec + dir * 5) / 5) * 5, 0, 60);
  else if (field === "secMax") d.secMax = clamp(d.secMax + dir * 5, Math.max(NECK_START, 5), 300);
  else if (field === "reps") {
    if (k.neck) d.reps = clamp(d.reps + dir, NECK_START, d.secMax);
    else if (k.timed) d.reps = clamp(d.reps + dir * 5, 5, 600);
    else d.reps = clamp(d.reps + dir, 1, 60);
  }
  if (field === "reps") d.repsPick = d.reps;
  // Snap from the reps last picked, so stepping the range around doesn't ratchet the target upwards
  if (k.wave && (field === "repLow" || field === "repTop")) d.reps = snapWaveRep(d.repsPick ?? d.reps, draftRungs(d));
  if (k.neck && d.reps > d.secMax) d.reps = d.secMax;
  render();
}
function editSetKgStep(v){
  const d = ui.editEx; const n = Number(v);
  if (!d || !KG_STEP_OPTS.includes(n)) return;
  d.kgStep = n; d.msg = ""; render();
}
function editSetReps(v){ const d = ui.editEx; if (!d) return; d.reps = d.repsPick = Number(v); d.msg = ""; render(); }
/** Reset to default: fill the sheet with the program's settings. Working kg + target reps are progress, so they stay
 *  (target reps only snap onto the default wave rungs). Nothing changes until Save. */
function resetExerciseEditDraft(){
  const d = ui.editEx; if (!d) return;
  const ex = state.exercises[d.ei]; if (!ex) return;
  const def = exerciseDefault(state.programId, ex.id) || ex;
  const plain = applyEdits({...ex, sets: def.sets, rest: def.rest}, state.programId, {});
  const fresh = editDraftFrom({...plain, name: isStageLadder(ex) ? ex.name : def.name, note: isStageLadder(ex) ? ex.note : (def.note || "")}, d.ei);
  const k = editKind(ex);
  ui.editEx = {...fresh, weight: d.weight, reps: k.wave ? snapWaveRep(d.reps, draftRungs(fresh)) : (k.neck ? Math.min(d.reps, NECK_MAX) : d.reps), msg: "Defaults loaded — tap Save to keep them"};
  render();
}
function readEditTextFields(){
  const d = ui.editEx; if (!d) return;
  const n = document.querySelector("[data-edit-name]"), t = document.querySelector("[data-edit-note]");
  if (n) d.name = n.value;
  if (t) d.note = t.value;
}
function saveExerciseEdit(){
  const d = ui.editEx; if (!d) return false;
  const ei = state.exercises.findIndex(e => e.id === d.id);
  const ex = state.exercises[ei]; if (!ex) { cancelExerciseEdit(); return false; }
  const k = editKind(ex), pid = state.programId;
  const name = String(d.name || "").replace(/\s+/g, " ").trim();
  const fail = (m) => { d.msg = m; render(); return false; };
  if (k.names && !name) return fail("Name can’t be blank");
  if (!(d.kgStep > 0)) return fail("kg increase must be more than 0");
  if (d.repTop < d.repLow) return fail("Top of the rep range must be at or above the bottom");
  if (!(d.sets >= 1 && d.sets <= 10)) return fail("Sets must be 1–10");
  if (!(d.rest >= 15 && d.rest <= 600)) return fail("Rest must be 15 s – 10 min");
  const def = exerciseDefault(pid, ex.id) || ex;
  const [bl, bt] = baseRange(ex);
  const edit = {};
  if (k.kgStep && d.kgStep !== KG_STEP) edit.kgStep = d.kgStep;
  if (k.range && (d.repLow !== bl || d.repTop !== bt)) { edit.repLow = d.repLow; edit.repTop = d.repTop; }
  if (d.sets !== def.sets) edit.sets = d.sets;
  if (d.rest !== def.rest) edit.rest = d.rest;
  if (k.names && name !== def.name) edit.name = name.slice(0, EDIT_NAME_MAX);
  if (k.names && String(d.note || "").trim() !== String(def.note || "")) edit.note = String(d.note || "").trim().slice(0, EDIT_NOTE_MAX);
  if (k.neck && d.secStep !== NECK_STEP) edit.secStep = d.secStep;
  if (k.neck && d.secMax !== NECK_MAX) edit.secMax = d.secMax;
  if (k.switch && d.switchSec !== SWITCH_DEFAULT) edit.switchSec = d.switchSec;
  const all = sanitizeEdits(state.exerciseEdits);
  const clean = sanitizeEdit(edit);
  if (clean) (all[pid] ||= {})[ex.id] = clean;
  else if (all[pid]) { delete all[pid][ex.id]; if (!Object.keys(all[pid]).length) delete all[pid]; }
  state.exerciseEdits = all;
  // Back to the program's sets / rest / name / note first, then lay the edits over them
  let next = {...ex, sets: def.sets, rest: def.rest};
  if (k.names) next = {...next, name: def.name, note: def.note};
  if (next.sets !== ex.sets) next.setsLog = resizeSetsLog(ex.setsLog, next.sets);
  next = applyEdits(next, pid, all);
  if (next.sets !== ex.sets && next.setsLog.length !== next.sets) next.setsLog = resizeSetsLog(ex.setsLog, next.sets);
  if (k.kg) next.weight = clampKg(d.weight);
  let reps = Math.round(Number(d.reps) || ex.reps);
  if (k.wave) reps = snapWaveRep(reps, waveRepsFor(next));
  if (k.neck) reps = Math.max(NECK_START, Math.min(neckMaxFor(next), reps));
  next.reps = Math.max(1, reps);
  state.exercises = state.exercises.map((e, i) => i === ei ? next : e);
  state.liftProgress = captureProgress(state.exercises, state.liftProgress);
  ui.editEx = null; ui.panel = "none";
  save();
  toast(`${next.name} saved`, clean ? "Your settings" : "Program defaults");
  render();
  return true;
}
