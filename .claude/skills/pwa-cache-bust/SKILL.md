---
name: pwa-cache-bust
description: Recovery playbook for stale @ducanh2912/next-pwa service worker caches that serve outdated chunks during dev or after deploy. USE FOR: phantom React errors referencing files that don't exist (e.g. "App.tsx"), missing _next/static chunk 404s, "Cannot read properties of undefined" with stack traces pointing at deleted code, service worker not picking up next.config.ts/manifest/public/ changes, "why is my change not showing up", verifying SW activation after deploy, unregistering SW in Chrome/Safari/Firefox. Trigger phrases: "stale cache", "service worker", "sw.js", "phantom error", "chunk 404", "PWA not updating", "next-pwa", "skipWaiting", "clear cache", "unregister service worker". DO NOT USE FOR: actual code bugs that reproduce in incognito with cache disabled (those are real bugs — debug normally), Workbox precache config changes (edit next.config.ts directly), or first-time PWA setup.
---

# PWA cache recovery playbook

This project uses `@ducanh2912/next-pwa` (Workbox under the hood). The service worker is generated at build time into `public/sw.js` and registered automatically by `next-pwa`'s injection. When PWA-relevant files change — `next.config.ts`, `public/`, `manifest.ts`, anything that affects the precache manifest — the running tab can keep serving old chunks until the SW updates AND clients reload.

## Symptoms that point HERE (not at a real bug)

If the issue reproduces in **incognito with "Disable cache" checked in DevTools**, it's a real bug. If it only reproduces in your normal browser session, suspect the SW.

Telltale signs:

- React error referencing a file that **doesn't exist in the repo** (`App.tsx`, an old route, a renamed component).
- `GET /_next/static/chunks/<hash>.js 404` for hashes that don't appear in the current build.
- `TypeError: Cannot read properties of undefined (reading 'X')` with a stack trace that includes line numbers from code you deleted.
- Changes to `next.config.ts` (e.g. `images.remotePatterns`, the `withPWA` wrapping) appear to have no effect.
- Manifest icon updates don't show on the home-screen tile after rebuild.
- "I changed `globals.css` but the page looks identical" — and a hard reload doesn't fix it.

## Quick diagnostic (60 seconds)

1. Open DevTools → **Application** tab → **Service Workers** in the left sidebar.
2. Confirm the scope is `http://localhost:3000/` (or your prod origin) and check **"Last updated"**. If that timestamp is older than your last build, the SW is stuck.
3. Check the **Status** badge: `activated and is running` is normal. `redundant` means a new one is waiting.
4. **Application → Cache Storage** lists the Workbox caches (`workbox-precache-v2-...`, `workbox-runtime-...`). Their entries are the proximate cause of stale chunks.

## Dev-mode behaviour (it should NOT register at all)

`next.config.ts` has:

```ts
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: { skipWaiting: false, disableDevLogs: true },
});
```

`disable: process.env.NODE_ENV === "development"` means **the SW is NOT generated and NOT registered when running `npm run dev`**. If you see a service worker active on `localhost:3000` while `next dev` is running, one of:

1. You ran `npm run build && npm run start` earlier in this browser profile and the SW from that build is still installed.
2. `process.env.NODE_ENV` isn't being detected as `development` (check your shell — some setups set `NODE_ENV=production` accidentally).
3. The config was changed and the dev server wasn't restarted.

Fix path: unregister the SW (steps below) and restart `next dev`.

## skipWaiting policy

This project sets **`skipWaiting: false`** intentionally. Open tabs keep the previous SW active until the user reloads, so a deploy doesn't break a mid-session level. Trade-off: after a deploy, users will see the old build until they reload at least once. If you change this to `true`, document why in the PR.

## Recovery steps — try in this order

### Step 1: Unregister the SW (Chrome/Edge)

1. DevTools → **Application** → **Service Workers**
2. Find the entry for your origin → click **Unregister**
3. Close the tab (yes, close it — don't just reload)
4. Reopen the URL

That's enough ~70% of the time. The next page load will have **no SW**, will fetch fresh assets, and (in production) will register the new SW from `/sw.js`.

### Step 2: Clear cache storage explicitly

If unregister wasn't enough, the cache entries can be served by another route (e.g. a stale precached `/_next/.../chunk.js`):

1. DevTools → **Application** → **Storage** (top of the left sidebar) → **Clear site data**
2. Check at minimum: ☑ Cache storage, ☑ Service workers. Leave Local/Session storage UNCHECKED unless you also want to wipe device id / consent / learning language (you usually don't — that forces re-onboarding).
3. Click **Clear site data**
4. Hard reload: `Ctrl+Shift+R` (Linux/Win) / `Cmd+Shift+R` (Mac)

### Step 3: Nuke the build

If the dev server is the source (cached `.next` artefacts referencing renamed files):

```bash
# Stop next dev first.
rm -rf .next
npm run dev
```

This forces a clean rebuild. Combine with steps 1–2 in the browser.

### Step 4: Worst case — bump a version constant

If a deployed SW is genuinely stuck on production users, bump a version sentinel in `next.config.ts`. The `@ducanh2912/next-pwa` plugin hashes the precache manifest, so any meaningful config change (e.g. adding a comment with a date suffix to the workboxOptions, or any code change in `public/`) re-hashes `sw.js` and forces SW activation. Smallest viable change:

```ts
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    skipWaiting: false,
    disableDevLogs: true,
    // BUMP THIS to force a new SW hash:
    additionalManifestEntries: [{ url: "/version.txt", revision: "2026-05-05-1" }],
  },
});
```

Then create `public/version.txt` with that string and ship. Document in the commit.

## Browser-specific notes

### Chrome / Edge / Brave (Chromium)

DevTools steps above. **Bypass for network** checkbox in the SW panel is useful while debugging — it forwards every request to network without consulting the SW, but only while DevTools is open.

### Safari (macOS)

Service worker UI is hidden. Enable the Develop menu (Safari → Settings → Advanced → "Show features for web developers"). Then:

- Develop → Service Workers → list → right-click → Unregister
- Develop → Empty Caches (clears HTTP cache; does NOT clear Cache Storage API entries used by Workbox)
- For Cache Storage: Develop → Storage → Cache Storage → delete entries

iOS Safari has no DevTools. Recovery on iPhone:

- Settings → Safari → Advanced → Website Data → swipe-delete your origin
- Or: long-press the home-screen icon → Remove App → reinstall by visiting the site and using "Add to Home Screen"

### Firefox

- `about:debugging#/runtime/this-firefox` → Service Workers → find your origin → **Unregister**
- DevTools → Storage → Cache Storage → right-click cache → Delete All

## Verifying after a production deploy

1. Visit `/sw.js` directly in the browser. Find the `precacheAndRoute([...])` call (usually near the bottom). The hash strings (`"revision":"abc123..."`) should differ from the previous deploy. If they don't, the build didn't change anything Workbox cares about — that's fine, but it also means existing clients won't see an update prompt for this deploy.
2. In DevTools → Application → Service Workers, you should see a new entry in **"waiting"** state (because `skipWaiting: false`). The active SW is still the old one.
3. Reload once. The waiting SW activates and becomes the running one.
4. Reload again — assets are now served from the new SW's caches.

If users report stale content post-deploy and `/sw.js` *did* update, they likely never reloaded the tab. With `skipWaiting: false` that's expected; consider adding an in-app "new version available" toast that listens for `navigator.serviceWorker.controller` changing.

## When NOT to use this skill

- Bug reproduces in incognito + DevTools "Disable cache" → real bug, debug normally.
- "API call returns wrong data" → SW only caches static assets (JS chunks, CSS, images, manifest), not `/api/*` POSTs. Look at the API code.
- Audio upload fails → see the `audio-flow` skill.
- Edge function returns 5xx → see `supabase-edge-fn`.

## Step-by-step recovery walk-through (deployed prod, user-reported)

A user pings: "the app is broken, I see a weird red error". Walk them through this script:

1. **Reproduce yourself**. Open the deployed URL in your normal Chrome profile. If you don't see it, ask the user for:
   - Their browser + version
   - A screenshot of the error
   - Whether reload fixes it
2. **If you reproduce**:
   - DevTools → Application → Service Workers — note "Last updated"
   - Compare to your last deploy timestamp in Vercel/host dashboard
   - If SW is older than the deploy, this is a stale-SW case
3. **If you don't reproduce**: ask the user to open in Incognito. If incognito works, it's their cached SW. Send them this script:
   - Open DevTools (F12 or Cmd+Opt+I)
   - Application tab → Storage → Clear site data → Clear
   - Close the tab, reopen the URL

## In-app "update available" prompt (future improvement, not yet shipped)

With `skipWaiting: false`, users on a long-lived tab won't see a new SW until they reload. A common UX pattern is to show an in-app toast when a new SW is waiting:

```ts
// Conceptual sketch — not currently in this codebase
useEffect(() => {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    reg.addEventListener("updatefound", () => {
      const next = reg.installing;
      if (!next) return;
      next.addEventListener("statechange", () => {
        if (next.state === "installed" && navigator.serviceWorker.controller) {
          // A new SW is waiting; old one still controlling.
          showToast("A new version is available — reload?");
        }
      });
    });
  });
}, []);
```

If you implement this, do NOT auto-call `reg.waiting?.postMessage({type:"SKIP_WAITING"})` without user consent — that's the same problem as `skipWaiting: true`. Let the user tap "Reload".

## Inspecting `sw.js` directly

Useful for confirming what the SW will precache:

```bash
# After build:
cat public/sw.js | grep -o 'workbox-[a-z0-9-]*'        # which workbox modules baked in
cat public/sw.js | head -20                            # version banner
```

In the browser, navigate to `/sw.js` and search the file (Ctrl+F) for `precacheAndRoute` or `precache_manifest`. The array of `{url, revision}` entries is the source of truth for what will be cached.

## Quick reference: file locations

- SW config: `next.config.ts` (`withPWAInit` block)
- Generated SW: `public/sw.js` (build output, gitignored or committed depending on policy — check `.gitignore`)
- Web manifest: `src/app/manifest.ts` → served at `/manifest.webmanifest`
- Manifest icons: `public/icons/...` (hashed paths defined in `manifest.ts`)
- PWA registration injection: handled by `@ducanh2912/next-pwa` when `register: true`
