// ANVIL · Event wiring, startup, service worker registration. Loaded last.
// Classic script (shared global scope, no build step); load order is set in index.html.
document.getElementById("howto").addEventListener("click", (e) => { if (e.target.closest("[data-ht=close]")) closeHowto(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && htOpen) { closeHowto(); return; }
  const n = e.target.closest?.("[data-act=howto]");
  if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); openHowto(+n.dataset.i); }
}, true);
window.addEventListener("popstate", () => { if (htOpen) closeHowto(true); });

document.getElementById("app").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act==="howto") { e.preventDefault(); e.stopPropagation(); openHowto(+btn.dataset.i); return; }
  if (act==="set") {
    onMark(+btn.dataset.i, +btn.dataset.s);
  }
  else if (act==="set-rep") {
    e.stopPropagation();
    bumpSetReps(+btn.dataset.i, +btn.dataset.s, +btn.dataset.d);
  }
  else if (act==="toggle-ex") {
    toggleExExpand(+btn.dataset.i);
  }
  else if (act==="weight") bumpWeight(+btn.dataset.i, +btn.dataset.d);
  else if (act==="level") bumpLevel(+btn.dataset.i, +btn.dataset.d);
  else if (act==="skip") onSkipTap(+btn.dataset.i);
  else if (act==="skip-why") chooseSkipReason(btn.dataset.r);
  else if (act==="skip-cancel") cancelSkip();
  else if (act==="edit-ex") openExerciseEdit(+btn.dataset.i);
  else if (act==="edit-step") { readEditTextFields(); editStep(btn.dataset.f, +btn.dataset.d); }
  else if (act==="edit-kg-step") { readEditTextFields(); editSetKgStep(btn.dataset.v); }
  else if (act==="edit-reps") { readEditTextFields(); editSetReps(btn.dataset.v); }
  else if (act==="edit-reset") resetExerciseEditDraft();
  else if (act==="edit-save") { readEditTextFields(); saveExerciseEdit(); }
  else if (act==="edit-cancel") cancelExerciseEdit();
  else if (act==="rest") adjustRest(+btn.dataset.d);
  else if (act==="chart-pt") showChartPoint(btn.dataset.c, +btn.dataset.i);
  else if (act==="progress-range") { if (PROGRESS_RANGES[btn.dataset.r]) { ui.progressRange = btn.dataset.r; render(); } }
  else if (act==="day") { setDay(+btn.dataset.d); stopRest(); render(); }
  else if (act==="program") { setProgram(btn.dataset.id, 0); stopRest(); ui.panel="none"; toast(`${getProgram(btn.dataset.id).name} loaded`); render(); }
  else if (act==="settings-tab") { const tab=btn.dataset.tab; if (["program","sound","history","progress","backup","about"].includes(tab)) { ui.settingsTab=tab; render(); } }
  else if (act==="main-tab") {
    const tab = btn.dataset.tab;
    if (tab === "workout" || tab === "walk") {
      ui.mainTab = tab;
      if (tab !== "workout") { ui.panel = ui.panel === "add" || ui.panel === "remove" ? "none" : ui.panel; }
      render();
    }
  }
  else if (act==="walk-toggle") { toggleWalk(); }
  else if (act==="panel") { const next=btn.dataset.p; const opening=ui.panel!==next; ui.panel=opening?next:"none"; if (!opening || next!=="add") ui.pending=null; render(); }
  else if (act==="remove") { if (!removeExercise(btn.dataset.id)) toast("Keep at least one lift"); else toast(`${btn.dataset.name} removed`); render(); }
  else if (act==="pick") {
    const lift = LIBRARY.flatMap(g=>g.lifts).find(l=>l.id===btn.dataset.id);
    if (!lift) return;
    if (ui.pending?.id===lift.id) ui.pending=null;
    else { ui.pending=lift; ui.pickSets=lift.sets; ui.pickReps=lift.reps; }
    render();
  }
  else if (act==="sets") { ui.pickSets=+btn.dataset.n; render(); }
  else if (act==="reps") { ui.pickReps=+btn.dataset.n; render(); }
  else if (act==="confirm-add") {
    if (!ui.pending) return;
    const ok = addExercise({...ui.pending, sets:ui.pickSets, reps:ui.pickReps});
    if (!ok) toast("Already in the session");
    else { toast(`${ui.pending.name} · ${ui.pickSets}×${ui.pickReps}`); ui.pending=null; }
    render();
  }
  else if (act==="log") onLog();
  else if (act==="reset") resetChecks();
  else if (act==="export") exportBackup();
  else if (act==="import") importBackup();
  else if (act==="sync-now") syncNow(true);
  else if (act==="restore-cloud") restoreFromCloud();
  else if (act==="copy-live") copyLiveIntoPreview();
  else if (act==="restore-dismiss") { markRestoreOffered(); ui.restoreBannerHidden = true; render(); }
  else if (act==="check-update") checkForUpdate();
  else if (act==="apply-update") applyUpdate();
  else if (act==="cue-pack") { state.cuePack = normalizeCuePack(btn.dataset.id); save(); render(); }
  else if (act==="preview-sound") previewSound();
  else if (act==="vol") {
    state.soundVolume = clampVolume((+btn.value) / 100);
    save();
    const lab = document.querySelector("[data-vol-label]");
    if (lab) lab.textContent = `${Math.round(state.soundVolume * 100)}%`;
  }
  else if (act==="dismiss-hold") dismissBalanceHold();
  else if (act==="save-bw") saveBodyWeight();
  else if (act==="skip-bw") skipBodyWeight();
  else if (act==="bw-step") bumpBodyWeight(+btn.dataset.d);
  else if (act==="log-bw-now") openBodyWeightPrompt(false);
  else if (act==="install") {
    if (location.protocol === "file:") {
      ui.installHint = true;
      toast("Use the web link", "Open ANVIL in Chrome or Safari from the link, then tap Install. A downloaded file won’t stay on the home screen.");
      render();
    } else if (deferredInstall) {
      deferredInstall.prompt();
      deferredInstall.userChoice.then((r) => {
        if (r.outcome === "accepted") { deferredInstall = null; ui.installed = true; }
        render();
      });
    } else {
      ui.installHint = true;
      toast("Add to Home screen", "iPhone: Share → Add to Home Screen. Android: Chrome menu → Add to Home screen.");
      render();
    }
  }
});

try {
  load();
  loadWalks();
  resumeActiveWalk();
  if (normalizeWaveTargets()) save();
  render();
} catch (e) {
  // Never delete saved data here (v43 and earlier removed anvil_app_v3 on any startup error).
  rescueSaved(e);
  try { loadWalks(); } catch {}
  try { render(); }
  catch {
    const app = document.getElementById("app");
    if (app) app.textContent = "ANVIL hit a problem drawing this screen. Your data is safe on this phone — close and reopen the app, or tap Update now when it appears.";
  }
}
if (ui.loadFailed) { try { toast("Couldn’t read saved data", "A safe copy was kept on this phone"); } catch {} }
try { loadSync(); setTimeout(syncIfStale, 2500); } catch {}
if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
  function watchInstalling(worker){
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        ui.updateReady = true;
        render();
      }
    });
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (ui.refreshing) location.reload();
  });
  navigator.serviceWorker.register(new URL("sw.js", location.href).href).then((reg) => {
    ui.swReg = reg;
    try { reg.update(); } catch {}
    reg.addEventListener("updatefound", () => watchInstalling(reg.installing));
    if (reg.waiting && navigator.serviceWorker.controller) {
      ui.updateReady = true;
      render();
    }
    watchInstalling(reg.installing);
  }).catch(() => {});
  const pokeUpdate = () => {
    if (document.visibilityState !== "visible") return;
    const reg = ui.swReg;
    if (reg && typeof reg.update === "function") {
      try { reg.update(); } catch {}
    }
  };
  document.addEventListener("visibilitychange", pokeUpdate);
  window.addEventListener("focus", pokeUpdate);
  setInterval(pokeUpdate, 60 * 60 * 1000);
}
