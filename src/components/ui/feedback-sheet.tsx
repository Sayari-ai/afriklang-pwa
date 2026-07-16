"use client";

import { Check } from "lucide-react";

import { Button } from "./button";

/**
 * FeedbackSheet the "correct answer" panel that slides up from the
 * bottom of the lesson screen after a successful submit (the
 * signature Duolingo moment). Light brand-blue surface, brand-blue
 * praise headline next to a check medallion, full-width CONTINUE.
 *
 * Rendered inside the lesson screen's flex column as an overlay:
 * position fixed, clamped to the 480px phone frame.
 */
export function FeedbackSheet({
  title,
  ctaLabel,
  onContinue,
}: {
  title: string;
  ctaLabel: string;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="w-full max-w-[480px] bg-primary-light pb-safe motion-safe:animate-[afk-slide-up_0.25s_ease-out]">
        <div className="flex flex-col gap-4 px-5 pb-4 pt-5 phone-sm:px-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-bg phone-sm:h-10 phone-sm:w-10">
              <Check
                size={28}
                strokeWidth={4}
                // Hex, not var(): lucide `color` lands on SVG `stroke`.
                // Brand blue (--color-primary).
                color="#00539F"
                aria-hidden
              />
            </span>
            <p
              role="status"
              className="text-[22px] font-extrabold leading-tight text-primary-text phone-sm:text-[19px]"
            >
              {title}
            </p>
          </div>
          <Button variant="primary" size="lg" fullWidth onClick={onContinue}>
            {ctaLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
