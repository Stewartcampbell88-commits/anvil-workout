// ANVIL · Screen rendering + form listeners.
// Classic script (shared global scope, no build step); load order is set in index.html.
function renderTimerOnly(){
  const program = getProgram(state.programId);
  const ci = currentIndex(state.exercises);
  const active = state.exercises[ci];
  const timeText = ui.isGo ? "GO" : fmtTime(ui.remain || active?.rest || 90);
  const timeClass = ui.isGo ? "go" : (ui.remain>0 && ui.remain<=3 ? "warn" : "");
  document.querySelectorAll("[data-timer]").forEach(el => {
    el.textContent = timeText;
    el.classList.remove("go","warn");
    if (timeClass) el.classList.add(timeClass);
  });
  document.querySelectorAll("[data-cue]").forEach(el => {
    el.textContent = (ui.remain>0 && ui.remain<=3 && !ui.isGo) ? String(ui.remain) : (ui.isGo ? "GO" : "");
  });
  const bar = document.getElementById("timer-bar-label");
  if (bar) bar.textContent = (ui.running || ui.remain>0) ? `Rest · ${active?.name??""}` : (active?.name??"");
}

function exNameHtml(ex, ei){ return `<span class="ex-name" data-act="howto" data-i="${ei}" role="button" tabindex="0" aria-label="How to do ${esc(ex.name)}">${esc(ex.name)}<i class="ex-info" aria-hidden="true">i</i></span>`; }
function render(){
  const program = getProgram(state.programId);
  const ci = currentIndex(state.exercises);
  const active = state.exercises[ci];
  const timerOn = ui.running || ui.remain>0 || ui.isGo;
  const timeText = ui.isGo ? "GO" : fmtTime(ui.remain || active?.rest || 90);
  const timeClass = ui.isGo ? "go" : (ui.remain>0 && ui.remain<=3 ? "warn" : "");
  const doneSets = state.exercises.reduce((n,ex) => n + (ex.skipped ? ex.sets : ex.setsLog.filter(s=>s.ok||s.miss).length), 0);
  const totalSets = state.exercises.reduce((n,ex) => n+ex.sets, 0);
  const inSession = new Set(state.exercises.map(e=>e.id));
  const sub = `${program.name}${program.days.length>1 ? ` · ${program.days[state.dayIndex]?.label}` : ""} · ${doneSets}/${totalSets} sets`;

  let lastBlock = "";
  const cards = state.exercises.map((ex, ei) => {
    const showTag = ex.block !== lastBlock;
    lastBlock = ex.block;
    const isActive = ei===ci && !ex.skipped;
    const expanded = isExExpanded(ex);
    const resolved = exerciseResolved(ex);
    const passed = exercisePassed(ex);
    const failed = exerciseFailed(ex);
    const statusCls = ex.skipped ? "skipped" : passed ? "pass" : failed ? "fail" : "";
    const tag = showTag?`<p class="block">${esc(ex.block)}</p>`:"";

    if (!expanded) {
      if (ex.skipped) {
        return `${tag}
      <article class="card collapsed skipped" id="ex-${esc(ex.id)}">
        <div class="row" style="align-items:center">
          <h2 class="muted" style="margin:0">${exNameHtml(ex, ei)}</h2>
          <button class="skip on" data-act="skip" data-i="${ei}">Unskip</button>
        </div>
      </article>`;
      }
      const statusLab = passed ? "passed" : failed ? "failed" : "done";
      return `${tag}
      <article class="card collapsed ${statusCls}" id="ex-${esc(ex.id)}">
        <button type="button" class="ex-toggle" data-act="toggle-ex" data-i="${ei}" aria-expanded="false" aria-label="${esc(ex.name)}, ${statusLab}. Expand">
          <h2>${exNameHtml(ex, ei)}</h2>
          <span class="ex-status ${statusCls}" aria-hidden="true"></span>
        </button>
      </article>`;
    }

    const tight = ex.sets > 3;
    const loggedCue = isActive && ui.remain>0 && ui.remain<=3 && !ui.isGo ? String(ui.remain) : (isActive && ui.isGo ? "GO" : "");
    const remainText = isActive ? timeText : fmtTime(ex.rest);
    const tClass = isActive ? timeClass : "";
    const level = ex.levels?.length ? ex.levels[ex.levelIndex??0] : null;
    const wNeg = Number(ex.weight) < 0;
    const weightCtrl = `<button class="icon-btn" data-act="weight" data-i="${ei}" data-d="-2.5" aria-label="Decrease weight">${I.minus}</button>
           <span class="kg${wNeg?" neg":""}">${fmtKg(ex.weight)}</span>
           <button class="icon-btn" data-act="weight" data-i="${ei}" data-d="2.5" aria-label="Increase weight">${I.plus}</button>
           <span class="muted" style="font-size:.875rem">${wNeg?"kg assist":"kg"}</span>`;
    const load = ex.levels?.length
      ? `<button class="icon-btn" data-act="level" data-i="${ei}" data-d="-1" aria-label="Easier height">${I.minus}</button>
         <span class="level">${esc(level)}</span>
         <button class="icon-btn" data-act="level" data-i="${ei}" data-d="1" aria-label="Harder height">${I.plus}</button>
         <span style="flex-basis:100%;height:0" aria-hidden="true"></span>
         ${weightCtrl}`
      : `${weightCtrl}`;
    const amrap = usesAmrap(ex);
    const sets = ex.skipped ? "" : `<div class="sets${tight?" tight":""}">${ex.setsLog.map((log,si) => {
      const shown = log.reps ?? ex.reps;
      const cls = log.ok ? "ok" : log.miss ? "miss" : "";
      const hit = ex.bilateral ? `${shown} ea` : String(shown);
      const isLast = si === ex.setsLog.length - 1;
      const setLab = (isLast && amrap) ? "AMRAP" : String(si+1);
      const setAria = (isLast && amrap) ? "AMRAP last set" : ("Set " + (si+1));
      return `<div class="set ${cls}">
        <button type="button" class="set-hit" data-act="set" data-i="${ei}" data-s="${si}" aria-label="${setAria}">
          <span class="set-label">${setLab}</span>${hit}
        </button>
        <div class="set-tools">
          <button type="button" class="set-tool" data-act="set-rep" data-i="${ei}" data-s="${si}" data-d="-1" aria-label="Fewer reps">−</button>
          <button type="button" class="set-tool" data-act="set-rep" data-i="${ei}" data-s="${si}" data-d="1" aria-label="More reps">+</button>
        </div>
      </div>`;
    }).join("")}</div>`;
    const titleBlock = resolved && !ex.skipped
      ? `<div style="min-width:0;flex:1">
            <button type="button" class="ex-toggle" data-act="toggle-ex" data-i="${ei}" aria-expanded="true" aria-label="${esc(ex.name)}. Collapse">
              <h2>${exNameHtml(ex, ei)}</h2>
              <span class="ex-status ${statusCls}" aria-hidden="true"></span>
            </button>
            ${ex.note?`<p class="note">${esc(ex.note)}</p>`:""}
          </div>`
      : `<div style="min-width:0;flex:1">
            <h2>${exNameHtml(ex, ei)}</h2>
            ${ex.note?`<p class="note">${esc(ex.note)}</p>`:""}
            ${ex.skipped?`<p class="note">Skipped — won’t count</p>`:""}
          </div>`;
    return `${tag}
      <article class="card${isActive?" active":""}${ex.skipped?" skipped":""}${resolved && !ex.skipped ? " " + statusCls : ""}" id="ex-${esc(ex.id)}">
        <div class="row">
          ${titleBlock}
          <p class="meta">${esc(targetLabel(ex))}<br>${ex.streak}/3 clean · ${ex.failStreak}/3 no-rep${amrap?`<br><span style="opacity:.7;font-size:.65rem">Last set AMRAP · +2 → next kg</span>`:""}</p>
        </div>
        <div class="weight">${load}</div>
        ${isActive?`<div class="rest-box"><p class="cue" data-cue>${loggedCue}</p><p class="big ${tClass}" data-timer style="font-size:3rem">${remainText}</p>
          <div class="split" style="justify-content:center;margin-top:.625rem"><button class="icon-btn" data-act="rest" data-d="-15" aria-label="Minus 15 seconds">−</button>
          <button class="icon-btn" data-act="rest" data-d="15" aria-label="Plus 15 seconds">+</button></div></div>`:""}
        ${sets}
        <div style="margin-top:.25rem;display:flex;justify-content:flex-end">
          <button class="skip${ex.skipped?" on":""}" data-act="skip" data-i="${ei}">${ex.skipped?"Unskip":"Skip"}</button>
        </div>
      </article>`;
  }).join("");

  const days = program.days.length>1
    ? `<div class="days">${program.days.map((d,i)=>`<button class="${i===state.dayIndex?"on":""}" data-act="day" data-d="${i}">${esc(d.label)}</button>`).join("")}</div>`
    : "";

  const remove = ui.panel==="remove" ? `<section class="panel"><p class="tiny">This session</p>${
    state.exercises.map(ex=>`<div class="rm"><span style="font-size:.875rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ex.name)}</span><button data-act="remove" data-id="${esc(ex.id)}" data-name="${esc(ex.name)}">Remove</button></div>`).join("")
  }</section>` : "";

  const add = ui.panel==="add" ? `<section class="panel"><p class="tiny">Add a lift</p>${
    LIBRARY.map(group => {
      const lifts = group.lifts.filter(l => !inSession.has(l.id));
      if (!lifts.length) return "";
      return `<div class="space"><p class="block" style="margin:0 0 .5rem">${esc(group.group)}</p>${lifts.map(lift => {
        const open = ui.pending?.id === lift.id;
        const opts = REP_OPTS.includes(lift.reps) ? REP_OPTS : [...REP_OPTS, lift.reps].sort((a,b)=>a-b);
        const lab = lift.note?.includes("Seconds") ? "Secs" : lift.note?.includes("Metres") ? "Metres" : "Reps";
        return `<div style="margin-top:.375rem"><button class="lift${open?" on":""}" data-act="pick" data-id="${lift.id}">${esc(lift.name)}</button>${
          open ? `<div class="picker"><p class="tiny" style="margin-bottom:.375rem">Sets</p><div class="chips">${SET_OPTS.map(n=>`<button class="chip${n===ui.pickSets?" on":""}" data-act="sets" data-n="${n}">${n}</button>`).join("")}</div>
            <p class="tiny" style="margin:.75rem 0 .375rem">${lab}</p><div class="chips">${opts.map(n=>`<button class="chip${n===ui.pickReps?" on":""}" data-act="reps" data-n="${n}">${n}</button>`).join("")}</div>
            <button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700" data-act="confirm-add">Add ${ui.pickSets}×${ui.pickReps}</span></button></div>` : ""
        }</div>`;
      }).join("")}</div>`;
    }).join("")
  }</section>` : "";

  const volPct = Math.round(clampVolume(state.soundVolume) * 100);
  const settingsTab = ["program","sound","history","progress","backup","about"].includes(ui.settingsTab) ? ui.settingsTab : "program";
  ui.settingsTab = settingsTab;
  let settingsDetail = "";
  if (settingsTab === "program") {
    settingsDetail = `<section class="panel"><p class="tiny">Program</p><ul style="margin:.75rem 0 0;padding:0;list-style:none;display:grid;gap:.5rem">${
      PROGRAMS.map(p=>`<li><button class="prog${p.id===state.programId?" on":""}" data-act="program" data-id="${p.id}"><span style="font-size:1rem;font-weight:700">${esc(p.name)}</span><span class="note" style="${p.id===state.programId?"opacity:.8;color:inherit":""}">${esc(p.blurb)}</span></button></li>`).join("")
    }</ul></section>`;
  } else if (settingsTab === "sound") {
    settingsDetail = `<section class="panel"><p class="tiny">Sound</p>
        <p class="tiny" style="margin-top:.75rem;letter-spacing:.08em">Volume</p>
        <div class="vol-row"><input type="range" min="0" max="100" step="1" value="${volPct}" data-act="vol" aria-label="Sound volume" /><span class="vol-lab" data-vol-label>${volPct}%</span></div>
        <p class="tiny" style="margin-top:.875rem;letter-spacing:.08em">Rest cues</p>
        <div class="cue-list">${Object.values(CUE_PACKS).map(p=>`<button class="prog${p.id===state.cuePack?" on":""}" data-act="cue-pack" data-id="${p.id}"><span style="font-size:1rem;font-weight:700">${esc(p.name)}</span><span class="note" style="${p.id===state.cuePack?"opacity:.8;color:inherit":""}">${esc(p.blurb)}</span></button>`).join("")}</div>
        <button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700;gap:.5rem" data-act="preview-sound">${I.sound} Preview</span></button>
        <p class="note" style="margin-top:.75rem">Cues fire on the last 3 seconds of rest. Tone packs use soft app-style chimes; voice packs use real Aussie audio (not browser TTS). Volume 0 mutes everything. Max volume is boosted to cut through phone music.</p>
      </section>`;
  } else if (settingsTab === "history") {
    settingsDetail = `<section class="panel"><p class="tiny">Session log</p>${
      state.history.length===0 ? `<p class="note">No sessions yet. Tick every set, then log.</p>`
      : `<ol style="margin:.5rem 0 0;padding:0;list-style:none">${state.history.slice(0,8).map(h=>`<li style="margin-top:.75rem"><p style="margin:0;font-size:.875rem;font-weight:600">${esc(fmtWhen(h.date))}${h.durationSec > 0 ? ` <span class="muted" style="font-weight:400">· ${esc(fmtDurMin(h.durationSec))}</span>` : ""}</p><p class="note">${esc((Array.isArray(h.notes) ? h.notes : []).join(" · "))}</p></li>`).join("")}</ol>`
    }</section>`;
  } else if (settingsTab === "progress") {
    if (!PROGRESS_RANGES[ui.progressRange]) ui.progressRange = "1m";
    const rangeHtml = `<div class="seg" role="group" aria-label="Range">${Object.entries(PROGRESS_RANGES).map(([k, r]) => `<button class="${k === ui.progressRange ? "on" : ""}" data-act="progress-range" data-r="${k}">${r.label}</button>`).join("")}</div>`;
    // Body weight
    const bwAll = bodySeries();
    const bwPts = inRange(bwAll);
    const latestBw = state.bodyWeightLog[0]?.kg;
    let bwStats = "", bwChart;
    if (!bwAll.length) bwChart = `<p class="chart-empty">Log a session or add a weigh-in.</p>`;
    else {
      bwChart = svgLineChart("bw", bwPts.map(p => ({ t: p.t, y: p.y, read: `${fmtDayDate(p.t)} · ${fmtNum(p.y)} kg` })), { unit: "kg", trend: 7 });
      if (bwPts.length) {
        const d = bwPts[bwPts.length - 1].y - bwPts[0].y;
        bwStats = headline(d, "kg", bwPts[0].y, bwPts[bwPts.length-1].y, null);
      }
    }
    const bwLegend = bwPts.length >= 3 ? `<p class="chart-legend"><span class="lg-line"></span>Weigh-ins <span class="lg-dash"></span>7-entry avg</p>` : "";
    // Lifts
    const liftOpts = progressLiftOptions();
    if (!ui.progressLiftId || !liftOpts.some(o => o.id === ui.progressLiftId)) {
      ui.progressLiftId = liftOpts[0]?.id || null;
    }
    const seriesAll = ui.progressLiftId ? liftSeries(ui.progressLiftId) : [];
    const useReps = isRepsChartLift(seriesAll);
    const lastName = seriesAll[seriesAll.length-1]?.name || "";
    const secAxis = useReps && (/hang|plank/i.test(lastName) || /sec/i.test(lastName) || ui.progressLiftId==="em-plank" || ui.progressLiftId==="tp-plank");
    const axisLabel = useReps ? (secAxis ? "sec" : "reps") : "kg";
    let best = -Infinity, prCount = 0;
    const liftAll = seriesAll.map((p, i) => {
      const y = useReps ? p.reps : p.weight;
      const pr = i > 0 && y > best;
      if (pr) prCount++;
      best = Math.max(best, y);
      const wTxt = p.weight < 0 ? `${fmtNum(p.weight)} kg assist` : `${fmtNum(p.weight)} kg`;
      const read = `${fmtDayDate(p.t)} · ${useReps ? `${fmtNum(p.reps)} ${axisLabel}${p.weight ? ` @ ${wTxt}` : ""}` : `${wTxt} × ${fmtNum(p.reps)}`}${p.clean ? "" : " · missed"}${pr ? " · PR" : ""}`;
      return { t: p.t, y, read, pr, hollow: !p.clean };
    });
    const liftPts = inRange(liftAll);
    const liftChart = !seriesAll.length
      ? `<p class="chart-empty">Complete sessions to track lifts.</p>`
      : svgLineChart("lift", liftPts, { unit: axisLabel, zeroLine: !useReps });
    let liftStats = "";
    if (liftPts.length) {
      const a = liftPts[0].y, z = liftPts[liftPts.length-1].y, d = z - a;
      liftStats = headline(d, axisLabel, a, z, d > 0);
    }
    const assistNote = !useReps && seriesAll.some(p => p.weight < 0) ? `<p class="note" style="margin-top:.5rem">Below 0 = assist kg. Climbing toward 0 means less help.</p>` : "";
    const liftLegend = liftPts.length ? `<p class="chart-legend"><span class="lg-dot"></span>Clean <span class="lg-dot hollow"></span>Missed <span class="lg-dot pr"></span>PR${liftPts.filter(p => p.pr).length ? ` ×${liftPts.filter(p => p.pr).length}` : ""}</p>` : "";
    const selectHtml = liftOpts.length
      ? `<select class="progress-select" data-act="progress-lift" aria-label="Lift">${liftOpts.map(o=>`<option value="${esc(o.id)}"${o.id===ui.progressLiftId?" selected":""}>${esc(o.name)}</option>`).join("")}</select>`
      : `<p class="note" style="margin-top:.5rem">No lifts logged yet.</p>`;
    // Workout time (sessions timed by the v47+ workout clock)
    const timed = inRange(state.history.filter(h => h && h.durationSec > 0).map(h => ({ t: h.date, y: h.durationSec })).reverse());
    const lastTimed = state.history.find(h => h && h.durationSec > 0);
    const timeHtml = lastTimed ? `<section class="panel"><div class="chart-head"><p class="tiny">Workout time</p><span class="chart-unit">min</span></div>
        ${statRow([{ lab:"Last", val:fmtDurMin(lastTimed.durationSec) }, { lab:"Avg", val: timed.length ? fmtDurMin(timed.reduce((a, p) => a + p.y, 0) / timed.length) : "—" }, { lab:"Timed", val:String(timed.length) }])}
      </section>` : "";
    // Walks
    const wk = walkWeekBars();
    const walkTotal = wk.bars.reduce((a, b) => a + b.y, 0);
    const walkChart = svgBarChart("walk", wk.bars, { unit: wk.unit });
    settingsDetail = `${rangeHtml}
      <section class="panel"><div class="chart-head"><p class="tiny">Body weight</p><span class="chart-unit">${latestBw!=null?`${esc(fmtNum(Number(latestBw)))} kg`:"—"}</span></div>
        ${bwStats}
        ${bwChart}
        ${bwLegend}
        <button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700" data-act="log-bw-now">Log body weight</span></button>
      </section>
      <section class="panel"><div class="chart-head"><p class="tiny">Lifts</p><span class="chart-unit">${esc(axisLabel)}</span></div>
        ${selectHtml}
        ${liftStats}
        ${liftChart}
        ${liftLegend}
        ${assistNote}
      </section>
      ${timeHtml}
      <section class="panel"><div class="chart-head"><p class="tiny">Walks / week</p><span class="chart-unit">${esc(wk.unit)}</span></div>
        ${walks.length ? statRow([{ lab:"Total", val:String(Math.round(walkTotal)) }, { lab:"Walks", val:String(wk.bars.reduce((a, b) => a + b.n, 0)) }, { lab:"Avg/wk", val:fmtNum(walkTotal / wk.bars.length) }]) : ""}
        ${walks.length ? walkChart : `<p class="chart-empty">No walks yet — use the Walk tab.</p>`}
      </section>`;
  } else if (settingsTab === "backup") {
    settingsDetail = `${ANVIL_PREVIEW ? `<section class="panel"><p class="tiny">Preview</p>
        <p class="note" style="margin-top:.5rem">This is a test copy of ANVIL. It keeps its own data, never syncs to the Google Sheet, and never changes your real app.</p>
        <button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700" data-act="copy-live">Copy my real data into Preview</span></button>
      </section>` : ""}<section class="panel"><p class="tiny">Backup</p>
        <div class="split" style="margin-top:.75rem">
          <button data-act="export">Export</button>
          <button data-act="import">Import</button>
        </div>
        <p class="note" style="margin-top:.75rem">Export downloads a JSON backup. Import overwrites local data from a previous file.</p>
      </section>
      <section class="panel"><p class="tiny">Restore from cloud</p>
        <label class="note" style="display:block;margin-top:.75rem">Name
          <input data-restore-name type="text" autocomplete="off" placeholder="Stewart / Alexis / Marcus" value="${esc(ui.restoreName || syncName())}" style="width:100%;margin-top:.25rem;padding:.6rem;border-radius:.6rem;border:1px solid #444;background:transparent;color:inherit;font:inherit">
        </label>
${restorePinField(".6rem")}
        <button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700" data-act="restore-cloud">Restore from cloud</span></button>
        <p class="note" data-restore-status style="margin-top:.6rem">${esc(ui.restoreMsg || "")}</p>
        <p class="note" style="margin-top:.4rem">Pulls your latest synced sessions, body weight and walks back from the Google Sheet — handy on a new phone. ${restoreTrusted() ? "This phone is trusted, so no PIN is needed." : "Needs the family PIN once (the PIN itself is never saved on this phone)."} Replaces what’s on this phone.</p>
      </section>
      <section class="panel"><p class="tiny">Sync</p>
        <label class="note" style="display:block;margin-top:.75rem">Name
          <input data-sync="name" type="text" autocomplete="off" placeholder="Stewart / Alexis / Marcus" value="${esc(syncName())}" style="width:100%;margin-top:.25rem;padding:.6rem;border-radius:.6rem;border:1px solid #444;background:transparent;color:inherit;font:inherit">
        </label>
        
        <button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700" data-act="sync-now">Sync now</span></button>
        <p class="note" data-sync-status style="margin-top:.6rem">${esc(syncStatusText())}</p>
        <p class="note" style="margin-top:.4rem">Auto-syncs to Stewart's private Google Sheet after each session, each walk, and daily on open. No sign-in needed.</p>
      </section>`;
  } else {
    const updateBtn = ui.updateReady
      ? `<button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700" data-act="apply-update">Update now</span></button>`
      : "";
    settingsDetail = `<section class="panel"><p class="tiny">About</p>
        <p style="margin:.75rem 0 0;font-size:1rem;font-weight:700">${esc(ui.appVersion || APP_VERSION)}</p>
        <p class="note" style="margin-top:.5rem">Checks GitHub Pages for a new build. Tap Update now to reload onto it.</p>
        <button class="split" style="width:100%;margin-top:.75rem"><span class="primary" style="display:flex;width:100%;min-height:2.75rem;border-radius:.75rem;align-items:center;justify-content:center;font-weight:700${ui.updateChecking?";opacity:.7":""}" data-act="check-update">${ui.updateChecking?"Checking…":"Check for update"}</span></button>
        ${updateBtn}
      </section>`;
  }
  const settingsNav = [
    ["program","Program"],
    ["sound","Sound"],
    ["history","Session log"],
    ["progress","Progress"],
    ["backup","Backup"],
    ["about","About"],
  ].map(([tab,label]) => `<button type="button" data-act="settings-tab" data-tab="${tab}" class="${settingsTab===tab?"on":""}">${label}</button>`).join("");
  const bwShown = (typeof ui.bwDraftKg === "number" && ui.bwDraftKg > 0)
    ? ui.bwDraftKg.toFixed(1).replace(/\.0$/, "")
    : "—";
  const holdLines = (ui.pendingHolds || []).map(h =>
    `${esc(h.name)} stays at ${h.weight} kg until ${esc(h.ceilingName)} moves up (now ${h.ceilingWeight} kg).`
  );
  const balanceHold = ui.panel==="balance-hold" && ui.pendingHolds?.length ? `<div class="settings-sheet" role="dialog" aria-modal="true" aria-label="Held for balance"><div class="settings-sheet-inner">
    <div class="settings-head"><h2>Held for balance</h2><button class="icon-btn" data-act="dismiss-hold" aria-label="Close">${I.x}</button></div>
    <div class="settings-body" style="justify-content:center">
      <p class="note" style="text-align:center;margin:0 0 1rem">Improve the bigger lift first — upwards chain only.</p>
      ${holdLines.map(line => `<p class="note" style="text-align:center;margin:0 0 .75rem;color:var(--fg)">${line}</p>`).join("")}
      <div class="split" style="margin-top:1rem">
        <button class="primary" data-act="dismiss-hold" style="width:100%">Got it</button>
      </div>
    </div>
  </div></div>` : "";
  const bodyweight = ui.panel==="bodyweight" ? `<div class="settings-sheet" role="dialog" aria-modal="true" aria-label="Body weight"><div class="settings-sheet-inner">
    <div class="settings-head"><h2>Body weight</h2><button class="icon-btn" data-act="skip-bw" aria-label="Close">${I.x}</button></div>
    <div class="settings-body" style="justify-content:center">
      <p class="note" style="text-align:center;margin:0">${ui.bwLinkSession?"After this session":"Weigh-in"}</p>
      <div class="bw-step-row">
        <button class="icon-btn" data-act="bw-step" data-d="-0.5" aria-label="Minus 0.5 kg">−</button>
        <div style="display:flex;align-items:baseline;justify-content:center">
          <span class="bw-num">${esc(bwShown)}</span><span class="bw-unit">kg</span>
        </div>
        <button class="icon-btn" data-act="bw-step" data-d="0.5" aria-label="Plus 0.5 kg">+</button>
      </div>
      <div class="split" style="margin-top:1rem">
        <button class="primary" data-act="save-bw">Save</button>
        <button data-act="skip-bw">Skip</button>
      </div>
    </div>
  </div></div>` : "";
  const settings = ui.panel==="settings" ? `<div class="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings"><div class="settings-sheet-inner">
    <div class="settings-head"><h2>Settings</h2><button class="icon-btn" data-act="panel" data-p="settings" aria-label="Close">${I.x}</button></div>
    <div class="settings-body">
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Settings sections">${settingsNav}</nav>
        <div class="settings-detail">${settingsDetail}</div>
      </div>
    </div>
  </div></div>` : "";

  const isFile = location.protocol === "file:";
  const hint = isFile
    ? `<div class="help">This file can’t stay on the home screen. Open the web link in Chrome or Safari, then tap <b style="color:var(--fg)">Install</b>.</div>`
    : (ui.installHint && !ui.installed ? `<div class="help">iPhone: Share → <b style="color:var(--fg)">Add to Home Screen</b>. Android: Chrome menu → <b style="color:var(--fg)">Add to Home screen</b>.</div>` : "");
  const updateBanner = ui.updateReady
    ? `<div class="help" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap"><span style="color:var(--fg);font-weight:600">Update available</span><button class="install primary" data-act="apply-update">Update now</button></div>`
    : "";

  const restoreBanner = showRestoreBanner()
    ? `<div class="help"><span style="color:var(--fg);font-weight:600">Restore your progress from cloud?</span>
        <label class="note" style="display:block;margin-top:.5rem">Name
          <input data-restore-name type="text" autocomplete="off" placeholder="Stewart / Alexis / Marcus" value="${esc(ui.restoreName || syncName())}" style="width:100%;margin-top:.25rem;padding:.6rem;border-radius:.6rem;border:1px solid #444;background:transparent;color:inherit;font:inherit">
        </label>
${restorePinField(".5rem")}
        <div class="split" style="margin-top:.6rem"><button class="primary" data-act="restore-cloud">Restore</button><button data-act="restore-dismiss">Not now</button></div>
        <p class="note" data-restore-status style="margin-top:.4rem">${esc(ui.restoreMsg || "")}</p></div>`
    : "";

  const onWalk = ui.mainTab === "walk";
  const tabBar = `<nav class="tab-bar" aria-label="Main">
      <button type="button" data-act="main-tab" data-tab="workout" class="${onWalk?"":"on"}" aria-current="${onWalk?"false":"page"}">${I.workout} Workout</button>
      <button type="button" data-act="main-tab" data-tab="walk" class="${onWalk?"on":""}" aria-current="${onWalk?"page":"false"}">${I.walk} Walk</button>
    </nav>`;

  const workoutBody = `
    ${days}
    ${timerOn?`<div class="timer-bar"><div><p class="note" id="timer-bar-label" style="margin:0">${esc((ui.running||ui.remain>0)?`Rest · ${active?.name??""}`:(active?.name??""))}</p>
      <p class="big ${timeClass}" data-timer style="font-size:1.875rem">${timeText}</p></div>
      <div style="display:flex;gap:.375rem"><button class="icon-btn" data-act="rest" data-d="-15">−</button>
      <button class="icon-btn" data-act="rest" data-d="15">+</button></div></div>`:""}
    ${updateBanner}
    ${restoreBanner}
    ${hint}
    <div class="space">${cards}</div>
    <div class="split">
      <button class="${ui.panel==="add"?"on":""}" data-act="panel" data-p="add">${I.plus} Add</button>
      <button class="${ui.panel==="remove"?"on":""}" data-act="panel" data-p="remove">${I.minus} Remove</button>
    </div>
    ${remove}
    ${add}
    <div class="split">
      <button class="primary" id="log-session" data-act="log">Log session</button>
      <button data-act="reset">${I.reset} Reset</button>
    </div>
    <p class="foot">Tap the big number to complete that set (tap again clears). − / + dial that set’s reps — going below the target marks it failed (red). Leave a lift blank or skip — it won’t count. Weight − can go negative (assist kg; less assist = progress). Last set AMRAP on most lifts — hit target+2 (or more) to add 2.5kg next time. Timed holds and early heave stages skip AMRAP. Ember / Anvil / Titan: 3 clean at a rung climbs 6→8→10→12, then 3×6 +2.5kg (plank waves 20→30→20s, no kg) — AMRAP load bump skips the wave climb that session. Heaves ladder: hang → feet assist → negatives → full (auto-graduate after wave). ANVIL Cossack ladder: supported → short → full depth → goblet (auto-graduate after wave; kg on final). Titan plate bench: 3 clean at 3×12 @ ≥10kg → barbell 3×6 @ 20kg (AMRAP at 12 @ ≥10kg also graduates). Other programs: 3 clean → +2 reps (or +2.5 kg at cap). 3 short sessions → reset week (drop kg first if loaded).</p>`;

  const wsec = clockElapsedSec();
  const wclock = wsec == null ? "" : ` · <span data-wclock aria-label="Workout time">${fmtClock(wsec)}</span>`;
  const headTitle = onWalk
    ? `<div class="head-title">${I.walk}<h1>WALK</h1></div><p class="sub muted">${walk.active ? "Walking…" : "Track a walk"}</p>`
    : `<div class="head-title">${I.anvil}<h1>${esc(program.name)}</h1>${ANVIL_PREVIEW ? `<span class="tiny" style="color:var(--warn)">Preview</span>` : ""}</div><p class="sub muted">${esc(sub)}${wclock}</p>`;

  const app = document.getElementById("app");
  app.classList.add("has-tabs");
  app.innerHTML = `
    <header>
      <div class="row">
        <div style="min-width:0">${headTitle}</div>
        <div class="head-actions">
          ${ui.installed ? "" : `<button class="install primary" data-act="install">${I.phone} Install</button>`}
          <button class="icon-btn" data-act="panel" data-p="settings" aria-label="Settings">${I.settings}</button>
        </div>
      </div>
    </header>
    ${onWalk ? (updateBanner + hint + renderWalkBody()) : workoutBody}
    ${balanceHold}
    ${bodyweight}
    ${settings}
    ${tabBar}
  `;
  syncClockTicker();
}

document.addEventListener("pointerdown", unlockAudio, {once:true});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && walk.active) acquireWakeLock();
});

document.getElementById("app").addEventListener("change", (e) => {
  const f = e.target.closest("[data-sync]");
  if (!f) return;
  if (f.dataset.sync === "name") syncCfg.name = f.value.trim().slice(0, 40);
  syncCfg.status = ""; saveSync(); syncStatusRefresh();
});

document.getElementById("app").addEventListener("input", (e) => {
  const rn = e.target.closest("[data-restore-name]");
  if (rn) { const was = restoreTrusted(); ui.restoreName = rn.value.trim().slice(0, 40); if (was !== restoreTrusted()) { render(); const n = document.querySelector("[data-restore-name]"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } } return; }
  const rp = e.target.closest("[data-restore-pin]");
  if (rp) { const v = rp.value.replace(/\D/g, "").slice(0, 6); if (v !== rp.value) rp.value = v; ui.restorePin = v; return; }
  const el = e.target.closest("[data-act=vol]");
  if (!el) return;
  state.soundVolume = clampVolume((+el.value) / 100);
  save();
  const lab = document.querySelector("[data-vol-label]");
  if (lab) lab.textContent = `${Math.round(state.soundVolume * 100)}%`;
});
document.getElementById("app").addEventListener("change", (e) => {
  const el = e.target.closest("[data-act=progress-lift]");
  if (!el) return;
  ui.progressLiftId = el.value || null;
  render();
});
/* ===== How-to guides: figure engine (side/front stick figure, IK, offline) ===== */
