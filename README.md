# ANVIL — Home gym tracker

ANVIL is a lightweight home-gym workout tracker packaged as a Progressive Web App and as an Android WebView app (`com.anvil.workout`). This repository holds the web shell: `index.html`, service worker, manifest, and icons.

## What’s in the box

No build step: plain classic `<script src>` files that share one global scope, loaded in this order by `index.html`.

| File | Role |
|------|------|
| `index.html` | Page shell; loads `css/app.css` and `js/*.js` (each with `?v=<APP_VERSION>`) |
| `css/app.css` | All styles |
| `js/core.js` | `APP_VERSION`, storage-key helper, programs (Day A/B lists), ladders, wave + balance-chain helpers |
| `js/walk.js` | Walk tab (timer, GPS distance, weekly strip) |
| `js/audio.js` | Rest-timer cues |
| `js/state.js` | State, load/save + migrations, safety copies, Sheet sync, Export/Import, Restore from cloud |
| `js/session.js` | Set logging, progression, rest timer, updates, body weight |
| `js/progress.js` | Progress charts |
| `js/render.js` | Screen rendering |
| `js/howto.js` | How-to sheets + animations |
| `js/main.js` | Event wiring, startup, service worker registration (loaded last) |
| `sw.js` | Offline service worker; `CACHE` must equal `APP_VERSION`; precaches every file above |
| `backend/Code.gs` | Google Apps Script sync/restore backend (copy of what is deployed; deploy by hand) |
| `tests/` | `npm test` — headless Chrome app tests + backend tests |
| `scripts/` | `bump-version.sh`, `ship.sh`, `make-preview.sh`, `publish-preview.sh`, `rebuild-apk.sh` |

## Releasing

1. `scripts/bump-version.sh 45` (updates `APP_VERSION`, `sw.js` `CACHE` and every `?v=`)
2. `npm test` (also run by `ship.sh`, `publish-preview.sh` and `rebuild-apk.sh`; they refuse on failure)
3. `scripts/publish-preview.sh` → check `/preview/` on the phone (see `PREVIEW.md`)
4. `scripts/ship.sh --push` only after Stewart OKs it

Rest cues: default **Chime** (app-style tones). Optional voice packs play pre-generated Australian audio — not browser `speechSynthesis`.

## How data is stored

Workout state lives only in the browser’s **`localStorage`** under the key:

```text
anvil_app_v3
```

The saved JSON object includes:

- `programId` / `dayIndex` — current program and day
- `exercises` — today’s lifts, weights, set logs
- `history` — logged sessions, newest first (kept to the last 500)
- `liftProgress` — long-term progression (weights, levels, streaks)
- `soundVolume` / `cuePack` — rest-timer volume and voice cue style

Other keys: `anvil_walks_v1` (walks), `anvil-sync-v1` (sync settings), `anvil_sync_token_v1` (trusted-phone token), `anvil-restore-offered-v1`, `anvil_walk_active_v1` (walk in progress), and safety copies `anvil_app_v3_snap` (before each new version first runs), `anvil_app_v3_undo` (before Import/Restore replaces data), `anvil_app_v3_rescue` (data that failed to load). The family's phones also sync to a private Google Sheet (see `backend/Code.gs`). Clearing site data, switching browsers, or uninstalling the Android app will wipe it unless you Export first.

## Export / Import backups

In **Settings → Backup**:

1. **Export** — downloads `anvil-backup-YYYY-MM-DD.json` with the current `anvil_app_v3` payload.
2. **Import** — pick a previous JSON backup, confirm overwrite, then the app writes it to `localStorage` and reloads the UI.

Use Export before updating or reinstalling anything risky. Import restores history, progression, and the current session layout from that file.

## Updating the Android APK without losing data

To keep existing workouts when shipping a new build:

1. Keep the **same Android package name**: `com.anvil.workout`
2. Sign with the **same signing key** as the previous release
3. Install the new APK **over** the old one — do **not** uninstall first
4. Keep the same `localStorage` key (`anvil_app_v3`) so WebView storage still matches

Uninstalling removes the app’s WebView storage and deletes all local data. Prefer Export → update → Import if you must wipe the install.

When you change shell assets (HTML/CSS/JS), run `scripts/bump-version.sh` so installed clients fetch the new files.

## Running locally

Serve the folder over HTTP (service workers need a secure origin or localhost):

```bash
cd anvil-workout
python3 -m http.server 8080
```

Open `http://localhost:8080` in Chrome or Safari. Opening `index.html` as a `file://` URL works for a quick look but cannot install as a PWA.

## License

MIT — see [LICENSE](LICENSE).
