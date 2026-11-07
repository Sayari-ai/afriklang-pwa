import { describe, expect, it } from "vitest";
import { cacheId, campaignCache } from "./cache";
import { CAMPAIGNS, markSubmitted, missionsKey } from "./queries";
import type { CampaignCard, Mission, RejectDetail } from "./types";
import type { CampaignList, MissionList } from "./api";

const detail: RejectDetail = { check: "too_short", measured: 2.1, limit: 3, unit: "s", bound: "min" };
const progress = { total: 10, todo: 7, submitted: 1, accepted: 0, rejected: 2 };
const card = { campaign_id: "c1", progress } as CampaignCard;
const mission = (id: string, over: Partial<Mission> = {}): Mission =>
  ({ mission_id: id, status: "todo", rejection_reason: null, rejection_detail: null, recording: null, ...over }) as Mission;

describe("markSubmitted", () => {
  it("shows a sent take as submitted at once, with no rejection reason or detail left on it", () => {
    const refused = mission("m1", { status: "rejected", rejection_reason: "duration", rejection_detail: detail, recording: { status: "rejected", rejection_reason: "duration", rejection_detail: detail } });
    campaignCache.put<MissionList>(cacheId("u1", missionsKey("c1")), { campaign: card, missions: [refused, mission("m2")], rewards: {} as MissionList["rewards"] });
    campaignCache.put<CampaignList>(cacheId("u1", CAMPAIGNS), { contributor: {} as CampaignList["contributor"], campaigns: [card] });

    markSubmitted("u1", "c1", "m1");

    const list = campaignCache.read<MissionList>(cacheId("u1", missionsKey("c1"))).data!;
    expect(list.missions[0]).toEqual({ ...refused, status: "submitted", rejection_reason: null, rejection_detail: null, recording: { status: "uploaded", rejection_reason: null, rejection_detail: null } });
    expect(list.missions[1]).toEqual(mission("m2"));
    // The counts move with it, on the campaign's own card and on the home list.
    expect(list.campaign.progress).toEqual({ ...progress, rejected: 1, submitted: 2 });
    expect(campaignCache.read<CampaignList>(cacheId("u1", CAMPAIGNS)).data!.campaigns[0].progress).toEqual({ ...progress, rejected: 1, submitted: 2 });
  });

  it("does nothing when the mission is not cached", () => {
    campaignCache.put<MissionList>(cacheId("u2", missionsKey("c1")), { campaign: card, missions: [mission("m1")], rewards: {} as MissionList["rewards"] });
    markSubmitted("u2", "c1", "zzz");
    expect(campaignCache.read<MissionList>(cacheId("u2", missionsKey("c1"))).data!.missions[0]).toEqual(mission("m1"));
  });
});
