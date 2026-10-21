# Previewing a build on the phone before it goes live

The preview lives in its **own repo**, `Stewartcampbell88-commits/anvil-preview` (GitHub Pages from `main` /):

**https://stewartcampbell88-commits.github.io/anvil-preview/**

`scripts/publish-preview.sh` runs the tests, builds the current branch (via `scripts/make-preview.sh`) and, with
`--push`, pushes it to that repo's `main`. Without `--push` it only builds and commits in a temp dir. The live repo
(`anvil-workout`) is not touched. Open the link in Chrome on the phone (don't install it).

## Why a separate address?

The installed ANVIL app's scope is `/anvil-workout/`. The old preview at `/anvil-workout/preview/` was *inside* that
scope, so tapping a preview link opened it in the installed app and the app stayed there. `/anvil-preview/` is
outside the scope, so the installed app can never open it.

`anvil-workout/preview/` is now only a redirect: `preview/index.html` unregisters the old `/preview/` service worker,
clears the old `anvil-preview-*` caches (unless the new preview is installed in that browser) and
`location.replace`s to the live app; `preview/sw.js` is a self-unregistering worker that does the same for a phone
still running the old preview worker. Never build into `./preview` (`make-preview.sh` refuses).

## Does it share data with the live app?

The preview is the **same origin** as live (`stewartcampbell88-commits.github.io`), so the browser gives it the
**same localStorage and Cache Storage**. So the preview build, detected by `/anvil-preview/` (or legacy `/preview/`)
in its URL:

- prefixes **every** key with `anvil-preview:` — it starts empty and cannot write a live key (data from the old
  `/preview/` address is still there, same keys);
- has Google Sheet **sync and Restore switched off** — it never overwrites the cloud copy and never spends
  family-PIN lockout tries;
- offers **Settings → Backup → Copy my real data into Preview**: a one-way read of the live keys;
- uses its own service-worker scope (`/anvil-preview/`) and cache names (`anvil-preview-*`), and each flavour only
  deletes its own old caches.

Remaining risk: it uses some of the same ~5 MB storage quota. Remove the preview by deleting the anvil-preview repo
(or turning its Pages off).
