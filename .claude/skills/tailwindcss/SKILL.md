---
name: tailwindcss
description: Tailwind CSS v4 (CSS-first, no JS config) — utility-first CSS framework consumed via the @tailwindcss/postcss plugin. USE FOR: writing utilities, defining custom theme tokens, adding @custom-variant / @utility, opacity modifiers, container queries, arbitrary values, dark-mode strategy, debugging unknown classes, migrating v3 patterns. DO NOT USE FOR: editing tailwind.config.js (does not exist in v4), v3-style @tailwind base/components/utilities directives, JIT safelist arrays, the `theme()` plugin API, or anything from `tailwindcss/plugin`.
---

# tailwindcss@^4 (+ @tailwindcss/postcss@^4)

> **CRITICAL: This is Tailwind v4, not v3.** v4 is a full rewrite with a **CSS-first** config model. There is **no `tailwind.config.js`**. There are **no `@tailwind base; @tailwind components; @tailwind utilities;` directives**. Most LLM training data shows v3 — assume your instinct is wrong and check this doc first. Browser targets: Safari 16.4+, Chrome 111+, Firefox 128+.

## When to use
- Adding/styling any UI in this PWA (`src/app/**`, `src/components/**`).
- Introducing a new design token (color, font, spacing) → add it under `@theme inline { … }` in `src/app/globals.css`.
- Adding a project-wide variant (e.g. responsive breakpoint, attribute selector) → `@custom-variant`.
- Adding a project-wide utility class (e.g. safe-area helper) → `@utility`.
- Debugging "class not generating" → almost always source-detection or you're writing v3 syntax.

## Setup in this project (verbatim)

### `postcss.config.mjs`
The only PostCSS plugin is `@tailwindcss/postcss`. v4 handles `@import` resolution and vendor prefixing internally — **do not** add `postcss-import` or `autoprefixer`.
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

### `src/app/globals.css` (single source of truth)
```css
@import "tailwindcss";

/* Custom narrow-phone variant (≤379px). Use as `phone-sm:text-2xl`. */
@custom-variant phone-sm (@media (max-width: 379px));

/* Custom utility — Tailwind v4 ships no built-in `pb-safe`. */
@utility pb-safe {
  padding-bottom: max(env(safe-area-inset-bottom), 0.75rem);
}

:root {
  --color-primary: #00539f;
  --color-brand-primary: var(--color-primary);
  --color-record-active: #e53935;
  /* …more raw tokens… */
}

@theme inline {
  --font-sans: var(--font-satoshi);   /* set by next/font/local */
  --color-primary: var(--color-primary);
  --color-record-active: var(--color-record-active);
  /* expose every raw token here so utilities like `bg-primary`,
     `text-record-active`, `font-sans` are generated. */
}
```

Import path (in `src/app/layout.tsx`):
```ts
import "./globals.css";
```

### Package versions (`package.json`)
```json
{
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4"
  }
}
```

There is **no** `tailwind.config.js`, `tailwind.config.ts`, or `tailwind.config.mjs` in this repo — and there should not be one.

## API / feature reference

### The single import
```css
@import "tailwindcss";
```
Replaces v3's three `@tailwind` directives. This single line:
1. Loads Preflight (base reset).
2. Registers all utility classes.
3. Triggers automatic source detection (no `content` array).
4. Emits the theme variables registered via `@theme`.

You can split the import for finer control:
```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css" layer(utilities);
```

### `@theme` — the new "config"
v4 configuration lives in CSS. Every `@theme` token becomes both a CSS variable on `:root` **and** a generator for matching utilities.

```css
@theme {
  --color-mint-500: oklch(0.72 0.11 178);
  --font-display: "Satoshi", sans-serif;
  --breakpoint-3xl: 120rem;
  --spacing-128: 32rem;
}
```
This automatically produces:
- Color utilities: `bg-mint-500`, `text-mint-500`, `border-mint-500`, `ring-mint-500`, `from-mint-500`, …
- Opacity modifier: `bg-mint-500/50` (works on **any** color via `color-mix()`).
- Font: `font-display`.
- Breakpoint: `3xl:flex`, `max-3xl:hidden`, `min-3xl:*` …
- Spacing: `p-128`, `mt-128`, `w-128`, `gap-128`.

**`@theme inline`** (used in this project): inlines the value of any referenced CSS variable so Tailwind doesn't add a layer of `var()` indirection in generated utilities. Use it when the source token is already a `:root` variable you also want to mutate at runtime (theming, font swaps via `next/font`).

Token namespaces Tailwind recognises:
| Namespace | Generates |
|---|---|
| `--color-*` | `bg-*`, `text-*`, `border-*`, `ring-*`, `outline-*`, `fill-*`, `stroke-*`, gradient stops, … |
| `--font-*` | `font-*` (font-family) |
| `--text-*` | `text-*` (font-size, with optional line-height) |
| `--font-weight-*` | `font-*` (weight) |
| `--leading-*` / `--tracking-*` | line-height / letter-spacing |
| `--breakpoint-*` | responsive variants `<name>:` and `max-<name>:` |
| `--container-*` | container-query sizes (`@<name>:`) and `max-w-*` widths |
| `--spacing-*` | every spacing utility (`p`, `m`, `gap`, `w`, `h`, `inset`, …) |
| `--radius-*` | `rounded-*` |
| `--shadow-*` / `--inset-shadow-*` / `--drop-shadow-*` | shadows |
| `--blur-*` | `blur-*` |
| `--ease-*` / `--animate-*` | transition / animation |
| `--default-font-family` | overrides preflight |

### `@custom-variant`
Defines a reusable variant prefix.
```css
/* This project: */
@custom-variant phone-sm (@media (max-width: 379px));

/* More examples: */
@custom-variant theme-midnight (&:where([data-theme="midnight"] *));
@custom-variant any-hover (@media (any-hover: hover));
```
Usage: `phone-sm:text-2xl`, `theme-midnight:bg-zinc-950`.

### `@utility`
Registers a custom utility that participates correctly in the cascade and supports all variants.
```css
@utility pb-safe {
  padding-bottom: max(env(safe-area-inset-bottom), 0.75rem);
}

/* Functional utility with a value (matches `tab-2`, `tab-4`, `tab-[7]`): */
@utility tab-* {
  tab-size: --value(integer);
}
```
**Replaces** the v3 idiom of `@layer utilities { .my-class { … } }`. The `@layer utilities` form still parses but no longer registers the rule as a true Tailwind utility (no variant support, no automatic sorting).

### `@layer`
v4 uses **native CSS cascade layers**. The default order is:
```css
@layer theme, base, components, utilities;
```
Use `@layer base { … }` for your own resets/element styles. **Do not** put utilities inside `@layer utilities` — use `@utility` instead.

### Automatic source detection
v4 automatically scans the project from the location of the CSS file: it follows `.gitignore`, ignores binary/lockfile/vendor paths, and treats every other text file as a potential class source. **There is no `content: [...]` array.** No purge, no safelist config.

To opt-in or opt-out manually:
```css
@source "../../some/external/dir";          /* add a path */
@source not "../../legacy";                  /* exclude a path */
@source inline("bg-red-500 bg-red-600");     /* safelist literal classes */
```

### Dark mode
Default v4 behaviour uses the `prefers-color-scheme` media query under the `dark:` variant. To switch to a class- or attribute-based strategy, redefine the variant:
```css
/* Class strategy */
@custom-variant dark (&:where(.dark, .dark *));

/* Attribute strategy (preferred, plays nicely with SSR) */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```
This project currently has no dark mode — ship a `@custom-variant dark` block in `globals.css` if/when needed.

### Opacity modifier syntax (universal)
```html
<div class="bg-primary/50 text-white/80 border-mint-500/25">
```
Works on **any** `--color-*` token (no per-color setup, unlike v3). Implemented under the hood with `color-mix(in oklab, …)`.

### Arbitrary values
Square brackets for literals, parentheses for CSS variables (note: changed from v3):
```html
<div class="grid-cols-[max-content_auto] bg-(--color-brand-primary) w-[clamp(0px,50vw,32rem)]">
```
- v3 `bg-[--brand-color]` → v4 `bg-(--brand-color)`.
- Spaces inside arbitrary values are written with underscores (`max-content_auto`).

### Dynamic utility values (no theme entry needed)
Many utilities accept any number on the spacing or numeric scale without registering it:
```html
<div class="mt-17 grid-cols-15 data-[state=open]:opacity-90">
```

### Container queries (built-in, no plugin)
```html
<div class="@container">
  <div class="@md:flex @lg:grid-cols-3">…</div>
</div>
```
Sizes come from `--container-*` theme tokens. Use `@max-md:`, `@min-lg:` for ranges.

### 3D transforms
First-class in v4: `rotate-x-45`, `rotate-y-180`, `rotate-z-12`, `translate-z-12`, `scale-z-50`, `perspective-distant`, `perspective-origin-top-left`, `transform-3d`, `backface-hidden`. The plain `rotate-*`, `scale-*`, `translate-*` utilities now compile to the **individual** CSS properties (`rotate`, `scale`, `translate`), not a composed `transform`.

### Gradients (renamed in v4)
- v3 `bg-gradient-to-r` → v4 `bg-linear-to-r` (the older alias still works for compatibility).
- New conic / radial helpers: `bg-radial-[at_25%_25%]`, `bg-conic-from-blue-500`.
- Variants now **preserve** prior stops: `dark:from-blue-500` won't wipe `to-yellow-400`. To unset a `via-*` stop in dark mode, use `dark:via-none`.
- Interpolation modifier: `bg-linear-to-r/oklch from-indigo-500 to-pink-500` mixes in OKLCH for perceptually smoother gradients (defaults are `srgb`).

### Animations
Built-in animations remain `animate-spin`, `animate-ping`, `animate-pulse`, `animate-bounce`. Add custom ones via `@theme`:
```css
@theme {
  --animate-wiggle: wiggle 1s ease-in-out infinite;
}
@keyframes wiggle {
  0%, 100% { transform: rotate(-3deg); }
  50%      { transform: rotate(3deg); }
}
```
Now `animate-wiggle` exists. Pair with `motion-safe:` / `motion-reduce:` to honour user preferences.

### Container queries — deeper look
```html
<article class="@container">
  <header class="@sm:flex @md:gap-6 @lg:grid-cols-2">…</header>
  <p class="@max-md:text-sm">…</p>
</article>
```
- Default named sizes (`@sm`, `@md`, …) come from `--container-*` tokens — by default the same xs→7xl scale as widths.
- Arbitrary container sizes: `@[28rem]:flex`.
- Named containers (multiple nested `@container`): `@container/sidebar` then `@md/sidebar:hidden`.

### Source detection edge cases
v4 auto-scans following these rules:
- Walks the project from the CSS file's location upward to the nearest `package.json`-rooted directory, then recurses down.
- Respects `.gitignore` (so `node_modules/`, `.next/`, etc. are skipped automatically).
- Skips files whose extension matches a known binary/lockfile/vendor list.

If a class isn't being generated:
1. **Don't construct class names dynamically** at the substring level — Tailwind matches *whole* class strings in source. `` `bg-${color}-500` `` won't be detected. Use full literals (`bg-red-500`, `bg-blue-500`) or `@source inline("bg-{red,blue,green}-500")`.
2. Make sure the file is checked into git (untracked files matching `.gitignore` rules may be skipped).
3. Add `@source "../path"` for files outside the project root (e.g. a sibling design-system package).

### Other v4-only features worth knowing
- `not-*` variant: `not-hover:opacity-70`, `not-supports-[...]:hidden`.
- `in-*` variant for descendant matching: `in-data-[loading]:animate-pulse`.
- `*` direct-child variant: `*:p-2` styles every direct child.
- `**` descendant variant (TS-style): `**:[svg]:size-4`.
- `starting:` variant for `@starting-style` transitions.
- `@starting-style` works with `transition-discrete`.
- `field-sizing-content` for auto-sizing textareas.
- Text-shadow utilities: `text-shadow-sm`, `text-shadow-lg`, `text-shadow-(--my-shadow)`.
- Mask utilities: `mask-radial-from-*`, `mask-linear-to-*`, etc.
- `inset-shadow-*` and `inset-ring-*` for inner shadows / rings.
- Logical-property utilities first-class: `ps-4` (padding-inline-start), `me-2`, `border-s`, `text-start`, `rounded-ss-lg`.

### `@reference` (CSS Modules / scoped styles)
Not used in this project (we don't have CSS Modules), but if a future component imports a separate stylesheet that needs `@apply`:
```css
/* component.module.css */
@reference "../app/globals.css";
.title { @apply text-xl font-bold text-primary; }
```
`@reference` makes Tailwind's theme tokens, custom variants and utilities visible **without** duplicating their CSS into the bundle.

## Common patterns (this project)

### Using a project token in a component
```tsx
// Tailwind utility (preferred):
<button className="bg-primary text-white hover:bg-primary/90 rounded-xl px-4 py-2">…</button>

// Inline CSS variable (when you need a gradient or computed color):
<div style={{ background: "var(--color-brand-primary)" }} />
```

### Narrow-phone overrides
```tsx
<h1 className="text-3xl phone-sm:text-2xl">Welcome</h1>
<button className="px-6 py-3 phone-sm:px-4 phone-sm:py-2">Start</button>
```

### Safe-area bottom padding (custom utility)
```tsx
<footer className="pb-safe sticky bottom-0 bg-black/80">…</footer>
```

### Adding a new color token
1. Add the raw value to `:root` in `globals.css`.
2. Mirror it inside `@theme inline { --color-<name>: var(--color-<name>); }`.
3. The class `bg-<name>`, `text-<name>`, `border-<name>`, etc. exist immediately.

### Conditional classes (with `clsx` style helpers — none installed yet)
```tsx
<div className={`rounded-lg p-4 ${isActive ? "bg-record-active" : "bg-record-idle"}`} />
```

### Font integration with `next/font`
`src/lib/fonts.ts` defines `next/font/local` with `variable: "--font-satoshi"`. The variable class is applied to `<html>` in `layout.tsx`, then exposed to Tailwind via:
```css
@theme inline { --font-sans: var(--font-satoshi); }
```
…which generates `font-sans` and makes Satoshi the default `body` font.

## Gotchas (v3 → v4 traps)

1. **No `tailwind.config.js`.** If you create one, Tailwind v4 ignores it unless you opt in with `@config "./tailwind.config.js"` in CSS — and even then `corePlugins`, `safelist`, and `separator` are unsupported. Don't introduce one.
2. **No `@tailwind base/components/utilities;`.** Use the single `@import "tailwindcss";`.
3. **No JS plugin API for the common case.** No `tailwindcss/plugin`, no `addUtilities()`. Use `@utility`, `@custom-variant`, `@theme` from CSS.
4. **No `content: [...]` / `safelist`.** Source detection is automatic; safelist via `@source inline("…")` if absolutely needed.
5. **No `purge`** (was already gone in v3, but worth restating).
6. **Renamed scale defaults** (silently visual breaking):
   - `shadow` → renders like old `shadow-sm`. Old `shadow-sm` → use `shadow-xs`.
   - `rounded` → renders like old `rounded-sm`. Old `rounded-sm` → use `rounded-xs`.
   - `blur`, `drop-shadow`, `backdrop-blur` follow the same shift.
   - `ring` was 3px in v3, now 1px. Old `ring` → `ring-3`.
   - `outline-none` → `outline-hidden` (the new `outline-none` truly sets `outline-style: none`).
7. **Default border / ring / divide color is now `currentColor`**, not `gray-200` / `blue-500`. Always specify a color: `border border-zinc-200`.
8. **Buttons no longer get `cursor: pointer`** by default (Preflight matches the browser). Add it back globally in `@layer base` if you want it.
9. **`hidden` HTML attribute beats `block`/`flex`** classes now. Remove the attribute, don't override with `block`.
10. **Arbitrary CSS variables**: `bg-[--x]` is dead, use `bg-(--x)`.
11. **Variant stacking order is left-to-right**, not right-to-left. `*:first:pt-0`, not `first:*:pt-0`.
12. **Gradients keep prior stops across variants.** `dark:from-blue-500` no longer wipes `to-yellow-400`. Use `dark:via-none` etc. to "unset".
13. **`hover:` only fires on devices with `(hover: hover)`.** Touch tap no longer triggers `hover:`. If you need legacy behaviour: `@custom-variant hover (&:hover);`.
14. **`space-x-*` / `space-y-*` / `divide-*` selectors changed** to `> :not(:last-child)`. Prefer `flex gap-*` going forward.
15. **`@apply` doesn't work in CSS-Modules / Vue `<style>` blocks** without `@reference "../../app.css";` first. In this Next.js project we don't use CSS Modules — keep utilities in JSX className strings.
16. **No Sass/Less/Stylus.** Tailwind v4 IS your preprocessor. This repo does not use them.
17. **Important modifier moved to the end**: `bg-red-500!`, not `!bg-red-500` (old form still parses but is deprecated).
18. **Removed deprecated utilities**: `bg-opacity-*`, `text-opacity-*`, `flex-shrink-*`, `flex-grow-*`, `overflow-ellipsis`, `decoration-slice/clone`. Use the modern equivalents (`bg-black/50`, `shrink-*`, `grow-*`, `text-ellipsis`, `box-decoration-*`).
19. **`theme()` function in CSS**: prefer the generated CSS variable (`var(--color-red-500)`); when you must use `theme()`, pass the variable name (`theme(--breakpoint-xl)`), not the dotted v3 path (`theme(screens.xl)`).
20. **Browser support** is modern-only — `@property`, `color-mix()`, cascade layers. Don't try to support IE11/Safari 15.

## References
- Project setup: `src/app/globals.css`, `postcss.config.mjs`, `package.json`.
- Tailwind v4 docs (canonical): https://tailwindcss.com/docs
- PostCSS install: https://tailwindcss.com/docs/installation/using-postcss
- v3 → v4 upgrade: https://tailwindcss.com/docs/upgrade-guide
- Theme variables: https://tailwindcss.com/docs/theme
- Functions & directives (`@theme`, `@utility`, `@custom-variant`, `@source`, `@reference`, `@config`): https://tailwindcss.com/docs/functions-and-directives
- Adding custom styles: https://tailwindcss.com/docs/adding-custom-styles
- Detecting classes (source detection / safelisting): https://tailwindcss.com/docs/detecting-classes-in-source-files
- Dark mode strategies: https://tailwindcss.com/docs/dark-mode
