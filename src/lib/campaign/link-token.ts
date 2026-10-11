/**
 * The invitation link's token: read it from the URL fragment (#t=...), keep it until the
 * contributor is signed in and has claimed it, and make sure it never stays in the address
 * bar (history, screenshots, referrers).
 *
 * Fragments are never sent to a server, which is why the dashboard puts the token there.
 */

const KEY = "afriklang.campaign.token.v1";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The token in a URL fragment like "#t=abc" (or "#foo=1&t=abc"), when it is well formed. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const t = params.get("t");
  return t && TOKEN_RE.test(t) ? t : null;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveToken(token: string, s: Store | null = store()): void {
  try {
    s?.setItem(KEY, token);
  } catch {
    // storage blocked: the token then lives only in the page's memory
  }
}

export function savedToken(s: Store | null = store()): string | null {
  try {
    const t = s?.getItem(KEY) ?? null;
    return t && TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function clearToken(s: Store | null = store()): void {
  try {
    s?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Pick up the token from the current URL: remember it and strip the fragment. Returns the
 * token to use now (from the URL, else from storage), or null.
 */
export function takeTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = tokenFromHash(window.location.hash);
  if (fromUrl) {
    saveToken(fromUrl);
    // Replace the entry so Back does not bring the token back.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromUrl;
  }
  return savedToken();
}
