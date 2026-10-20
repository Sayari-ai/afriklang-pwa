/**
 * The campaign reads, as cache entries, and the local edits that keep them in step with what the
 * contributor just did (so a screen never waits for a reload to show it).
 *
 *   campaigns           contributor + one card per campaign      (listCampaigns)
 *   missions:<id>       one campaign's card + its missions        (getMissions)
 *   pool:<id>           pool campaigns: the last draw and its pool state (drawMissions; never fetched)
 *
 * A `missions` answer also carries the campaign's card: it replaces the card in `campaigns`, so the
 * home screen is up to date without a second call.
 */

import { drawMissions, getMissions, listCampaigns, returnMissions, type CampaignList, type DrawResult, type MissionList, type ReturnResult } from "./api";
import { cacheId, campaignCache } from "./cache";
import { measureClockSkew, serverNow } from "./clock";
import { addDrawn, leaseOver, mergeDrawn, removeReturned, type LastDraw } from "./pool";
import type { CampaignCard, CampaignResult, Mission, PoolView } from "./types";

export const CAMPAIGNS = "campaigns";
export const missionsKey = (campaignId: string) => `missions:${campaignId}`;
export const poolKey = (campaignId: string) => `pool:${campaignId}`;

/** What the phone remembers of a pool campaign's draws. */
export type PoolMemo = { last: LastDraw; pool: PoolView | null };

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

// ── Pool campaigns ───────────────────────────────────────────────────────

const drawing = new Map<string, Promise<CampaignResult<DrawResult>>>();
const drawListeners = new Set<() => void>();
const drawChanged = () => drawListeners.forEach((l) => l());

/** Whether a draw for this campaign is running (screens show it; see subscribeDrawing). */
export const isDrawing = (userId: string, campaignId: string) => drawing.has(cacheId(userId, poolKey(campaignId)));
export function subscribeDrawing(fn: () => void) {
  drawListeners.add(fn);
  return () => void drawListeners.delete(fn);
}

/** Codes after which the card itself has changed (paused, closed, consent needed...): reload it. */
const CARD_CHANGED = new Set(["campaign_paused", "campaign_not_open", "campaign_closed", "not_assigned", "profile_incomplete", "blocked", "account_consent", "campaign_consent"]);

/**
 * Draw a batch for a pool campaign. One call per campaign at a time (a second caller shares it).
 * The new missions join the saved list at once (the studio can start on them, also if the network
 * drops right after), and the draw's outcome is remembered so the app does not ask again too soon.
 */
export function drawForCampaign(userId: string, campaignId: string): Promise<CampaignResult<DrawResult>> {
  const memoId = cacheId(userId, poolKey(campaignId));
  const running = drawing.get(memoId);
  if (running) return running;
  const p = drawMissions(campaignId)
    .then((res) => {
      const at = Date.now();
      const before = campaignCache.read<PoolMemo>(memoId).data;
      if (!res.ok) {
        campaignCache.put<PoolMemo>(memoId, { last: { at, status: "error", added: 0, code: res.code }, pool: before?.pool ?? null });
        if (CARD_CHANGED.has(res.code)) refreshCampaign(userId, campaignId);
        return res;
      }
      const drawn = Array.isArray(res.data.missions) ? res.data.missions : [];
      let added = drawn.length;
      campaignCache.update<MissionList>(cacheId(userId, missionsKey(campaignId)), (d) => {
        const merged = mergeDrawn(d.missions, drawn);
        added = merged.added;
        return { ...d, missions: merged.missions, campaign: d.campaign ? { ...d.campaign, progress: addDrawn(d.campaign.progress, merged.added) } : d.campaign };
      });
      if (added > 0) {
        campaignCache.update<CampaignList>(cacheId(userId, CAMPAIGNS), (l) => ({
          ...l,
          campaigns: l.campaigns.map((c) => (c.campaign_id === campaignId ? { ...c, progress: addDrawn(c.progress, added) } : c)),
        }));
      }
      const pool = res.data.pool && typeof res.data.pool === "object" ? res.data.pool : null;
      // Fresh missions that already look expired: the phone's clock is wrong even after correcting
      // it (APP-011). Do not draw again every minute; say so, and measure the clock again.
      const clockWrong = drawn.length > 0 && drawn.every((m) => leaseOver(m, serverNow()));
      if (clockWrong) void measureClockSkew(true);
      campaignCache.put<PoolMemo>(memoId, { last: { at, status: clockWrong ? "clock" : (pool?.status ?? "ok"), added }, pool });
      // The server's own list and counts (its order, the leases) replace the local merge. Also when
      // nothing was added but the server says the speaker holds open missions: the saved list is old.
      if (added > 0 || (pool?.status === "ok" && (pool.open ?? 0) > 0)) refreshCampaign(userId, campaignId);
      return res;
    })
    .finally(() => {
      drawing.delete(memoId);
      drawChanged();
    });
  drawing.set(memoId, p);
  drawChanged();
  return p;
}

/** Give back open pool missions the speaker will not record. They leave the list at once. */
export async function giveBack(userId: string, campaignId: string, missionIds: string[]): Promise<CampaignResult<ReturnResult>> {
  const res = await returnMissions(campaignId, missionIds);
  if (!res.ok) {
    if (CARD_CHANGED.has(res.code)) refreshCampaign(userId, campaignId);
    return res;
  }
  const doomed = new Set(missionIds);
  let gone: Mission[] = [];
  campaignCache.update<MissionList>(cacheId(userId, missionsKey(campaignId)), (d) => {
    gone = d.missions.filter((m) => doomed.has(m.mission_id) && (m.status === "todo" || m.status === "rejected"));
    return { ...d, missions: d.missions.filter((m) => !gone.includes(m)), campaign: d.campaign ? { ...d.campaign, progress: removeReturned(d.campaign.progress, gone) } : d.campaign };
  });
  campaignCache.update<CampaignList>(cacheId(userId, CAMPAIGNS), (l) => ({
    ...l,
    campaigns: l.campaigns.map((c) => (c.campaign_id === campaignId ? { ...c, progress: removeReturned(c.progress, gone) } : c)),
  }));
  // Do not hand them a new batch the moment they gave this one back.
  const memoId = cacheId(userId, poolKey(campaignId));
  const before = campaignCache.read<PoolMemo>(memoId).data;
  campaignCache.put<PoolMemo>(memoId, { last: { at: Date.now(), status: "returned", added: 0 }, pool: before?.pool ? { ...before.pool, open: res.data.pool?.open ?? 0 } : null });
  refreshCampaign(userId, campaignId);
  return res;
}
