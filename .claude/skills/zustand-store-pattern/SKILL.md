---
name: zustand-store-pattern
description: The dual-API Zustand idiom used by every store in this project. Stores are consumed both reactively from React (`useFoo((s) => s.bar)`) and imperatively from non-React code (`useFoo.getState().bar`, `useFoo.setState(...)`). Covers store file layout, persistence via `safeStorage`/localStorage with manual `hydrate()` + `hydrated` boot-gate (NOT `persist()` middleware), reset patterns, selector best practices including `useShallow` for v5 object selectors, method-style actions inside the store, and cross-store calls (always via `getState()`, never importing one hook into another store). USE FOR: creating a new store, debugging hydration mismatches, fixing infinite re-renders from object selectors, calling a store from outside React, resetting a store, deciding where an action lives. DO NOT USE FOR: server-side state (use SWR or RSC fetch), persisting Blobs (use `idb-keyval`), or migrating to `persist()` middleware (this project deliberately uses manual `safeStorage`).
---

# Zustand store pattern (v5)

Every store in `src/stores/` follows the same shape so consumers can rely on consistent ergonomics. This is a cross-cutting convention break it only with a comment explaining why.

Reference implementations:

- `src/stores/snackbar.ts` minimal, no persistence (~55 lines)
- `src/stores/device-identity.ts` read-or-create persistence (~78 lines)
- `src/stores/consent.ts` manual `hydrate()` + `hydrated` flag (~70 lines)
- `src/stores/path-repo.ts` full lifecycle, async actions, cross-store calls (~570 lines)

## 1. Standard shape

```ts
"use client";

import { create } from "zustand";

interface FooState {
  // Data
  bar: number;
  // Derived flags (boot-gates, loading, error)
  hydrated: boolean;
  error: string | null;
  // Actions defined inline as method-style fields
  increment: () => void;
  loadFromBackend: () => Promise<void>;
  reset: () => void;
}

export const useFoo = create<FooState>()((set, get) => ({
  bar: 0,
  hydrated: false,
  error: null,

  increment: () => set({ bar: get().bar + 1 }),

  loadFromBackend: async () => {
    set({ error: null });
    try {
      const v = await fetchSomething();
      set({ bar: v, hydrated: true });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e; // callers decide whether to surface
    }
  },

  reset: () => set({ bar: 0, hydrated: false, error: null }),
}));
```

The `"use client"` directive at the top is **mandatory**. Zustand stores carry mutable references and cannot be evaluated on the server.

## 2. The dual-API contract

Every store must work in **both** of these call sites:

### React (reactive, subscribes to changes)

```tsx
function MyComponent() {
  const bar = useFoo((s) => s.bar);
  const increment = useFoo((s) => s.increment);
  return <button onClick={increment}>{bar}</button>;
}
```

### Non-React (imperative, snapshot read)

```ts
// In an API client, queue runner, route handler, or another store's body
const deviceId = useDeviceIdentity.getState().ensure();
useSnackbar.getState().show("Saved");
useFoo.setState({ bar: 42 });
```

Examples in the codebase:

- `src/lib/storage/progress-queue-runner.ts:50,118,190` `useDeviceIdentity.getState()` and `useSnackbar.getState()` from a non-React module.
- `src/app/(app)/level/[cycleLevel]/page.tsx:425,435,518` `useConsent.getState()`, `useDeviceIdentity.getState()`, `usePathRepo.getState().completeLevel(...)` inside event handlers (technically within a React tree but called imperatively, not reactively).

## 3. Selectors avoid the v5 footgun

Zustand v5 removed the equality-function default. **Object selectors re-render on every state change**, even if the slice didn't change:

```ts
// BAD re-renders whenever ANY field of the store changes
const { bar, baz } = useFoo((s) => ({ bar: s.bar, baz: s.baz }));
```

Two correct patterns:

```ts
// GOOD one selector per primitive
const bar = useFoo((s) => s.bar);
const baz = useFoo((s) => s.baz);
```

```ts
// GOOD useShallow when you must return an object
import { useShallow } from "zustand/shallow";
const { bar, baz } = useFoo(useShallow((s) => ({ bar: s.bar, baz: s.baz })));
```

Returning `s` directly (no selector) re-renders on every change never do this.

## 4. Persistence manual, not `persist()` middleware

This project does **not** use Zustand's `persist()` middleware. We use `safeStorage` (a thin `localStorage` wrapper that no-ops on the server) for synchronous primitive persistence. Reasons:

- `persist()` rehydrates *asynchronously* even from `localStorage`, which means there's a frame where `hydrated === false` and components flicker. Manual reads are sync.
- The legacy Flutter app reads/writes the same keys with raw `SharedPreferences` shapes; mirroring that mapping is easier with explicit `safeStorage.getItem(StorageKeys.foo)` calls.
- IDB-backed persistence (the progress queue, audio queue) lives in `src/lib/storage/` as plain async modules Zustand only mirrors the in-memory view.

### a. Synchronous read on store creation

`src/stores/device-identity.ts`:

```ts
function readPersisted(): string | null {
  return safeStorage.getItem(StorageKeys.deviceUuid);
}

export const useDeviceIdentity = create<DeviceIdentityState>((set, get) => ({
  deviceId: readPersisted(), // initial value comes straight from disk
  ensure: () => { /* generate + persist on miss */ },
  // ...
}));
```

This works for keys that are guaranteed cheap and small. The store is "hydrated" by definition the moment `create()` returns.

### b. Manual `hydrate()` with a `hydrated` boot-gate

`src/stores/consent.ts`:

```ts
export const useConsent = create<ConsentState>((set, get) => ({
  granted: false,
  grantedAt: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return; // idempotent
    const persisted = readPersisted();
    set({ ...persisted, hydrated: true });
  },
  // ...
}));
```

Components that need to gate UI on hydration:

```tsx
function ConsentGate({ children }: { children: React.ReactNode }) {
  const hydrated = useConsent((s) => s.hydrated);
  const hydrate = useConsent((s) => s.hydrate);
  useEffect(() => { hydrate(); }, [hydrate]);
  if (!hydrated) return <SplashScreen />;
  return children;
}
```

The boot-gate is critical because the initial server render has `hydrated: false`, so the first client paint must match. Only flip `hydrated: true` inside an effect never inline during render.

## 5. Reset / testing

Zustand v5 supports `getInitialState()` for reset:

```ts
useFoo.setState(useFoo.getInitialState(), true); // `true` = replace, not merge
```

The `path-repo` store ships an explicit `reset()` action because it must also clear localStorage and rotate the device id (cross-store side effect). Prefer an explicit `reset` action when the store has external state to clean up; use `getInitialState()` only in tests where you can ignore side-effects.

## 6. Cross-store calls

**Never import one store's hook into another store's body.** That creates a hidden import-order dependency and bricks SSR. Always reach across via `getState()`:

```ts
// src/stores/path-repo.ts:360
const deviceId = useDeviceIdentity.getState().ensure();
```

```ts
// src/stores/path-repo.ts:528
useDeviceIdentity.getState().rotate();
```

Same rule for non-store modules calling stores see `progress-queue-runner.ts:118,190`.

## 7. Method-style actions vs free functions

Two valid patterns, used differently:

### Inline (preferred for store-internal state mutations)

Action methods are defined **inside** `create((set, get) => ({ ... }))`. They have closure access to `set`/`get`, so they can read+write atomically. Most actions belong here.

### Free functions outside (for orchestration that touches multiple stores)

`src/stores/device-identity.ts:69`:

```ts
export function getDeviceIdSync(): string {
  if (typeof window === "undefined") {
    throw new Error("getDeviceIdSync() called on the server. ...");
  }
  return useDeviceIdentity.getState().ensure();
}
```

Use a free function when:

- The behaviour wraps a `getState()` call with extra invariants (env checks, error mapping).
- The action coordinates two or more stores and "belongs" to neither of them. In that case put it in `src/lib/` instead of a store file.

## 8. Step-by-step "add a new store" playbook

1. **File location.** `src/stores/<kebab-name>.ts`. Always `"use client"` at the top.
2. **Type the state interface** with both data and actions. Keep it next to the `create` call (don't split across files).
3. **Implement `create<State>()((set, get) => ({...}))`.** Include a `reset` action if the store accumulates state.
4. **Persistence?**
   - Trivial single value → sync read in the initial state object (pattern §4a).
   - Multiple fields or async source → `hydrate()` + `hydrated` boot-gate (pattern §4b). Add a `<XxxGate>` wrapper or call `hydrate()` from a top-level effect.
   - Add a key to `src/lib/storage-keys.ts` rather than hardcoding the string.
5. **Snackbar integration.** If the action surfaces user-facing errors, accept the message as a parameter the store cannot call `t()` itself. The caller does:

   ```tsx
   try {
     await useFoo.getState().doThing();
   } catch (e) {
     useSnackbar.getState().show(t("fooFailedSnack", { error: String(e) }));
   }
   ```

   See `src/app/(app)/level/[cycleLevel]/page.tsx:524-528` for the canonical shape.
6. **Cross-store calls** always `useOther.getState()`, never `import { useOther }` and call as a hook.
7. **Test the dual API.** Open the store file and confirm both `useFoo((s) => s.bar)` and `useFoo.getState().bar` work. If the action depends on React context (it shouldn't), refactor.
8. **Verify** run the triad (see `build-verify` skill):

   ```bash
   npx tsc --noEmit && npx eslint . && npx next build --webpack
   ```

## 9. Common mistakes

- **Object selector without `useShallow`** → infinite re-render storm. Symptom: React DevTools shows the component re-rendering on unrelated state changes.
- **Forgetting `"use client"`** → "You're importing a component that needs `useState`. ..." build error.
- **Importing a store hook inside another store** → import cycle, SSR crash, or stale closure on hot reload. Always `useOther.getState()`.
- **Setting `hydrated: true` inline in `create()`** → hydration mismatch (server says false, client says true). Only flip it inside an action triggered from an effect.
- **Reaching into `localStorage` directly** instead of going through `safeStorage` → SSR crash (`localStorage is not defined`).
