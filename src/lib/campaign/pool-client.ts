"use client";

/**
 * Pool campaigns in the screens: what the speaker can still record, the last draw, and drawing
 * by itself when the batch runs low (when the campaign is opened, and while recording).
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cacheId, campaignCache } from "./cache";
import { serverNow } from "./clock";
import { useCampaignSession } from "./hooks";
import { missionsInOutbox } from "./outbox-logic";
import { useOutbox } from "./outbox-client";
import { isPool, liveMissions, shouldDraw } from "./pool";
import { drawForCampaign, giveBack, isDrawing, poolKey, subscribeDrawing, type PoolMemo } from "./queries";
import { canRecordNow } from "./studio-flow";
import type { CampaignCard, Mission } from "./types";

/**
 * The current time, moved on every minute while `enabled` (leases end while a screen is open).
 * `server`: the server's time as estimated from the phone's (clock.ts), for comparing with leases.
 */
export function useMinuteClock(enabled = true, server = false): number {
  const read = server ? serverNow : Date.now;
  const [now, setNow] = useState(read);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(read()), 60_000);
    const onShow = () => document.visibilityState === "visible" && setNow(read());
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [enabled, read]);
  return now;
}

/** The missions still the speaker's (lapsed pool leases removed), recomputed as time passes. */
export function useLiveMissions(missions: readonly Mission[] | null): readonly Mission[] | null {
  const leased = Boolean(missions?.some((m) => m.lease_until));
  const now = useMinuteClock(leased, true);
  return useMemo(() => (missions && leased ? liveMissions(missions, now) : missions), [missions, leased, now]);
}

/** The phone's memory of this campaign's draws (null before the first one). */
export function usePoolMemo(campaignId: string): PoolMemo | null {
  const session = useCampaignSession();
  const id = session.status === "signedIn" ? cacheId(session.userId, poolKey(campaignId)) : null;
  return useSyncExternalStore(
    campaignCache.subscribe,
    () => (id ? campaignCache.read<PoolMemo>(id).data : null),
    () => null,
  );
}

export type PoolState = {
  pool: boolean;
  memo: PoolMemo | null;
  /** Missions the speaker can still record (takes waiting on the phone are done for them). Null until known. */
  open: number | null;
  drawing: boolean;
  /** A draw is running or about to start by itself (`auto`): a screen that needs the batch should wait. */
  pending: boolean;
  /** The last draw failed (network, server): say so next to a retry. */
  drawFailed: boolean;
  drawNow: () => Promise<void>;
  /** Give back every open mission that has no take waiting on the phone. Resolves to how many went back, or null on failure. */
  giveBackOpen: () => Promise<number | null>;
  /** The ids `giveBackOpen` would return. */
  returnable: string[];
};

/**
 * `missions` is the live list (or null while it loads). With `auto`, a pool campaign that is ready
 * and holds fewer than `refill_below` recordable missions draws by itself (spaced out: see shouldDraw).
 * Planned campaigns get `pool: false` and never call anything.
 */
export function usePool(card: CampaignCard | null, missions: readonly Mission[] | null, auto: boolean): PoolState {
  const session = useCampaignSession();
  const userId = session.status === "signedIn" ? session.userId : null;
  const campaignId = card?.campaign_id ?? "";
  const pool = Boolean(card && isPool(card));
  const memo = usePoolMemo(campaignId);
  const box = useOutbox();
  const onPhone = useMemo(() => missionsInOutbox(box.items.filter((i) => i.userId === userId && i.campaignId === campaignId)), [box.items, userId, campaignId]);
  const drawing = useSyncExternalStore(subscribeDrawing, () => (userId && campaignId ? isDrawing(userId, campaignId) : false), () => false);

  const open = useMemo(() => (pool && missions ? missions.filter((m) => canRecordNow(m, onPhone)).length : null), [pool, missions, onPhone]);
  const returnable = useMemo(
    () => (pool && missions ? missions.filter((m) => (m.status === "todo" || m.status === "rejected") && m.lease_until && !onPhone.has(m.mission_id)).map((m) => m.mission_id) : []),
    [pool, missions, onPhone],
  );

  const drawNow = useCallback(async () => {
    if (!userId || !campaignId || !pool) return;
    await drawForCampaign(userId, campaignId);
  }, [userId, campaignId, pool]);

  const giveBackOpen = useCallback(async () => {
    if (!userId || !campaignId || !returnable.length) return 0;
    let returned = 0;
    // The dashboard takes at most 200 ids per call.
    for (let i = 0; i < returnable.length; i += 200) {
      const res = await giveBack(userId, campaignId, returnable.slice(i, i + 200));
      if (!res.ok) return i === 0 ? null : returned;
      returned += res.data.returned ?? 0;
    }
    return returned;
  }, [userId, campaignId, returnable]);

  const lastAt = memo?.last.at ?? null;
  const lastStatus = memo?.last.status ?? null;
  const nextStep = card?.next_step;
  const refill = card?.refill_below;
  const now = useMinuteClock(auto && pool);
  const due = useMemo(() => {
    if (!auto || !pool || open == null || !nextStep) return false;
    const last = lastAt != null && lastStatus ? { at: lastAt, status: lastStatus, added: 0 } : null;
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    // The minute clock lags real time: never let it read as earlier than the last draw (that would
    // look like a clock set back, and draw again at once).
    return shouldDraw({ card: { dispatch: "pool", refill_below: refill, next_step: nextStep }, open, last, now: Math.max(now, lastAt ?? 0), online });
  }, [auto, pool, open, nextStep, refill, lastAt, lastStatus, now]);
  useEffect(() => {
    if (due && !drawing) void drawNow();
  }, [due, drawing, drawNow]);

  return { pool, memo, open, drawing, pending: drawing || due, drawFailed: memo?.last.status === "error", drawNow, giveBackOpen, returnable };
}
