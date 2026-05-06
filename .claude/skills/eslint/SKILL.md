---
name: eslint
description: ESLint v9 with FLAT CONFIG (eslint.config.mjs) wired to eslint-config-next 16.2.4 (core-web-vitals + typescript). USE FOR: editing eslint.config.mjs, adding/disabling rules, ignoring files, configuring per-file overrides, integrating plugins, running `npm run lint`, fixing Next.js / Core Web Vitals warnings, TypeScript-aware linting. DO NOT USE FOR: legacy `.eslintrc.*` configs (this project does not use them and v9 deprecates them), `.eslintignore` files (replaced by `ignores` in flat config), Prettier formatting (not installed).
---

# eslint@^9 (+ eslint-config-next@16.2.4)

> **CRITICAL: ESLint 9 uses FLAT CONFIG.** Almost all training data shows the legacy `.eslintrc.{js,json,yml}` + `extends: ["next/core-web-vitals"]` style — that format is **deprecated** in v9 and **removed** in v10. This project uses `eslint.config.mjs` exclusively. Don't propose `.eslintrc*` edits.

## When to use
- Adding, tightening, or silencing a lint rule.
- Adjusting which files are linted (globs, ignores).
- Adding a new ESLint plugin (e.g. `eslint-plugin-jsx-a11y`, `@typescript-eslint`).
- Diagnosing a lint failure during `npm run lint` or `npm run build` (Next.js runs ESLint at build time).
- Wiring per-directory overrides (e.g. relax rules in `tests/`).

## Setup in this project (verbatim)

### `eslint.config.mjs`
```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // next-pwa generated artifacts: minified workbox runtime + service
    // worker that ship as-is. Linting them produces hundreds of bogus
    // warnings against the bundled minified code.
    "public/sw.js",
    "public/sw.js.map",
    "public/workbox-*.js",
    "public/workbox-*.js.map",
    "public/fallback-*.js",
  ]),
]);

export default eslintConfig;
```

### `package.json`
```json
{
  "scripts": { "lint": "eslint" },
  "devDependencies": {
    "eslint": "^9",
    "eslint-config-next": "16.2.4"
  }
}
```

Notes:
- File name is `eslint.config.mjs` because `package.json` does not set `"type": "module"`. `.mjs` forces ESM regardless. `eslint.config.js` would also work if `"type": "module"` were set; `eslint.config.cjs` would use CommonJS.
- `npm run lint` runs `eslint` with no path → ESLint discovers files via the config's `files`/`ignores` and the cwd.
- Next.js 16 also runs ESLint inside `next build` using this same config.
- `eslint-config-next` v16+ ships **flat-config-native** subpath exports (`eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`). That's why this project does **not** need `FlatCompat`.

## API / feature reference

### Anatomy of a flat config
A flat config exports an **array of configuration objects**. Each object can have:

| Key | Purpose |
|---|---|
| `name` | Diagnostic label (recommended). |
| `files` | Glob array — which files this object applies to. Default: `**/*.{js,cjs,mjs}`. |
| `ignores` | Glob array — files this object skips. With **only** `ignores` (no other keys), it acts as **global ignores**. |
| `languageOptions` | `ecmaVersion`, `sourceType`, `globals`, `parser`, `parserOptions`. |
| `linterOptions` | `noInlineConfig`, `reportUnusedDisableDirectives`. |
| `plugins` | `{ pluginName: pluginObject }` — flat config requires plugin **objects**, not strings. |
| `rules` | `{ "rule-name": "off" | "warn" | "error" | ["error", options] }`. |
| `settings` | Free-form metadata accessible to rules (e.g. `react: { version: "detect" }`). |
| `processor`, `extends` | Less common; `extends` is a flat-config helper provided by `defineConfig`. |

### `defineConfig` and `globalIgnores`
Imported from `eslint/config`:
- `defineConfig(arr)` — type-aware identity helper; flattens nested arrays so you can spread shareable configs.
- `globalIgnores(globs)` — returns a config object containing only `ignores`, making the global-ignore semantics explicit. Equivalent to `{ ignores: globs }` but self-documenting.

### Rule severity
```js
rules: {
  "no-unused-vars": "off",                   // disable
  "no-console": "warn",                      // print warning
  "eqeqeq": "error",                         // fail
  "@next/next/no-html-link-for-pages": ["error", { customRoutes: ["/foo"] }],
}
```

### Per-glob overrides (cascading)
Order matters — later objects override earlier ones for matching files.
```js
export default defineConfig([
  ...nextVitals,
  {
    files: ["src/lib/**/*.ts"],
    rules: { "no-console": "error" },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: { globals: { vitest: "readonly" } },
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);
```

### Adding a plugin
```js
import importPlugin from "eslint-plugin-import";

export default defineConfig([
  ...nextVitals,
  {
    plugins: { import: importPlugin },
    rules: {
      "import/order": ["warn", { "newlines-between": "always" }],
      "import/no-default-export": "off",
    },
  },
]);
```
Key differences vs legacy:
- Plugin is **imported as an ESM module** and passed as an **object**, not a string.
- The plugin key in `plugins` (`import` here) is the **prefix** used in rule IDs (`import/order`).

### `languageOptions`
```js
{
  languageOptions: {
    ecmaVersion: "latest",       // default
    sourceType: "module",        // default for .js/.mjs
    globals: { window: "readonly", MyGlobal: "writable" },
    parser: tsParser,            // an imported parser object, e.g. @typescript-eslint/parser
    parserOptions: {
      project: "./tsconfig.json",
      tsconfigRootDir: import.meta.dirname,
    },
  },
}
```

### Globally ignoring files
Two equivalent forms:
```js
globalIgnores([".next/**", "public/sw.js"])
// or
{ ignores: [".next/**", "public/sw.js"] }   // no other keys → global
```
**Replaces `.eslintignore`** (no longer read in v9). Note: directory-only patterns must end with `/**` (e.g. `dist/**`, not `dist/`).

### Rules from `eslint-config-next`
This project pulls in two sub-configs from `eslint-config-next`:

1. **`eslint-config-next/core-web-vitals`** — extends the base Next plugin recommended set with stricter Web Vitals-related rules:
   - `@next/next/no-img-element` (error) — use `next/image`.
   - `@next/next/no-html-link-for-pages` (error) — use `next/link` for internal routes.
   - `@next/next/no-sync-scripts`, `@next/next/no-script-component-in-head`.
   - `@next/next/no-page-custom-font`, `@next/next/google-font-display`, `@next/next/google-font-preconnect`.
   - `@next/next/inline-script-id`, `@next/next/no-before-interactive-script-outside-document`.
   - `@next/next/no-assign-module-variable`, `@next/next/no-document-import-in-page`, `@next/next/no-head-element`, `@next/next/no-styled-jsx-in-document`, `@next/next/no-title-in-document-head`, `@next/next/no-typos`, `@next/next/no-unwanted-polyfillio`.
   - React + React Hooks rules (`react/jsx-key`, `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`).
   - Core JS rules (`no-undef`, `no-unused-vars` adapted for TS).

2. **`eslint-config-next/typescript`** — adds `@typescript-eslint/parser` + a curated subset of `@typescript-eslint` rules suitable for App-Router projects (no type-checked rules by default — those require `parserOptions.project`).

To inspect which rules are actually active for a given file:
```bash
npx eslint --print-config src/app/page.tsx
```

### Running the linter
```bash
npm run lint                       # whole repo (respects ignores)
npx eslint src/app                 # subset
npx eslint --fix src/app           # autofix
npx eslint --max-warnings 0 .      # treat warnings as errors (CI gate)
npx eslint --inspect-config        # interactive flat-config explorer
npx eslint --print-config <file>   # dump effective rules for a file
```

### Inline disables (still work)
```ts
// eslint-disable-next-line @next/next/no-img-element
<img src="/legacy.png" />

/* eslint-disable @typescript-eslint/no-explicit-any */
const opaque: any = …;
/* eslint-enable @typescript-eslint/no-explicit-any */
```
`reportUnusedDisableDirectives` defaults to `"warn"` in v9 — stale disable comments now produce a lint warning.

## Common patterns

### Allow `<img>` on a single file (avatar / icon)
```ts
/* eslint-disable @next/next/no-img-element */
```
Prefer fixing it with `next/image`. Only disable when the source is a data URI or external CDN that resists optimisation.

### Relax a rule globally for one directory
```js
{
  files: ["src/lib/dev/**/*.ts"],
  rules: { "no-console": "off" },
},
```

### Add a typed `@typescript-eslint` rule (when needed)
```js
import tseslint from "typescript-eslint";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
]);
```
Type-checked rules are *significantly* slower — apply them narrowly.

### Using a legacy shareable config via FlatCompat (only if needed)
This project doesn't need it because `eslint-config-next` ships flat-native exports. If you ever pull in an old `.eslintrc`-style shareable config:
```js
import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

export default defineConfig([
  ...compat.extends("some-legacy-config"),
  // ...
]);
```

## Gotchas

1. **`.eslintrc.*` is dead.** ESLint v9 still reads it via `ESLINT_USE_FLAT_CONFIG=false`, but v10 removes that escape hatch. Don't add one. If you find one in the repo, migrate it.
2. **`.eslintignore` is dead.** Move patterns into `globalIgnores([...])`. Directories need a `/**` suffix.
3. **Plugins are objects, not strings.** `plugins: ["import"]` (legacy) → `plugins: { import: importPlugin }` (flat). The string version silently does nothing in flat config.
4. **Order matters in the array.** Later entries override earlier ones for matched files. Place `eslint-config-next` spreads first, project overrides last.
5. **`extends` no longer exists at the top level.** In flat config you spread arrays (`...nextVitals`). The `extends` key inside a single config object is a `defineConfig`-only convenience and works differently than legacy `extends`.
6. **Default file targets are `**/*.{js,cjs,mjs}`.** TypeScript files are linted only because `eslint-config-next/typescript` adds `**/*.{ts,tsx}` patterns. If you write your own object with `rules` only and no `files`, it applies to JS files too — be deliberate.
7. **`eslint-config-next` v16 sub-paths require ESM.** Hence `eslint.config.mjs` (or `"type": "module"`).
8. **`next build` runs ESLint.** Failing rules break the build. To skip during build, set `eslint.ignoreDuringBuilds: true` in `next.config.*` — but prefer fixing.
9. **No more `--ext` flag.** ESLint v9 derives extensions purely from `files` globs. `npx eslint --ext .ts,.tsx .` is gone.
10. **Cache file path** moved to `.eslintcache` in cwd by default — keep it gitignored.
11. **`reportUnusedDisableDirectives` defaults to `"warn"`.** Old disable comments will surface as lint output until removed.
12. **`eslint --init` generates flat config now.** Don't be surprised when it produces `eslint.config.mjs`.
13. **`globalIgnores` requires the patterns to be globs**, not paths. `dist/` won't match anything; `dist/**` will.
14. **Workbox / next-pwa output**: this project deliberately ignores `public/sw.js`, `public/workbox-*.js`, etc. — they are minified and would generate hundreds of false positives. Re-add to `globalIgnores` if a new generated file appears.
15. **TypeScript-aware ESLint can be slow.** The current config does *not* set `parserOptions.project`, so type-aware rules are off. Only enable them in a scoped override for the files that need them.

## References
- Project: `eslint.config.mjs`, `package.json`.
- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- Configure rules: https://eslint.org/docs/latest/use/configure/rules
- Configure plugins: https://eslint.org/docs/latest/use/configure/plugins
- Combine configs: https://eslint.org/docs/latest/use/configure/combine-configs
- Ignore files: https://eslint.org/docs/latest/use/configure/ignore
- Migration guide (legacy → flat): https://eslint.org/docs/latest/use/configure/migration-guide
- ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
- `eslint-config-next`: https://nextjs.org/docs/app/api-reference/config/eslint
- typescript-eslint flat config: https://typescript-eslint.io/getting-started
