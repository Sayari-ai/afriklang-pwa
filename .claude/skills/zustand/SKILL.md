---
name: zustand
description: Zustand is a small, hook-based state management library for React. This project uses it heavily — every store under src/stores/ (path-repo, consent, snackbar, device-identity, learning-language, nickname, onboarding, app-locale) is a Zustand `create()` call. USE FOR: app-wide client state (consent flags, device identity, in-progress repositories, snackbar slot, locale selection), state that must be readable from non-React call sites via `useFoo.getState()`, state that needs imperative actions (boot, completeLevel, advanceCycle), and lightweight transient/event channels. DO NOT USE FOR: server data the screen reads declaratively (use SWR), persistent storage primitives (use safeStorage / IndexedDB directly inside store actions), or React-only ephemeral UI state that lives inside one component (use useState).
---

# zustand@^5.0.12

## When to use

This project's pattern is **one Zustand store per concern**, each in its own file under `src/stores/`. Stores own:

- The in-memory shape of a domain (consent flags, progress vector, etc.).
- Imperative actions that mutate that shape (`grant()`, `completeLevel()`, `boot()`).
- Persistence I/O via `safeStorage` (localStorage wrapper) — NOT via the `persist` middleware (the project rolls its own to keep storage shapes auditable and migrate-friendly).

**Reach for a Zustand store when**:
- Data is shared across screens or used by non-React code (API clients, queue runners).
- The data needs imperative methods that bundle "mutate cache + post to backend + update memory" (`completeLevel` is the canonical example).
- You want to subscribe to changes outside React (transient updates).

**Don't reach for Zustand when**:
- The data is a one-shot read of a backend resource — use SWR (currently leaderboard only).
- The state lives in one component — use `useState`/`useReducer`.
- You want global server-state caching with focus revalidation — that's SWR's job.

## API reference

### `create<T>()(initializer)` — v5 syntax

v5 dropped the legacy default export and tightened the curried form. Always:

```ts
import { create } from 'zustand';

interface ConsentState {
  granted: boolean;
  grant: () => void;
}

export const useConsent = create<ConsentState>()((set, get) => ({
  granted: false,
  grant: () => set({ granted: true }),
}));
```

Note the **double parens**: `create<T>()(initializer)`. v4 allowed `create<T>(initializer)` but v5 requires the curried form for proper inference of middleware return types. (When no generic is needed because you use `combine`, you can write `create((set, get) => ({...}))`.)

The returned `useConsent` is **both** a React hook and an object with static methods (`getState`, `setState`, `subscribe`, `destroy`). This dual nature is the foundation of the project's idioms — see [The `useFoo` + `useFoo.getState()` idiom](#the-usefoo--usefoogetstate-idiom).

### `set` and `get`

```ts
(set, get) => ({
  count: 0,
  inc: () => set({ count: get().count + 1 }),
  // Or, equivalently, the functional form:
  inc2: () => set((state) => ({ count: state.count + 1 })),
})
```

- `set(partial)` shallow-merges. Pass a function for atomic updates that depend on previous state.
- `set(partial, true)` **replaces** the entire state (second arg defaults to `false`). Almost never want this — wipes actions too.
- `get()` reads the current state synchronously inside actions. Use this to read store state from inside an action without re-deriving via a selector.

### `useStore(selector, equalityFn?)` — the hook form

```ts
// Subscribe to a single field (referential equality):
const granted = useConsent((s) => s.granted);

// Subscribe to multiple fields with shallow equality (v5 idiom):
import { useShallow } from 'zustand/shallow';
const { granted, grantedAt } = useConsent(
  useShallow((s) => ({ granted: s.granted, grantedAt: s.grantedAt })),
);
```

**v5 breaking change**: the legacy second-arg `equalityFn` was removed from `create()`'s default. To use shallow equality, wrap the selector in `useShallow` (from `zustand/shallow`), or use `createWithEqualityFn` from `zustand/traditional` if you need a custom comparator.

The selector runs on every store change; the component re-renders only when the selector's output fails the equality check.

### Static accessors — `useStore.getState()` / `useStore.setState()`

```ts
// Read the current state without subscribing (no React, no rerender):
const id = useDeviceIdentity.getState().ensure();

// Mutate from outside React:
useSnackbar.getState().show('Saved');
useDeviceIdentity.setState({ deviceId: null });

// Subscribe imperatively (returns unsubscribe):
const unsub = useConsent.subscribe((state, prev) => {
  if (state.granted !== prev.granted) console.log('flipped');
});
```

These work **outside React** — in API clients, queue runners, the audio pipeline, etc. The project uses this idiom pervasively (see [Common patterns](#common-patterns-project-specific)).

`getState()` returns the **canonical** state object — same reference selectors see. Don't mutate it; always go through actions or `setState`.

## The `useFoo` + `useFoo.getState()` idiom

**This is the most important pattern in this codebase.** Every store exposes both:

1. The **hook** `useFoo`, used inside React components for reactive subscriptions.
2. The **static** `useFoo.getState()`, used everywhere else for synchronous reads.

Examples from the codebase:

```ts
// src/stores/path-repo.ts:360
const deviceId = useDeviceIdentity.getState().ensure();

// src/stores/path-repo.ts:389
const deviceId = useDeviceIdentity.getState().ensure();

// src/stores/path-repo.ts:528
useDeviceIdentity.getState().rotate();

// src/stores/snackbar.ts (consumed pattern):
useSnackbar.getState().show('Hello');
```

`useDeviceIdentity` exports a synchronous helper that wraps this:

```ts
// src/stores/device-identity.ts:69
export function getDeviceIdSync(): string {
  if (typeof window === 'undefined') {
    throw new Error('called on server — gate behind a "use client" boundary');
  }
  return useDeviceIdentity.getState().ensure();
}
```

**When to use which**:
- React component that should re-render on change → `useFoo((s) => s.field)`.
- React component that needs the value once (event handler, effect setup) → `useFoo.getState().field` is fine, but prefer the hook unless you have a reason.
- Action inside another store → `useFoo.getState()`. Calling another store's hook is illegal here (no hook context).
- API client / network layer / non-React code → `useFoo.getState()`.

**Rule**: never call `useFoo()` (the hook) outside a component. Always use `useFoo.getState()` from store actions, plain functions, or imperative code.

## Middleware

Composed left-to-right; the outermost wrapper sees the raw initializer last. Common middleware:

### `persist` — automatic localStorage / sessionStorage

```ts
import { persist, createJSONStorage } from 'zustand/middleware';

create<State>()(
  persist(
    (set, get) => ({ /* ... */ }),
    {
      name: 'feature-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ granted: state.granted }), // pick what to persist
      version: 1,
      migrate: (persisted, version) => { /* ... */ },
    },
  ),
);
```

**This project doesn't use `persist`.** Instead, every store does I/O explicitly via `safeStorage` (`src/lib/safe-storage.ts`) inside its actions — see `consent.ts:60-61`, `path-repo.ts:writeCachedBundle`, etc. Reasons:

- Storage shape is auditable and migration-friendly (we control the JSON layout to mirror the Flutter app's SharedPreferences keys exactly).
- We need to tolerate two on-disk shapes during a backend rollout (`path-repo.ts:readCachedBundle`).
- We can call `safeStorage.getItem` synchronously during store **initialization** to seed the initial state from disk (see `device-identity.ts:41` — `deviceId: readPersisted()`).

If you add a new persisted store, follow the existing convention rather than introducing `persist`.

### `devtools` — Redux DevTools integration

```ts
import { devtools } from 'zustand/middleware';

create<State>()(devtools((set) => ({...}), { name: 'consent', store: 'consent' }));
```

Each set call shows up as `setState` in the DevTools panel. Pass a third arg to `set` to label actions:

```ts
set({ granted: true }, false, 'consent/grant');
```

Currently not wired up project-wide; consider adding for hard-to-trace store interactions during debugging.

### `immer` — mutable-style updates for nested state

```ts
import { immer } from 'zustand/middleware/immer';

create<State>()(immer((set) => ({
  nested: { count: 0 },
  inc: () => set((state) => { state.nested.count += 1; }), // looks mutable, is immutable
})));
```

Not used in this project — our state shapes are flat enough that `set((s) => ({ field: { ...s.field, count: s.field.count + 1 } }))` stays readable. Reach for `immer` if you find yourself spreading three levels deep.

### `subscribeWithSelector` — selector-aware subscribe

Default `subscribe` fires on every change; with this middleware you can subscribe to a specific slice:

```ts
import { subscribeWithSelector } from 'zustand/middleware';

const useDog = create<State>()(subscribeWithSelector((set) => ({...})));

useDog.subscribe(
  (state) => state.paw,
  (paw, prev) => console.log('paw changed', paw, prev),
  { equalityFn: shallow, fireImmediately: false },
);
```

Useful for transient updates outside React without a wasted-render trigger on unrelated fields.

### `combine` — type-friendly state + actions split

```ts
import { combine } from 'zustand/middleware';

const useStore = create(combine(
  { count: 0, name: '' },              // initial state — types inferred
  (set, get) => ({                      // actions
    inc: () => set((s) => ({ count: s.count + 1 })),
  }),
));
```

`combine` infers the state type from the first argument — no explicit `<State>` generic needed. Tradeoff: more verbose for small stores, can't pre-declare optional fields cleanly. The project uses **explicit generics** instead (see every file in `src/stores/`) because it makes interfaces self-documenting.

## TypeScript

Two valid styles in this codebase:

### Explicit interface (used everywhere in src/stores/)

```ts
interface DeviceIdentityState {
  deviceId: string | null;
  ensure: () => string;
  rotate: () => string;
}

export const useDeviceIdentity = create<DeviceIdentityState>()((set, get) => ({
  deviceId: readPersisted(),
  ensure: () => { /* ... */ return id; },
  rotate: () => { /* ... */ return fresh; },
}));
```

Pros: interface doubles as documentation; easy to export and reuse types; matches the rest of the codebase.

### `combine` (inferred)

```ts
export const useFoo = create(combine(
  { count: 0 },
  (set) => ({ inc: () => set((s) => ({ count: s.count + 1 })) }),
));
```

Don't introduce this style mid-project — pick one for consistency. The project's chosen style is **explicit interface**.

### Selector + return type

When destructuring multiple fields with `useShallow`, the inferred return type is the slice — easy to type explicitly if needed:

```ts
const slice: Pick<ConsentState, 'granted' | 'grantedAt'> = useConsent(
  useShallow((s) => ({ granted: s.granted, grantedAt: s.grantedAt })),
);
```

## v5 breaking changes from v4

If you're porting code or reading older docs:

- **No default export.** `import create from 'zustand'` (v4) → `import { create } from 'zustand'` (v5).
- **Curried `create()`.** `create<T>(init)` (v4) → `create<T>()(init)` (v5).
- **No second-arg equality on `create`.** Use `useShallow` from `zustand/shallow`, or `createWithEqualityFn` from `zustand/traditional` for custom comparators.
- **`shallow` import path.** `zustand/shallow` (still works, but the React-flavoured hook is `useShallow` from the same module).
- **`getServerState` removed** from `useStore` — use `useSyncExternalStore` directly if you need SSR.
- **React 18+ required.** Uses `useSyncExternalStore` internally.

## Common patterns (project-specific)

### 1. Initial state from synchronous storage read

`device-identity.ts:41` reads localStorage during the `create()` initializer so the first render has the cached value:

```ts
function readPersisted(): string | null {
  return safeStorage.getItem(StorageKeys.deviceUuid);
}

export const useDeviceIdentity = create<DeviceIdentityState>()((set, get) => ({
  deviceId: readPersisted(), // synchronous — no async hydration race
  ensure: () => { /* ... */ },
  rotate: () => { /* ... */ },
}));
```

`safeStorage` no-ops on the server, so this is SSR-safe.

### 2. Hydrate-once gate for derived state

When initial state can't be computed synchronously, expose a `hydrate()` action and a `hydrated: boolean` flag:

```ts
// src/stores/consent.ts
hydrate: () => {
  if (get().hydrated) return; // idempotent
  const persisted = readPersisted();
  set({ ...persisted, hydrated: true });
},
```

Components call `useConsent.getState().hydrate()` once on mount.

### 3. Reentrant-safe async `boot()`

`path-repo.ts:320-381` shows the canonical async-init pattern: an in-flight promise gate so concurrent callers all await the same network round-trip:

```ts
let inFlightBoot: Promise<void> | null = null;

boot: async (opts = {}) => {
  if (inFlightBoot) return inFlightBoot;       // dedupe
  const run = async (): Promise<void> => { /* ... */ };
  inFlightBoot = run().finally(() => { inFlightBoot = null; });
  return inFlightBoot;
},
```

Without this, two screens mounting in parallel would both kick off `assignPath` + `getPath` + `getProgress`.

### 4. Cross-store calls via `getState()`

A store action that needs another store's data calls `getState()` (never the hook):

```ts
// src/stores/path-repo.ts:360
const deviceId = useDeviceIdentity.getState().ensure();
```

This works because actions run in plain JS context, not under a React hook context.

### 5. Single-slot imperative channel (snackbar)

`snackbar.ts` is a Zustand store used purely as an outside-React message bus:

```ts
useSnackbar.getState().show('Saved'); // from anywhere
```

The reactive consumer is a single `<SnackbarHost>` mounted in `(app)/layout.tsx` that subscribes to `message`. No other component subscribes — Zustand is just a convenient pub/sub with one-render-on-change semantics.

### 6. Convenience selectors as free functions

`path-repo.ts:544-572` exports plain functions that take a state arg:

```ts
export function selectStatus(state: PathRepoState, cycle: number, levelId: number) {
  /* ... */
}

// Usage in components:
const status = usePathRepo((s) => selectStatus(s, cycle, levelId));
```

Keeps complex selectors testable without React, and makes them composable.

### 7. Frozen catalogues alongside the store

`learning-language.ts:39-43` exports a `Object.freeze`'d array next to the store. The frozen reference means components doing `useLearningLanguage((s) => s.list)` get stable referential equality — no spurious rerenders.

### 8. Computed-derived methods on the store

`learning-language.ts:92-93`:

```ts
isoOrDefault: () => get().iso ?? 'wo',
displayNameOrDefault: () => get().selected?.displayName ?? 'Wolof',
```

Methods that derive from state. Components call them via `useLearningLanguage((s) => s.isoOrDefault())` — the derivation runs every render but the result is memoised by Zustand's equality check.

For genuinely expensive computations, derive outside the store using `useMemo` over the relevant slice. Don't try to cache derived values inside the store — invalidation is your problem then.

### 9. Transient subscriptions outside React

When you need to react to store changes from non-React code (e.g. an offline queue runner):

```ts
const unsub = useConsent.subscribe((state, prev) => {
  if (state.granted && !prev.granted) {
    drainQueuedAudioUploads();
  }
});
```

Wrap in `subscribeWithSelector` middleware if you only care about a slice — saves callbacks on unrelated fields.

## Gotchas

- **Calling the hook outside React**: `useFoo()` throws ("rendered fewer hooks..."-style errors). Always `useFoo.getState()` outside components.
- **Selector identity**: returning a fresh object literal from a selector causes a re-render every store change. Either select a single field or wrap with `useShallow`.
- **`set` shallow-merges by default**: `set({ a: 1 })` keeps existing `b`, `c`. `set({ a: 1 }, true)` replaces — wiping actions. Almost always pass `false` (default).
- **Functional `set` reads from current state**: `set((state) => ({...}))` is the safe form when computing from current state. `set({ count: get().count + 1 })` works but races with concurrent updates.
- **SSR**: stores defined at module scope are evaluated on the server. Make initializers SSR-safe (`safeStorage` no-ops on server; uuid generation works fine; anything reading `window` must be guarded).
- **`'use client'` boundary**: every file in `src/stores/` starts with `'use client'`. Stores can only be **consumed** by client components — RSCs can't call hooks or `getState()`.
- **v5 `useShallow`**: forgetting to wrap a multi-field selector with `useShallow` causes the component to rerender on every unrelated state change. Symptom: profiler shows the component rerendering when nothing visible changed.
- **Don't mutate `getState()`**: it returns the live state reference. Mutations bypass the subscription system and corrupt internals. Always go through `setState` or actions.
- **DevTools time-travel**: `devtools` middleware time-travel works only for state updates done through `set`. Direct `setState` calls (or middleware-bypass `set(_, true, ...)`) don't show up.

## References

- README: https://github.com/pmndrs/zustand
- Migrating to v5: https://github.com/pmndrs/zustand/blob/main/docs/migrations/migrating-to-v5.md
- TypeScript guide: https://github.com/pmndrs/zustand/blob/main/docs/learn/guides/advanced-typescript.md
- Project usage:
  - `src/stores/path-repo.ts` — async boot, in-flight gate, cross-store calls, free-function selectors
  - `src/stores/consent.ts` — hydrate-once pattern, dual persistence (granted vs granted_at)
  - `src/stores/device-identity.ts` — synchronous initialization from storage, sync helper for non-React callers
  - `src/stores/snackbar.ts` — single-slot imperative channel
  - `src/stores/learning-language.ts` — frozen catalogue, computed methods
