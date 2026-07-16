---
name: next
description: Next.js 16.2.4 App Router conventions, file-system routing, dynamic params (now Promise-typed), Image, Metadata, route handlers, middleware, and webpack-mode caveats. USE FOR any Next.js work in this PWA. DO NOT USE FOR: Pages Router (not used), turbopack-specific features (this project uses --webpack).
---

# Next.js 16.2.4

This project pins `next@16.2.4` with `react@19.2.4`. Build/dev runs with the
classic webpack compiler (`next dev --webpack` / `next build --webpack`),
**not** Turbopack. App Router only there is no `pages/` directory.

The bundled docs at `node_modules/next/dist/docs/01-app/` are the source of
truth for this version. When in doubt, read them Next 16 has breaking
changes vs Next 13/14/15 that most LLM training data still reflects.

## When to use

Trigger phrases / scenarios:

- Adding/editing anything under `src/app/**` (pages, layouts, route handlers).
- Touching `next.config.ts`, `proxy.ts` (formerly `middleware.ts`),
  `manifest.ts`, `robots.ts`, `sitemap.ts`.
- Working with `params`, `searchParams`, `cookies()`, `headers()`,
  `useRouter`, `usePathname`, `useSearchParams`, `<Image>`, `<Link>`,
  `Metadata`, `Viewport`.
- Diagnosing "params should be awaited", "cookies() returned a promise",
  hydration mismatches, or HMR weirdness specific to webpack mode.
- Anything that mentions Server Components, Client Components, the
  `'use client'` directive, or Server Actions.

## Critical breaking changes from Next 13–15

LLMs frequently emit pre-Next-15 patterns. **Do not** ship any of these.

### 1. `params` and `searchParams` are Promises

```tsx
// ❌ Pre-15 (synchronous) WILL throw at runtime in Next 16
export default function Page({ params }: { params: { slug: string } }) {
  return <h1>{params.slug}</h1>
}

// ✅ Next 16 async server component
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <h1>{slug}</h1>
}

// ✅ Next 16 client component uses React's `use()` hook
'use client'
import { use } from 'react'
export default function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = use(params)
  return <h1>{slug}</h1>
}
```

Same applies to `searchParams`, and to `params` in `layout.tsx`,
`route.ts`, and `generateMetadata`.

### 2. `cookies()`, `headers()`, `draftMode()` are async

```tsx
// ❌ Pre-15
import { cookies } from 'next/headers'
const theme = cookies().get('theme')

// ✅ Next 16
import { cookies } from 'next/headers'
const cookieStore = await cookies()
const theme = cookieStore.get('theme')
```

### 3. `middleware.ts` → `proxy.ts`

Next 16 deprecated the `middleware` file convention and renamed it to
`proxy`. Same API surface (`NextRequest`/`NextResponse`, `matcher` config),
new filename. Place at `src/proxy.ts` (alongside `app/`).

```ts
// src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  if (!request.cookies.get('session')) {
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

### 4. `error.tsx` uses `unstable_retry`, not `reset`

```tsx
// ✅ Next 16
'use client'
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return <button onClick={() => unstable_retry()}>Retry</button>
}
```

### 5. Route segment config: `dynamic` / `revalidate` / `fetchCache` removed under Cache Components

When the (opt-in) Cache Components feature is enabled, `export const dynamic`,
`dynamicParams`, `revalidate`, and `fetchCache` are no longer accepted.
This project does not currently enable Cache Components, so the legacy
`force-dynamic` / `revalidate = 60` style is still valid see
`src/app/api/audio-upload/route.ts:50` which uses `export const dynamic = "force-dynamic"`.

### 6. `experimental_ppr` removed

`export const experimental_ppr = true` was removed in v16. A codemod is
available; use the new Cache Components opt-in instead.

### 7. GET route handlers default to dynamic

Since v15-RC, `GET` handlers no longer cache by default. Opt back in with
`export const revalidate = 60` (or use `fetch` with `next: { revalidate }`).

## File-system routing reference

All paths below are under `src/app/`. This project also uses route groups
like `src/app/(app)/` to share layout without affecting URLs.

| File              | Purpose                                              | Component type        |
| ----------------- | ---------------------------------------------------- | --------------------- |
| `layout.tsx`      | Shared UI wrapping a segment; required at root.      | Server (default)      |
| `page.tsx`        | Leaf UI; makes the segment publicly routable.        | Server (default)      |
| `template.tsx`    | Like layout but remounts on navigation.              | Server (default)      |
| `loading.tsx`     | `<Suspense>` fallback for the segment.               | Server (default)      |
| `error.tsx`       | React error boundary; **must be Client Component**.  | Client (`'use client'`) |
| `global-error.tsx`| Root-level error boundary; replaces RootLayout.      | Client                |
| `not-found.tsx`   | UI when `notFound()` is thrown in segment.           | Server                |
| `route.ts`        | API endpoint (mutually exclusive with `page.tsx`).   | Server only           |
| `default.tsx`     | Parallel-route fallback for unmatched slot.          | Server (default)      |
| `proxy.ts`        | Edge proxy (formerly `middleware.ts`); at `src/`.    | Edge runtime          |
| `manifest.ts`     | PWA manifest generator (this project uses it).       | Server                |
| `robots.ts`       | `/robots.txt` generator.                             | Server                |
| `sitemap.ts`      | `/sitemap.xml` generator.                            | Server                |
| `icon.tsx`/`apple-icon.tsx` | Generated app icons.                       | Server                |
| `opengraph-image.tsx` | Generated OG image per route.                    | Server                |

Folders:

- `[slug]` dynamic segment.
- `[...slug]` catch-all.
- `[[...slug]]` optional catch-all.
- `(group)` route group, no URL impact (used here for `(app)`).
- `@slot` parallel route slot, surfaces as a typed prop on `layout`.
- `(.)foo` / `(..)foo` / `(...)foo` intercepting routes.

Layout-related gotchas:

- A layout **does not re-render on navigation**, so it cannot read
  `searchParams` or `pathname`. Push that into a Client child using
  `useSearchParams()` / `usePathname()`.
- Layouts cannot pass props to `children`. Refactor shared data into a
  request-cached function (`React.cache`) and call from both sides; or
  use the `fetch()` request dedup that's automatic with Next.

## Page & dynamic routes

```tsx
// src/app/lessons/[lessonId]/page.tsx
type Props = {
  params: Promise<{ lessonId: string }>
  searchParams: Promise<{ tab?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lessonId } = await params
  return { title: `Lesson ${lessonId}` }
}

// Pre-render at build time body still must `await params`.
export async function generateStaticParams() {
  return [{ lessonId: 'intro' }, { lessonId: 'greetings' }]
}

export default async function Page({ params, searchParams }: Props) {
  const { lessonId } = await params
  const { tab = 'overview' } = await searchParams
  // ...
}
```

`PageProps<'/lessons/[lessonId]'>` and `LayoutProps<'/lessons'>` are
globally available helpers (generated by `next dev` / `next typegen`)
that infer `params`/`searchParams` from the route literal.

## Route handlers (`app/api/.../route.ts`)

```ts
// Supported exports: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
// `request` is a NextRequest (extends Web Request).
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'        // default; 'edge' also valid
export const dynamic = 'force-dynamic' // opt out of static optimization

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }, // <-- Promise!
) {
  const { id } = await params
  const json = await request.json()
  return NextResponse.json({ id, ...json }, { status: 201 })
}
```

### Reading bodies

```ts
const json = await request.json()
const text = await request.text()
const buf  = await request.arrayBuffer()
const form = await request.formData()       // for multipart
const stream = request.body                  // ReadableStream<Uint8Array>
```

### Streaming a request body upstream (this project's pattern)

`src/app/api/audio-upload/route.ts:52` proxies multipart audio uploads to
an external service without buffering. Streaming a request body via
`fetch` requires `duplex: 'half'`, which isn't yet in `lib.dom`:

```ts
const upstream = await fetch(upstreamUrl, {
  method: 'POST',
  headers: { 'content-type': contentType }, // keep multipart boundary intact
  body: request.body,                        // ReadableStream passthrough
  duplex: 'half' as any,                     // required when body is a stream
  signal: request.signal,                    // wire client abort -> upstream
} as RequestInit)

return new NextResponse(upstream.body, {
  status: upstream.status,
  headers: { 'content-type': upstream.headers.get('content-type') ?? '' },
})
```

Important: do **not** call `request.formData()` if you intend to forward
`request.body` as a stream consuming it once locks the stream.

### Edge vs Node runtime

- `runtime = 'nodejs'` (default): Node APIs (`fs`, `Buffer`), longer
  timeouts, full streaming-fetch support.
- `runtime = 'edge'`: V8 isolates, smaller cold start, but **no Node
  built-ins** and stricter fetch semantics. The audio-upload proxy
  pins `'nodejs'` deliberately because Edge fetch's request-body
  streaming is more limited.

### Cookies & redirects in route handlers

```ts
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const store = await cookies()             // async!
store.set('locale', 'fr', { httpOnly: true, sameSite: 'lax', path: '/' })

redirect('/dashboard') // throws must be top-level, not inside try/catch
```

## `next/image`

```tsx
import Image from 'next/image'

// Static-sized
<Image src="/icons/Logo.svg" alt="" width={120} height={32} priority />

// Fill parent (parent must be `position: relative`)
<div className="relative aspect-square">
  <Image src={remoteUrl} alt="" fill sizes="(max-width: 480px) 100vw, 480px" />
</div>
```

Project-specific:

- `next.config.ts` allow-lists `*.supabase.co` under `images.remotePatterns`,
  so any Supabase Storage URL works as an `<Image src>`.
- For images served from Supabase Storage that you **don't** want Next's
  optimizer to refetch (auth-protected, signed URLs, audio thumbnails),
  pass `unoptimized` so the browser fetches the URL directly.
- Always set `sizes` when using `fill` without it the browser downloads
  the largest variant.

## `next/link`, `next/navigation`

```tsx
import Link from 'next/link'

<Link href="/lessons" prefetch={false}>Lessons</Link>
```

`<Link>` auto-prefetches in-viewport routes. Disable with `prefetch={false}`
on links you don't expect users to click (e.g. footer legal pages).

```tsx
'use client'
import {
  useRouter, usePathname, useSearchParams,
  redirect, notFound,
} from 'next/navigation'

const router = useRouter()
router.push('/x')          // adds history entry
router.replace('/x')       // no history entry use for post-submit redirects
router.refresh()           // re-fetch current segment's RSC payload
router.back()
router.prefetch('/x')

const pathname = usePathname()
const sp = useSearchParams()  // ReadOnlyURLSearchParams
const tab = sp.get('tab')
```

`redirect()` and `notFound()` work in **server** components/handlers and
throw never wrap them in `try/catch` (that swallows the redirect).

## Metadata API

```tsx
// src/app/layout.tsx see actual file at src/app/layout.tsx:9
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  applicationName: 'Afriklang',
  title: { default: 'Afriklang', template: '%s · Afriklang' },
  description: '...',
  icons: { icon: [{ url: '/icons/Logo.svg', type: 'image/svg+xml' }] },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Afriklang' },
  formatDetection: { telephone: false },
}

// `viewport` MUST be its own export not a key on `metadata`.
export const viewport: Viewport = {
  themeColor: '#00539F',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}
```

Dynamic per-route:

```tsx
export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { slug } = await params
  const previousImages = (await parent).openGraph?.images || []
  return {
    title: slug,
    openGraph: { images: ['/og.png', ...previousImages] },
  }
}
```

Do **not** put raw `<title>` / `<meta>` tags in the root layout let the
Metadata API render them so streaming and dedup work correctly.

## `next.config.ts`

This project uses a TypeScript config (see `next.config.ts:1`):

```ts
import type { NextConfig } from 'next'
import withPWAInit from '@ducanh2912/next-pwa'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: { skipWaiting: false, disableDevLogs: true },
})

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.100.19'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
}

// Order matters: intl inner, PWA outer.
export default withPWA(withNextIntl(nextConfig))
```

Key points:

- `allowedDevOrigins` is required since Next 15 to hit `next dev` from a
  LAN device (phone testing the PWA).
- Plugin order matters. PWA must wrap last so its webpack plugin sees
  the fully-resolved config.
- Do **not** assign `module.exports = ...` in this file; mixing CJS
  assignment with `export default` clobbers the plugin chain (this bug
  bit the project once, see comment in `next.config.ts:36`).

## Webpack-mode caveats (this project)

Scripts pass `--webpack` so the legacy webpack compiler is used.
Consequences:

- **Turbopack-only features are unavailable**: Turbopack-specific
  configuration in `next.config.ts` (e.g. `turbopack.rules`,
  `turbopack.resolveAlias`) is ignored. Don't reach for them.
- **HMR is slower** than Turbopack but works reliably with the
  `next-pwa` and `next-intl` plugins (which is partly why webpack is
  pinned here).
- **`@ducanh2912/next-pwa` is webpack-only** switching to Turbopack
  would require swapping out the PWA plugin entirely.
- Bundle analyzer / custom webpack tweaks go in `next.config.ts`'s
  `webpack(config) { ... }` hook (not yet used here).

## Common gotchas

- **Server vs Client components**: every file under `app/` is a Server
  Component unless it (or an ancestor in the import graph) starts with
  `'use client'`. Server Components cannot use `useState`, `useEffect`,
  `useRouter`, browser APIs, or event handlers. Client Components cannot
  be `async` and cannot directly `await cookies()`/`headers()`.
- **`'use client'` scope**: the directive applies to the file and
  everything it imports. A Client Component can render Server Components
  only if they're passed in as `children`/props by a Server parent.
- **Async dynamic APIs always**: `params`, `searchParams`, `cookies()`,
  `headers()`, `draftMode()` all return Promises in Next 16. Linting
  catches most violations; runtime throws if you try to use them sync.
- **Hydration mismatches**: don't render anything that differs between
  server and client (e.g. `Date.now()`, `Math.random()`, locale-formatted
  dates without an explicit locale). For browser-extension noise on
  `<body>` (Grammarly, ColorZilla), use `suppressHydrationWarning` on
  `<body>` only see `src/app/layout.tsx:71`.
- **`public/` assets** are served at the root: `public/icons/Logo.svg`
  → `/icons/Logo.svg`. Do **not** import them; reference by URL.
- **Env vars**: `process.env.FOO` is server-only and inlined at build
  time on the server. `process.env.NEXT_PUBLIC_FOO` is inlined into the
  client bundle and visible in DevTools never put secrets there.
- **`force-dynamic` opts a route into per-request rendering** and
  disables the full-route cache. Use sparingly; prefer `fetch` with
  `cache: 'no-store'` on individual data calls.
- **Don't catch `redirect()` / `notFound()`**: they throw a special
  signal Next must catch. A bare `try/catch` will swallow the redirect
  and surface a confusing "no response" error.
- **Layouts can't access the request**: they're cached for client
  navigation. Read cookies/headers only inside `page.tsx`/`route.ts`,
  or wrap the per-request UI in a `<Suspense>` inside the layout.

## References

- Local docs (authoritative for this version):
  `node_modules/next/dist/docs/01-app/`
  - File conventions: `03-api-reference/03-file-conventions/`
  - Functions (cookies/headers/redirect/etc): `03-api-reference/04-functions/`
  - Components (Image/Link/Form): `03-api-reference/02-components/`
  - Migration notes: `02-guides/migrating/`
- Project files worth reading first:
  - `next.config.ts:1` plugin chain (next-intl + next-pwa)
  - `src/app/layout.tsx:1` root layout, metadata, viewport
  - `src/app/api/audio-upload/route.ts:1` streaming proxy with `duplex: 'half'`
- Live docs (may show a newer version): https://nextjs.org/docs/app
