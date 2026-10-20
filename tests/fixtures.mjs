// Realistic saved data in the formats real phones have today (keys + shapes must stay identical).
export const KEYS = { STATE: "anvil_app_v3", WALKS: "anvil_walks_v1", SYNC: "anvil-sync-v1", TOKENS: "anvil_sync_token_v1", OFFERED: "anvil-restore-offered-v1" };

const lift = (id, name, weight, reps, setReps, extra = {}) => ({ id, name, weight, reps, clean: setReps.every((r) => r >= reps), sets: setReps.map((r) => ({ ok: r >= reps, miss: r < reps, reps: r })), ...extra });

export function anvilHistory(n = 10, start = Date.UTC(2026, 6, 1)){
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = i % 2 ? "B" : "A";
    const date = new Date(start + i * 3.5 * 86400000).toISOString();
    const lifts = day === "A"
      ? [lift("squat", "Squat", 60 + i, 8, [8, 8, 9], { amrapReps: 9 }), lift("bench", "Bench Press", 50, 8, [8, 8, 8], { amrapReps: 8 }), lift("bext", "Back extension (twist)", 0, 10, [10, 10, 10])]
      : [lift("rdl", "RDL", 80, 8, [8, 8, 10], { amrapReps: 10 }), lift("heaves", "Heaves", -10, 6, [6, 6, 5], { amrapReps: 5 })];
    out.unshift({ date, programId: "anvil", day, notes: [`session ${i + 1}`], lifts, ...(i % 3 === 0 ? { bodyWeightKg: 85 - i * 0.1 } : {}) });
  }
  return out; // newest first, like the app
}
export const anvilProgress = () => ({
  squat: { reps: 8, weight: 69, streak: 1, failStreak: 0 }, bench: { reps: 8, weight: 50, streak: 2, failStreak: 0 },
  row: { reps: 10, weight: 40, streak: 0, failStreak: 0 }, rdl: { reps: 8, weight: 80, streak: 0, failStreak: 0 },
  heaves: { reps: 6, weight: -10, streak: 0, failStreak: 1 }, bext: { reps: 10, weight: 0, streak: 1, failStreak: 0 },
  cossack: { reps: 8, weight: 0, streak: 0, failStreak: 0, levelIndex: 1 },
});
export const walksFixture = () => [
  { date: "2026-10-19", durationSec: 1800, distanceKm: 2.41, startedAt: "2026-10-18T20:30:00.000Z" },
  { date: "2026-10-17", durationSec: 2400, distanceKm: 3.1, startedAt: "2026-10-16T21:00:00.000Z" },
];
export const bwFixture = () => [{ date: "2026-10-19T08:00:00.000Z", kg: 84.6 }, { date: "2026-10-12T08:00:00.000Z", kg: 85.2 }];

/** Current-format saved state for Stewart (v38+ layout). */
export function stewartState(extra = {}){
  return { programId: "anvil", dayIndex: 1, exercises: [], history: anvilHistory(10), liftProgress: anvilProgress(), bodyWeightLog: bwFixture(), soundVolume: 0.8, cuePack: "aussie", loudCuesV33: true, anvilLayoutV38: true, ...extra };
}
