---
name: react
description: React 19.2.4 hooks, components, refs, context, suspense, transitions, and the new `use()` API for unwrapping Promises. Trigger phrases include "useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext", "useReducer", "useTransition", "useDeferredValue", "useId", "useSyncExternalStore", "useImperativeHandle", "useLayoutEffect", "use()", "useActionState", "useOptimistic", "forwardRef", "memo", "lazy", "Suspense", "Context.Provider", "ref as prop", "React Compiler", "Server Components", "client components". USE FOR: writing components, choosing/using hooks, refs, context, suspense, async transitions, server/client component boundaries with Next 16, React Compiler hints. DO NOT USE FOR: React 18 patterns (this project is on 19.2.4 — many older patterns are removed or replaced). DO NOT USE FOR: `react-dom` APIs like `createPortal`, `flushSync`, resource preloading, form actions (use react-dom skill).
---

# React 19.2.4

This project is pinned to **`react@19.2.4`** and **`react-dom@19.2.4`**, used through **Next.js 16** with the **React Compiler enabled**. React 19 has substantial breaking changes from 18 — most LLM training emphasises 18 patterns that no longer apply. Treat this skill as authoritative over your prior knowledge when they conflict.

## When to use

- Writing or editing any `.tsx` / `.ts` file that imports from `react`.
- Deciding which hook fits a problem (`useState` vs `useReducer` vs `useSyncExternalStore`, `useMemo` vs the React Compiler, etc.).
- Working with refs, context, suspense, transitions, or async data.
- Touching server/client component boundaries — combine with the Next.js skill for routing/segment specifics.

## Breaking changes from React 18 (read this first)

LLMs frequently regress to 18 patterns. **Do not** do these in this codebase:

1. **`forwardRef` is no longer needed.** `ref` is a regular prop on function components. Destructure it like any other prop. `React.forwardRef` still exists but is deprecated and will be removed; do not introduce new uses of it.
   ```tsx
   // ❌ React 18
   const Input = forwardRef<HTMLInputElement, Props>((props, ref) => <input ref={ref} {...props} />);
   // ✅ React 19
   function Input({ ref, ...props }: Props & { ref?: React.Ref<HTMLInputElement> }) {
     return <input ref={ref} {...props} />;
   }
   ```
2. **`<Context>` replaces `<Context.Provider>`.** Render the context object directly as a JSX element. `<Context.Provider>` still works but is deprecated.
   ```tsx
   const ThemeContext = createContext<Theme>("light");
   <ThemeContext value="dark">{children}</ThemeContext>
   ```
3. **`useFormState` is renamed to `useActionState`** and lives in `react` (not `react-dom`). It returns `[state, dispatch, isPending]` (3-tuple, the pending flag is new).
4. **`useTransition`'s `startTransition` accepts async functions.** `isPending` covers the entire async lifecycle. Functions used this way are called "Actions".
5. **`use()` is a new first-class API** for unwrapping Promises and reading Context. Unlike hooks, it can be called conditionally (after early returns, inside `if`). Used heavily in this project to unwrap Next 16's async route `params`/`searchParams`.
6. **String refs are removed.** Use callback refs or `useRef` only.
7. **Legacy context API (`contextTypes`, `getChildContext`) is removed.**
8. **`ReactDOM.render` / `ReactDOM.hydrate` / `findDOMNode` / `unmountComponentAtNode` are removed** — see the react-dom skill.
9. **Ref callbacks may return a cleanup function.** If a ref callback returns a value that is not a function, TypeScript will reject it (avoid implicit returns: `ref={el => (this.el = el)}` → `ref={el => { this.el = el; }}`).
10. **Document metadata hoists automatically.** Rendering `<title>`, `<meta>`, `<link>` anywhere in the tree hoists them to `<head>`. (Note: in this Next 16 project, prefer the framework's `metadata` export for static metadata; reserve in-tree tags for genuinely dynamic per-component cases.)
11. **Errors in render are reported once, not three times.** `createRoot` accepts new `onCaughtError` / `onUncaughtError` options.
12. **The new JSX transform (`react/jsx-runtime`) is required.** Don't `import React from "react"` just for JSX. Only import the named hooks/APIs you actually use.
13. **`propTypes` and `defaultProps` on function components are removed.** Use TypeScript and default parameter values.
14. **`useDeferredValue` accepts a second `initialValue` argument.**

## Hooks reference

All hooks must be called at the top level of a component or another hook (Rules of Hooks), with the exception of `use()`.

### State

- **`useState<T>(initial)`** → `[state, setState]`. `setState(next)` or `setState(prev => next)`. Initial value can be a lazy initializer function. Bail out by returning the same reference from the updater.
- **`useReducer<S, A>(reducer, initialArg, init?)`** → `[state, dispatch]`. Prefer over `useState` when next state depends on multiple fields or actions are dispatched from many places.

### Effects

- **`useEffect(fn, deps?)`** — run after commit; cleanup runs before next effect and on unmount. Empty deps `[]` runs once after mount + once cleanup on unmount. The level page uses this pattern at `src/app/(app)/level/[cycleLevel]/page.tsx:184` to dispose recorders/timers/blob URLs.
- **`useLayoutEffect(fn, deps?)`** — synchronous, after DOM mutation but before paint. Use only when you must read layout and synchronously re-render (e.g. measuring an element to position a tooltip). Blocks paint — avoid by default.
- **`useInsertionEffect(fn, deps?)`** — for CSS-in-JS libraries injecting `<style>` tags before any layout effect reads them. Application code should not need this.

### Memoisation

With the **React Compiler enabled** (this project), most `useMemo`/`useCallback` calls are unnecessary — the compiler memoizes by default. **Keep manual memoisation only when:**
- The compiler bails out (visible in compiler diagnostics or React DevTools' "Memo ✨" badge being absent).
- You need stable identity for an external API (third-party hook, dependency array of an effect that mustn't refire).
- The memo guards a value passed to a memoized child via a non-Compiler-aware library.

The level page keeps a manual `useMemo` for `{ level, owningPathId }` (`page.tsx:98`) precisely because the early-return-and-construct shape confused the compiler's escape analysis. That comment is the canonical example for when to keep `useMemo` in this codebase.

- **`useMemo<T>(() => value, deps)`** — memoize a value across renders.
- **`useCallback<F>(fn, deps)`** — memoize a function. Equivalent to `useMemo(() => fn, deps)`.

### Refs

- **`useRef<T>(initial)`** → `{ current: T }`. Mutating `.current` does **not** trigger a re-render. Use for: timer handles, recorder instances, reentrancy guards (`busyRef`), DOM nodes, values that must survive renders without participating in them. The level page uses this extensively for `recorderRef`, `tickerRef`, `pendingStreamRef`, `submittedCountRef`, `completionDispatchedRef`.
- **`useImperativeHandle(ref, () => methods, deps?)`** — customize what a parent's `ref` sees. Rare. With `ref` being a normal prop now, you call this exactly the same way.

### Identity

- **`useId()`** → unique stable id (e.g. `":r0:"`) safe for SSR. Use to associate `<label htmlFor>` with `<input id>` when a stable id isn't otherwise available. **Not** for list keys.

### Concurrency

- **`useTransition()`** → `[isPending, startTransition]`. In React 19 `startTransition` accepts an async function and `isPending` stays true through the entire awaited body. This makes it the simplest way to manage pending state for an async mutation.
  ```tsx
  const [isPending, startTransition] = useTransition();
  startTransition(async () => {
    const err = await save(data);
    if (err) setError(err);
  });
  ```
- **`useDeferredValue<T>(value, initialValue?)`** — returns a lagging copy of `value` that React updates at lower priority. The new `initialValue` controls what's returned on the very first render.
- **`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)`** — subscribe to an external store with concurrent-rendering–safe semantics. This project uses **Zustand** (`src/stores/path-repo.ts`), which uses `useSyncExternalStore` internally. You almost never call this directly — call store hooks like `usePathRepo(s => s.bundle)`.

### Context

- **`useContext<T>(Context)`** — read a context value. Cannot be conditional.
- **`use(Context)`** — read a context value, **may** be conditional (after early returns, inside `if`). Prefer `use()` for new code where conditional reads are needed; otherwise either is fine.

### Debug

- **`useDebugValue(value, format?)`** — label custom hooks in React DevTools.

### Actions / async (new in 19)

- **`use<T>(promise: Promise<T>): T`** — unwrap a Promise in render. Suspends until resolved; on rejection, throws to the nearest Error Boundary. Critical caveat: **don't pass a Promise created during render** (it'll be a fresh promise each render and you'll see the warning "A component was suspended by an uncached promise"). The Promise must come from props, a ref, a cache, or framework plumbing. In this project, `use(params)` and `use(searchParams)` from Next 16 are the canonical safe inputs — Next memoizes those Promises across renders.
  ```tsx
  // src/app/(app)/level/[cycleLevel]/page.tsx:76
  const { cycleLevel: rawParam } = use(params);
  ```
  `use()` may also be called conditionally:
  ```tsx
  if (!shouldRead) return null;
  const theme = use(ThemeContext); // legal, useContext is not
  ```

- **`useActionState<State, Payload>(action, initialState, permalink?)`** → `[state, dispatch, isPending]`. Wraps an async action so you don't manage pending/error state by hand. Replaces 18's `useFormState` (same signature, different name + new `isPending`). Pair with `<form action={dispatch}>` for progressive-enhancement-friendly forms.
  ```tsx
  const [error, submitAction, isPending] = useActionState(
    async (prev: string | null, formData: FormData) => {
      const e = await save(formData.get("name"));
      return e ?? null;
    },
    null,
  );
  return <form action={submitAction}>…</form>;
  ```

- **`useOptimistic<State, Optimistic>(state, updater?)`** → `[optimisticState, addOptimistic]`. Render an immediate optimistic state during a transition; React reverts to the real `state` when the transition settles.
  ```tsx
  const [optimisticName, setOptimisticName] = useOptimistic(currentName);
  startTransition(async () => {
    setOptimisticName(newName);
    await save(newName);
  });
  ```

- **`useFormStatus()`** lives in **`react-dom`**, not `react`. See the react-dom skill.

## Components & JSX

- The new automatic JSX transform compiles JSX to `react/jsx-runtime` imports. **Never** add `import React from "react"` solely to enable JSX. Import what you actually use:
  ```tsx
  import { useState, useEffect } from "react";
  import type { ReactNode } from "react";
  ```
- Function components only. No class components in new code.
- `React.memo(Component, areEqual?)` still exists; with the React Compiler it's rarely needed.
- `React.lazy(() => import(...))` for code-splitting, paired with `<Suspense>`. Next 16 also exposes `next/dynamic` which is usually a better fit at the route level.
- Fragments: `<>…</>` or `<Fragment key={...}>…</Fragment>` (the latter when you need a key).
- Conditional rendering: prefer `cond ? <A /> : <B />` or `cond && <A />`. Beware: `0 && <A />` renders `0` — guard numbers explicitly.

## Refs (no more forwardRef)

`ref` is now a normal prop. The TypeScript type is `React.Ref<T>` (which is `RefCallback<T> | RefObject<T> | null`).

```tsx
// Forwarded ref to a host element
type Props = { label: string; ref?: React.Ref<HTMLButtonElement> };
function MyButton({ label, ref }: Props) {
  return <button ref={ref}>{label}</button>;
}
```

**Ref cleanup callbacks** (new):

```tsx
<div ref={(node) => {
  if (!node) return;
  const obs = new ResizeObserver(/* … */);
  obs.observe(node);
  return () => obs.disconnect(); // cleanup runs on unmount / ref change
}} />
```

If you previously relied on the ref callback being invoked with `null` on unmount, switch to the cleanup function — that null call is going away.

**TypeScript gotcha:** an implicit-return ref callback now fails type-checking because TS can't tell whether you meant to return a cleanup. Use a block body:

```tsx
// ❌ <div ref={el => (myEl = el)} />
// ✅
<div ref={el => { myEl = el; }} />
```

## Context (new `<Context>` shorthand)

```tsx
const ThemeContext = createContext<"light" | "dark">("light");

// Provider — no `.Provider` needed
<ThemeContext value="dark">
  <App />
</ThemeContext>

// Consumer (function component)
function Body() {
  const theme = useContext(ThemeContext); // or use(ThemeContext)
  return <div data-theme={theme} />;
}
```

`<Context.Provider>` still works but is deprecated; do not introduce new uses.

## Suspense

`<Suspense fallback={…}>` shows the fallback while any descendant suspends (via `use()`, `React.lazy`, or framework data). React 19 added "pre-warming" — sibling subtrees of a suspended boundary keep rendering in the background so they're hot when the boundary resolves.

```tsx
<Suspense fallback={<Spinner />}>
  <Comments commentsPromise={commentsPromise} />
</Suspense>
```

In this Next 16 project, route-level `loading.tsx` and `error.tsx` files create implicit Suspense / Error Boundaries — prefer those over hand-rolled boundaries for full pages.

## Server vs client components (interplay with Next 16)

- **Server Components** (the default in Next 16 `app/` routes) run at request/build time. They can be async, can `await` directly, can read databases, but **cannot use hooks, refs, browser APIs, or event handlers**.
- **Client Components** are marked with `"use client"` at the top of the file (see `src/app/(app)/level/[cycleLevel]/page.tsx:1`). They run in the browser and can use every hook in this skill.
- **Server Actions** are async functions marked `"use server"` (file-level or function-level). They can be passed as props to client components and invoked from `<form action={…}>` or `useActionState`.
- There is no `"use server"` directive *for* server components — the absence of `"use client"` is what makes a module a server module. The "use server" directive is exclusively for actions.
- A client component can render server-rendered children only by receiving them as `children` props from a server parent. It cannot import a server module directly.

When in doubt about which side a piece of code runs on, check the nearest `"use client"` directive walking up the file/import tree.

## React Compiler hints

Next 16 enables the React Compiler. Treat it as your default memoizer:

- Don't add `useMemo`/`useCallback` defensively. Add them only when you've confirmed the compiler bailed out, or when stable identity is required for a non-compiled API surface.
- Use the `"use no memo"` function-level directive (per `react-compiler/directives` docs) to opt a single function out if it's miscompiling. Use sparingly and with a comment explaining why.
- Constructor-literal objects in branches confuse escape analysis (see `page.tsx:98` comment). Keep object shape stable across branches when you want the compiler to memoize.
- Mutation outside of `useState`/`useReducer` (e.g. mutating a captured object during render) breaks the compiler's correctness assumptions. Stay pure in render; mutate refs in handlers/effects only.
- The ESLint plugin `eslint-plugin-react-hooks` includes compiler-aware lints — heed its warnings.

## Common gotchas

- **`use(somePromise)` where `somePromise` is created in render** → infinite suspense / "uncached promise" warning. The Promise must be stable (props, ref, framework plumbing).
- **Setting state during render** → infinite loop. Only acceptable in the "derived state" pattern with a guard comparing previous to current value.
- **Closures capturing stale state inside `setInterval`/`setTimeout`** → use functional setters (`setX(prev => …)`) or refs. The level page's countdown at `page.tsx:327` uses both.
- **Effect dependency arrays missing values** → ESLint will warn. Either include the value or refactor (extract to a ref, hoist out of the component, etc.). Don't suppress without justification.
- **Mutating state directly** → `state.push(x)` is a bug. Always create a new array/object.
- **List keys using array index** → causes incorrect reconciliation when items are reordered/inserted. Use a stable id from the data.
- **Returning a non-cleanup value from a ref callback** → TypeScript error in 19. Use a block body.
- **Calling hooks conditionally** → forbidden, except `use()`.
- **`"use client"` must be the very first line** (after an optional shebang) of the file. Comments before it disable it.
- **Importing server-only code into a client component** → bundler error. Pass data through props from a server parent.

## References

- Live docs: https://react.dev/reference/react
- React 19 release notes: https://react.dev/blog/2024/12/05/react-19
- Upgrade guide: https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- Rules of React: https://react.dev/reference/rules
- React Compiler: https://react.dev/reference/react-compiler/configuration
- Project examples: `src/app/(app)/level/[cycleLevel]/page.tsx` (use, useEffect cleanup, useRef, useCallback, useMemo with compiler-safe shape), `src/stores/path-repo.ts` (Zustand store), `src/components/screen-background.tsx` (simple typed component, no `forwardRef`).
