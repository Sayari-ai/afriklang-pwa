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

/** True when the fragment carries a `t` that is not a well-formed token (cut or altered when copied). */
export function malformedTokenInHash(hash: string): boolean {
  const t = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("t");
  return t !== null && !TOKEN_RE.test(t);
}

/**
 * Pick up the invitation from the current URL: remember a good token and strip the fragment
 * either way. `token` is the one to use now (from the URL, else from storage); `malformed`
 * says the URL carried a broken one, which the screen explains instead of silently ignoring.
 */
export function takeLinkFromLocation(): { token: string | null; malformed: boolean } {
  if (typeof window === "undefined") return { token: null, malformed: false };
  const hash = window.location.hash;
  const fromUrl = tokenFromHash(hash);
  const malformed = !fromUrl && malformedTokenInHash(hash);
  // Replace the entry so Back does not bring the token (or its broken copy) back.
  if (fromUrl || malformed) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (fromUrl) {
    saveToken(fromUrl);
    return { token: fromUrl, malformed: false };
  }
  return { token: malformed ? null : savedToken(), malformed };
}
