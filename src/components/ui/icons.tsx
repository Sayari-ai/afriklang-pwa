import { Palette } from "@/lib/colors";

/**
 * Small flat inline icons coin, lock, mic drawn as SVG so they
 * match the flat game palette exactly. Colors are hex from `Palette`
 * (SVG presentation attributes don't resolve CSS `var()`).
 */

/** Flat gold coin with an embossed star the points currency. */
export function CoinIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 36 36" aria-hidden className={className} style={style}>
      <circle cx="18" cy="18" r="16" fill={Palette.yellowDeep} />
      <circle cx="18" cy="16.5" r="14.5" fill={Palette.yellow} />
      <circle
        cx="18"
        cy="16.5"
        r="10.5"
        fill="none"
        stroke={Palette.yellowDeep}
        strokeWidth="2"
      />
      <path
        d="M18 9.5 L20.1 14 L25 14.6 L21.4 17.9 L22.4 22.7 L18 20.3 L13.6 22.7 L14.6 17.9 L11 14.6 L15.9 14 Z"
        fill={Palette.yellowDeep}
      />
    </svg>
  );
}

/** Flat padlock for locked path nodes. */
export function LockIcon({
  className,
  color = Palette.textFaint,
  style,
}: {
  className?: string;
  /** Hex fill. */
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} style={style}>
      <path
        d="M12 3a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V8a5 5 0 0 0-5-5zm-2.6 5a2.6 2.6 0 0 1 5.2 0v2H9.4V8z"
        fill={color}
      />
    </svg>
  );
}

/** Solid mic glyph (record CTA). */
export function MicIcon({
  className,
  color = "#FFFFFF",
  style,
}: {
  className?: string;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" fill={color} aria-hidden className={className} style={style}>
      <path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3zm5 9a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
    </svg>
  );
}

/** Spinner ring inherits `currentColor`. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label="Loading"
      className={`block animate-spin rounded-full border-[3px] border-current/25 border-t-current ${className ?? "h-10 w-10"}`}
    />
  );
}
