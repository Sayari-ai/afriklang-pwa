"use client";

/** Frame of every campaign screen: header (title, language, sign out) and a padded column. */

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LocalePicker } from "@/components/locale-picker";
import { signOut } from "@/lib/campaign/auth-client";
import { useCampaignSession } from "@/lib/campaign/hooks";

export function CampaignShell({ children }: { children: ReactNode }) {
  const t = useTranslations("campaign.common");
  const session = useCampaignSession();

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-white text-slate-900">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <Link href="/campaign" className="text-base font-bold text-primary">
          {t("appName")}
        </Link>
        {session.status === "signedIn" ? (
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.assign("/campaign"))}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            {t("signOut")}
          </button>
        ) : null}
      </header>
      <div className="px-4 pt-3">
        <LocalePicker />
      </div>
      <main className="flex flex-1 flex-col gap-4 px-4 py-5 pb-safe">{children}</main>
    </div>
  );
}
