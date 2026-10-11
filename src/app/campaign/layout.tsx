import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CampaignShell } from "@/components/campaign/CampaignShell";

// The invitation link carries a one-time token in its fragment: never let a referrer leak the page URL.
export const metadata: Metadata = { title: "Campaign", referrer: "no-referrer" };

export default function CampaignLayout({ children }: { children: ReactNode }) {
  return <CampaignShell>{children}</CampaignShell>;
}
