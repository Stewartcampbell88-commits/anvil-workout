# ANVIL — Home gym tracker

ANVIL is a lightweight home-gym workout tracker packaged as a Progressive Web App and as an Android WebView app (`com.anvil.workout`). This repository holds the web shell: `index.html`, service worker, manifest, and icons.

## What’s in the box

| File | Role |
|------|------|
| `index.html` | Full app UI + logic (programs, session tracking, history) |
| `sw.js` | Offline service worker (`anvil-v10` cache) |
| `manifest.json` | PWA install metadata |
| Icons / favicon | App icons for install and home screen |

## How data is stored

Workout state lives only in the browser’s **`localStorage`** under the key:

```text
anvil_app_v3
```

The saved JSON object includes:

- `programId` / `dayIndex` — current program and day
- `exercises` — today’s lifts, weights, set logs
- `history` — recent session notes (kept to the last 30)
- `liftProgress` — long-term progression (weights, levels, streaks)
- `soundVolume` / `cuePack` — rest-timer volume and voice cue style

Nothing is synced to a server. Clearing site data, switching browsers, or uninstalling the Android app will wipe it unless you Export first.

## Export / Import backups

At the bottom of the main screen (under **Log session** / **Reset**):

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

When you change shell assets (HTML/CSS/JS), bump the service worker `CACHE` name (currently `anvil-v10`) so installed clients fetch the new files.

## Running locally

Serve the folder over HTTP (service workers need a secure origin or localhost):

```bash
cd anvil-workout
python3 -m http.server 8080
```

Open `http://localhost:8080` in Chrome or Safari. Opening `index.html` as a `file://` URL works for a quick look but cannot install as a PWA.

## License

MIT — see [LICENSE](LICENSE).
