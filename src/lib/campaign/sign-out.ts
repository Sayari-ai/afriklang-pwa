"use client";

/**
 * Leaving the speaker app on this phone (APP-008): the session, then what this person left on the
 * phone that another person using it must not see. Takes waiting to be sent stay (the speaker was
 * told; they go the next time this account signs in), and so does nothing else of anyone else.
 */

import { clearActivity } from "./activity";
import { signOut } from "./auth-client";
import { campaignCache } from "./cache";
import { clearDrafts } from "./drafts";
import { clearToken } from "./link-token";

/** `keepInvitation`: "use another account" after a claim failed keeps the invitation, so the claim resumes. */
export async function signOutHere(userId: string | null, opts: { keepInvitation?: boolean } = {}): Promise<void> {
  await signOut();
  campaignCache.clear();
  if (!opts.keepInvitation) clearToken();
  if (userId) {
    clearActivity(userId);
    await clearDrafts(userId);
  }
}
