"use client";

/**
 * How to reach the team (APP-05): the address as plain text the speaker can select or copy, and a
 * button that opens their mail app with a subject and their speaker ID (when known) filled in.
 * Shown wherever a message says "contact / ask / tell the Afriklang team" (CONTACT_MESSAGES).
 * Works signed out (no speaker ID then), on light screens and on the dark ones (studio, account).
 */

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSavedCampaignList } from "@/lib/campaign/hooks";
import { CONTACT_EMAIL, contactMailto } from "@/lib/campaign/contact";

export function ContactTeam({ lead, tone = "light", className = "" }: { lead?: string | null; tone?: "light" | "dark"; className?: string }) {
  const t = useTranslations("campaign.common.contact");
  // Read only: the help shown under a failed list must not retry that list (and unmount itself).
  const list = useSavedCampaignList();
  const speakerId = list.state === "ready" ? list.data.contributor.speaker_id : null;
  const href = contactMailto({ subject: t("subject"), body: speakerId ? t("body", { id: speakerId }) : null });
  const dark = tone === "dark";
  return (
    <div className={`space-y-1 text-sm ${className}`}>
      {lead ? <p>{lead}</p> : null}
      <p>
        {t("address")}{" "}
        {/* Its own text, never the link's: a long press on a link copies "mailto:…", not the address. */}
        <span className={`select-all font-bold [overflow-wrap:anywhere] ${dark ? "text-white" : "text-slate-900"}`}>{CONTACT_EMAIL}</span>
      </p>
      <a
        href={href}
        className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${dark ? "bg-white/15 text-white focus-visible:outline-white" : "bg-white text-primary ring-1 ring-slate-300 focus-visible:outline-primary"}`}
      >
        <Mail size={16} aria-hidden /> {t("write")}
      </a>
    </div>
  );
}
