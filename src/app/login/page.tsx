"use client";

/**
 * Login screen mandatory Google sign-in gate.
 *
 * Funnel position (see the decision tree in `src/app/page.tsx`):
 *
 *     /onboarding → /login → /path-setup → /consent → /home
 *
 * There is no guest mode: the splash gate and `<AppRouteGuard>` refuse
 * to route past this screen without a session. Identity for backend
 * calls remains the anonymous `device_id`; the Google account is the
 * access key and (later, server-side) the cross-device link.
 *
 * OAuth flow (PKCE, see `src/stores/auth.ts` + `src/lib/supabase.ts`):
 *   1. CTA → `signInWithGoogle()` → full-page redirect to Google.
 *      `busy` stays true until the unload so the button shows a
 *      spinner during the (perceptible) navigation.
 *   2. Google redirects back to `/login?code=...`. `<AppHydration>`
 *      boots the auth store, whose `getSession()` awaits the code
 *      exchange. While that runs, `hydrated` is false and we hold
 *      render (`null`) same no-flash pattern as every funnel screen.
 *   3. Session lands → the re-entry guard bounces to `/`, the splash
 *      gate, which owns the canonical "where next" decision tree.
 *
 * If the user cancels on Google's screen, the provider bounces back
 * with `?error=access_denied&...` surfaced as an inline message (the
 * snackbar host only exists inside the `(app)/` shell). The flag is
 * *derived* from `useSearchParams()` during render (no effect+setState
 * see react-hooks/set-state-in-effect), which is why the screen body
 * sits under the mandatory `<Suspense>` boundary.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";

import { GameIconHalo, GameKey } from "@/components/game/glossy-icons";
import { WoodButton } from "@/components/game/wood-button";
import { ScreenBackground } from "@/components/screen-background";
import { track } from "@/lib/api/events";
import { useAuth } from "@/stores/auth";

export default function LoginPage() {
  // `useSearchParams()` requires a Suspense boundary for prerender.
  // `fallback={null}` matches the hold-render pattern below.
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}

function LoginScreen() {
  const router = useRouter();
  const t = useTranslations();
  const searchParams = useSearchParams();

  const [busy, setBusy] = useState(false);
  // Local failure: `signInWithOAuth` itself rejected (offline,
  // backend unconfigured, provider misconfigured).
  const [localFailed, setLocalFailed] = useState(false);
  // URL failure: the provider redirected back with `?error=...`.
  // Derived during render; dismissed when the user retries.
  const [urlErrorDismissed, setUrlErrorDismissed] = useState(false);
  const urlFailed =
    searchParams.has("error") || searchParams.has("error_description");
  const failed = localFailed || (urlFailed && !urlErrorDismissed);

  const authHydrated = useAuth((s) => s.hydrated);
  const signedIn = useAuth((s) => s.user !== null);

  // Re-entry guard: already signed in (deep link, or the OAuth
  // redirect just completed) → punt to the splash gate. We do NOT
  // replicate its decision tree here single source of truth.
  useEffect(() => {
    if (authHydrated && signedIn) {
      router.replace("/");
    }
  }, [authHydrated, signedIn, router]);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setLocalFailed(false);
    // Scrub any stale provider error from the URL so a post-retry
    // refresh doesn't resurrect the message. Done here (event
    // handler), not in an effect, to keep the error visible until the
    // user acts on it.
    if (urlFailed) {
      setUrlErrorDismissed(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
    track("login_start");
    try {
      await useAuth.getState().signInWithGoogle();
      // Success → the browser is navigating to Google. Keep the
      // spinner; this component unmounts on unload.
    } catch {
      setLocalFailed(true);
      setBusy(false);
    }
  };

  // Hold render while the session restore / code exchange is running,
  // or while the signed-in bounce is about to fire. Same pattern as
  // `/consent` and `<AppRouteGuard>` avoids a flash of the gate.
  if (!authHydrated) return null;
  if (signedIn) return null;

  return (
    <ScreenBackground>
      <div className="flex min-h-dvh w-full flex-col px-6">
        <div className="flex-1" />

        {/* Glossy key "unlock your adventure" header. */}
        <div className="flex justify-center">
          <GameIconHalo size={104}>
            <GameKey className="h-[68%] w-[68%]" />
          </GameIconHalo>
        </div>
        <div className="h-6" />
        <h1 className="text-outline whitespace-pre-line text-center font-game text-[36px] leading-tight tracking-wide text-cream phone-sm:text-[28px]">
          {t("loginTitle")}
        </h1>
        <div className="h-3" />
        <p
          className="text-center text-[18px] font-medium leading-snug text-cream/95 phone-sm:text-[15px]"
          style={{ textShadow: "0 1px 0 rgba(0,0,0,0.4)" }}
        >
          {t("loginSubtitle")}
        </p>

        <div className="flex-1" />

        {failed && (
          <>
            <p
              role="alert"
              className="text-center text-[15px] font-bold leading-snug text-red-300 phone-sm:text-[13px]"
              style={{ textShadow: "0 1px 0 rgba(0,0,0,0.5)" }}
            >
              {t("loginErrorGeneric")}
            </p>
            <div className="h-3" />
          </>
        )}

        <WoodButton
          tone="green"
          size="lg"
          fullWidth
          onClick={signIn}
          disabled={busy}
          loading={busy}
          aria-busy={busy}
        >
          <span className="inline-flex items-center justify-center gap-3">
            <GoogleG />
            {t("loginGoogleCta")}
          </span>
        </WoodButton>
        <div className="h-3" />
        <p className="text-center text-[13px] font-normal text-cream/70">
          {t("loginPrivacyNote")}
        </p>
        <div className="h-4" />
      </div>
    </ScreenBackground>
  );
}

/**
 * Official multi-colour Google "G" on a white tile, so the brand mark
 * stays legible on the wood/grass button body (Google's white-button
 * variant, adapted to the game pill).
 */
function GoogleG() {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white phone-sm:h-6 phone-sm:w-6"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
    >
      <svg viewBox="0 0 48 48" className="h-[18px] w-[18px] phone-sm:h-4 phone-sm:w-4">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    </span>
  );
}
