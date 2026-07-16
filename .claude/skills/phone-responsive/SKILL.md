---
name: phone-responsive
description: Narrow-phone (320–379px) responsive audit and fix workflow for the 480px-locked PWA frame using the phone-sm Tailwind variant. USE FOR: layouts breaking on iPhone SE 1st gen / Galaxy Fold cover / older Androids, content overflowing horizontally at 320px, mic button or action buttons too large for narrow screens, text wrapping awkwardly, padding/margin compounding, step bars becoming illegible, choosing base-vs-phone-sm values, touch-target sizing within iOS/Android minimums. Trigger phrases: "phone-sm", "narrow phone", "320px", "iPhone SE", "Galaxy Fold", "doesn't fit on small screen", "responsive audit", "overflow x", "mic button too big", "horizontal scroll on phone". DO NOT USE FOR: tablet or desktop layouts (this PWA is hard-locked to a 480px max-width frame and never adds md:/lg: variants), accessibility a11y issues unrelated to size (use a separate workflow), or printing/styling for non-phone form factors.
---

# Narrow-phone responsive workflow

This PWA is wrapped in `mx-auto max-w-[480px]` at the layout root, so the entire visible canvas is **at most 480px wide**. We only ever design for phones. The responsive scope therefore collapses to a single binary:

- **Default styles** target 380–480px (typical modern phones, iPhone 13+, Pixel 6+, etc.).
- **`phone-sm:` variant** targets **viewports ≤ 379px** (iPhone SE 1st gen 320×568, Galaxy Fold cover ~280×653, smaller Androids).

Everything wider than 480px shows the same 480px frame centred with letterboxing this is intentional. **Never add `md:`, `lg:`, `xl:`, or `2xl:` variants in this codebase.** If you find one, delete it.

## The variant definition

Defined in `src/app/globals.css`:

```css
@custom-variant phone-sm (@media (max-width: 379px));
```

That's a Tailwind v4 `@custom-variant` directive, equivalent to `@media (max-width: 379px)`. Use it as:

```tsx
<button className="h-[100px] w-[100px] phone-sm:h-[88px] phone-sm:w-[88px]" />
<p className="text-[18px] phone-sm:text-[15px]" />
<div className="px-6 phone-sm:px-4" />
```

The base value is the "normal phone" size; `phone-sm:` overrides it for narrow phones.

## What to scrutinize

When you write or review a phone-screen component, walk through the file and ask "does this fit at 320px?" for each of:

### 1. Fixed pixel sizes that would overflow

The mic button on the level screen is 100×100. At 320px wide with `px-6` (=24px each side), the available content width is 272px 100px fits, but combined with the surrounding waveform and labels there's no breathing room. The fix in `src/app/(app)/level/[cycleLevel]/page.tsx:901`:

```tsx
className="relative flex h-[100px] w-[100px] items-center justify-center rounded-full phone-sm:h-[88px] phone-sm:w-[88px]"
```

12px shaved off each dimension. Action buttons (Retake/Listen/Submit) follow the same pattern base `h-[72px] w-[72px]`, `phone-sm:h-[64px] phone-sm:w-[64px]` (page.tsx:1054).

### 2. Horizontal padding that compounds

Inner padding on parents stacks. A `px-6` on a screen + `px-6` on a card = 48px gone from the available width. On a 320px viewport that leaves 272px for content. Reduce to `px-4` (16px) on narrow phones:

```tsx
<div className="flex flex-col items-center px-6 phone-sm:px-4">
```

The Skip button in the TopBar uses `px-3 py-2 ... phone-sm:px-2` (page.tsx:780) for the same reason recovers ~8px on each side.

### 3. Large text that wraps awkwardly

The level-screen H1 is 32px black weight on the question card title. At 320px with two-line wrap, descenders collide with the next line and the overall block dominates the viewport. Fix:

```tsx
<h1 className="text-[32px] font-black leading-tight ... phone-sm:text-[24px]">
  {titleTemplate}
</h1>
```

Body copy similarly: `text-[18px] phone-sm:text-[15px]` (page.tsx:839 for the prompt text).

### 4. Step bars / progress dots becoming illegible

The level top-bar step indicator is a `FractionallySizedBox` at 60% in Flutter; in the PWA that's `w-3/5`. At 320px viewport with `px-2` from the TopBar, 60% is roughly 187px divided across 8 steps that's 23px per dot, with gaps. Fine for 4-step levels, cramped for 8. Override:

```tsx
<div className="w-3/5 phone-sm:w-4/5">
  <StepBar total={totalSteps} current={currentStep} />
</div>
```

(page.tsx:773) Going to 80% width preserves dot legibility on narrow phones at the cost of pushing the Skip button slightly right acceptable because the back button on the left is also tightened with `phone-sm:px-2`.

### 5. Action button labels under buttons

The Retake/Listen/Submit row has labels under each circular button. At 13px on narrow phones they fit cleanly under the 64px button; at the base 15px under a 72px button they're proportionally similar. Already handled in `ActionButton` (page.tsx:1064):

```tsx
<span className="line-clamp-2 text-center text-[15px] font-semibold text-white phone-sm:text-[13px]">{label}</span>
```

Note `line-clamp-2` is the safety net long translations (German, Swahili) wrap to two lines without overflowing the `max-w-[88px]` outer.

## Touch-target minimums

- iOS HIG: **44×44pt**
- Material Design (Android): **48×48dp**

These are the floor. `phone-sm:h-[88px] w-[88px]` (mic button shrunk) is well above. `phone-sm:h-[64px] w-[64px]` (action buttons shrunk) is also fine. **Don't shrink interactive elements below 44×44 even on the narrowest phones** if your design needs that, change the layout (stack instead of row, drop the label, etc.).

The TopBar Skip button uses `px-2 py-2 text-[15px]`. With ~15px text + 16px horizontal padding, the hit area is ~47×33. Vertical is the constraint if you ever shrink Skip further, raise vertical padding to keep it tappable.

## Audit playbook

When a screen is reported as broken on narrow phones, or before merging a new screen:

1. **Open the route file** (e.g. `src/app/(app)/<route>/page.tsx`).
2. **Grep for fixed-pixel values**: `h-[`, `w-[`, `text-[`, `px-`, `py-`, `gap-`, `rounded-[`. Scan each one and ask:
   - Is this >= 60px? Probably needs `phone-sm:` variant.
   - Is the text >= 20px? Probably needs to shrink at 320px.
   - Is the padding >= 5 (=20px)? Probably needs to shrink.
3. **Open Chrome DevTools** → Toggle device toolbar (`Ctrl+Shift+M`) → set **Responsive** → width **320**, height **568** (iPhone SE 1st gen). Walk every interactive state of the screen at this size.
4. **Check secondary states**: the recording timer adds height, the review row replaces the mic button both states must fit. The countdown digit (`text-[56px] phone-sm:text-[48px]`, page.tsx:915) is rendered inside the mic button; its base size would overflow the shrunk 88px circle without the override.
5. **Look for horizontal scroll**: if the body has any horizontal scrollbar at 320px, something's overflowing. Common culprits: a fixed-width child of a flex row, a `min-w-` larger than the viewport, an absolute-positioned element with `right-[-4px]` (the StepBar dot uses this fine because the parent is `relative` and clips).
6. **Repeat at 280px** (Galaxy Fold cover). If it still works, ship it. If not, decide: is Galaxy Fold a supported platform for this feature? (Usually no 320 is the floor.)

## What you should NOT do

- ❌ Add `md:` / `lg:` / `xl:` / `2xl:` the frame is locked at 480px max.
- ❌ Use `sm:` for "small phones" Tailwind's `sm:` is `min-width: 640px`, the **opposite** of what you want here. Use `phone-sm:`.
- ❌ Use percentage widths for things that need to be touch targets (a 50% width button at 320px is 160px wide, fine; at unknown-future 240px viewports it's 120px, still fine but a 25% width button at 320px is 80px which is OK, and at 240px is 60px which is borderline). Prefer fixed-px with `phone-sm:` overrides for buttons.
- ❌ Pick `phone-sm:` values that are < 44px tall on touch targets.
- ❌ Use `clamp()` or viewport units (`vw`, `vh`) for typography unless you've measured the result at both 320 and 480 they often look great at one size and broken at the other.

## Reference: the level screen as a worked example

`src/app/(app)/level/[cycleLevel]/page.tsx` is the densest example in the codebase. Look at it for the canonical patterns:

| Element | Base | phone-sm |
|---|---|---|
| Mic button | `h-[100px] w-[100px]` | `phone-sm:h-[88px] phone-sm:w-[88px]` |
| Countdown digit | `text-[56px]` | `phone-sm:text-[48px]` |
| Action buttons | `h-[72px] w-[72px]` | `phone-sm:h-[64px] phone-sm:w-[64px]` |
| Action label | `text-[15px]` | `phone-sm:text-[13px]` |
| Question H1 | `text-[32px]` | `phone-sm:text-[24px]` |
| Prompt body | `text-[18px]` | `phone-sm:text-[15px]` |
| QuestionContent padding | `px-6` | `phone-sm:px-4` |
| Step bar width | `w-3/5` | `phone-sm:w-4/5` |
| Skip button | `px-3 ... text-[18px]` | `phone-sm:px-2 phone-sm:text-[15px]` |

If you're unsure, **copy these proportions** rather than inventing new ones visual consistency across screens matters more than per-screen optimisation.

## Decision flowchart for a new fixed-pixel value

When you write `text-[Npx]`, `h-[Npx]`, `w-[Npx]`, `px-N`, `py-N`, `gap-N`:

1. Is the value text? Look up the table:
   - `text-[12px]`–`text-[14px]`: never needs `phone-sm:` (already small).
   - `text-[15px]`–`text-[18px]`: usually leave as-is unless wrapping issues at 320px.
   - `text-[20px]`–`text-[24px]`: consider `phone-sm:` shrink to next step down.
   - `text-[28px]`+: almost always needs a `phone-sm:` value 6–10px smaller.
2. Is the value a touch target dimension (`h-[Npx]` or `w-[Npx]` on a button)?
   - < 44px: refuse accessibility floor.
   - 44–60px: usually no `phone-sm:` needed.
   - 60–80px: borderline; check at 320 in DevTools.
   - 80px+: needs `phone-sm:` ~12% smaller, never below 60px.
3. Is it padding/gap?
   - `*-1` to `*-3` (4–12px): never shrink.
   - `*-4` (16px): rarely shrink.
   - `*-5` (20px) to `*-6` (24px): consider `phone-sm:px-4` / `phone-sm:px-3`.
   - `*-8` (32px)+: almost always needs a phone-sm shrink.

## Pixel budgets to hold in your head

At 320px viewport with the typical screen frame `px-6 phone-sm:px-4`:

- Available content width: **288px** (320 − 16 − 16).
- A row with three 64px circular buttons + their `max-w-[88px]` label wrappers fills exactly: 88 × 3 = 264px, gaps 24px → 288. Tight but fits.
- A single-line label inside `max-w-[88px]` at `text-[13px]` ≈ 11 chars before wrap. Translations longer than that need `line-clamp-2` (already set).

At 280px (Galaxy Fold cover) with `phone-sm:px-3`:

- Available: 280 − 24 = **256px**.
- The three-button row above no longer fits with gaps. Galaxy Fold is **not currently a supported viewport** don't optimise for it unless explicitly requested. If you must, drop label visibility entirely on `<280px` and rely on icons + aria-labels.

## Manual QA matrix

When merging a screen change, flip through these in DevTools device toolbar:

| Device | Width | Why |
|---|---|---|
| iPhone SE (1st gen) | 320 | Floor of `phone-sm` range; iOS quirks |
| iPhone 13 mini | 375 | Just inside `phone-sm` upper edge |
| iPhone 13 / 14 | 390 | Most-common iOS size, base styles |
| Pixel 5 | 393 | Common Android, base styles |
| Pixel 7 | 412 | Wider Android, base styles |
| Galaxy S20 Ultra | 412 | Tall variant of above |
| Frame max | 480 | Upper bound of the locked frame |

If all 7 look correct, ship. If only 320 looks broken, add a `phone-sm:` override. If 480 looks broken but smaller don't, you have an unrelated layout bug don't reach for `md:` to fix it.

## Adding a NEW custom variant

Don't, unless there's a clear product reason and team agreement. The cost of a new variant is:

- Every contributor has to learn another breakpoint.
- Every screen audit grows in dimensions.
- Tailwind v4's `@custom-variant` is global to the codebase.

If you genuinely need a third tier (e.g. a dedicated "tall narrow" variant for Galaxy Fold), define it in `globals.css` next to `phone-sm` with a clear name like `phone-tiny`. Document the px range in the comment above. Update this skill to add it to the audit table.
