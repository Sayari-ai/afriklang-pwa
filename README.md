# Afriklang PWA

Progressive Web App companion to the [Afriklang Flutter app](../afriklang-mobile).
Built with Next.js (App Router) + TypeScript + Tailwind CSS, with offline / installable
support provided by [`@ducanh2912/next-pwa`](https://github.com/DuCanhGH/next-pwa).

## Stack

- **Framework**: Next.js 16 (App Router), TypeScript, React 19
- **Styling**: Tailwind CSS v4
- **PWA**: `@ducanh2912/next-pwa` (Workbox-based service worker)
- **Bundler**: webpack (forced via `--webpack` because `next-pwa` does not
  yet support Turbopack — see `package.json` scripts)

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000 — service worker disabled in dev
npm run build    # emits public/sw.js + workbox runtime
npm run start    # serve the production build, install banner becomes available
npm run lint
```

## Deploying to AWS Amplify

This app is **server-rendered** (App Router with the `/api/audio-upload`
Route Handler and dynamic pages), so it deploys to Amplify's **SSR/compute
platform (WEB_COMPUTE)** — not static hosting. Do **not** add
`output: "export"` to `next.config.ts`; Amplify detects SSR from the
`.next` build output.

### One-time setup

1. **Connect the repo**: Amplify console → *New app* → *Host web app* →
   pick this Git repository and branch.
2. **Build settings**: Amplify auto-detects [`amplify.yml`](./amplify.yml)
   at the repo root (runs `nvm install` → `npm ci` → `npm run build`,
   artifacts in `.next`). No manual edits needed.
3. **Node version**: pinned to 20 via [`.nvmrc`](./.nvmrc) (Next.js 16
   requires Node ≥ 20.9). Bump there if you need a newer runtime.
4. **Environment variables** (App settings → *Environment variables*) —
   see [`.env.example`](./.env.example):

   | Variable | Required | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Inlined at build time |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon key |
   | `SAYARI_BASE_URL` | ⬜ | Server-side override (has a default) |
   | `NEXT_PUBLIC_SAYARI_BASE_URL` | ⬜ | Build-time public fallback |

   `amplify.yml` copies these into `.env.production` during the build so
   the SSR compute can read them at runtime (Amplify does not expose app
   env vars to the compute by default).

### Notes / caveats

- **Next.js 16 support**: confirm Amplify's managed SSR runtime supports
  the Next.js major version before the first deploy — newer majors can lag
  Amplify's compute runtime. If unsupported, the build log will say so.
- The PWA service worker (`public/sw.js`) is regenerated on every build and
  served with `Cache-Control: no-cache` via the `customHeaders` block in
  `amplify.yml`, so deploys don't strand users on a stale worker.
- `npm ci` requires `package-lock.json` to stay in sync with `package.json`
  — run `npm install` and commit the lock file whenever deps change, or the
  Amplify build fails at the install step.

## PWA wiring

- `next.config.ts` wraps the Next config with `withPWAInit({ dest: "public", ... })`.
  The service worker is auto-registered on the client.
- `src/app/manifest.ts` is the App Router-native manifest (served at
  `/manifest.webmanifest`). Brand color `#00539F` matches the mobile app.
- Icons are SVG placeholders in `public/icons/`. Replace with real PNG/ICO
  exports of the Afriklang logo before launch.
- Generated artifacts (`public/sw.js`, `public/workbox-*.js`, etc.) are
  gitignored and re-emitted on every `next build`.

## Layout

```
src/
  app/
    layout.tsx       # Root layout with PWA metadata + viewport
    manifest.ts      # PWA manifest
    page.tsx         # Landing placeholder
    globals.css
public/
  icons/             # PWA icons (SVG placeholders)
```
