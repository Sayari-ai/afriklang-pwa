/**
 * Why a screen asks the speaker to sign in: their session ended by itself ("Your session has
 * expired"), or there is simply none ("Sign in to continue"). Pure, so it can be tested.
 *
 * A session "expired" only when this phone held one in this visit (signed in, or saved on the
 * phone when the app opened) and it ended without the speaker signing out: Auth refused it, or
 * it could not be renewed. No session at all (never signed in here, or signed out on purpose,
 * on this tab or another) is a plain sign-in, never "expired".
 */

export type SessionMemory = { held: boolean; lost: boolean };

export const NO_SESSION_YET: SessionMemory = { held: false, lost: false };

/** The memory after the session state became `next`. `onPurpose`: the speaker signed out themselves. */
export function rememberSession(mem: SessionMemory, next: "waiting" | "signedOut" | "signedIn", onPurpose: boolean): SessionMemory {
  if (next === "signedIn") return { held: true, lost: false };
  if (next === "signedOut") return { held: false, lost: mem.lost || (mem.held && !onPurpose) };
  return mem;
}
