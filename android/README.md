# Build an Android APK for YT Automation

The dashboard is a PWA, so wrapping it as a native-looking Android APK
takes ~5 minutes with the right tool. The APK is just a thin shell
that opens the live dashboard URL in a fullscreen Chrome view (a
"Trusted Web Activity" / TWA).

## Option A — PWABuilder.com (recommended)

Zero setup. Browser-only.

1. Open https://www.pwabuilder.com
2. Paste `https://dashboard.groovymark.com` → click **Start**
3. Wait for the analysis. You should see green check marks for Manifest
   and Service Worker (the latter is optional — yellow is fine).
4. Click **Package For Stores** at the top right → choose **Android**.
5. Distribution: pick **"Other (sideload)"** — no Play Store needed.
6. Settings to confirm:
   - **Package ID**: `com.groovymark.ytautomation` (or any reverse-domain)
   - **App name**: `YT Automation`
   - **Launcher name**: `YT Auto`
   - Leave the rest at defaults.
7. Click **Generate**. Download the ZIP.

### What's in the ZIP

- `app-release-signed.apk` — install this on your phone
- `assetlinks.json` — paste its contents into the Dokploy env var
  `ANDROID_ASSETLINKS_JSON` (see below)
- `signing.keystore` + `signing-key-info.txt` — **save these somewhere
  safe**. You need them to build updated APKs that the existing app
  can upgrade to. Lose them and you'll have to uninstall + reinstall
  with a new keystore.

### Install on your phone

1. Email the APK to yourself, AirDrop, USB transfer — any path.
2. On Android: Settings → Security → "Install unknown apps" → allow
   the app you'll use to open the APK (Gmail, Files, etc.).
3. Tap the APK file → Install → Open.

### One-time: serve assetlinks.json (removes the URL bar)

Without this, the app works but shows the URL bar at the top. To
verify the TWA so Android trusts it:

1. Open `assetlinks.json` from the PWABuilder ZIP — it's a JSON array
   with your APK's SHA-256 fingerprint.
2. Copy its entire contents (the `[ { ... } ]`).
3. In Dokploy → dashboard / web service → **Environment** → add:
   ```
   ANDROID_ASSETLINKS_JSON=[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.groovymark.ytautomation","sha256_cert_fingerprints":["AB:CD:EF:..."]}}]
   ```
   (Single line, escape quotes as needed.)
4. Redeploy.
5. Test: `https://dashboard.groovymark.com/.well-known/assetlinks.json`
   should return your JSON.
6. Uninstall and reinstall the APK — now Android verifies the link
   and the URL bar disappears.

## Option B — Bubblewrap CLI (advanced, local build)

If you want fully automated builds, use Google's Bubblewrap CLI.

### Prerequisites
- Node 20+
- Java JDK 17

### One-time setup

```bash
npm install -g @bubblewrap/cli

cd android
bubblewrap init --manifest=https://dashboard.groovymark.com/manifest.json
```

Bubblewrap prompts for: package ID, app name, signing key info, etc.
Use the same values as Option A's defaults. A signing key gets
generated and saved as `android.keystore` in this directory — **commit
this nowhere; back it up offline.**

### Build (every time you want a new APK)

```bash
cd android
bubblewrap build
```

Output: `app-release-signed.apk`.

### Re-using the same key across builds

Once `bubblewrap init` has run, future `bubblewrap build` invocations
use the same key, so the new APK installs as an upgrade over the old
one. Same constraint applies as Option A — keep the keystore safe.

## Quick checklist when something breaks

| Symptom | Fix |
|---|---|
| APK installs but shows URL bar | `assetlinks.json` not served — verify the URL above |
| "App not installed" on Android | Existing app has a different signing key. Uninstall first. |
| "There was a problem parsing the package" | APK is corrupted; re-download |
| PWABuilder yellow warning about service worker | Optional; APK still builds. Can ignore. |
| App opens but is white screen | Check the dashboard URL is reachable in Chrome on the phone |
