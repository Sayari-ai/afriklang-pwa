/**
 * What went wrong when Google or Supabase Auth sent the speaker back without a session (APP2-11).
 * Without it the app showed the same sign-in card again, every time, with no word of why.
 *
 * Read once, before the Auth client handles (and strips) the address. Only a short code is kept:
 * never the error's description.
 */

export type SignInReturnProblem = "signupsClosed" | "denied" | "restart" | "failed";

/** The problem in a redirect's query and fragment, or null. `code`: a PKCE code came back (see takeSignInReturnProblem). */
export function signInReturnProblem(search: string, hash: string): SignInReturnProblem | "code" | null {
  let code = false;
  for (const part of [search.replace(/^\?/, ""), hash.replace(/^#/, "")]) {
    if (!part) continue;
    const p = new URLSearchParams(part);
    const err = p.get("error_code") ?? p.get("error");
    if (err) {
      const all = `${p.get("error_code") ?? ""} ${p.get("error") ?? ""} ${p.get("error_description") ?? ""}`.toLowerCase();
      if (/signup_disabled|signups? not allowed/.test(all)) return "signupsClosed";
      // The flow started in another browser or tab (iOS mail app then Safari), or took too long.
      if (/bad_oauth_state|flow_state|bad_code_verifier|code verifier/.test(all)) return "restart";
      if (/access_denied|cancel/.test(all)) return "denied";
      return "failed";
    }
    if (p.get("code")) code = true;
  }
  return code ? "code" : null;
}

let captured: ReturnType<typeof signInReturnProblem> = null;
let read = false;

/** Note the problem in the current address (call before the Auth client starts). */
export function captureSignInReturn(): void {
  if (read || typeof window === "undefined") return;
  read = true;
  captured = signInReturnProblem(window.location.search, window.location.hash);
}

/**
 * The problem to show on the sign-in card, once. A code that came back but left the speaker signed
 * out could not be exchanged: its key was saved by another browser (flow started elsewhere).
 */
export function takeSignInReturnProblem(): SignInReturnProblem | null {
  const p = captured;
  captured = null;
  return p === "code" ? "restart" : p;
}
