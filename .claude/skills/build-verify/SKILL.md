---
name: build-verify
description: Verification triad after any code change in this Next 16 + React 19 PWA — `npx tsc --noEmit && npx eslint . && npx next build --webpack`. Covers when to run each (tsc on type changes, eslint on any code, full build before commit since it catches RSC/client-boundary errors tsc misses), the required `--webpack` flag, common failures (Module not found after rename, ReferenceError from SSR boundary issues, prerender errors on dynamic routes), and quick lint-only on changed files. USE FOR: post-edit verification, deciding whether to skip the build, debugging build-only failures, fixing Next 16 build errors. DO NOT USE FOR: deploying, runtime dev debugging (`npm run dev`), or `npm test` (no test runner configured).
---

# Build verification

The triad you run after any code change:

```bash
npx tsc --noEmit && npx eslint . && npx next build --webpack
```

This catches three disjoint failure classes:

| Tool         | Catches                                                                          | Misses                                              |
| ------------ | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `tsc`        | Type errors, unresolved imports                                                  | RSC/client-boundary violations, runtime config bugs |
| `eslint`     | Style, unused imports, react-hooks rules, Next.js best practices                 | Type errors                                         |
| `next build` | RSC/client-boundary errors, prerender failures, route export shape mismatches    | Things only triggered at runtime in the browser     |

`tsc` alone is **not** enough — Next.js inserts module wrappers around your code before bundling, and incompatibilities (e.g. importing a server-only module from a client component) only manifest at build time.

## 1. The build flag — `--webpack`

This project's `package.json`:

```json
"scripts": {
  "dev": "next dev --webpack",
  "build": "next build --webpack",
  "start": "next start",
  "lint": "eslint"
}
```

Next 16 defaults to **Turbopack** but this project pins **webpack** via `--webpack` because:

- `@ducanh2912/next-pwa` (the service-worker plugin) is webpack-only as of November 2026.
- Some webpack loader configurations in `next.config.ts` aren't yet supported under Turbopack.

**Always pass `--webpack` when invoking `next build` or `next dev` directly.** Forgetting it produces confusing errors like missing PWA manifest assets or service worker registration warnings.

`npm run build` already includes the flag, so prefer that:

```bash
npm run build
```

is equivalent to `npx next build --webpack`.

## 2. When to run each

### `tsc --noEmit` — after any type-touching change

Fastest of the three (~5–15 s on this codebase). Run after:

- Editing types in `src/lib/content/models.ts`, store interfaces, or API client signatures.
- Renaming exports.
- Touching anything that crosses module boundaries.

```bash
npx tsc --noEmit
```

It's also worth running before lint when you suspect a type-level break — eslint can fail confusingly on a missing import that's actually a tsc-reported issue.

### `eslint` — after any code change

```bash
npx eslint .                            # whole repo
npx eslint src/app/(app)/level          # one directory
npx eslint src/stores/path-repo.ts      # single file (fastest iteration)
```

This project uses `eslint-config-next` plus the default `eslint:recommended` rules. The config lives at the repo root.

**Warning vs error:** Some Core Web Vitals rules (e.g. `@next/next/no-img-element`) are **warnings**, not errors. The CI gate (if any) and `npm run lint` exit 0 on warnings — but treat them as red. Fix them before committing.

### `next build` — before commit (or before pushing)

Slowest (~30 s – 2 min depending on cache state). Run when:

- You added or removed a route segment.
- You changed a `"use client"` boundary (added or removed the directive).
- You touched `next.config.ts`, `middleware.ts`, or `i18n.ts`.
- You're about to commit anything beyond a one-file lint cleanup.

```bash
npm run build
```

Skipping the build is **acceptable for doc-only changes** (markdown, comments, this file). **Never skip it for code changes** — `tsc` does not catch RSC/client-boundary violations, and a broken build hits CI/Vercel and bricks deploy previews.

## 3. Quick iteration — lint-only on one file

When you're fixing a stack of lint errors:

```bash
npx eslint src/path/to/file.tsx --fix
```

`--fix` auto-applies safe rewrites (import sort, missing semicolons, `prefer-const`, etc.). Always re-read the file after a `--fix` pass — a few rules (e.g. `react-hooks/exhaustive-deps`) intentionally don't autofix because the safe rewrite can change behaviour.

## 4. Common failures and fixes

### `Module not found: Can't resolve '...'`

After a rename or move, the dev server's webpack cache may be stale. Fixes in order of cheapness:

1. Stop and restart `npm run dev`.
2. Delete `.next/` and rebuild:

   ```bash
   rm -rf .next && npm run build
   ```

3. If the error persists, the import path is genuinely wrong. Search for the old name:

   ```bash
   git grep "old-module-name" -- 'src/'
   ```

### `ReferenceError: <thing> is not defined` at build time

Almost always an RSC/client-boundary issue. The module imports something that only exists in the browser (e.g. `localStorage`, `window`, `navigator.onLine`) but is being evaluated on the server during prerender.

**Fix:** Add `"use client";` as the first non-empty line of the file. All `src/stores/*.ts` files in this project carry it for exactly this reason.

If the offender is *imported by* a server component, you also need a client wrapper component. RSC doesn't allow a client component to be `import`ed and called directly inside a server component's function body using a hook — you must compose them as React children.

### `Hydration failed because the server rendered HTML didn't match the client`

The store-hydration boot-gate is missing. Server renders with `hydrated: false` (initial state); client first paint reads from `localStorage` and disagrees. Fix by gating the UI on the `hydrated` flag (see the `zustand-store-pattern` skill, §4b).

### `eslint-config-next` warnings

Common ones in this project:

- `@next/next/no-img-element` — use `<Image>` from `next/image`. The level page does this at line 854.
- `react-hooks/exhaustive-deps` — list every closed-over value in the dep array. If a value is intentionally stable (e.g. a ref's `.current` is read inside but the ref object itself is stable), comment why.
- `@typescript-eslint/no-unused-vars` — prefix with `_` to silence (`(_unused, value) => ...`).

### Prerender errors on dynamic routes

Symptom:

```
Error occurred prerendering page "/level/[cycleLevel]"
```

Two possible causes:

1. **Missing `generateStaticParams`** — Next 16 requires explicit static params for catchall/dynamic routes if the route shouldn't be dynamic. If the route is genuinely dynamic (level is keyed by user state), mark it:

   ```ts
   export const dynamic = "force-dynamic";
   ```

2. **Async `params` not awaited.** Next 16 made `params` a Promise. Unwrap with `React.use()` in client components or `await` in server components. See `src/app/(app)/level/[cycleLevel]/page.tsx:76`:

   ```ts
   const { cycleLevel: rawParam } = use(params);
   ```

### "You're importing a component that needs `useState`. ..."

The component uses a React hook but is being treated as a server component. Add `"use client";` at the top.

### Build hangs at "Collecting page data"

Usually a top-level await or infinite loop in module evaluation. Common culprits:

- A store's initial state calling an async API.
- A route file with synchronous network calls outside an export.

Move the work into a hook or an effect. Module top-level should be pure.

## 5. Incremental command sequences

### After a one-file edit:

```bash
npx eslint src/path/to/changed.tsx
```

If it passes and the change is isolated, commit. If it touches types or imports:

```bash
npx tsc --noEmit && npx eslint src/path/to/changed.tsx
```

### Before a commit (recommended):

```bash
npx tsc --noEmit && npx eslint . && npm run build
```

Use `&&` so the chain stops on the first failure.

### When debugging a build-only failure:

```bash
rm -rf .next && npm run build 2>&1 | tee /tmp/build.log
```

Tee the log so you can grep it after the fact:

```bash
grep -E "(error|Error|failed)" /tmp/build.log
```

### When `tsc` is slow on first run:

The TypeScript build cache lives at `tsconfig.tsbuildinfo` (if `composite: true`) or in `.next/cache/`. Don't delete it routinely — it's what makes incremental `tsc` runs fast.

## 6. What is NOT in scope

- **`npm test`** — this project has no test runner configured. There are no unit tests; the verification surface is types + lint + build.
- **Playwright / E2E** — not set up. If you add tests, document the new gate here.
- **Deployment / CI checks** — out of scope. Vercel runs `npm run build` on its own; matching the local triad to it is the goal.
- **Runtime debugging** — `npm run dev` opens a hot-reload server but doesn't catch the same issues as `next build` (especially RSC boundaries, which dev mode is more permissive about).

## 7. Decision flowchart

```
Code change?
├── Doc/comment only? → skip the build, just ensure files save cleanly.
├── One-file logic change?
│   ├── Touches types or imports? → tsc + eslint on file.
│   └── Otherwise? → eslint on file. Run full triad before commit.
├── Multi-file or boundary change ("use client" added/removed)?
│   └── Run the full triad: tsc + eslint + next build.
├── New route, layout, or middleware? → full triad, MANDATORY.
└── About to commit? → full triad, no exceptions.
```

## 8. Common mistakes

- **Skipping the build because `tsc` passes.** `tsc` doesn't know about RSC. The build is the only gate that catches client/server boundary errors before deploy.
- **Forgetting `--webpack`.** `npx next build` (without the flag) runs Turbopack, which fails on PWA assets and produces misleading errors.
- **Running `npm run lint` and assuming green.** It exits 0 on warnings. Look at the output.
- **Trusting `next dev` output.** Dev mode is more permissive than `next build` — boundary violations sometimes only surface in the production build.
- **`rm -rf .next` as a default first move.** It's only useful for stale-cache symptoms ("Module not found" after a rename). For type/lint/RSC errors, the cache isn't the problem.
