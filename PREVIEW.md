# Previewing a build on the phone before it goes live

`scripts/publish-preview.sh` builds the current branch into `/anvil-workout/preview/` on top of what is live
(`origin/main`), leaving every live file at the root byte-identical. With `--push` it publishes; without, it only
makes the local branch `preview-pages`. Open https://stewartcampbell88-commits.github.io/anvil-workout/preview/
in Chrome on the phone (don't install it).

## Does it share data with the live app?

The preview is the **same origin** as live (`stewartcampbell88-commits.github.io`), so the browser gives it the
**same localStorage and Cache Storage**. (On Android the installed ANVIL app and Chrome tabs share it too; on iPhone
a home-screen app is separate from Safari.) Without precautions a preview build would load, migrate and re-save the
real `anvil_app_v3`, and auto-sync to the Google Sheet. So the preview build, detected by `/preview/` in its URL:

- prefixes **every** key with `anvil-preview:` — it starts empty and cannot write a live key;
- has Google Sheet **sync and Restore switched off** — it never overwrites the cloud copy and never spends
  family-PIN lockout tries;
- offers **Settings → Backup → Copy my real data into Preview**: a one-way read of the live keys;
- uses its own service-worker scope (`/preview/`) and cache names (`anvil-preview-*`), and each flavour only
  deletes its own old caches.

Remaining risks: it uses some of the same ~5 MB storage quota; the live v43 service worker (scope `/anvil-workout/`)
still answers `/preview/` requests until the preview's own worker installs (harmless); a live update to a
pre-v44 build deletes preview caches (preview just refetches). Remove the preview by deleting `preview/` from main.
