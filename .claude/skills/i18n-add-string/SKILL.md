---
name: i18n-add-string
description: Add, rename, or remove a translated string in this next-intl PWA. Covers the en.json/fr.json dual-edit invariant (missing key throws at runtime), the camelCase + section-prefix naming convention (e.g. `levelGetReady`, `homeCouldNotSaveProgressSnack`), ICU plural/select syntax, variable interpolation `t("key", { var })`, calling `useTranslations()` in client components vs `getTranslations()` in server components, and the `useSnackbar.getState().show(t("key"))` pattern. USE FOR: adding labels/snackbar messages/error strings/button copy, renaming i18n keys, auditing en.json vs fr.json parity, ICU plurals, deciding where to call t() (client/server/outside React). DO NOT USE FOR: changing locale-routing config, adding a third language beyond en/fr (touch `i18n.ts` + language picker), or deliberately hardcoded UI text.
---

# Adding a translated string

This project uses [`next-intl`](https://next-intl.dev). Messages live in two flat JSON files:

- `src/messages/en.json` — source of truth for English copy
- `src/messages/fr.json` — French translations, **must contain every key in en.json**

A missing key at lookup time logs `IntlError: MISSING_MESSAGE` and renders the raw key string as fallback. In dev that's loud; in production it ships broken UI. **Never edit one file without the other.**

## 1. Naming convention

Keys are flat (no nesting), camelCase, prefixed by feature/screen:

| Prefix             | Examples                                                       |
| ------------------ | -------------------------------------------------------------- |
| `common*`          | `commonRetry`, `commonSkip`, `commonCancel`, `commonNext`      |
| `onboarding*`      | `onboardingIntroTitle`, `onboardingPasscodeResentSnack`        |
| `pathSetup*`       | `pathSetupLoadingTitle`, `pathSetupRetryButton`                |
| `consent*`         | `consentTitle`, `consentBulletDatasets`, `consentAgreeButton`  |
| `home*`            | `homePointsLabel`, `homeCouldNotSaveProgressSnack`             |
| `level*`           | `levelGetReady`, `levelTapToRecord`, `levelUploadFailedSnack`  |
| `levelComplete*`   | `levelCompleteCongrats`, `levelCompleteCycleTitle`             |
| `cycleAdvance*`    | `cycleAdvanceOfflineSnack`, `cycleAdvanceFailedSnack`          |
| `leaderboard*`     | `leaderboardTitle`, `leaderboardYouLine`                       |
| `profile*`         | `profileTitle`, `profileConsentLabel`                          |
| `nickname*`        | `nicknameSheetSave`, `nicknameErrorTooShort`                   |
| `notifications*`   | `notificationsEmptyTitle`, `notificationsSampleRankBody`       |

Suffix conventions:

- `*Title` / `*Subtitle` — heading copy
- `*Snack` — snackbar messages (transient toast)
- `*Button` / `*Action` / `*Cta` — button labels
- `*Label` / `*Sublabel` — settings rows
- `*Hint` / `*Placeholder` — input affordances
- `*Error*` — validation messages

When in doubt, read `src/messages/en.json` and match the closest existing key's shape.

## 2. ICU syntax

`next-intl` uses [ICU MessageFormat](https://formatjs.io/docs/core-concepts/icu-syntax). The simple cases used in this project:

### Variable interpolation

```json
"levelQuestionTitle": "How do you call this in\n{language} ?",
"homeCouldNotSaveProgressSnack": "Could not save progress: {error}"
```

Call site:

```ts
t("levelQuestionTitle", { language: langDisplay })
t("homeCouldNotSaveProgressSnack", { error: msg })
```

### Plurals (not yet used; pattern is)

```json
"streakDays": "{count, plural, =0 {No streak yet} one {# day} other {# days}}"
```

```ts
t("streakDays", { count: 3 }) // "3 days"
```

### Select (gendered/categorical)

```json
"profileConsentSublabel": "{state, select, granted {Granted — recordings are uploaded.} other {Revoked — recordings will not be uploaded.}}"
```

In this project we currently use **two separate keys** (`profileConsentSublabelGranted`, `profileConsentSublabelRevoked`) instead of `select`, because translators handle separate keys more reliably. Prefer that pattern unless you genuinely have N>2 cases.

### Newlines

Use literal `\n` in the JSON string. The UI renders them via `whitespace-pre-line` Tailwind class — see `levelQuestionTitle` and the `<h1>` in `src/app/(app)/level/[cycleLevel]/page.tsx:832-837`.

## 3. Calling `t()` — three sites

### a. Client components

```tsx
"use client";
import { useTranslations } from "next-intl";

export default function MyScreen() {
  const t = useTranslations();
  return <button>{t("commonRetry")}</button>;
}
```

Namespacing is supported (`useTranslations("home")` then `t("pointsLabel")`) but **this project does not use namespaces** — keys are already feature-prefixed. Don't introduce one without converting all keys.

### b. Server components / route handlers / `generateMetadata`

```ts
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("homeTabProfile") };
}
```

`getTranslations` is async; `useTranslations` is sync. Don't mix them.

### c. Outside React (stores, API clients, queue runners)

You **cannot** call `t()` directly — there is no React context. Three options:

1. **Pass the translated string in.** The progress-queue runner does this:

   ```ts
   // src/lib/storage/progress-queue-runner.ts
   startProgressQueueRunner({
     getCopy: () => ({ syncFailed: t("progressQueuedSyncFailedSnack") })
   });
   ```

   The caller is in a React tree (e.g. `(app)/layout.tsx`), captures `t` via `useTranslations()`, and passes a `getCopy` callback that the runner invokes when it needs the string.

2. **Read the message lazily inside a hook.** If the value is needed reactively, expose a hook:

   ```ts
   export function useFooLabel() {
     const t = useTranslations();
     return t("fooLabel");
   }
   ```

3. **Hardcode in English as a last resort** — only acceptable for dev-only / debug strings that never reach production users.

## 4. Snackbar pattern

`useSnackbar` (see `src/stores/snackbar.ts`) is imperative. The caller MUST be inside a React tree to have a `t`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useSnackbar } from "@/stores/snackbar";

function SubmitButton() {
  const t = useTranslations();
  const onClick = () => {
    useSnackbar.getState().show(t("homeCouldNotSaveProgressSnack", { error: "boom" }));
  };
  // ...
}
```

`useSnackbar.getState().show(...)` does NOT require a React tree (the store is global) — but `t(...)` does. The snackbar host (`<SnackbarHost>`) is mounted once in `(app)/layout.tsx` so any authenticated screen gets it for free.

## 5. Step-by-step playbook

1. **Pick a key name.** Find the closest existing prefix in `src/messages/en.json`. If you're adding a level snackbar, look at the `level*Snack` family.
2. **Add to `src/messages/en.json`.** Place it next to siblings (group is empty-line-separated).
3. **Add to `src/messages/fr.json`.** Same key, same placeholders, French copy. Keep the same group ordering so diffs stay readable.
4. **Use it in code.** `const t = useTranslations()` (client) or `await getTranslations()` (server).
5. **Verify parity.** Counts must match:

   ```bash
   node -e 'const e=Object.keys(require("./src/messages/en.json")); const f=Object.keys(require("./src/messages/fr.json")); const onlyEn=e.filter(k=>!f.includes(k)); const onlyFr=f.filter(k=>!e.includes(k)); console.log({en:e.length,fr:f.length,onlyEn,onlyFr})'
   ```

   Both arrays must be empty.
6. **Run the verification triad** (see the `build-verify` skill):

   ```bash
   npx tsc --noEmit && npx eslint . && npx next build --webpack
   ```

   `tsc` won't catch missing keys (they're plain strings), but `next build` will fail loudly if the new ICU placeholder count mismatches the call site.

## 6. Common mistakes

- **Adding only to `en.json`.** Runtime error in the French build, no compile-time guard. Always edit both.
- **Reusing a key with a different placeholder set.** `t("foo", { x })` where `foo` was rewritten to use `{y}` — `next-intl` throws `IntlError: MISSING_VAR`. Update every call site when you rename a placeholder.
- **Calling `t()` in a Zustand store body.** No React context → impossible. Pass the string in via an action argument or a `getCopy` callback (see §3c).
- **Forgetting `\n` for multi-line copy.** The `whitespace-pre-line` class is what renders them; they're invisible in raw JSON.
- **Hardcoding inside JSX during a refactor.** Every user-visible string passes through `t()`. Search for stray quoted English strings before committing: `npx eslint .` will flag many of them via `react/jsx-no-literals`-adjacent rules but not all — grep manually if you suspect any.
