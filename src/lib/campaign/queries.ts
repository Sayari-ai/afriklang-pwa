/**
 * The campaign reads, as cache entries, and the local edits that keep them in step with what the
 * contributor just did (so a screen never waits for a reload to show it).
 *
 *   campaigns           contributor + one card per campaign      (listCampaigns)
 *   missions:<id>       one campaign's card + its missions        (getMissions)
 *
 * A `missions` answer also carries the campaign's card: it replaces the card in `campaigns`, so the
 * home screen is up to date without a second call.
 */

import { getMissions, listCampaigns, type CampaignList, type MissionList } from "./api";
import { cacheId, campaignCache } from "./cache";
import type { CampaignCard, Mission } from "./types";

export const CAMPAIGNS = "campaigns";
export const missionsKey = (campaignId: string) => `missions:${campaignId}`;

export function loadCampaigns(userId: string, force = false) {
  return campaignCache.load<CampaignList>(cacheId(userId, CAMPAIGNS), listCampaigns, force);
}

export function loadMissions(userId: string, campaignId: string, force = false) {
  return campaignCache.load<MissionList>(
    cacheId(userId, missionsKey(campaignId)),
    () =>
      getMissions(campaignId).then((r) => {
        if (r.ok && r.data.campaign) replaceCard(userId, r.data.campaign);
        return r;
      }),
    force,
  );
}

/** Put a fresher card in the campaign list. */
export function replaceCard(userId: string, card: CampaignCard) {
  campaignCache.update<CampaignList>(cacheId(userId, CAMPAIGNS), (l) => ({
    ...l,
    campaigns: l.campaigns.map((c) => (c.campaign_id === card.campaign_id ? { ...c, ...card } : c)),
  }));
}

/** Progress counts after one mission moved from `from` to "submitted". Exported for tests. */
export function shiftProgress(p: CampaignCard["progress"], from: Mission["status"]): CampaignCard["progress"] {
  if (from === "submitted" || from === "accepted") return p;
  const key = from === "rejected" ? "rejected" : "todo";
  return { ...p, [key]: Math.max(0, p[key] - 1), submitted: p.submitted + 1 };
}

/** The dashboard saved a recording for this mission: show it as submitted everywhere, at once. */
export function markSubmitted(userId: string, campaignId: string, missionId: string) {
  let from: Mission["status"] | null = null;
  campaignCache.update<MissionList>(cacheId(userId, missionsKey(campaignId)), (d) => ({
    ...d,
    missions: d.missions.map((m) => {
      if (m.mission_id !== missionId) return m;
      from = m.status;
      return { ...m, status: "submitted", rejection_reason: null, recording: { status: "uploaded", rejection_reason: null } };
    }),
    campaign: d.campaign && from ? { ...d.campaign, progress: shiftProgress(d.campaign.progress, from) } : d.campaign,
  }));
  if (!from) return;
  const was = from;
  campaignCache.update<CampaignList>(cacheId(userId, CAMPAIGNS), (l) => ({
    ...l,
    campaigns: l.campaigns.map((c) => (c.campaign_id === campaignId ? { ...c, progress: shiftProgress(c.progress, was) } : c)),
  }));
}

/** Something changed on the server (a write answered, a take was refused): fetch again. */
export function refreshCampaign(userId: string, campaignId?: string) {
  void loadCampaigns(userId, true);
  if (campaignId) void loadMissions(userId, campaignId, true);
}
