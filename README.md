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
