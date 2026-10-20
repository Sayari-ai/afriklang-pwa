"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClaimCampaignList } from "@/components/campaign/ClaimCampaignList";
import { ClaimFailureCard } from "@/components/campaign/ClaimFailureCard";
import { ClaimBrokenLink, ClaimSpinner } from "@/components/campaign/ClaimNotice";
import { SignInCard } from "@/components/campaign/SignInCard";
import { claimLink } from "@/lib/campaign/api";
import { claimOutcome, nextView, type ClaimState } from "@/lib/campaign/claim-flow";
import { useCampaignSession } from "@/lib/campaign/hooks";
import { clearToken, dismissTokenFor, isTokenDismissedFor, takeLinkFromLocation } from "@/lib/campaign/link-token";
import { loadCampaigns } from "@/lib/campaign/queries";

export default function CampaignLandingPage() {
  const t = useTranslations("campaign.claim");
  const common = useTranslations("campaign.common");
  const session = useCampaignSession();

  // null until the URL / storage has been read (never during server render).
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [claim, setClaim] = useState<ClaimState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  // The URL carried a broken invitation (cut when copied): say so rather than ignore it.
  const [brokenLink, setBrokenLink] = useState(false);
  // The token came from the link just tapped (not from storage): it is claimed even offline,
  // and even after an earlier "Go to my campaigns".
  const [fromUrl, setFromUrl] = useState(false);
  // A saved invitation and no connection: the home shows first; the claim runs once online.
  const [offline, setOffline] = useState(false);
  // The token+attempt already sent: StrictMode runs effects twice, a token must be claimed once.
  const started = useRef<string | null>(null);

  useEffect(() => {
    // Read in the effect (the URL is not known on the server); the strip of the fragment is a side effect too.
    const found = takeLinkFromLocation();
    void Promise.resolve().then(() => {
      setToken(found.token);
      setFromUrl(found.fromUrl);
      setBrokenLink(found.malformed);
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    });
    // An installed app that is already open can receive a new invitation link as a hash-only change.
    const onHash = () => {
      const fresh = takeLinkFromLocation();
      if (fresh.token) {
        setBrokenLink(false);
        setFromUrl(true);
        setToken(fresh.token);
        setClaim({ status: "idle" });
      } else if (fresh.malformed) setBrokenLink(true);
    };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // A saved invitation this account already gave up on (wrong Google account): not claimed again.
  const signedInUser = session.status === "signedIn" ? session.userId : null;
  const dismissed = Boolean(token && signedInUser && !fromUrl && isTokenDismissedFor(token, signedInUser));
  // A saved invitation waits for the connection; a link just tapped is tried at once.
  const deferred = Boolean(token && offline && !fromUrl && claim.status === "idle");
  const activeToken = dismissed || deferred ? null : token;

  useEffect(() => {
    if (session.status !== "signedIn" || !activeToken) return;
    const token = activeToken;
    const userId = session.userId;
    const id = `${token}:${attempt}`;
    if (started.current === id) return;
    started.current = id;
    setClaim({ status: "claiming" });
    // No cancel flag on purpose: the second StrictMode pass is skipped above, so the first result must land.
    void claimLink(token).then((res) => {
      if (res.ok) {
        clearToken();
        // The claim answers with one campaign; the home needs the whole list, which the claim
        // may just have changed: refetch it before showing the home.
        void loadCampaigns(userId, true).finally(() => setClaim({ status: "done" }));
        return;
      }
      if (claimOutcome(res).clearToken) clearToken();
      setClaim({ status: "failed", failure: res });
    });
  }, [session, activeToken, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // A claim that failed on the connection is tried again by itself when the phone is back online
  // or the app comes back to the front (the speaker should not have to find the button).
  const failedRetryable = claim.status === "failed" && claimOutcome(claim.failure).retryable;
  useEffect(() => {
    if (!failedRetryable) return;
    const again = () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) retry();
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [failedRetryable, retry]);

  const continueWithoutToken = useCallback(() => {
    // A wrong account: stop claiming this invitation for it (another account still can).
    // A connection failure: only for now; the next visit with a connection claims it.
    if (claim.status === "failed" && token && signedInUser && claimOutcome(claim.failure).offerOtherAccount) dismissTokenFor(token, signedInUser);
    setToken(null);
    setFromUrl(false);
    setClaim({ status: "idle" });
  }, [claim, token, signedInUser]);

  const dismissBrokenLink = useCallback(() => setBrokenLink(false), []);

  const view = nextView({ session: session.status, hasToken: token === undefined ? null : Boolean(activeToken), claim });
  const email = session.status === "signedIn" ? session.email : null;

  if (brokenLink && view !== "waiting" && view !== "claiming") return <ClaimBrokenLink onContinue={dismissBrokenLink} />;

  switch (view) {
    case "waiting":
      return <ClaimSpinner title={common("loading")} />;
    case "signIn":
      return <SignInCard hasInvitation={Boolean(token)} />;
    case "claiming":
      return <ClaimSpinner title={t("claiming.title")} body={t("claiming.body")} />;
    case "claimFailed":
      return claim.status === "failed" ? <ClaimFailureCard failure={claim.failure} email={email} onRetry={retry} onContinue={continueWithoutToken} /> : null;
    case "claimed":
      return <ClaimCampaignList />;
    case "home":
      return <ClaimCampaignList />;
  }
}
