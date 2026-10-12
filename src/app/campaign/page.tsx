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
import { clearToken, takeLinkFromLocation } from "@/lib/campaign/link-token";
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
  // The token+attempt already sent: StrictMode runs effects twice, a token must be claimed once.
  const started = useRef<string | null>(null);

  useEffect(() => {
    // Read in the effect (the URL is not known on the server); the strip of the fragment is a side effect too.
    const found = takeLinkFromLocation();
    void Promise.resolve().then(() => {
      setToken(found.token);
      setBrokenLink(found.malformed);
    });
    // An installed app that is already open can receive a new invitation link as a hash-only change.
    const onHash = () => {
      const fresh = takeLinkFromLocation();
      if (fresh.token) {
        setBrokenLink(false);
        setToken(fresh.token);
      } else if (fresh.malformed) setBrokenLink(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (session.status !== "signedIn" || !token) return;
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
  }, [session, token, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const continueWithoutToken = useCallback(() => {
    setToken(null);
    setClaim({ status: "idle" });
  }, []);

  const dismissBrokenLink = useCallback(() => setBrokenLink(false), []);

  const view = nextView({ session: session.status, hasToken: token === undefined ? null : Boolean(token), claim });
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
