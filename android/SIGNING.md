# ANVIL Android signing

This folder holds the **release keystore** used to sign APKs for `com.anvil.workout`.

## Files (local only — gitignored)

| File | Purpose |
|------|---------|
| `anvil-release.keystore` | Release signing keystore (alias: `anvil`) |
| `keystore.pass` | Store/key password (single line, mode 600) |

These must **never** be committed. `.gitignore` already excludes `android/*.keystore`, `android/*.jks`, and `android/*.pass`.

## Why updates need this keystore

Android only allows an app update if the new APK is signed with the **same certificate** as the installed app. Losing this keystore means future builds cannot update in place — users would have to uninstall (wiping local data) and reinstall.

Keep a secure offline backup of `anvil-release.keystore` and `keystore.pass`.

## Important: upgrade from the original APK

The first APK shipped to users was signed with a different private key (we do not have that original keystore). Therefore:

1. **Export** a backup from the old app (Settings → Export).
2. **Uninstall** the old ANVIL app.
3. **Install** the new APK signed with `anvil-release.keystore`.
4. **Import** the backup.

After that, all future APKs signed with **this** keystore can upgrade normally without uninstalling, and workout data will survive.

## Rebuild flow

See `scripts/rebuild-apk.sh`. High level:

1. Decode the previous APK (or keep a decoded tree) with apktool.
2. Replace `assets/www/` with web assets from the repo root (`index.html`, `manifest.json`, `sw.js`, icons — not README/LICENSE).
3. Bump `versionCode` / `versionName` in `apktool.yml`.
4. `apktool b` → `zipalign` → `apksigner sign` with this keystore.
5. Output: `dist/anvil-workout.apk`.

## Cert fingerprint (this keystore)

After signing, verify with:

```bash
apksigner verify --print-certs dist/anvil-workout.apk
```

Original (pre-migration) cert SHA-256:

`c980c01f1fe673b1ab42329da2917c1cf37316c076b4fd4603bdc0c4fe682ae8`

This keystore (`anvil-release.keystore`) cert SHA-256:

`37c2a0f416f4f8dc525b36782b4109be6e49539dc1fac9b5ec2a1926e08820a7`
