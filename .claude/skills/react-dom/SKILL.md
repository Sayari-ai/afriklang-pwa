---
name: react-dom
description: React DOM 19.2.4 browser-side rendering APIs, portals, synchronous flush, form actions, resource preloading, hydration, and built-in DOM components. Trigger phrases include "createRoot", "hydrateRoot", "createPortal", "flushSync", "preload", "preinit", "prefetchDNS", "preconnect", "preloadModule", "preinitModule", "useFormStatus", "form action", "ReactDOM.render", "findDOMNode", "hydrate", "renderToString", "stylesheet precedence", "document metadata", "<title>", "<meta>", "<link>", "<script async>". USE FOR: mounting/hydrating React trees in the browser, portals, synchronous DOM flushes, `<form action={fn}>`, `useFormStatus`, resource preloading, hoisted document metadata, custom-element interop. DO NOT USE FOR: React-package hooks like `useState`/`useEffect`/`use()` (use the react skill). DO NOT USE FOR: React 18 patterns `ReactDOM.render`, `hydrate`, `findDOMNode`, `unmountComponentAtNode`, `renderToNodeStream` are all REMOVED in 19.
---

# React DOM 19.2.4

This project pins **`react-dom@19.2.4`** alongside `react@19.2.4`, used through Next.js 16. The framework owns root creation and hydration, so you almost never call `createRoot`/`hydrateRoot` yourself. You **do** routinely use portals, `flushSync` (sparingly), `<form action>`, `useFormStatus`, and the resource-preloading APIs. Several React 18 APIs are **removed**.

## When to use

- Calling `createPortal` to render outside the normal tree (modals, tooltips, toast roots).
- Forcing a synchronous DOM update with `flushSync` (rare; e.g. before a measurement or `scrollIntoView`).
- Wiring `<form>` Actions and reading their state with `useFormStatus`.
- Preloading scripts/stylesheets/fonts/DNS with `preload`, `preinit`, `prefetchDNS`, `preconnect`, `preloadModule`, `preinitModule`.
- Using hoisted document metadata (`<title>`, `<meta>`, `<link>`) inside any component.
- Bootstrapping React in a non-Next environment (test harnesses, Storybook, custom embeds).
- Custom-element (Web Component) interop React 19 now passes Custom Elements Everywhere.

## Breaking changes from React 18

These are **removed** in 19 never reintroduce them:

| Removed                          | Replacement                                       |
| -------------------------------- | ------------------------------------------------- |
| `ReactDOM.render(el, container)` | `createRoot(container).render(el)`                |
| `ReactDOM.hydrate(el, container)`| `hydrateRoot(container, el)`                      |
| `ReactDOM.unmountComponentAtNode`| `root.unmount()` on the `Root` returned by `createRoot` |
| `findDOMNode`                    | `useRef` + ref-as-prop                            |
| `renderToNodeStream`             | `renderToPipeableStream` (Node) / `renderToReadableStream` (Web) from `react-dom/server` |
| `renderToStaticNodeStream`       | Static streaming variants                          |

Also changed:

- **`useFormState` is gone** from `react-dom` replaced by `useActionState` from `react` (covered in the react skill).
- **`useFormStatus`** still lives in `react-dom`.
- **`<form action={fn}>`, `<input formAction={fn}>`, `<button formAction={fn}>`** now accept functions natively; React invokes them with the `FormData` and manages the pending state and (for uncontrolled forms) automatic reset on success.
- **Hydration error reporting** is single-line with a diff, instead of three duplicate console errors.
- **Third-party DOM mutations** (browser extensions, ad scripts) in `<head>`/`<body>` no longer trigger hydration mismatch errors.
- **Custom Elements** receive properties (not attributes) when the prop name matches a property on the instance; primitive props become attributes during SSR.
- New root options: `onCaughtError`, `onUncaughtError`, alongside the existing `onRecoverableError`.
- New static APIs in `react-dom/static`: `prerender`, `prerenderToNodeStream`.

## Client APIs (`react-dom/client`)

In a Next 16 app you do not call these Next handles mounting. They matter for tests, Storybook, and any custom embed.

### `createRoot(container, options?)` → `Root`

```ts
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("app")!, {
  onCaughtError(error, errorInfo) { /* logged to error reporter */ },
  onUncaughtError(error, errorInfo) { /* show fatal-error UI */ },
  onRecoverableError(error, errorInfo) { /* benign hydration recoveries */ },
  identifierPrefix: "app-",   // for SSR id namespacing
});
root.render(<App />);
// ...later
root.unmount();
```

### `hydrateRoot(container, reactNode, options?)` → `Root`

Same option shape as `createRoot`. Use when the container already holds server-rendered HTML. Mismatches now surface as a single error with a diff.

```ts
hydrateRoot(document, <Document />, {
  onRecoverableError(err) { /* expected: extension-injected nodes */ },
});
```

## APIs (`react-dom`)

### `createPortal(children, domNode, key?)`

Renders `children` into `domNode` (which must already exist in the DOM) while keeping the React parent–child relationship for context, events, and error boundaries. Events still bubble through the React tree, not the DOM tree.

```tsx
import { createPortal } from "react-dom";

function Modal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null; // SSR guard
  return createPortal(
    <div role="dialog" className="fixed inset-0 …">{children}</div>,
    document.body,
  );
}
```

Notes:
- Always SSR-guard `document` access Next renders this on the server first.
- Don't portal into a node managed by another framework or by React itself elsewhere; React will fight over its children.

### `flushSync(callback)`

Forces React to flush state updates inside `callback` synchronously, including DOM commit, before returning. **Avoid by default** it disables batching and concurrent features. Legitimate uses:

- You need to read post-update layout immediately (e.g. measure a newly-rendered element).
- You're integrating with a non-React API that expects the DOM to reflect a value before its next call (e.g. `select.scrollIntoView()` after appending an option).

```ts
import { flushSync } from "react-dom";

flushSync(() => setOpen(true));
panelRef.current?.scrollIntoView();
```

If you find yourself reaching for `flushSync` often, you probably want a `useLayoutEffect` instead.

## Form action handling

React 19 lets you pass a function directly as `action` (or `formAction` on submit buttons/inputs). React calls it with the `FormData`, tracks pending state, and for uncontrolled forms resets the form on success.

```tsx
async function saveName(formData: FormData) {
  const name = formData.get("name");
  await fetch("/api/name", { method: "POST", body: JSON.stringify({ name }) });
}

<form action={saveName}>
  <input name="name" />
  <SubmitButton />
</form>
```

### `useFormStatus()` → `{ pending, data, method, action }`

Reads the status of the **nearest parent `<form>`**. Must be called from a component rendered as a descendant of that form (not from the form itself).

```tsx
"use client";
import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>;
}
```

To manage the action's *return value* and pending state in one place, prefer `useActionState` (from `react`) over `useFormStatus`. Use `useFormStatus` for design-system components that don't own the action.

### `requestFormReset(form)`

Manually reset a controlled form after an action succeeds (uncontrolled forms reset automatically).

## Resource preloading APIs

Imported from `react-dom`. Calling them schedules `<link>`/`<script>` insertions into `<head>`; React deduplicates and prioritises by resource type, not call order. Safe to call from render they're idempotent.

| API                                        | Purpose                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `prefetchDNS(href)`                        | DNS lookup hint for a host you may contact.                             |
| `preconnect(href, options?)`               | Open TCP/TLS connection to a host you will contact.                     |
| `preload(href, options)`                   | Fetch a resource (`as: "style" \| "script" \| "font" \| "image" \| "fetch"`) into the cache. |
| `preloadModule(href, options?)`            | Fetch an ESM module into the cache.                                     |
| `preinit(href, options)`                   | Fetch *and* execute a script (`as: "script"`) or insert a stylesheet (`as: "style"`). |
| `preinitModule(href, options?)`            | Fetch *and* evaluate an ESM module.                                     |

Common shape:

```tsx
import { preload, preconnect, prefetchDNS, preinit } from "react-dom";

function CheckoutLink() {
  preconnect("https://payments.example.com");
  preload("/fonts/Inter.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  preinit("/css/checkout.css", { as: "style", precedence: "default" });
  return <a href="/checkout">Checkout</a>;
}
```

In the Next 16 app, framework-level features (font, image, link prefetching) usually obviate these. Reach for them when you need to nudge the loader from a deeply-nested component (e.g. preconnect to Supabase Storage right before a page is about to render `<Image />`).

## Document metadata (hoisted)

React 19 hoists `<title>`, `<meta>`, `<link>` from anywhere in the tree to `<head>`. **In this Next 16 project**, prefer the framework's `metadata` export and `generateMetadata` for static metadata they integrate with route segments and dedupe across navigations. Use in-tree tags when truly per-component-dynamic (e.g. a `BlogPost` component whose author info should be reflected in `<meta name="author">`).

```tsx
function BlogPost({ post }: { post: Post }) {
  return (
    <article>
      <title>{post.title}</title>
      <meta name="author" content={post.authorName} />
      <link rel="canonical" href={post.url} />
      <h1>{post.title}</h1>
      …
    </article>
  );
}
```

## Stylesheets & async scripts

React 19 manages `<link rel="stylesheet" precedence="…">` ordering and dedupes inline `<style>` and `<script async>` blocks rendered anywhere in the tree.

```tsx
<Suspense fallback="loading…">
  <link rel="stylesheet" href="/css/foo.css" precedence="default" />
  <link rel="stylesheet" href="/css/bar.css" precedence="high" />
  <article className="foo bar">…</article>
</Suspense>
```

React waits for stylesheets to load before committing the render that depends on them, both client-side and during streaming SSR.

## Server APIs (`react-dom/server`)

Used only by frameworks (Next 16 owns this). For completeness:

- `renderToReadableStream(node, options?)` Web streams (Edge, Workers).
- `renderToPipeableStream(node, options?)` Node streams.
- `renderToString(node)` synchronous, no Suspense data fetching. Limited.
- `renderToStaticMarkup(node)` like `renderToString` but skips React-internal attributes.

## Static APIs (`react-dom/static`) new in 19

For static HTML generation that waits for all data:

- `prerender(node, options?)` Web streams.
- `prerenderToNodeStream(node, options?)` Node streams.

Differs from `renderToString` by awaiting Suspense boundaries before returning.

## Built-in DOM components

React 19 normalises a handful of host-element behaviours worth remembering:

- `<form action={fn}>` function actions, automatic pending/reset.
- `<input formAction={fn}>` / `<button formAction={fn}>` per-button action override.
- `<link rel="stylesheet" precedence="…">` managed insertion ordering.
- `<style precedence="…">` same for inline styles.
- `<script async src="…">` deduped, hoisted to `<head>`.
- `<title>` / `<meta>` / `<link>` hoisted to `<head>`.
- Custom elements receive matching props as DOM properties; `false` and non-primitive props are omitted during SSR.

## Common gotchas

- **Calling removed APIs.** `ReactDOM.render`, `hydrate`, `findDOMNode`, `unmountComponentAtNode` are gone they will throw or fail to import.
- **Importing `useFormState` from `react-dom`.** It moved to `react` and was renamed `useActionState`. Old imports will not resolve.
- **`createPortal` to a non-existent node.** Guard for `document`/the target node existing (especially in SSR / first-render).
- **Forgetting `precedence` on managed `<link rel="stylesheet">`.** Without it, React doesn't manage ordering and you fall back to insertion order.
- **Calling preload APIs in a server component when the resource is browser-only** fine, they no-op on the server in unsupported contexts, but verify your framework's behaviour.
- **`flushSync` inside an event handler that already runs synchronously.** Often unnecessary React batches per-event but commits before the browser repaints. You only need `flushSync` when you must observe DOM state *before* yielding back to the browser/another library.
- **Hydration mismatches caused by environment-only data** (timestamps, `Math.random`, locale-dependent formatting). Compute on the server and pass down, or render only on the client behind a `useEffect`/`use client` boundary.
- **Custom-element prop names that collide with HTML attribute names** React 19 picks property over attribute when the property exists on the instance. Test interop with the actual element class.
- **Document metadata duplication** when a parent renders `<title>` and a child also does last writer in tree order wins, but it's confusing. Centralise via Next's `metadata` API where possible.

## References

- Live docs: https://react.dev/reference/react-dom
- Client APIs: https://react.dev/reference/react-dom/client
- Server APIs: https://react.dev/reference/react-dom/server
- Static APIs: https://react.dev/reference/react-dom/static
- Resource preloading overview: https://react.dev/reference/react-dom#resource-preloading-apis
- React 19 release notes: https://react.dev/blog/2024/12/05/react-19
