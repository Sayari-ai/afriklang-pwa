---
name: next-intl
description: i18n with next-intl v4 in App Router mode (no locale-based routing). Trigger phrases include "translate", "i18n", "localization", "useTranslations", "getTranslations", "NextIntlClientProvider", "messages bundle", "ICU plural", "locale switcher", "fr.json", "en.json", "request config". USE FOR: editing message bundles, calling t() in server vs client components, request config, locale resolution from cookie/Accept-Language, plural/date/number formatting, switching the user's locale at runtime via router.refresh(). DO NOT USE FOR: configuring locale-based routing with [locale] segments (this project deliberately doesn't use that mode), setting up next-intl middleware (we don't use it), the PWA service worker (see next-pwa skill).
---

# next-intl@^4.11.0 (App Router, no i18n routing)

`next-intl` is the i18n library wired into this project. We run it in its **"Provide a locale" / "no i18n routing"** mode the URL never contains the locale; instead a cookie (`afriklang.app_locale.v1`) drives `getRequestConfig`, mirroring the Flutter app's `AppLocaleController`. Switching locales calls `router.refresh()`, which re-runs Server Components, which re-reads the cookie, which re-resolves messages.

## When to use

Reach for this skill when:

- Adding a new translatable string (extending `src/messages/{en,fr}.json`).
- Calling `t()` in a server vs. client component and unsure which API to use.
- Editing `src/i18n/request.ts` (locale resolution order).
- Touching the `NextIntlClientProvider` in `src/app/layout.tsx`.
- Adding plurals / interpolation / date / number / list formatting.
- Implementing a locale switcher (we already have `src/components/locale-picker.tsx`).
- Debugging "Couldn't find next-intl config file" or `useTranslations` returning the literal key.

Do NOT use for:

- Setting up `[locale]`-segmented routing or `next-intl/middleware`. This project is deliberately routing-free; locale lives in a cookie.
- Backend / DB-side translations.
- Audio prompt translations (those live with the lesson content in Supabase).

## Setup in this project

File layout (matches the upstream "App Router" guide, minus the `[locale]` segment):

```
afriklang-pwa/
├── next.config.ts          # createNextIntlPlugin('./src/i18n/request.ts')
├── src/
│   ├── messages/
│   │   ├── en.json         # ICU MessageFormat, flat keys (no namespace nesting)
│   │   └── fr.json
│   ├── i18n/
│   │   ├── request.ts      # default export: getRequestConfig(...)
│   │   └── locales.ts      # SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale()
│   ├── stores/
│   │   └── app-locale.ts   # zustand store; writes cookie + localStorage
│   ├── hooks/
│   │   └── use-set-app-locale.ts  # setOverride() then router.refresh()
│   ├── components/
│   │   ├── locale-picker.tsx       # UI radio group (System / EN / FR)
│   │   └── app-hydration.tsx       # useLocale() → effective locale into store
│   └── app/
│       └── layout.tsx     # getLocale() + getMessages() → NextIntlClientProvider
```

Plugin (in `next.config.ts:7`):

```ts
import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withPWA(withNextIntl(nextConfig));  // i18n inner, PWA outer
```

Path is passed explicitly so the wiring is greppable. The plugin would also auto-detect `src/i18n/request.ts` with no argument.

Request config (`src/i18n/request.ts:23-41`):

```ts
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = headerStore.get("accept-language");
  const acceptPrimary = acceptLanguage?.split(",")[0]?.trim();

  const locale: Locale =
    resolveLocale(cookieValue) !== DEFAULT_LOCALE
      ? resolveLocale(cookieValue)
      : resolveLocale(acceptPrimary);

  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
```

Resolution order: cookie → `Accept-Language` → `DEFAULT_LOCALE` ("en"). Region subtags are stripped (`en-US` → `en`). Unsupported values fall back to default. Messages are dynamic-imported so cold start only loads one bundle.

Root provider (`src/app/layout.tsx:54-87`):

```tsx
const locale = await getLocale();
const messages = await getMessages();

return (
  <html lang={locale}>
    <body suppressHydrationWarning>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AppHydration />
        {children}
      </NextIntlClientProvider>
    </body>
  </html>
);
```

## API reference

### Server-side (Server Components, Server Actions, Route Handlers, `generateMetadata`)

Imported from `next-intl/server`:

| Symbol                           | Returns                                | Notes                                                                                  |
| -------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `getRequestConfig(async () => …)`| Plugin entry. Default-exported from `src/i18n/request.ts`. | Resolves `{ locale, messages, timeZone?, now?, formats?, onError?, getMessageFallback? }` per request. |
| `await getLocale()`              | `string`                               | The locale chosen by your request config.                                              |
| `await getMessages()`            | The full messages object               | Pass to `<NextIntlClientProvider messages={…}>`.                                       |
| `await getTranslations(ns?)`     | `t(key, values?)` translator           | Awaitable equivalent of `useTranslations`. Use in async Server Components.             |
| `await getTranslations({ locale, namespace })` | translator                | Force a specific locale (e.g. for an email rendered for another user).                 |
| `await getFormatter()`           | `{ dateTime, number, relativeTime, list }` | Server equivalent of `useFormatter()`.                                             |
| `await getNow()` / `await getTimeZone()` | values from request config       | For SSR-stable "now".                                                                  |

### Client-side (Client Components only files marked `"use client"`)

Imported from `next-intl`:

| Symbol                                | Returns                              | Notes                                                                |
| ------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `useTranslations(namespace?)`         | `t(key, values?)` translator         | Reads from the nearest `NextIntlClientProvider`.                     |
| `useLocale()`                         | `string`                             | The locale that was resolved server-side (mirrors `getLocale()`).    |
| `useMessages()`                       | full messages object                 | Rarely needed; use `useTranslations` instead.                        |
| `useFormatter()`                      | formatter handle                     | `.dateTime(date, options)`, `.number(n, options)`, `.relativeTime(date, now)`, `.list(items)`. |
| `useNow({ updateInterval? })`         | live `Date`                          | Re-renders on a tick, useful for relative timers.                    |
| `useTimeZone()`                       | string                               | From request config (or runtime default).                            |
| `<NextIntlClientProvider … />`        | provider component                   | Props: `locale`, `messages`, `timeZone?`, `now?`, `formats?`, `onError?`, `getMessageFallback?`. |

### Translator (`t`) shape

```ts
t(key: string, values?: Record<string, string | number | Date>): string
t.rich(key, values & { tag: (chunks) => ReactNode }): ReactNode  // for inline tags
t.markup(key, values): string                                    // string-only inline tags
t.raw(key): unknown                                              // returns the un-formatted message tree
t.has(key): boolean                                              // existence check
```

ICU MessageFormat is the message syntax see "Common patterns" below.

### Plugin (`next-intl/plugin`)

```ts
import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin(
  // Optional: path to the request-config file. Defaults to ./i18n/request.{ts,tsx,js,jsx}
  // (with or without ./src). We pass it explicitly: "./src/i18n/request.ts".
  requestConfigPath?: string,
);
```

The plugin patches webpack/turbopack so `getRequestConfig` is registered for SSR. Without it you'll see `Couldn't find next-intl config file` at request time.

## Common patterns

### Server Component using `t()`

```tsx
// src/app/profile/page.tsx
import { getTranslations } from "next-intl/server";

export default async function ProfilePage() {
  const t = await getTranslations(); // no namespace → flat keys
  return <h1>{t("profileAppLanguageLabel")}</h1>;
}
```

For metadata:

```ts
export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("profileTitle") };
}
```

### Client Component using `useTranslations()`

From `src/components/locale-picker.tsx:36`:

```tsx
"use client";
import { useTranslations } from "next-intl";

export function LocalePicker() {
  const t = useTranslations();
  return (
    <button>{t("profileAppLanguageEnglish")}</button>
  );
}
```

### Interpolation + plurals (ICU)

Messages already in this project (`src/messages/en.json`):

```json
{
  "homeTabComingSoon": "{tabTitle}\n(coming soon)",
  "homeLevelLockedSnack": "Level {levelId} is locked",
  "consentDisclaimer": "By tapping \"{action}\" you confirm you have read the points above."
}
```

Usage:

```tsx
t("homeLevelLockedSnack", { levelId: 3 });
t("consentDisclaimer", { action: t("consentAgreeButton") });
```

ICU plurals (add when needed):

```json
{
  "pointsBalance": "{count, plural, =0 {No points} one {# point} other {# points}}"
}
```

```tsx
t("pointsBalance", { count: user.points });
```

ICU `select`:

```json
{
  "greeting": "{gender, select, female {Bienvenue} male {Bienvenu} other {Bienvenue}}, {name}!"
}
```

### Dates / numbers / lists

```tsx
const f = useFormatter();
f.dateTime(date, { dateStyle: "medium" });
f.number(amount, { style: "currency", currency: "USD" });
f.relativeTime(thenDate, now);
f.list(["Yoruba", "Lingala", "Wolof"], { type: "conjunction" });
```

`Intl.*` underpins all of this same option shapes as `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.ListFormat`.

### Namespacing (we don't use it; here's how if you do)

Current project keys are flat (`onboardingIntroTitle`, `homeTabProfile`, …) chosen to mirror the Flutter `.arb` keys exactly. If you ever migrate to nested:

```json
{
  "Onboarding": {
    "introTitle": "Get your first $20",
    "introCta": "Let's start"
  }
}
```

```tsx
const t = useTranslations("Onboarding");
t("introTitle");
```

Don't half-migrate pick one style per file.

### Switching locale at runtime (this project's pattern)

The full chain: `LocalePicker` button → `useSetAppLocale()` → store writes cookie + `localStorage` → `router.refresh()` → request config re-runs → new `messages` flow into `NextIntlClientProvider` → all `useTranslations()` consumers re-render.

```ts
// src/hooks/use-set-app-locale.ts
const setOverride = useAppLocale((s) => s.setOverride);
const router = useRouter();
return (override) => {
  setOverride(override);    // writes cookie afriklang.app_locale.v1 + localStorage
  router.refresh();         // re-runs Server Components in the current route
};
```

This is intentional we don't need locale-prefixed URLs because the experience is single-user, mobile-first, and matches the Flutter app's runtime locale switch.

### Hydrating a client store with the server-resolved locale

From `src/components/app-hydration.tsx:34-72`:

```tsx
"use client";
const serverLocale = useLocale();
useEffect(() => {
  if (isSupportedLocale(serverLocale)) {
    useAppLocale.getState().setEffective(serverLocale);
  }
}, [serverLocale]);
```

`useLocale()` returns the same value `getLocale()` returned on the server, so client code has a synchronous source of truth without re-resolving.

## Gotchas

- **Server vs. Client API mismatch**: `useTranslations` only works in Client Components (it reads context). `getTranslations` only works in Server Components / Actions / Metadata (it `await`s request config). Mixing them up gives "useTranslations must be called inside NextIntlClientProvider" or "You're using a hook inside a Server Component".
- **`Couldn't find next-intl config file`**: the plugin didn't run. In `next.config.ts` make sure `withNextIntl` wraps the config and that nothing else (a stray `module.exports = …`) clobbers `module.exports` first. We hit this earlier in the project see the comment block at `next.config.ts:35-40`.
- **`router.refresh()` is the only safe locale switch**: a hard `window.location.reload()` works but loses client React state (open sheets, recordings in progress). `router.refresh()` keeps state and re-runs Server Components only.
- **Cookie must be set before `router.refresh()`**: `useSetAppLocale` does this in order store first (which writes cookie sync), then refresh. If you reverse it, the request config reads the old cookie and you see no change.
- **`SameSite=Lax`, `path=/`, 1-year `max-age`** is what `src/stores/app-locale.ts:62-70` writes. The path matters without `path=/` the manifest endpoint and route handlers won't see the cookie.
- **Region subtags**: `Accept-Language: fr-CA,en;q=0.5` becomes `fr-ca` → primary tag `fr` → resolved as `fr`. See `src/i18n/locales.ts:32-36`. Don't add `fr-CA.json` expecting it to be picked up.
- **Missing keys**: by default `t("missing.key")` returns the key string and logs in dev. Override via `getMessageFallback` / `onError` in either `getRequestConfig` (server) or `<NextIntlClientProvider>` (client) keep them in sync.
- **JSON typecheck**: TypeScript sees `messages` as `Record<string, string | …>`. For autocomplete on `t("…")` keys, set up TypeScript augmentation: declare `interface IntlMessages extends Messages` from `messages/en.json`. See <https://next-intl.dev/docs/workflows/typescript>.
- **`suppressHydrationWarning` on `<body>`** in `src/app/layout.tsx:71` is for browser extensions injecting attributes, not for next-intl. Don't move it onto translated content real translation mismatches MUST surface as hydration errors.
- **App Router caching**: route segments using `getTranslations` are still statically rendered if the rest of the segment is static. Cookie / `headers()` reads in `request.ts` make routes dynamic that's fine for this app (everything is per-user) but be aware before adding `getTranslations` to a marketing-style static page.
- **Don't import `next-intl/server` in a Client Component** and don't import `next-intl` hooks in a Server Component. The package even ships separate entry points (`react-server` vs `react-client`) so a wrong import errors at build time, but the error message can be cryptic.
- **Plurals are by locale category, not English categories**: `one`, `few`, `many`, `other`, plus `=N` exact matches. French has different plural rules than English (e.g. `0` is singular in French) let ICU handle it, don't hard-code `if (count === 1)`.

## References

- Local README: `node_modules/next-intl/README.md`
- Local types index: `node_modules/next-intl/dist/types/`
  - Server entry: `dist/types/server.react-server.d.ts`
  - Client entry: `dist/types/index.react-client.d.ts`
  - Plugin: `node_modules/next-intl/plugin.d.ts`
  - `getRequestConfig` shape: `dist/types/server/react-server/getRequestConfig.d.ts`
- Upstream docs (App Router): <https://next-intl.dev/docs/getting-started/app-router>
- Server vs Client Components: <https://next-intl.dev/docs/environments/server-client-components>
- Translations / ICU MessageFormat: <https://next-intl.dev/docs/usage/translations>
- Numbers / Dates / Lists: <https://next-intl.dev/docs/usage/numbers>, `/dates-times`, `/lists`
- Plugin reference: <https://next-intl.dev/docs/usage/plugin>
- TypeScript augmentation: <https://next-intl.dev/docs/workflows/typescript>
- Project sites:
  - Plugin call: `next.config.ts:7`
  - Request config: `src/i18n/request.ts:23-41`
  - Locale model: `src/i18n/locales.ts`
  - Provider: `src/app/layout.tsx:54-87`
  - Locale store: `src/stores/app-locale.ts`
  - Switch hook: `src/hooks/use-set-app-locale.ts`
  - Picker UI: `src/components/locale-picker.tsx`
  - Hydration sync: `src/components/app-hydration.tsx:34-72`
  - Message bundles: `src/messages/en.json`, `src/messages/fr.json`
