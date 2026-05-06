---
name: typescript
description: TypeScript 5.x configured for Next.js 16 App Router — strict mode, bundler module resolution, react-jsx, path alias `@/*` → `./src/*`. USE FOR: tsconfig edits, type errors, picking the right utility type, generic / conditional / mapped types, type guards, discriminated unions, ambient declarations, satisfies operator, Next.js-specific typing (PageProps, server-action types). DO NOT USE FOR: runtime schema validation (zod is NOT installed — use manual type guards), JS-only refactors, ESLint rule tweaks (see `eslint` skill), build-time Next config (see Next.js docs).
---

# typescript@^5 (Next.js 16 App Router)

## When to use
- Writing or refactoring any `.ts` / `.tsx` in `src/**`.
- Modelling API responses, store state, server actions.
- Resolving "Property X does not exist on type Y", "Type Z is not assignable to …".
- Adding a path alias, lib target, or a new compiler option.
- Adding ambient module declarations for assets / untyped JS deps.

## Setup in this project (verbatim)

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

(Project file uses `"jsx": "react-jsx"` — Next 16 also accepts `"preserve"`. Keep whichever ships in the repo. Both compile correctly under SWC/Webpack; `react-jsx` matches what `create-next-app` emits today.)

### Why each option
| Option | Reason |
|---|---|
| `target: "ES2017"` | Wide browser support after Next/SWC down-levels. |
| `lib: ["dom", "dom.iterable", "esnext"]` | DOM types + the latest ECMAScript built-ins. |
| `allowJs: true` | Permits importing legacy `.js` (e.g. occasional config files). |
| `skipLibCheck: true` | Skips type-checking `node_modules/**/*.d.ts` — speeds builds, avoids 3P breakage. |
| `strict: true` | Enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict`. |
| `noEmit: true` | TS only type-checks; SWC/webpack does the actual transpile. |
| `esModuleInterop: true` | Lets `import x from "cjs-module"` work. |
| `module: "esnext"` | Emit pure ESM `import`/`export`. |
| `moduleResolution: "bundler"` | TS 5 mode that mirrors how bundlers resolve — supports `package.json` `exports`, no extension required, no `.js` rewrite. **Required by Next 16.** |
| `resolveJsonModule: true` | `import data from "./data.json"`. |
| `isolatedModules: true` | Each file must be transpilable in isolation (required by SWC). Forbids `const enum`, certain re-exports without `export type`. |
| `jsx: "preserve"` / `"react-jsx"` | Next/SWC handles JSX transformation. `"preserve"` keeps `<Foo/>` for Next; `"react-jsx"` emits `_jsx()` calls. Both work in Next 16. |
| `incremental: true` | Caches type-check info in `.tsbuildinfo` for faster subsequent runs. |
| `plugins: [{ name: "next" }]` | Enables the Next.js TS server plugin: typed routes, server-component diagnostics, async `params` handling. |
| `paths: { "@/*": ["./src/*"] }` | Project-wide alias — `import x from "@/lib/foo"`. |
| `include: ".next/types/**"` | Picks up Next-generated types (typed routes, route segment configs). |

### Package versions
```json
{ "devDependencies": { "typescript": "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19" } }
```

## TypeScript 5.x feature reference

### `satisfies` operator
Validates a value against a type **without widening** the inferred literal type. Excellent for store config / route maps where you want both autocomplete and exhaustive keys.
```ts
const palette = {
  primary: "#00539f",
  recordActive: "#e53935",
} satisfies Record<string, `#${string}`>;
// typeof palette.primary is the literal "#00539f", not string.
```

### `const` type parameters
```ts
function tuple<const T extends readonly unknown[]>(t: T): T { return t; }
const t = tuple(["a", "b"]);   // type: readonly ["a", "b"], not string[]
```

### Decorators (stage 3)
TS 5 supports the standard decorator proposal (no `experimentalDecorators` flag). Not used in this project, but legal.

### `using` / `Symbol.dispose`
```ts
function openFile(path: string) {
  const handle = fs.openSync(path, "r");
  return { handle, [Symbol.dispose]() { fs.closeSync(handle); } };
}
{
  using f = openFile("a.txt");   // disposed at block exit
}
```
Requires `target` ≥ ES2022 + a polyfill (or TS 5.2+ down-level helpers). Not currently used here.

### `allowImportingTsExtensions`
Lets you write `import x from "./foo.ts"` (only valid with `noEmit: true` or `emitDeclarationOnly`). Off in this project.

### `verbatimModuleSyntax`
Stricter than `isolatedModules` + `importsNotUsedAsValues`. Forces `import type` everywhere a value isn't actually used at runtime, and never elides `import "./side-effect"`. Not enabled here, but recommended if you ever flip it on you'll need to audit imports.

### `isolatedDeclarations`
TS 5.5+. When enabled, every exported declaration must be explicitly typed so a tool can emit `.d.ts` without invoking the TS checker. Useful for libraries; off here.

### `noUncheckedIndexedAccess` (recommended toggle, currently off)
Adds `| undefined` to every indexed access (`arr[0]: T | undefined`). Catches a major class of bugs but requires extensive optional-chaining adjustments — flip on with care.

## Utility types cheat sheet

| Utility | Example | Result |
|---|---|---|
| `Partial<T>` | `Partial<{a: 1, b: 2}>` | `{ a?: 1; b?: 2 }` |
| `Required<T>` | `Required<{a?: 1}>` | `{ a: 1 }` |
| `Readonly<T>` | `Readonly<{a: 1}>` | `{ readonly a: 1 }` |
| `Pick<T, K>` | `Pick<User, "id" \| "name">` | object with only those keys |
| `Omit<T, K>` | `Omit<User, "password">` | inverse of Pick |
| `Record<K, V>` | `Record<"r" \| "g" \| "b", number>` | `{ r: number; g: number; b: number }` |
| `Exclude<T, U>` | `Exclude<"a" \| "b", "a">` | `"b"` |
| `Extract<T, U>` | `Extract<string \| number, string>` | `string` |
| `NonNullable<T>` | `NonNullable<string \| null>` | `string` |
| `ReturnType<F>` | `ReturnType<() => 1>` | `1` |
| `Parameters<F>` | `Parameters<(a: 1, b: 2) => void>` | `[a: 1, b: 2]` |
| `Awaited<T>` | `Awaited<Promise<Promise<1>>>` | `1` |
| `InstanceType<C>` | `InstanceType<typeof Foo>` | instance shape |
| `ConstructorParameters<C>` | constructor arg tuple |
| `Uppercase / Lowercase / Capitalize / Uncapitalize` | template-literal manipulation |

### Built-in type predicate helpers
```ts
function isDefined<T>(x: T | null | undefined): x is T { return x != null; }

const items: (User | null)[] = …;
const live: User[] = items.filter(isDefined);
```

## Conditional types
```ts
type IsArray<T> = T extends readonly unknown[] ? true : false;
type A = IsArray<string[]>;   // true
type B = IsArray<string>;     // false

// Distributive over unions:
type Wrap<T> = T extends unknown ? { value: T } : never;
type W = Wrap<"a" | "b">;     // { value: "a" } | { value: "b" }

// `infer` to extract types:
type ElementOf<T> = T extends readonly (infer U)[] ? U : never;
```

## Mapped types
```ts
type Nullable<T> = { [K in keyof T]: T[K] | null };

// Key remapping (TS 4.1+):
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

// Modifiers: `+readonly`, `-readonly`, `+?`, `-?`
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Concrete<T> = { [K in keyof T]-?: T[K] };
```

## Template literal types
```ts
type Route = `/${"home" | "lessons" | "profile"}`;     // "/home" | "/lessons" | "/profile"
type EventName<E extends string> = `on${Capitalize<E>}`;
```

## Generics — practical patterns
```ts
function once<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  let called = false; let value: R;
  return (...args) => (called ? value : (called = true, value = fn(...args)));
}

// Constrained generic
function pickKey<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }
```

## Declaration merging & ambient modules
```ts
// src/types/global.d.ts
declare global {
  interface Window {
    __APP_BUILD__?: string;
  }
}
export {}; // make this file a module

// src/types/png.d.ts — ambient for non-TS imports
declare module "*.png" {
  const src: string;
  export default src;
}

// next-intl module augmentation example
declare module "next-intl" {
  interface AppConfig { Locale: "en" | "fr" | "lin" }
}
```
Anything inside `**/*.d.ts` is auto-included by `tsconfig.json`'s `include`.

## Common patterns in this project

### Manual interfaces (no zod)
```ts
// src/lib/api/types.ts
export interface LessonSummary {
  id: string;
  title: string;
  unlocked: boolean;
  progress: number; // 0..1
}
```
Pair with a hand-written guard at the network boundary:
```ts
function isLessonSummary(x: unknown): x is LessonSummary {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string"
    && typeof o.title === "string"
    && typeof o.unlocked === "boolean"
    && typeof o.progress === "number";
}
```

### Discriminated unions for API responses
```ts
type Result<T> =
  | { status: "ok";    data: T }
  | { status: "error"; error: { code: string; message: string } };

function render<T>(r: Result<T>) {
  if (r.status === "ok") return r.data;   // T narrowed
  console.error(r.error.message);          // error narrowed
}
```

### `satisfies` for store configs
```ts
import { create } from "zustand";

interface SessionState {
  userId: string | null;
  setUserId: (id: string | null) => void;
}

export const useSession = create<SessionState>()((set) => ({
  userId: null,
  setUserId: (id) => set({ userId: id }),
} satisfies SessionState));
```

### Next.js App Router typing
```tsx
// src/app/lessons/[id]/page.tsx — Next 16: params is async
type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LessonPage({ params }: PageProps) {
  const { id } = await params;
  // …
}
```

### Path alias
```ts
import { supabase } from "@/lib/supabase";   // → ./src/lib/supabase
import type { Lesson } from "@/lib/api/types";
```
Works because of `paths: { "@/*": ["./src/*"] }` + `moduleResolution: "bundler"`. The Next TS plugin and SWC honour it without further config.

### Type-only imports
```ts
import type { ReactNode } from "react";
import { useEffect, type FC } from "react";   // mixed form
```
Required when `verbatimModuleSyntax` is on; recommended even without.

### Asserting `unknown` from JSON
```ts
const raw: unknown = await res.json();
if (!isLessonSummary(raw)) throw new Error("Bad payload");
const lesson = raw;   // narrowed to LessonSummary
```

## Gotchas

1. **`moduleResolution: "bundler"` is mandatory for Next 16.** `"node"` and `"node16"` will break `package.json` `exports` resolution for things like `next-intl/server`, `eslint-config-next/core-web-vitals`. Don't change it.
2. **`isolatedModules: true` forbids `const enum`.** Use plain `enum` or, better, a `const` object with `as const` and a derived union type.
3. **Re-exporting types** under `isolatedModules` requires `export type { Foo } from "./bar"`. Plain `export { Foo }` errors when `Foo` is type-only.
4. **`strictPropertyInitialization`** (part of `strict`) requires every class field to be assigned in the constructor or marked `?` / `!`. Most React state lives in functions so this rarely bites here.
5. **`useUnknownInCatchVariables`** (part of `strict` since 4.4): `catch (e)` types `e` as `unknown`. Narrow before use:
   ```ts
   try { … } catch (e) { if (e instanceof Error) console.log(e.message); }
   ```
6. **`skipLibCheck: true`** hides errors in `node_modules`. If a 3rd-party type is wrong, you may need a local override file (`src/types/foo.d.ts`).
7. **`noEmit: true`**: do not run `tsc` expecting JS output. Use `tsc --noEmit` for type-checking; let SWC compile.
8. **Path aliases at runtime**: `tsconfig.json#paths` only affects type-checking + Next/SWC. Don't expect Node-without-bundler scripts to resolve `@/…` (use `tsx`/`ts-node` with a paths plugin if needed).
9. **JSX flag**: with `"jsx": "preserve"` you cannot run files through `tsc` to JS — Next/SWC must do the JSX transform. With `"react-jsx"`, you import nothing — no `import React from "react"` needed.
10. **`incremental: true` produces `.tsbuildinfo`** — keep it gitignored (Next handles this).
11. **Next 16 `params` is `Promise<…>`.** Forgetting to `await` is a runtime bug the type system catches only if you type the prop as `Promise<…>`. Always do.
12. **`@types/react` 19 changed defaults**: `ReactNode` no longer includes `bigint`, `useRef<T>(initial)` requires the initial value or yields `RefObject<T | null>`. If you upgraded from 18, expect minor type shifts.
13. **TS doesn't validate runtime data.** Interfaces are erased. Always guard at the network boundary; this project does so manually (see "Manual interfaces" above).
14. **Cyclic `import type` is fine**, cyclic value imports may not be. Prefer splitting types into a leaf `types.ts` per module.
15. **`tsc --watch` vs `next dev`**: don't run both; `next dev` already type-checks (well, lints — full TS check happens on `next build`). For continuous checks, run `tsc --noEmit --watch` in a side terminal.

## References
- Project: `tsconfig.json`, `package.json`, `src/types/**`.
- TS handbook: https://www.typescriptlang.org/docs/handbook/intro.html
- TSConfig reference: https://www.typescriptlang.org/tsconfig
- Module resolution `bundler`: https://www.typescriptlang.org/docs/handbook/modules/reference.html#bundler
- Utility types: https://www.typescriptlang.org/docs/handbook/utility-types.html
- TS 5.0 release notes (decorators, `const` type params): https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/
- `satisfies` (TS 4.9): https://devblogs.microsoft.com/typescript/announcing-typescript-4-9/#the-satisfies-operator
- `using` / `Symbol.dispose` (TS 5.2): https://devblogs.microsoft.com/typescript/announcing-typescript-5-2/
- Next.js TypeScript guide: https://nextjs.org/docs/app/api-reference/config/typescript
