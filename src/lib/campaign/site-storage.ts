/**
 * Does this browser let the app keep anything on the phone?
 *
 * Some browsers block a site's storage altogether: Chrome with "Block all cookies / site data"
 * (or a site rule for collect.afriklang.com), some locked-down work phones and WebViews. There,
 * merely reading `window.localStorage` or `window.sessionStorage` throws a SecurityError. Creating
 * the Supabase client reads `window.sessionStorage` (its realtime socket, which takes no option to
 * avoid it), so the app used to crash into the error screen on the first page (GitHub issue #86).
 *
 * The sign-in cannot work without storage anyway (the PKCE verifier and the session are saved on
 * the phone), so the sign-in screen says how to allow it instead.
 */

type StorageHost = { localStorage?: Storage | null; sessionStorage?: Storage | null };

const PROBE_KEY = "afriklang.storage-probe.v1";

function usable(read: () => Storage | null | undefined): boolean {
  try {
    const s = read();
    if (!s) return false;
    s.setItem(PROBE_KEY, "1");
    s.removeItem(PROBE_KEY);
    return true;
  } catch (e) {
    // A full storage still works for reading the session: only a refusal means "blocked".
    return isQuotaError(e);
  }
}

function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

/** true when the browser refuses this site's localStorage or sessionStorage. False on the server. */
export function siteStorageBlocked(host: StorageHost | undefined = typeof window === "undefined" ? undefined : window): boolean {
  if (!host) return false;
  return !usable(() => host.localStorage) || !usable(() => host.sessionStorage);
}
