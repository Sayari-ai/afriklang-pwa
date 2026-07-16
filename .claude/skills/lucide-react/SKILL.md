---
name: lucide-react
description: Lucide is a fork of Feather Icons providing 1000+ tree-shakable SVG icon components for React. The version on disk (1.14.0) is the modern Lucide React package despite the unusual major version number, it is the standard tree-shakable API exported by lucide-icons/lucide. USE FOR: bottom-nav icons, button glyphs, status indicators, any inline SVG icon need. DO NOT USE FOR: app branding / logos (use dedicated SVG files), illustration-grade artwork (use proper assets), animated icons (write custom SVG).
---

# lucide-react@^1.14.0

## When to use

This project currently uses lucide-react in **one file**: `src/components/bottom-nav.tsx:20`:

```tsx
import { Home, Trophy, Bell, User, type LucideIcon } from 'lucide-react';
```

Every other icon in the app is a hand-rolled inline SVG (see `leaderboard/page.tsx` `TrophyIcon`, `CloudOffIcon`, `HourglassIcon`, `RefreshIcon`). The mixed approach is intentional:

- **Use lucide-react** when you need a recognisable, conventional icon and don't want to draw it yourself. Bottom-nav tab icons fit this exactly.
- **Use inline SVG** when the icon needs custom paths, exact pixel-perfect tuning, or fill-based (rather than stroke-based) artwork. The `TrophyIcon` in `leaderboard/page.tsx` uses a Material-style filled glyph that doesn't match Lucide's stroke aesthetic.

If you're adding a new icon that exists in Lucide and the stroke style is acceptable, prefer Lucide over inlining.

## Note on the version number

`lucide-react@1.14.0` looks like an old version, but it isn't. The Lucide team reset their versioning at some point the package on disk is from the modern `lucide-icons/lucide` monorepo and exposes the standard tree-shakable API:

```ts
// node_modules/lucide-react/dist/lucide-react.d.ts
interface LucideProps extends ElementAttributes {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}
type LucideIcon = ForwardRefExoticComponent<...>;

declare const AArrowDown: ForwardRefExoticComponent<...>;
// ... 1000+ named exports
```

So use it as you would the current Lucide React docs at https://lucide.dev/guide/packages/lucide-react.

## API reference

### Importing icons

Each icon is a named export **always destructure**, never import the whole package:

```tsx
import { Home, Trophy, Bell, User } from 'lucide-react';
```

Tree-shaking works because the package has `"sideEffects": false` in `package.json` and ships ESM. Webpack/Turbopack will drop unused icons from the bundle.

**Don't** do `import * as Icons from 'lucide-react'` that defeats tree-shaking and pulls all 1000+ icons into the bundle.

### `LucideIcon` the icon type

For props that accept any icon component:

```tsx
import { Home, type LucideIcon } from 'lucide-react';

interface TabProps {
  icon: LucideIcon;  // any icon export from lucide-react
  label: string;
}

function Tab({ icon: Icon, label }: TabProps) {
  return <><Icon size={24} /> {label}</>;
}

<Tab icon={Home} label="Home" />
```

This is exactly the pattern used in `bottom-nav.tsx` the tabs config is a typed array of `{ icon: LucideIcon, ... }`.

### Props

All icons accept:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `size` | `number \| string` | `24` | Sets `width` and `height` simultaneously. Pass a number for px or a string for any CSS unit. |
| `color` | `string` | `'currentColor'` | Stroke color. Defaults to `currentColor` so CSS `color` cascades. |
| `strokeWidth` | `number \| string` | `2` | Stroke thickness. Bump to 1.5 for a lighter look, or 2.5 for emphasis. |
| `absoluteStrokeWidth` | `boolean` | `false` | When `true`, the stroke width stays at `strokeWidth` px regardless of `size`. Default behaviour scales with size. |
| `className` | `string` | | Standard React className works with Tailwind. |
| `aria-hidden` | `boolean` | | Set when the icon is decorative (paired with adjacent text). |
| `aria-label` | `string` | | Set when the icon stands alone (no adjacent text). |

Plus all standard SVG props (`onClick`, `style`, `ref`, `data-*`, etc.) icons are `ForwardRefExoticComponent<SVGProps<SVGSVGElement>>`.

## Common patterns (project-specific)

### Tab-bar icon with `LucideIcon` type

```tsx
// Pattern from src/components/bottom-nav.tsx
import { Home, Trophy, Bell, User, type LucideIcon } from 'lucide-react';

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
}

const tabs: Tab[] = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/profile', label: 'Profile', icon: User },
];

// In render:
{tabs.map(({ icon: Icon, label, href }) => (
  <Link key={href} href={href}>
    <Icon size={24} aria-hidden />
    <span>{label}</span>
  </Link>
))}
```

### Color via Tailwind / `currentColor`

Default `color="currentColor"` means the icon inherits the surrounding text color. Drive it with Tailwind:

```tsx
<button className="text-white hover:text-yellow-300">
  <Bell size={20} />  {/* picks up text-white / text-yellow-300 */}
</button>
```

Don't pass `color="white"` if you can use `text-white` on the parent the className approach lets hover/focus states work without prop juggling.

### Accessibility

**Decorative icon** (paired with visible text):

```tsx
<button>
  <Trophy aria-hidden size={16} /> Leaderboard
</button>
```

**Standalone icon** (no adjacent text):

```tsx
<button aria-label="Refresh">
  <RefreshCw size={20} />
</button>
```

If the icon is purely visual but has no text label, the parent button needs `aria-label`; the icon itself doesn't need one (and shouldn't have both that's redundant for screen readers).

### Sizing for hi-DPI / responsive

For Tailwind-based responsive sizing, prefer `className="h-6 w-6 phone-sm:h-5 phone-sm:w-5"` over JS-based size juggling. Set `size` as a fallback only for non-CSS contexts.

## Gotchas

- **Don't `import *`** kills tree-shaking; pulls in the full ~250 KB of icon definitions instead of just the ones you use.
- **`size` overrides Tailwind `h-*`/`w-*`**: the prop sets `width`/`height` SVG attributes which take precedence over CSS unless you use `!important`. Pick one approach per icon and stick with it.
- **`color` overrides `currentColor`**: passing `color="..."` disables Tailwind text-color inheritance. If you want CSS color to win, **omit** the `color` prop entirely.
- **No fill icons by default**: Lucide is stroke-based. If you want a filled look, you'll need to draw it yourself (see the `TrophyIcon` in `leaderboard/page.tsx` for an example of when to skip Lucide).
- **PascalCase names**: file system naming on https://lucide.dev/icons/ uses `kebab-case` (`a-arrow-down`); the React export is `PascalCase` (`AArrowDown`). Convert at import time.
- **TypeScript strict mode + `LucideIcon` type**: `LucideIcon` is a `ForwardRefExoticComponent` you can't trivially substitute a function component with a different signature. If you need to mix Lucide and custom icons in the same array, type the array as `ComponentType<{ size?: number }>` or similar.
- **SSR**: lucide-react ships ESM and CJS. Both work in Next.js; no special handling needed.

## References

- Docs: https://lucide.dev/guide/packages/lucide-react
- Icon catalogue: https://lucide.dev/icons/
- GitHub: https://github.com/lucide-icons/lucide/tree/main/packages/lucide-react
- Project usage: `src/components/bottom-nav.tsx:20`
