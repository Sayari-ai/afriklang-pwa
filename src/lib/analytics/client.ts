/**
 * The browser side of PostHog after start-up (init.ts): identity, handled exceptions and the
 * sign-in funnel. Nothing here imports the SDK: it acts through the client init.ts registered,
 * and is a no-op without one (turned off, localhost, server render, tests).
 *
 * Identity (owner, 2026-11): the contributor id only, with role, native language code and app
 * locale. Never a name, email, phone, prompt or audio. Profiles for identified people only.
 */

import { activePostHog, track } from "./events";

/** Send a handled exception to error tracking (it starts the replay too). A no-op without PostHog. */
export function reportException(error: unknown, properties?: Record<string, unknown>): void {
  const ph = activePostHog();
  if (!ph) return;
  try {
    ph.captureException(error, properties);
  } catch {
    // never throw from error reporting
  }
}

// ── Identity ─────────────────────────────────────────────────────────────

export type IdentityTraits = { role: "speaker"; native_language: string | null; app_locale: string };

let identifiedAs: string | null = null;

/** Tie this browser's events to the contributor (internal id only). Repeats are skipped. */
export function identifyContributor(contributorId: string, traits: IdentityTraits): void {
  const ph = activePostHog();
  if (!ph || !contributorId) return;
  const key = `${contributorId}|${traits.native_language ?? ""}|${traits.app_locale}`;
  if (identifiedAs === key) return;
  identifiedAs = key;
  try {
    const props: Record<string, string> = { role: traits.role, app_locale: traits.app_locale };
    if (traits.native_language) props.native_language = traits.native_language;
    ph.identify(contributorId, props);
  } catch {
    // ignore
  }
}

/** Forget the person on this browser (sign-out, or a session that ended in another tab). */
export function resetIdentity(): void {
  const ph = activePostHog();
  identifiedAs = null;
  if (!ph) return;
  try {
    if (ph.get_property("$user_state") === "identified") ph.reset();
  } catch {
    // ignore
  }
}

// ── Sign-in funnel ───────────────────────────────────────────────────────
// Google sign-in leaves the page and comes back: a flag in this tab's sessionStorage links the
// start to its end (completed when the session arrives, failed when Google or Auth sends an error back).

const SIGN_IN_KEY = "afriklang.analytics.signInStarted.v1";
const SIGN_IN_TTL_MS = 15 * 60_000;

function readSignInFlag(): boolean {
  try {
    const at = Number(sessionStorage.getItem(SIGN_IN_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SIGN_IN_TTL_MS;
  } catch {
    return false;
  }
}

function clearSignInFlag(): void {
  try {
    sessionStorage.removeItem(SIGN_IN_KEY);
  } catch {
    // ignore
  }
}

export function signInStarted(props: { in_app_browser: boolean; has_invitation: boolean }): void {
  try {
    sessionStorage.setItem(SIGN_IN_KEY, String(Date.now()));
  } catch {
    // ignore: the end of the funnel is then not linked
  }
  track("sign_in_started", props, { instant: true });
}

/** The sign-in could not start (the button's call threw). */
export function signInFailed(reason: string): void {
  clearSignInFlag();
  track("sign_in_failed", { reason });
}

/** A checked session arrived: the end of a sign-in started in this tab, if one was. */
export function noteSignedIn(): void {
  if (!readSignInFlag()) return;
  clearSignInFlag();
  track("sign_in_completed");
}

/** Back from Google with an error in the address (`?error=…` or `#error=…`): the sign-in failed. */
export function consumeSignInReturn(): void {
  if (!readSignInFlag()) return;
  const reason = signInErrorCode(window.location.search, window.location.hash);
  if (reason) signInFailed(reason);
}

/** The error code Supabase Auth puts in the redirect, or null. Only a short code: never the description. */
export function signInErrorCode(search: string, hash: string): string | null {
  for (const part of [search.replace(/^\?/, ""), hash.replace(/^#/, "")]) {
    if (!part.includes("error")) continue;
    const params = new URLSearchParams(part);
    const code = params.get("error_code") ?? params.get("error");
    if (code) return /^[a-z0-9_.-]{1,40}$/i.test(code) ? code : "other";
  }
  return null;
}
