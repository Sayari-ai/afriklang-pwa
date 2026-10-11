"use client";

import { useParams } from "next/navigation";
import { CampaignHub } from "@/components/campaign/CampaignHub";

export default function CampaignHubPage() {
  const params = useParams<{ id: string }>();
  return <CampaignHub campaignId={params.id} />;
}
