---
name: swr
description: SWR is a React data-fetching library built around stale-while-revalidate caching. It returns cached data immediately, revalidates in the background, and dedupes concurrent requests sharing the same key. USE FOR: fetching server data inside React components, refresh-on-focus / refresh-on-reconnect UX, optimistic updates via mutate(), pagination via useSWRInfinite, real-time-ish polling via refreshInterval, and any place where you want a hook-shaped replacement for ad-hoc useEffect+fetch+useState. DO NOT USE FOR: outside-React data flow (use the API client directly), one-shot mutations (POST/DELETE call the API client and then mutate() the affected SWR keys), persistent client state (use Zustand stores in src/stores/), or RSC server-side data loading (this is a client hook).
---

# swr@^2.4.1

## When to use

This project currently uses SWR in **one place**: `src/app/(app)/(tabs)/leaderboard/page.tsx:70`. The leaderboard is a perfect SWR fit because:

- It's read-only data backed by an Edge Function (`leaderboard_get`).
- It benefits from refresh-on-focus (the closest desktop equivalent to mobile pull-to-refresh).
- Local writes elsewhere (`completeLevel` in path-repo) need to trigger a refetch `mutate()` does this cleanly.

Everything else in the app uses Zustand stores (`src/stores/`) that own their own fetch+cache lifecycle (`usePathRepo.boot()`, etc.). That's the right call when:

- The data is part of an **app-wide repository** with imperative methods (`completeLevel`, `advanceCycle`, ...) that mutate cache + post to backend in the same call.
- Non-React callers need to read the data (`useFoo.getState()`).
- You want explicit cache I/O via `safeStorage` rather than SWR's in-memory cache.

**Reach for SWR when**: a screen needs to read remote data declaratively, the data isn't shared with non-React code paths, and you want focus/reconnect revalidation for free. **Reach for a Zustand store** when the data is shared, mutated imperatively, or has non-trivial offline persistence.

## API reference

### `useSWR(key, fetcher, options)`

```tsx
import useSWR from 'swr';

const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
  key,        // string | unknown[] | null | (() => string | unknown[] | null)
  fetcher,    // (key) => Promise<T>
  options,    // SWRConfiguration
);
```

**Returned fields**:
- `data: T | undefined` last successful response (cached). `undefined` until the first fetch resolves.
- `error: unknown` last error from the fetcher; cleared on next successful fetch.
- `isLoading: boolean` `true` only on the **first** load with no cached data. Use this for spinners. (`!data && !error` in v1; `isLoading` was added in v2 and is what you should use.)
- `isValidating: boolean` `true` whenever a request is in flight, including background revalidations on top of cached data. Use for subtle "refreshing..." indicators.
- `mutate: BoundMutator<T>` the **bound** mutate; revalidates / overwrites this hook's key only. See [mutate](#mutate).

**Key shapes**:
- `string` `"/api/leaderboard"`. Simplest case.
- `unknown[]` `["leaderboard", deviceId]`. The fetcher receives the array spread as args.
- `null` / `false` / `undefined` **conditional fetching**: SWR skips the request entirely. The hook returns `{ data: undefined, error: undefined, isLoading: false }`.
- `() => key` lazy. Throws inside the function (e.g. `user.id` on an undefined user) are caught and treated as `null`.

**Project pattern auth-token-keyed fetcher** (when we eventually add auth, keep the token in the key, never just close over it):

```tsx
const { data } = useSWR(
  token ? ['/api/me', token] : null,
  ([url, t]) => fetch(url, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json()),
);
```

This way, rotating the token invalidates the cache automatically (different array → different cache key). Closing over the token in the fetcher would silently serve stale data after rotation.

### `mutate`

Two forms:

**Bound** (returned from `useSWR`) operates on this hook's key:

```tsx
const { data, mutate } = useSWR('/api/profile', fetcher);

// Refetch (same key):
await mutate();

// Optimistic update + refetch:
await mutate({ ...data, name: 'New' }, { revalidate: true });

// Optimistic-only (no refetch caller already knows the truth):
await mutate({ ...data, name: 'New' }, { revalidate: false });
```

**Global** (imported from `swr`) operates on any key, callable from anywhere:

```tsx
import { mutate } from 'swr';

// Single key:
await mutate(['leaderboard', deviceId]);

// Filter function invalidate all matching keys:
await mutate(
  (key) => Array.isArray(key) && key[0] === 'leaderboard',
  undefined,
  { revalidate: true },
);
```

**Signature** (both forms):

```ts
mutate(
  key,
  data?: T | Promise<T> | ((current: T | undefined) => T | Promise<T>),
  opts?: {
    revalidate?: boolean;       // default true
    populateCache?: boolean | ((result, current) => T); // default true
    optimisticData?: T | ((current) => T);
    rollbackOnError?: boolean | ((err) => boolean); // default true
  },
);
```

**Optimistic update with rollback**:

```tsx
await mutate(
  postNewName(name),                    // promise of the real write
  {
    optimisticData: { ...data, name },  // shown immediately
    rollbackOnError: true,              // auto-revert if postNewName rejects
    populateCache: true,                // overwrite cache with the resolved value
    revalidate: false,                  // we trust the server response
  },
);
```

### `useSWRInfinite(getKey, fetcher, options)`

Pagination/cursor scrolling. `getKey(pageIndex, previousPageData)` returns the key for each page (or `null` to stop).

```tsx
import useSWRInfinite from 'swr/infinite';

const { data, size, setSize, isLoading } = useSWRInfinite<Page>(
  (index, prev) => prev && prev.items.length === 0 ? null : ['/api/feed', index],
  ([url, page]) => fetch(`${url}?page=${page}`).then(r => r.json()),
);

// data is Page[] one entry per loaded page. Flatten in the view.
const items = data?.flatMap(p => p.items) ?? [];

// Load next page:
<button onClick={() => setSize(size + 1)}>Load more</button>
```

Not currently used in this project.

### `useSWRImmutable(key, fetcher, options)`

Shorthand for `useSWR` with `revalidateIfStale: false`, `revalidateOnFocus: false`, `revalidateOnReconnect: false`. Use for data that's truly immutable for the session (configuration, locale catalogues, etc.).

```tsx
import useSWRImmutable from 'swr/immutable';
const { data } = useSWRImmutable('/api/locales', fetcher);
```

### `useSWRSubscription(key, subscribe)`

Bridges push-based sources (WebSocket, EventSource, Firestore) into the SWR cache. The `subscribe` callback receives `{ next }` and returns an unsubscribe.

```tsx
import useSWRSubscription from 'swr/subscription';

const { data, error } = useSWRSubscription(['ws', roomId], ([_, id], { next }) => {
  const ws = new WebSocket(`/ws/${id}`);
  ws.onmessage = (e) => next(null, JSON.parse(e.data));
  ws.onerror = (e) => next(e);
  return () => ws.close();
});
```

Not currently used. Consider it for the post-PoC realtime leaderboard if/when we ship one.

### `<SWRConfig value={...}>`

Provider for default options. Wrap once in `app/layout.tsx` (or a client boundary) to set fetcher / fallbacks / cache provider for all descendants.

```tsx
'use client';
import { SWRConfig } from 'swr';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (key) => fetch(key).then(r => r.json()),
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        dedupingInterval: 2000,
        errorRetryCount: 3,
        errorRetryInterval: 5000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
```

Nested `<SWRConfig>` providers merge inner values override outer.

## Options reference

All options can be passed per-hook or as `<SWRConfig>` defaults:

| Option | Default | Purpose |
|---|---|---|
| `revalidateOnFocus` | `true` | Refetch when the window regains focus. Project enables this on the leaderboard. |
| `revalidateOnReconnect` | `true` | Refetch when `navigator.onLine` flips back to true. Pair with `revalidateOnFocus`. |
| `revalidateIfStale` | `true` | On mount, if cache exists, fetch in the background anyway. |
| `dedupingInterval` | `2000` ms | Identical keys requested within this window share a single in-flight request. |
| `refreshInterval` | `0` (off) | Poll every N ms. **Don't enable globally** set per-hook on screens that need it. |
| `fallback` | `{}` | Map of `{ [serializedKey]: data }` used as initial cache. Useful for SSR hydration. |
| `fallbackData` | `undefined` | Synchronous initial value for **this** hook only. `data` will be this until the first real fetch resolves; `isLoading` is `false` from the start. |
| `suspense` | `false` | Throw a promise on first load (React Suspense). Wrap the consumer in `<Suspense>` and an error boundary. |
| `keepPreviousData` | `false` | When the key changes, keep showing the previous key's data until the new one resolves (vs. dropping to `undefined`). Great for paginated lists / search. |
| `errorRetryCount` | `unlimited` | Cap retries on failure. |
| `errorRetryInterval` | `5000` ms | Base interval between retries (with exponential backoff). |
| `isPaused` | `() => false` | If the function returns `true`, SWR pauses revalidation entirely (e.g. while a heavy modal is open). |
| `onSuccess` / `onError` / `onErrorRetry` | | Lifecycle hooks. `onErrorRetry` lets you customise retry policy (e.g. don't retry 404). |

### Cache provider

```tsx
<SWRConfig
  value={{
    provider: () => new Map(),  // any Map-like
  }}
>
```

Useful for: per-tab caches, test isolation, persisting cache to localStorage. The provider is created **once** per `<SWRConfig>` instance don't recreate on every render.

## Common patterns (project-specific)

### 1. Reactive Zustand-derived key (the leaderboard pattern)

The SWR key needs to update when the device id rotates, so we read it through a Zustand selector:

```tsx
// src/app/(app)/(tabs)/leaderboard/page.tsx:68
const deviceId = useDeviceIdentity((s) => s.deviceId)
  ?? useDeviceIdentity.getState().ensure();

const { data, error, isLoading, mutate } = useSWR<LeaderboardSnapshot>(
  deviceId ? ['leaderboard', deviceId] : null,
  ([, id]) => getLeaderboard(id as string),
  {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 0,
  },
);
```

Note the `?? getState().ensure()` fallback first-paint may have `deviceId === null` until hydration; we ensure synchronously rather than skipping the first fetch.

### 2. Cross-store invalidation

When a Zustand store mutates data that another screen reads via SWR, trigger `mutate()` from a `useEffect` watching the relevant store slice:

```tsx
// src/app/(app)/(tabs)/leaderboard/page.tsx:102-116
const localTotalPoints = usePathRepo((s) => s.progress?.totalPoints ?? null);
const lastSeenLocalTotal = useRef<number | null>(null);

useEffect(() => {
  if (localTotalPoints === null) return;
  if (lastSeenLocalTotal.current === null) {
    lastSeenLocalTotal.current = localTotalPoints;
    return; // don't refetch on the initial observation
  }
  if (localTotalPoints !== lastSeenLocalTotal.current) {
    lastSeenLocalTotal.current = localTotalPoints;
    void mutate();
  }
}, [localTotalPoints, mutate]);
```

**Don't** fold `localTotalPoints` into the SWR key that throws away the cached snapshot and flashes a loading state.

### 3. Suspense + error boundary

If you go suspense-mode, you must provide both:

```tsx
import { ErrorBoundary } from 'react-error-boundary'; // or your own
import { Suspense } from 'react';

<ErrorBoundary fallback={<ErrorView />}>
  <Suspense fallback={<Spinner />}>
    <LeaderboardBody />
  </Suspense>
</ErrorBoundary>

// Inside LeaderboardBody:
const { data } = useSWR(key, fetcher, { suspense: true });
// data is T (never undefined) when suspense is on.
```

The project doesn't currently use suspense mode for SWR the leaderboard handles loading/error explicitly. If we adopt it, gate it behind a single screen first; mixing suspense and non-suspense SWR hooks in the same tree gets confusing.

### 4. Conditional fetching to gate on hydration

```tsx
const { hydrated } = useConsent();
const { data } = useSWR(hydrated ? '/api/something' : null, fetcher);
```

Pass `null` until the prerequisite is ready. SWR returns `{ data: undefined, isLoading: false }` for null keys, so the consumer should distinguish "waiting for prerequisite" from "loading".

### 5. TypeScript generics

Always specify the response type the inferred type from a generic `fetch().then(r => r.json())` is `any`:

```tsx
useSWR<LeaderboardSnapshot>(key, fetcher);
useSWR<LeaderboardSnapshot, EdgeFunctionError>(key, fetcher); // typed errors
```

If your fetcher already returns a typed `Promise<T>` (e.g. our `getLeaderboard`), the generic isn't strictly required but is good practice for self-documentation.

## Gotchas

- **`isLoading` vs `!data`**: Use `isLoading` for the first-fetch spinner. Subsequent background revalidations leave `isLoading` false and only flip `isValidating`. The leaderboard does `isLoading && !data` both checks are belt-and-braces and harmless.
- **Key stability**: Inline objects/arrays as keys re-render every time. SWR serialises with `JSON.stringify`, so structurally-equal keys hit the same cache, but you'll still get extra hook invocations. Memoize where it matters.
- **`null` key vs empty string**: `null`/`undefined`/`false` skip the fetch. Empty string `""` does **not** it's a valid key.
- **Global mutate from outside React**: `import { mutate } from 'swr'` works in event handlers, store actions, etc., but only after the SWR provider has mounted. Calling it during module init is a no-op.
- **`revalidateOnFocus` in dev**: React Strict Mode + dev-tools focus events can cause apparent double-fetches. It's not a bug.
- **Server components**: SWR is client-only. A `useSWR` call in an RSC won't even compile gate it behind `'use client'` (the leaderboard page is a client component for exactly this reason).
- **Don't put auth tokens in the fetcher closure**: stale-token bug the fetcher captures the token at first render and keeps using it. Put the token in the key (see auth pattern above).
- **Cache provider lifetime**: `provider: () => new Map()` is called once per `<SWRConfig>` mount. Re-mounting the provider (e.g. by remounting the layout) creates a fresh cache and you lose all in-flight data.

## References

- Docs: https://swr.vercel.app/docs/getting-started
- API: https://swr.vercel.app/docs/api
- Mutation: https://swr.vercel.app/docs/mutation
- Conditional fetching: https://swr.vercel.app/docs/conditional-fetching
- Project usage: `src/app/(app)/(tabs)/leaderboard/page.tsx:70`
