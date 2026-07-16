import type { ReactNode } from "react";

/**
 * Card flat white surface with the signature 2px gray border and
 * 16px radius. The redesign's replacement for the carved wooden
 * panel: content sits directly on white, separation comes from the
 * border rather than shadows.
 */
export function Card({
  children,
  className,
  tone = "white",
}: {
  children: ReactNode;
  className?: string;
  /** `subtle` renders the light-gray well variant. */
  tone?: "white" | "subtle";
}) {
  return (
    <div
      className={`rounded-2xl border-2 border-border ${
        tone === "subtle" ? "bg-bg-subtle" : "bg-bg"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
