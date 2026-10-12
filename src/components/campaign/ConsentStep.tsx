"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { signConsent } from "@/lib/campaign/api";
import type { CampaignCard, CampaignFailure } from "@/lib/campaign/types";
import { safeExternalUrl } from "@/lib/security/safe-url";
import { FailureMessage, Notice, buttonPrimary } from "./CampaignHubParts";

type Props = { type: "account" | "campaign"; card: CampaignCard; onSigned: () => void };

export function ConsentStep({ type, card, onSigned }: Props) {
  const t = useTranslations("campaign.flow.consent");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const id = useId();
  const consent = card.consents[type];
  // The address is typed by an admin on the dashboard: only http(s) may become a link.
  const textUrl = safeExternalUrl(consent.text_url);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // a second tap before the re-render must not sign twice
  const [failure, setFailure] = useState<CampaignFailure | null>(null);
  const [changed, setChanged] = useState(false);

  const version = consent.required_version;
  const topic = card.topic.sub_domain ? `${card.topic.domain}, ${card.topic.sub_domain}` : card.topic.domain;

  async function sign() {
    if (!version || !agreed || sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const res = await signConsent({ type, campaignId: type === "campaign" ? card.campaign_id : undefined, version, locale });
      if (res.ok) return onSigned();
      if (res.code === "consent_version_changed") {
        setChanged(true);
        setAgreed(false);
        onSigned(); // reload so the new text and version appear
      } else setFailure(res);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">{t(type === "account" ? "accountTitle" : "campaignTitle")}</h1>
      {changed ? <Notice tone="warn"><p role="status">{t("changed")}</p></Notice> : null}
      {version === null ? (
        <Notice tone="warn"><p role="alert">{t("notConfigured")}</p></Notice>
      ) : (
        <>
          <p className="text-base text-slate-700">{type === "account" ? t("accountSummary") : t("campaignSummary", { code: card.code, topic })}</p>
          {textUrl ? (
            <a
              href={textUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-primary px-4 py-3 text-center text-base font-bold text-primary"
            >
              {t("readText")} <span className="ml-1 text-xs font-normal">{t("opensNewTab")}</span>
            </a>
          ) : (
            <p role="alert" className="text-sm text-amber-800">{t("noLink")}</p>
          )}
          <label htmlFor={`${id}-agree`} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 px-3 py-2">
            <input id={`${id}-agree`} type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-6 shrink-0 accent-primary" />
            <span className="text-base font-semibold text-slate-900">{t("agree")}</span>
          </label>
          {failure ? <FailureMessage failure={failure} /> : null}
          <button type="button" onClick={sign} disabled={!agreed || busy || !textUrl} aria-describedby={!agreed && textUrl ? `${id}-hint` : undefined} className={buttonPrimary}>
            {busy ? t("signing") : t("sign")}
          </button>
          {!agreed && textUrl ? <p id={`${id}-hint`} className="text-sm text-slate-600">{t("agreeFirst")}</p> : null}
        </>
      )}
    </section>
  );
}
