"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";

/**
 * Sheet shared bottom-sheet shell.
 *
 * White rounded-top card clamped to the 480px phone column, gray drag
 * handle, translucent scrim (tap to dismiss), body scroll-lock and
 * Escape-to-close. Slides up on entry (`afk-slide-up`, motion-gated).
 *
 * Consumers render their own content; `title` is optional sugar for
 * the common "heading + options" case.
 */
export function Sheet({
  title,
  children,
  onClose,
  dismissible = true,
}: {
  title?: string;
  children: ReactNode;
  onClose: () => void;
  /** When false, scrim taps and Escape are ignored (mid-submit). */
  dismissible?: boolean;
}) {
  const t = useTranslations();

  // Lock body scroll while open + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, dismissible]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Scrim. Tapping it dismisses. */}
      <button
        type="button"
        aria-label={t("commonClose")}
        onClick={() => {
          if (dismissible) onClose();
        }}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative mx-auto flex w-full max-w-[480px] flex-col rounded-t-3xl bg-bg pb-safe motion-safe:animate-[afk-slide-up_0.25s_ease-out]">
        <div className="flex justify-center pt-3">
          <span className="block h-1.5 w-10 rounded-full bg-border" />
        </div>
        {title && (
          <>
            <div className="h-3" />
            <h2 className="px-5 text-[19px] font-extrabold text-text">
              {title}
            </h2>
          </>
        )}
        <div className="h-2" />
        <div className="flex flex-col">{children}</div>
        <div className="h-3" />
      </div>
    </div>
  );
}
