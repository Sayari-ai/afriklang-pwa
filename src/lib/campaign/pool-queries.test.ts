import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ drawMissions: vi.fn(), returnMissions: vi.fn(), getMissions: vi.fn(), listCampaigns: vi.fn() }));
vi.mock("./api", () => api);

import { cacheId, campaignCache } from "./cache";
import { CAMPAIGNS, drawForCampaign, giveBack, missionsKey, poolKey, type PoolMemo } from "./queries";
import type { CampaignList, MissionList } from "./api";
import type { CampaignCard, Mission } from "./types";

const USER = "u1";
// A lease still running whenever the test runs (a fixed date failed every run after it: L-22).
const LEASE_UNTIL = new Date(Date.now() + 7 * 86_400_000).toISOString();
const CID = "c1";
const mission = (id: string, status: Mission["status"] = "todo"): Mission => ({
  mission_id: id,
  code: `M_${id}`,
  type: "read",
  position: Number(id.replace(/\D/g, "")) || 1,
  status,
  rejection_reason: null,
  prompt: { id: `P_${id}`, text_or_topic: "Text", category: null },
  duration_s: { min: 3, max: 15 },
  partner_speaker_id: null,
  partner_ready: false,
  recording: null,
  lease_until: LEASE_UNTIL,
});
const card = (progress: CampaignCard["progress"]) => ({ campaign_id: CID, dispatch: "pool", refill_below: 5, progress }) as unknown as CampaignCard;
const POOL = { status: "ok", open: 3, refill_below: 5, lease_until: LEASE_UNTIL, elsewhere: [] };

const missionsId = cacheId(USER, missionsKey(CID));
const listId = cacheId(USER, CAMPAIGNS);
const memoId = cacheId(USER, poolKey(CID));

beforeEach(() => {
  campaignCache.clear();
  for (const f of Object.values(api)) f.mockReset();
  // the background refresh after a change: answer with nothing new
  api.getMissions.mockResolvedValue({ ok: false, status: 0, code: "offline", message: "" });
  api.listCampaigns.mockResolvedValue({ ok: false, status: 0, code: "offline", message: "" });
  const progress = { total: 1, todo: 0, submitted: 1, accepted: 0, rejected: 0 };
  campaignCache.put<MissionList>(missionsId, { campaign: card(progress), missions: [mission("m1", "submitted")], rewards: { accepted: 0 } });
  campaignCache.put<CampaignList>(listId, { contributor: {} as never, campaigns: [card(progress)] });
});

describe("drawForCampaign", () => {
  it("adds the drawn missions to the saved list and the counts, and remembers the draw", async () => {
    api.drawMissions.mockResolvedValue({ ok: true, data: { missions: [mission("m2"), mission("m3")], pool: POOL } });
    const res = await drawForCampaign(USER, CID);
    expect(res.ok).toBe(true);
    const d = campaignCache.read<MissionList>(missionsId).data!;
    expect(d.missions.map((m) => m.mission_id)).toEqual(["m1", "m2", "m3"]);
    expect(d.campaign.progress).toMatchObject({ total: 3, todo: 2 });
    expect(campaignCache.read<CampaignList>(listId).data!.campaigns[0].progress).toMatchObject({ total: 3, todo: 2 });
    const memo = campaignCache.read<PoolMemo>(memoId).data!;
    expect(memo.last).toMatchObject({ status: "ok", added: 2 });
    expect(memo.pool).toEqual(POOL);
    // the server's list replaces the local merge
    expect(api.getMissions).toHaveBeenCalled();
  });

  it("a repeated answer adds nothing twice", async () => {
    api.drawMissions.mockResolvedValue({ ok: true, data: { missions: [mission("m1"), mission("m2")], pool: POOL } });
    await drawForCampaign(USER, CID);
    expect(campaignCache.read<MissionList>(missionsId).data!.missions).toHaveLength(2);
    expect(campaignCache.read<PoolMemo>(memoId).data!.last.added).toBe(1);
  });

  it("nothing new but open missions on the server: the saved list is old, reload it", async () => {
    api.drawMissions.mockResolvedValue({ ok: true, data: { missions: [], pool: { ...POOL, open: 6 } } });
    await drawForCampaign(USER, CID);
    expect(api.getMissions).toHaveBeenCalled();
  });

  it("a refusal is remembered as such, with nothing added and no reload", async () => {
    api.drawMissions.mockResolvedValue({ ok: true, data: { missions: [], pool: { ...POOL, status: "cell_full", open: 0, elsewhere: [{ campaign_id: "c2", title: "B", code: "B" }] } } });
    await drawForCampaign(USER, CID);
    expect(campaignCache.read<PoolMemo>(memoId).data!.last).toMatchObject({ status: "cell_full", added: 0 });
    expect(campaignCache.read<MissionList>(missionsId).data!.missions).toHaveLength(1);
    expect(api.getMissions).not.toHaveBeenCalled();
  });

  it("a failed call is remembered as an error; a changed campaign is reloaded", async () => {
    api.drawMissions.mockResolvedValue({ ok: false, status: 0, code: "network", message: "" });
    await drawForCampaign(USER, CID);
    expect(campaignCache.read<PoolMemo>(memoId).data!.last.status).toBe("error");
    expect(api.listCampaigns).not.toHaveBeenCalled();
    api.drawMissions.mockResolvedValue({ ok: false, status: 403, code: "campaign_paused", message: "" });
    await drawForCampaign(USER, CID);
    expect(api.listCampaigns).toHaveBeenCalled();
  });

  it("two callers at once share one call", async () => {
    let finish!: (v: unknown) => void;
    api.drawMissions.mockReturnValue(new Promise((r) => (finish = r)));
    const a = drawForCampaign(USER, CID);
    const b = drawForCampaign(USER, CID);
    finish({ ok: true, data: { missions: [], pool: POOL } });
    await Promise.all([a, b]);
    expect(api.drawMissions).toHaveBeenCalledTimes(1);
  });
});

describe("giveBack", () => {
  it("removes the open missions given back and does not draw again at once", async () => {
    campaignCache.put<MissionList>(missionsId, {
      campaign: card({ total: 3, todo: 1, submitted: 1, accepted: 0, rejected: 1 }),
      missions: [mission("m1", "submitted"), mission("m2"), mission("m3", "rejected")],
      rewards: { accepted: 0 },
    });
    api.returnMissions.mockResolvedValue({ ok: true, data: { returned: 2, pool: { open: 0, refill_below: 5 } } });
    const res = await giveBack(USER, CID, ["m2", "m3", "m1"]);
    expect(res.ok).toBe(true);
    expect(api.returnMissions).toHaveBeenCalledWith(CID, ["m2", "m3", "m1"]);
    const d = campaignCache.read<MissionList>(missionsId).data!;
    expect(d.missions.map((m) => m.mission_id)).toEqual(["m1"]);
    expect(d.campaign.progress).toEqual({ total: 1, todo: 0, submitted: 1, accepted: 0, rejected: 0 });
    expect(campaignCache.read<PoolMemo>(memoId).data!.last.status).toBe("returned");
  });

  it("changes nothing when the call fails", async () => {
    api.returnMissions.mockResolvedValue({ ok: false, status: 0, code: "offline", message: "" });
    await giveBack(USER, CID, ["m1"]);
    expect(campaignCache.read<MissionList>(missionsId).data!.missions).toHaveLength(1);
    expect(campaignCache.read<PoolMemo>(memoId).data).toBeNull();
  });
});
