// ANVIL · Constants, programs (Day A/B lists), ladders, wave + balance-chain helpers, icons.
// Classic script (shared global scope, no build step); load order is set in index.html.
// Preview build (served from /anvil-preview/ — its own repo — on the same origin as live; the old /preview/ path is
// still recognised for safety): every storage key gets a prefix so the
// preview can never read-modify-write the live app's data, and cloud sync/restore are switched off.
const ANVIL_PREVIEW = /\/(anvil-)?preview\//.test(location.pathname);
const PREVIEW_PREFIX = "anvil-preview:";
function K(key){ return ANVIL_PREVIEW ? PREVIEW_PREFIX + key : key; }
const STORAGE = K("anvil_app_v3");
const APP_VERSION = "anvil-v49";
const CUE_LOUDNESS = 2.4;
const CUE_MAX_GAIN = 0.95;
const SET_OPTS = [1,2,3,4,5];
const REP_OPTS = [5,6,8,10,12,15,20,30,40];
const WAVE_REPS = [6, 8, 10, 12];
const PUSH_LEVELS = ["Kitchen bench","Kitchen table","Workout bench","Knees","Toes"];
const HEAVE_STAGES = [
  { name:"Dead hang", note:"Hang from the bar, shoulders packed. Timed holds — seconds, not reps.", seconds:true, startReps:20 },
  { name:"Heaves (feet assisted)", note:"Hang from the bar. Feet on floor or a box for assist. Chin over bar, lower with control.", seconds:false, startReps:6 },
  { name:"Negative heaves", note:"Jump or step to chin-over-bar, then lower in 3–5 seconds. No pull required.", seconds:false, startReps:6 },
  { name:"Heaves", note:"Full pull-ups or chin-ups. Chin over bar, lower with control.", seconds:false, startReps:6 },
];

const BENCH_STAGES = [
  { name:"Plate bench", note:"Lie on bench or floor. Press plates together or use a plate in each hand. Build to 10 kg × 12, then move to the bar.", startWeight:2.5, startReps:6, useBar:false },
  { name:"Bench Press", note:"Empty bar first if needed. Feet planted, lower to chest, press up.", startWeight:20, startReps:6, useBar:true },
];

function isHeaveLadder(ex){
  return !!ex?.heaveLadder;
}
function heaveStage(ex){
  const idx = Math.min(HEAVE_STAGES.length - 1, Math.max(0, ex?.levelIndex ?? 0));
  return HEAVE_STAGES[idx];
}
function syncHeaveExercise(ex){
  if (!isHeaveLadder(ex)) return ex;
  const stage = heaveStage(ex);
  let note = stage.note;
  if (stage.seconds && !/seconds/i.test(note)) note = `${note} Timed — seconds, not reps.`;
  return {...ex, name: stage.name, note};
}
function isBenchLadder(ex){
  return !!ex?.benchLadder;
}
function benchStage(ex){
  const idx = Math.min(BENCH_STAGES.length - 1, Math.max(0, ex?.levelIndex ?? 0));
  return BENCH_STAGES[idx];
}
function syncBenchExercise(ex){
  if (!isBenchLadder(ex)) return ex;
  const stage = benchStage(ex);
  return {...ex, name: stage.name, note: stage.note};
}

const COSSACK_STAGES = [
  { name:"Supported lateral squat", note:"Hold a rack or bench. Shallow sit to the side — heel down. Both sides.", startReps:6, startWeight:0, loaded:false },
  { name:"Bodyweight Cossack (short)", note:"No hold. Short range to the side — stay upright, heel planted. Both sides.", startReps:6, startWeight:0, loaded:false },
  { name:"Full-depth Cossack", note:"Sit deep to the side, other leg straight. Chest up, heel down. Both sides.", startReps:6, startWeight:0, loaded:false },
  { name:"Goblet Cossack", note:"Light plate or KB at your chest. Full depth each side — add kg when 3×12 is clean.", startReps:6, startWeight:0, loaded:true },
];
function isCossackLadder(ex){
  return !!ex?.cossackLadder;
}
function cossackStage(ex){
  const idx = Math.min(COSSACK_STAGES.length - 1, Math.max(0, ex?.levelIndex ?? 0));
  return COSSACK_STAGES[idx];
}
function syncCossackExercise(ex){
  if (!isCossackLadder(ex)) return ex;
  const stage = cossackStage(ex);
  return {...ex, name: stage.name, note: stage.note};
}
function isPlankSeconds(ex){
  // Heave ladder: only Dead hang is timed — stage notes for negatives mention "seconds" of lowering, not hold time
  if (isHeaveLadder(ex)) return !!heaveStage(ex).seconds;
  return ex.id === "em-plank" || ex.id === "tp-plank" || /seconds/i.test(ex.note||"");
}
const AMRAP_BONUS = 2;
// Retention caps (were 60 sessions / 90 weigh-ins / 500 walks, which silently deleted old training history).
// 500 sessions ≈ 4–5 years at 2–3×/week and keeps the sync body well under the script's 2 MB limit.
const HISTORY_MAX = 500;
const BODYWEIGHT_MAX = 1000;
const WALKS_MAX = 2000;
const KG_STEP = 2.5;
const KG_FLOOR = -50; // assisted (negative) loads; floor is practical plate steps
function clampKg(w){
  const n = +Number(w).toFixed(1);
  if (!Number.isFinite(n)) return 0;
  return Math.max(KG_FLOOR, n);
}
/** Display kg; unicode minus for negatives (assisted). */
function fmtKg(w){
  const n = +Number(w).toFixed(1);
  if (!Number.isFinite(n)) return "0";
  const body = n.toFixed(1).replace(/\.0$/, "");
  return n < 0 ? ("−" + body.slice(1)) : body;
}
function usesAmrap(ex){
  if (!ex || (ex.sets ?? 0) < 2) return false;
  if (isPlankSeconds(ex)) return false;
  if (ex.finisher) return false;
  if (isHeaveLadder(ex) && (ex.levelIndex ?? 0) < HEAVE_STAGES.length - 1) return false;
  if (isCossackLadder(ex) && (ex.levelIndex ?? 0) < COSSACK_STAGES.length - 1) return false;
  return true;
}
function isWaveProgram(programId, ex){
  const pid = programId || (typeof state !== "undefined" && state?.programId);
  return pid === "ember" || pid === "anvil" || pid === "titan" || String(ex?.id||"").startsWith("em-");
}

/** Upwards-only strength chain: a lift may not kg-progress past the next lift UP the chain. */
const BALANCE_CHAINS = {
  anvil: { row: "bench", bench: "squat", squat: "rdl" },
  ember: { "em-press": "em-row", "em-row": "em-bench", "em-bench": "em-squat", "em-squat": "em-rdl" },
  titan: { "tp-press": "tp-row", "tp-row": "tp-bench", "tp-bench": "tp-squat", "tp-squat": "tp-rdl" },
};
const SQUAT_IDS = new Set(["squat", "em-squat", "tp-squat"]);
function ceilingFor(programId, exerciseId, sessionExs, progress){
  const explicit = BALANCE_CHAINS[programId];
  if (explicit) return explicit[exerciseId] || null;
  // Other programs with shared generic ids: press ≤ row ≤ bench ≤ squat ≤ rdl (or dl)
  if (exerciseId === "ohp") return "row";
  if (exerciseId === "row") return "bench";
  if (exerciseId === "bench") return "squat";
  if (exerciseId === "squat") {
    // Prefer rdl if both rdl and dl have a working weight
    if (workingWeightFor("rdl", sessionExs, progress) != null) return "rdl";
    if (workingWeightFor("dl", sessionExs, progress) != null) return "dl";
    return "rdl";
  }
  return null;
}
function liftLabelFor(id, sessionExs){
  const hit = (sessionExs || []).find(e => e.id === id);
  if (hit?.name) return hit.name;
  for (const p of PROGRAMS) {
    for (const d of p.days) {
      const ex = d.exercises.find(e => e.id === id);
      if (ex?.name) return ex.name;
    }
  }
  return id;
}
function workingWeightFor(id, sessionExs, progress){
  const hit = (sessionExs || []).find(e => e.id === id);
  if (hit && Number.isFinite(Number(hit.weight))) return Number(hit.weight);
  const p = progress?.[id];
  if (p && typeof p === "object" && Number.isFinite(Number(p.weight))) return Number(p.weight);
  return null;
}
/** Gate a would-be kg bump. Equality with ceiling is OK; exceeding is held. Skips heave ladders. */
function balanceKgHold(programId, ex, nextWeight, sessionExs, progress){
  if (!ex || isHeaveLadder(ex)) return null;
  // Cossack ladder: skip early stages; only gate final stage when loaded
  if (isCossackLadder(ex) && ((ex.levelIndex ?? 0) < COSSACK_STAGES.length - 1 || !(Number(ex.weight) > 0))) return null;
  const ceilId = ceilingFor(programId, ex.id, sessionExs, progress);
  if (!ceilId) return null;
  const ceilW = workingWeightFor(ceilId, sessionExs, progress);
  if (ceilW == null || !Number.isFinite(ceilW)) return null;
  // A bodyweight (0 kg), assisted or unset squat is no ceiling — otherwise EMBER/TITAN bench (and the
  // row/press chained under it) could never gain kg. A loaded squat still caps bench as before.
  if (SQUAT_IDS.has(ceilId) && !(ceilW > 0)) return null;
  const nw = +Number(nextWeight).toFixed(1);
  if (!(nw > ceilW)) return null;
  return {
    id: ex.id,
    name: ex.name,
    weight: Number(ex.weight) || 0,
    ceilingId: ceilId,
    ceilingName: liftLabelFor(ceilId, sessionExs),
    ceilingWeight: ceilW,
  };
}
function snapWaveRep(reps){
  const n = Number(reps);
  if (!Number.isFinite(n)) return WAVE_REPS[0];
  if (WAVE_REPS.includes(n)) return n;
  const up = WAVE_REPS.find(w => w >= n);
  return up != null ? up : WAVE_REPS[WAVE_REPS.length - 1];
}
function nextWaveStep(reps, weight){
  const idx = WAVE_REPS.indexOf(reps);
  if (idx >= 0 && idx < WAVE_REPS.length - 1) {
    const r = WAVE_REPS[idx + 1];
    return {reps:r, weight, note:`wave → 3×${r}`};
  }
  if (idx === WAVE_REPS.length - 1 || reps >= WAVE_REPS[WAVE_REPS.length - 1]) {
    const w = +(weight + 2.5).toFixed(1);
    return {reps:6, weight:w, note:`wave → 3×6 +2.5kg → ${w}kg`};
  }
  const next = WAVE_REPS.find(w => w > reps);
  if (next != null) return {reps:next, weight, note:`wave snap → 3×${next}`};
  const w = +(weight + 2.5).toFixed(1);
  return {reps:6, weight:w, note:`wave → 3×6 +2.5kg → ${w}kg`};
}
function normalizeWaveTargets(){
  const pid = state?.programId;
  if (pid !== "anvil" && pid !== "ember" && pid !== "titan") return false;
  let changed = false;
  const progress = {...(state.liftProgress || {})};
  state.exercises = (state.exercises || []).map(ex => {
    if (isPlankSeconds(ex) || ex.reps == null || WAVE_REPS.includes(ex.reps)) return ex;
    const reps = snapWaveRep(ex.reps);
    changed = true;
    const p = progress[ex.id];
    if (p && typeof p === "object" && p.reps !== reps) progress[ex.id] = {...p, reps};
    return {...ex, reps};
  });
  for (const [id, p] of Object.entries(progress)) {
    if (!p || typeof p !== "object" || p.reps == null) continue;
    if (id === "em-plank" || id === "em-heaves" || id === "tp-plank" || id === "tp-heaves" || /seconds/i.test(p.note||"")) continue;
    if (WAVE_REPS.includes(p.reps)) continue;
    progress[id] = {...p, reps: snapWaveRep(p.reps)};
    changed = true;
  }
  if (changed) state.liftProgress = progress;
  return changed;
}

function bb(id,name,sets,reps,rest,block,extra={}) {
  return {id,name,sets,reps,rest,weight: extra.weight ?? 20, block, ...extra};
}
function bw(id,name,sets,reps,rest,block,extra={}) {
  return {id,name,sets,reps,rest,weight:0, bw:true, block, ...extra};
}

const PROGRAMS = [
  {id:"anvil", name:"ANVIL", blurb:"2× week A/B. Wave 6→8→10→12 then +2.5kg. Cossack ladder on A; heaves on B.", days:[
    {label:"A", exercises:[
      bb("squat","Squat",3,8,120,"Day A"),
      bb("bench","Bench Press",3,8,120,"Day A"),
      bb("row","Bent over row",3,8,90,"Day A"),
      bb("xrdl","Crossed-leg straight-leg forward fold / RDL",3,6,75,"Day A",{weight:5,bilateral:true,note:"Cross one leg in front, legs straight (soft knees), hinge to a flat-back fold. Reps per side — switch the cross. Bodyweight or light dumbbell."}),
      bw("cossack", COSSACK_STAGES[0].name, 3, COSSACK_STAGES[0].startReps, 45, "Day A", {
        bilateral:true, cossackLadder:true, levels: COSSACK_STAGES.map(s=>s.name), levelIndex:0,
        note: COSSACK_STAGES[0].note
      }),
      bb("sgm","Seated good morning",3,8,90,"Day A",{cap:12,note:"Bar on upper back, sit tall, hinge from the hips. Soft knees."}),
      bw("bext","Back extension (twist)",3,10,60,"Day A",{finisher:true,note:"Rise, rotate to one side at the top, alternate sides each rep; slow, pause at top. Bodyweight, no kg."}),
    ]},
    {label:"B", exercises:[
      bb("rdl","RDL",3,8,120,"Day B"),
      bb("ohp","Overhead press",3,8,90,"Day B"),
      bw("lunge","Bulgarian split squat",3,8,75,"Day B",{cap:12,bilateral:true}),
      bw("psoas","Psoas march",3,8,45,"Day B",{cap:12,bilateral:true}),
      bw("lmr","Landmine rotation",3,8,60,"Day B",{cap:12,bilateral:true}),
      bw("heaves","Heaves",3,6,120,"Day B",{nocap:true,note:"Pull-ups or chin-ups. Clean reps; assist if needed."}),
      bw("bext","Back extension (twist)",3,10,60,"Day B",{finisher:true,note:"Rise, rotate to one side at the top, alternate sides each rep; slow, pause at top. Bodyweight, no kg."}),
    ]},
  ]},
  {id:"titan", name:"TITAN PROTOCOL", blurb:"Marcus · junior ANVIL. A/B wave 6→8→10→12. Plate bench → bar at 10kg×12.", days:[
    {label:"A", exercises:[
      bb("tp-squat","Squat",3,6,75,"Day A",{weight:0,cap:12,note:"Chair OK. Feet shoulder-width. Sit back, knees track toes, stand tall."}),
      bb("tp-bench", BENCH_STAGES[0].name, 3, 6, 90, "Day A", {
        weight:2.5, cap:12, benchLadder:true, levels: BENCH_STAGES.map(s=>s.name), levelIndex:0,
        note: BENCH_STAGES[0].note
      }),
      bb("tp-row","Bent over row",3,6,60,"Day A",{weight:2.5,cap:14,note:"Light plates start 2.5. Hinge, pull to ribs, lower slow."}),
      bw("tp-deadbug","Dead bug",3,6,45,"Day A",{bilateral:true,cap:12,note:"Lower back glued to the floor. Opposite arm and leg."}),
    ]},
    {label:"B", exercises:[
      bb("tp-rdl","Plate RDL",3,6,75,"Day B",{weight:2.5,cap:12,note:"2.5 kg plates in both hands. Soft knees, hips back, flat back."}),
      bb("tp-press","Overhead press",3,6,60,"Day B",{weight:2.5,cap:12,note:"2.5 kg plates. Press overhead, don’t shrug."}),
      bw("tp-lunge","Reverse lunges",3,6,60,"Day B",{bilateral:true,cap:12,note:"Reverse lunge. Step back, both knees ~90°. Drive through front heel."}),
      bw("tp-heaves", HEAVE_STAGES[0].name, 3, HEAVE_STAGES[0].startReps, 75, "Day B", {
        nocap:true, heaveLadder:true, levels: HEAVE_STAGES.map(s=>s.name), levelIndex:0,
        note: HEAVE_STAGES[0].note
      }),
      bw("tp-plank","Plank",3,20,45,"Day B",{cap:45,note:"Seconds, not reps. Knees down if needed."}),
    ]},
  ]},
  {id:"ember", name:"EMBER", blurb:"Beginner 3× week. Wave 6→8→10→12 then +2.5kg. Day B heaves: hang → feet assist → negatives → full (auto-graduate).", days:[
    {label:"A", exercises:[
      bb("em-squat","Squat",3,6,75,"Day A",{weight:0,cap:12,note:"Sit to a chair if needed. Hold a plate when ready."}),
      bb("em-bench","Bench Press",3,6,90,"Day A",{weight:20,cap:10,note:"Empty bar first if needed. Feet planted, lower to chest, press up."}),
      bb("em-row","Bent over row",3,6,60,"Day A",{weight:2.5,cap:14,note:"2.5 kg plates. Hinge, pull to ribs, lower slow."}),
      bw("em-deadbug","Dead bug",3,6,45,"Day A",{bilateral:true,cap:12,note:"Lower back glued to the floor. Opposite arm and leg."}),
    ]},
    {label:"B", exercises:[
      bb("em-rdl","Plate RDL",3,6,75,"Day B",{weight:2.5,cap:12,note:"2.5 kg plates in both hands. Soft knees, hips back, flat back."}),
      bb("em-press","Overhead press",3,6,60,"Day B",{weight:2.5,cap:12,note:"2.5 kg plates. Press overhead, don’t shrug."}),
      bw("em-heaves", HEAVE_STAGES[0].name, 3, HEAVE_STAGES[0].startReps, 90, "Day B", {
        nocap:true, heaveLadder:true, levels: HEAVE_STAGES.map(s=>s.name), levelIndex:0,
        note: HEAVE_STAGES[0].note
      }),
      bw("em-plank","Plank",3,20,45,"Day B",{cap:45,note:"Seconds, not reps. Knees down if needed."}),
    ]},
  ]},
  {id:"five-by-five", name:"5×5", blurb:"StrongLifts-style. Alternate A / B, add 2.5 kg when all 5s are clean.", days:[
    {label:"A", exercises:[bb("squat","Squat",5,5,180,"Day A",{cap:5}), bb("bench","Bench Press",5,5,150,"Day A",{cap:5}), bb("row","Bent over row",5,5,150,"Day A",{cap:5})]},
    {label:"B", exercises:[bb("squat","Squat",5,5,180,"Day B",{cap:5}), bb("ohp","Overhead press",5,5,150,"Day B",{cap:5}), bb("dl","Deadlift",1,5,180,"Day B",{cap:5})]},
  ]},
  {id:"starting-strength", name:"Starting Strength", blurb:"Novice 3×5. Squat every session. Bench and press trade days.", days:[
    {label:"A", exercises:[bb("squat","Squat",3,5,180,"Day A",{cap:5}), bb("bench","Bench Press",3,5,150,"Day A",{cap:5}), bb("dl","Deadlift",1,5,180,"Day A",{cap:5})]},
    {label:"B", exercises:[bb("squat","Squat",3,5,180,"Day B",{cap:5}), bb("ohp","Overhead press",3,5,150,"Day B",{cap:5}), bw("chin","Chin-ups",3,8,120,"Day B",{nocap:true})]},
  ]},
  {id:"greyskull", name:"Greyskull LP", blurb:"2–3×5 with a last-set push. Simple linear progression.", days:[
    {label:"A", exercises:[bb("bench","Bench Press",3,5,150,"Day A",{cap:8}), bb("row","Bent over row",3,5,120,"Day A",{cap:8}), bb("squat","Squat",3,5,180,"Day A",{cap:8})]},
    {label:"B", exercises:[bb("ohp","Overhead press",3,5,150,"Day B",{cap:8}), bw("chin","Chin-ups",3,8,120,"Day B",{nocap:true}), bb("dl","Deadlift",1,5,180,"Day B",{cap:5})]},
  ]},
  {id:"gzclp", name:"GZCLP", blurb:"T1 heavy, T2 volume, T3 pump. Two rotating days.", days:[
    {label:"A", exercises:[bb("squat","Squat",5,3,180,"T1",{cap:3}), bb("bench","Bench Press",3,10,120,"T2",{cap:10}), bb("pulldown","Lat pulldown",3,15,75,"T3",{cap:15})]},
    {label:"B", exercises:[bb("ohp","Overhead press",5,3,150,"T1",{cap:3}), bb("dl","Deadlift",3,10,150,"T2",{cap:10}), bb("row","Bent over row",3,15,90,"T3",{cap:15})]},
  ]},
  {id:"phraks", name:"Phraks GSLP", blurb:"3×5 full-body. A/B like 5×5, slightly less volume.", days:[
    {label:"A", exercises:[bb("squat","Squat",3,5,180,"Day A",{cap:5}), bb("bench","Bench Press",3,5,150,"Day A",{cap:5}), bb("row","Bent over row",3,5,120,"Day A",{cap:5})]},
    {label:"B", exercises:[bb("squat","Squat",3,5,180,"Day B",{cap:5}), bb("ohp","Overhead press",3,5,150,"Day B",{cap:5}), bb("dl","Deadlift",1,5,180,"Day B",{cap:5})]},
  ]},
  {id:"ppl", name:"Push Pull Legs", blurb:"Classic split. One day each, then repeat.", days:[
    {label:"Push", exercises:[bb("bench","Bench Press",3,8,150,"Push"), bb("ohp","Overhead press",3,8,120,"Push"), bw("dip","Dips",3,8,90,"Push",{nocap:true}), bw("pu","Push-ups",3,15,75,"Push",{nocap:true})]},
    {label:"Pull", exercises:[bb("dl","Deadlift",3,5,180,"Pull",{cap:5}), bb("row","Bent over row",3,8,120,"Pull"), bw("pullup","Pull-ups",3,6,120,"Pull",{nocap:true}), bb("curl","Dumbbell curl",3,10,60,"Pull",{cap:14})]},
    {label:"Legs", exercises:[bb("squat","Squat",3,8,180,"Legs"), bb("rdl","RDL",3,8,150,"Legs"), bw("lunge","Walking lunge",3,10,90,"Legs",{bilateral:true,cap:14}), bb("calf","Calf raise",3,12,45,"Legs",{cap:20})]},
  ]},
];

const LIBRARY = [
  {group:"Squat / hinge", lifts:[
    bb("squat","Squat",3,8,120,"Add-on"), bb("front-squat","Front squat",3,6,150,"Add-on"),
    bb("goblet","Goblet squat",3,10,75,"Add-on",{cap:14}), bb("dl","Deadlift",3,5,180,"Add-on",{cap:5}),
    bb("rdl","RDL",3,8,120,"Add-on"), bb("db-rdl","Dumbbell RDL",3,10,90,"Add-on",{cap:14}),
    bb("single-rdl","Single-leg RDL",3,8,75,"Add-on",{bilateral:true,cap:12}), bb("xrdl","Crossed-leg straight-leg forward fold / RDL",3,6,75,"Add-on",{weight:5,bilateral:true,cap:12,note:"Cross one leg in front, legs straight (soft knees), hinge to a flat-back fold. Reps per side — switch the cross. Bodyweight or light dumbbell."}), bb("good-morning","Good morning",3,8,90,"Add-on"),
    bb("kb-swing","Kettlebell swing",3,15,60,"Add-on",{cap:20}), bb("hip-thrust","Hip thrust",3,10,75,"Add-on",{cap:14}),
    bw("glute-bridge","Glute bridge",3,12,45,"Add-on",{cap:20}), bw("bext","Back extension",3,10,75,"Add-on",{cap:14}),
  ]},
  {group:"Push", lifts:[
    bb("bench","Bench Press",3,8,150,"Add-on"), bb("incline","Incline bench",3,8,120,"Add-on"),
    bb("floor-press","Floor press",3,8,120,"Add-on"), bb("db-bench","Dumbbell bench",3,10,90,"Add-on"),
    bb("ohp","Overhead press",3,8,90,"Add-on"), bb("db-ohp","Dumbbell OHP",3,8,90,"Add-on"),
    bw("pu","Push-ups",3,15,75,"Add-on",{nocap:true}), bw("close-pu","Close-grip push-ups",3,12,75,"Add-on",{nocap:true}),
    bw("pike-pu","Pike push-up",3,8,75,"Add-on",{nocap:true}), bw("dip","Dips",3,8,90,"Add-on",{nocap:true}),
    bb("lateral-raise","Lateral raise",3,12,45,"Add-on",{cap:16}),
  ]},
  {group:"Pull", lifts:[
    bb("row","Bent over row",3,8,90,"Add-on"), bb("db-row","Dumbbell row",3,10,75,"Add-on",{bilateral:true}),
    bw("inverted-row","Inverted row",3,8,75,"Add-on",{nocap:true}), bw("pullup","Pull-ups",3,6,120,"Add-on",{nocap:true}),
    bw("chin","Chin-ups",3,8,120,"Add-on",{nocap:true}), bb("pulldown","Lat pulldown",3,10,75,"Add-on",{cap:14}),
    bw("band-pull","Band pull-apart",3,15,45,"Add-on",{cap:20}), bb("facepull","Face pulls",3,12,45,"Add-on",{cap:16}),
    bb("curl","Dumbbell curl",3,10,60,"Add-on",{cap:14}), bb("hammer","Hammer curl",3,10,60,"Add-on",{cap:14}),
  ]},
  {group:"Legs / single-leg", lifts:[
    bw("lunge","Walking lunge",3,10,90,"Add-on",{bilateral:true,cap:14}),
    bw("reverse-lunge","Reverse lunge",3,10,75,"Add-on",{bilateral:true,cap:14}),
    bw("split-squat","Bulgarian split squat",3,8,75,"Add-on",{bilateral:true,cap:12}),
    bw("step-up","Step-up",3,10,75,"Add-on",{bilateral:true,cap:14}),
    bw("wall-sit","Wall sit",3,30,45,"Add-on",{cap:60,note:"Seconds, not reps"}),
    bb("calf","Calf raise",3,12,45,"Add-on",{cap:20}),
  ]},
  {group:"Core / extras", lifts:[
    bw("plank","Plank",3,30,45,"Add-on",{cap:60,note:"Seconds, not reps"}),
    bw("dead-bug","Dead bug",3,10,45,"Add-on",{bilateral:true,cap:16}),
    bw("situp","Sit-ups",3,12,45,"Add-on",{nocap:true}),
    bw("knee-raise","Hanging knee raise",3,10,60,"Add-on",{cap:16}),
    bw("psoas","Psoas march",3,8,45,"Add-on",{bilateral:true,cap:12}),
    bw("lmr","Landmine rotation",3,8,60,"Add-on",{bilateral:true,cap:12}),
    bw("abd","Side-lying abduction",3,12,45,"Add-on",{bilateral:true,cap:16,note:"Extra on the right"}),
    bb("farmer","Farmer carry",3,40,60,"Add-on",{cap:60,note:"Metres per set"}),
  ]},
];

function getProgram(id){ return PROGRAMS.find(p=>p.id===id) || PROGRAMS[0]; }
function blankSets(n){ return Array.from({length:n},()=>({ok:false,miss:false})); }
function toExercise(d){
  return {...d, streak:0, failStreak:0, levelIndex: d.levels?.length ? (d.levelIndex??0) : d.levelIndex, setsLog: blankSets(d.sets)};
}
function seedProgram(id, day=0){
  const p = getProgram(id);
  const d = p.days[Math.min(Math.max(0,day), p.days.length-1)];
  return d.exercises.map(toExercise);
}
function captureProgress(exs, prev={}){
  const next = {...prev};
  for (const ex of exs) next[ex.id] = {reps:ex.reps, weight:ex.weight, streak:ex.streak, failStreak:ex.failStreak, levelIndex:ex.levelIndex};
  return next;
}
function applyProgress(exs, progress, programId){
  const pid = programId || (typeof state !== "undefined" && state?.programId);
  const waveProg = pid === "ember" || pid === "anvil" || pid === "titan";
  return exs.map(ex => {
    const p = progress[ex.id];
    let next = p
      ? {...ex, reps:p.reps, weight:p.weight, streak:p.streak, failStreak:p.failStreak, levelIndex:p.levelIndex ?? ex.levelIndex}
      : ex;
    // Heave ladder: restore seed flags; em-heaves keeps migration for old progress
    if (ex.heaveLadder || next.heaveLadder || next.id === "em-heaves") {
      next = {
        ...next,
        heaveLadder: true,
        levels: (ex.levels?.length ? ex.levels : next.levels?.length ? next.levels : HEAVE_STAGES.map(s=>s.name)),
      };
      if (next.id === "em-heaves") {
        if (p && p.levelIndex != null && Number.isFinite(Number(p.levelIndex))) {
          next = {...next, levelIndex: Math.min(HEAVE_STAGES.length-1, Math.max(0, Number(p.levelIndex)))};
        } else if (p) {
          // Existing feet-assist progress without levelIndex → stage 1, keep reps/weight/streak
          next = {...next, levelIndex: 1};
        } else {
          next = {...next, levelIndex: 0, reps: HEAVE_STAGES[0].startReps};
        }
      } else if (p && p.levelIndex != null && Number.isFinite(Number(p.levelIndex))) {
        next = {...next, levelIndex: Math.min(HEAVE_STAGES.length-1, Math.max(0, Number(p.levelIndex)))};
      } else if (!p) {
        next = {...next, levelIndex: 0, reps: HEAVE_STAGES[0].startReps};
      }
      next = syncHeaveExercise(next);
    }
    // Bench ladder (TITAN plate → bar)
    if (ex.benchLadder || next.benchLadder) {
      next = {
        ...next,
        benchLadder: true,
        levels: (ex.levels?.length ? ex.levels : next.levels?.length ? next.levels : BENCH_STAGES.map(s=>s.name)),
      };
      if (p && p.levelIndex != null && Number.isFinite(Number(p.levelIndex))) {
        next = {...next, levelIndex: Math.min(BENCH_STAGES.length-1, Math.max(0, Number(p.levelIndex)))};
      } else if (!p) {
        next = {...next, levelIndex: 0, reps: BENCH_STAGES[0].startReps, weight: BENCH_STAGES[0].startWeight};
      }
      next = syncBenchExercise(next);
    }
    // Cossack ladder (ANVIL Day A)
    if (ex.cossackLadder || next.cossackLadder) {
      next = {
        ...next,
        cossackLadder: true,
        bilateral: true,
        levels: (ex.levels?.length ? ex.levels : next.levels?.length ? next.levels : COSSACK_STAGES.map(s=>s.name)),
      };
      if (p && p.levelIndex != null && Number.isFinite(Number(p.levelIndex))) {
        next = {...next, levelIndex: Math.min(COSSACK_STAGES.length-1, Math.max(0, Number(p.levelIndex)))};
      } else if (!p) {
        next = {...next, levelIndex: 0, reps: COSSACK_STAGES[0].startReps, weight: COSSACK_STAGES[0].startWeight};
      }
      next = syncCossackExercise(next);
    }
    if ((waveProg || String(next.id||"").startsWith("em-") || String(next.id||"").startsWith("tp-")) && !isPlankSeconds(next) && next.reps != null && !WAVE_REPS.includes(next.reps)) {
      next = {...next, reps: snapWaveRep(next.reps)};
    }
    return next;
  });
}
/** Why a lift was skipped (v48). Ids are stored; labels are shown. "other" carries a short free-text note. */
const SKIP_REASONS = [
  { id:"injury",    label:"Injury" },
  { id:"pain",      label:"Pain or discomfort" },
  { id:"fatigue",   label:"Fatigue" },
  { id:"time",      label:"Time constraint" },
  { id:"equipment", label:"Equipment unavailable" },
  { id:"heavy",     label:"Load too heavy" },
  { id:"technique", label:"Technique breakdown" },
  { id:"elsewhere", label:"Trained elsewhere" },
  { id:"illness",   label:"Illness" },
  { id:"other",     label:"Other" },
];
const SKIP_NOTE_MAX = 80;
function skipReasonId(id){ return SKIP_REASONS.some(r => r.id === id) ? id : ""; }
function cleanSkipNote(note){ return String(note ?? "").replace(/\s+/g, " ").trim().slice(0, SKIP_NOTE_MAX); }
/** "Time constraint" · "Other: knee niggle" · "Other" · "" (no reason given / old data). */
function skipReasonText(reason, note){
  const r = SKIP_REASONS.find(x => x.id === reason);
  const n = cleanSkipNote(note);
  if (!r) return n;
  return r.id === "other" && n ? `Other: ${n}` : r.label;
}
function hydrate(raw){
  if (!raw?.length) return null;
  const next = [];
  for (const e of raw) {
    if (!e.id || !e.name) continue;
    const sets = e.sets ?? 3;
    next.push({
      id:e.id, name:e.name, sets, rest:e.rest??90, weight:e.weight??0, reps:e.reps??8,
      bw:e.bw, nocap:e.nocap, cap:e.cap, block:e.block??"Session", bilateral:e.bilateral, note:e.note, finisher:e.finisher,
      heaveLadder:e.heaveLadder, benchLadder:e.benchLadder, cossackLadder:e.cossackLadder, levels:e.levels, levelIndex: e.levels?.length ? (e.levelIndex??0) : e.levelIndex,
      streak:e.streak??0, failStreak:e.failStreak??0, skipped:e.skipped??false,
      ...(e.skipped && skipReasonId(e.skipReason) ? { skipReason: e.skipReason, ...(cleanSkipNote(e.skipNote) ? { skipNote: cleanSkipNote(e.skipNote) } : {}) } : {}),
      setsLog: e.setsLog && e.setsLog.length===sets ? e.setsLog : blankSets(sets),
    });
  }
  return next.length ? next : null;
}
function currentIndex(exs){
  if (!exs.length) return 0;
  const i = exs.findIndex(e => !e.skipped && (e.setsLog||[]).some(s => !s.ok && !s.miss));
  return i < 0 ? exs.length-1 : i;
}

function exerciseResolved(ex){
  if (!ex) return true;
  if (ex.skipped) return true;
  const log = ex.setsLog || [];
  return log.length > 0 && log.every(s => s.ok || s.miss);
}
function exercisePassed(ex){
  if (!ex || ex.skipped) return false;
  const log = ex.setsLog || [];
  return log.length > 0 && log.every(s => s.ok && !s.miss);
}
function exerciseFailed(ex){
  if (!ex || ex.skipped) return false;
  return (ex.setsLog || []).some(s => s.miss);
}
function ensureExpandedEx(){
  if (!(ui.expandedEx instanceof Set)) ui.expandedEx = new Set();
  return ui.expandedEx;
}
function clearExpandedEx(){ ui.expandedEx = new Set(); }
function isExExpanded(ex){
  if (!ex || ex.skipped) return false;
  if (!exerciseResolved(ex)) return true;
  return ensureExpandedEx().has(ex.id);
}
function toggleExExpand(ei){
  const ex = state.exercises[ei];
  if (!ex || ex.skipped || !exerciseResolved(ex)) return;
  const set = ensureExpandedEx();
  if (set.has(ex.id)) set.delete(ex.id);
  else set.add(ex.id);
  render();
}
function nextIncompleteIndex(){
  return state.exercises.findIndex(e => !e.skipped && !exerciseResolved(e));
}
function scheduleJumpToNextIncomplete(){
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ni = nextIncompleteIndex();
      const el = ni >= 0
        ? document.getElementById("ex-" + state.exercises[ni].id)
        : document.getElementById("log-session");
      if (!el) return;
      el.scrollIntoView({ behavior:"smooth", block:"center" });
      if (ni >= 0) {
        el.classList.add("ex-flash");
        setTimeout(() => el.classList.remove("ex-flash"), 900);
      }
    });
  });
}
function fmtTime(sec){ const s=Math.max(0,Math.floor(sec)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }
function targetLabel(ex){
  const unit = isPlankSeconds(ex) ? "s" : "";
  return ex.bilateral ? `${ex.sets} × ${ex.reps}${unit} each` : `${ex.sets} × ${ex.reps}${unit}`;
}
function maxRep(ex){
  if (ex.nocap) return 50;
  if (ex.cap) return ex.cap;
  return Math.max(ex.reps || 0, 20);
}
function esc(s){ return String(s??"").replace(/[&<>"']/g, c => "&#"+c.charCodeAt(0)+";"); }
function fmtWhen(iso){
  try { return new Date(iso).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}); }
  catch { return iso; }
}

const I = {
  anvil: `<svg class="logo" viewBox="0 0 24 24"><path d="M7 10h10l-1 8H8z"/><path d="M4 10h16l-2-5H6z"/><path d="M6 21h12"/><path d="M10 10V6"/></svg>`,
  layers: `<svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  minus: `<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>`,
  reset: `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
  sound: `<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>`,
  settings: `<svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  walk: `<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M10 22l2-7 2 3 3 2"/><path d="M9 10l3 2 2-3 3 1"/></svg>`,
  workout: `<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11"/><path d="M17.5 6.5v11"/><path d="M4 9v6"/><path d="M20 9v6"/><path d="M6.5 12h11"/></svg>`,
};
