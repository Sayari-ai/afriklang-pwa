"use client";

/**
 * The app's outbox (see outbox.ts), wired to the browser: IndexedDB for the takes, the Sayari
 * upload proxy, the campaign bridge, and a runner that wakes on start, when the network returns,
 * when the app comes back to the foreground, and when a waiting take is due.
 */

import { createStore, del, get, set, values, type UseStore } from "idb-keyval";
import { useEffect, useSyncExternalStore } from "react";
import { AudioUploadError, uploadAudio } from "@/lib/api/audio";
import { logActivity } from "./activity";
import { submitRecording, withdrawConsent } from "./api";
import { campaignAccessToken, storedCampaignUser } from "./auth-client";
import { createOutbox, type OutboxEvent } from "./outbox";
import { MIN_WAKE_MS, precheckFromCard, type OutboxItem } from "./outbox-logic";
import { CAMPAIGNS, markSubmitted, refreshCampaign } from "./queries";
import { cacheId, campaignCache } from "./cache";
import type { CampaignList } from "./api";

/**
 * Upload with the contributor's session (the proxy refuses anonymous uploads). A 401 on a token
 * the client still thought valid gets one renewal and one more try; a second 401 goes back to
 * the outbox, which holds the take until the speaker is signed in again.
 */
async function uploadSignedIn(item: OutboxItem, onProgress: (sent: number, total: number) => void, signal: AbortSignal) {
  const send = (accessToken: string) =>
    uploadAudio({
      file: item.blob,
      filename: item.filename,
      languageIso: item.upload.languageIso,
      consentRecorded: true,
      ...(item.upload.dialect ? { dialect: item.upload.dialect } : {}),
      englishDescription: item.upload.englishDescription,
      speakerId: item.upload.speakerId,
      extraFields: item.upload.extraFields,
      accessToken,
      onProgress,
      signal,
    });
  const token = await campaignAccessToken();
  if (!token) {
    // A saved session that could not be renewed (network): wait for the network, not for a sign-in.
    if (storedCampaignUser()) throw new AudioUploadError("The session could not be renewed.", 0, true);
    throw new AudioUploadError("Sign in to send your recordings.", 401, false);
  }
  try {
    return await send(token);
  } catch (e) {
    if (!(e instanceof AudioUploadError) || e.status !== 401) throw e;
    const fresh = await campaignAccessToken(true);
    if (!fresh) {
      // Renewal failed on the network (the saved session is kept): retry later, do not ask to sign in.
      if (storedCampaignUser()) throw new AudioUploadError("The session could not be renewed.", 0, true);
      throw e;
    }
    return send(fresh);
  }
}

// Its own database: idb-keyval opens one store per database (see storage/progress-queue.ts).
let idb: UseStore | null = null;
const db = () => (idb ??= createStore("afriklang.campaign.outbox", "takes"));

export const outbox = createOutbox({
  store: {
    all: () => values<OutboxItem>(db()),
    get: (id) => get<OutboxItem>(id, db()),
    put: (item) => set(item.id, item, db()),
    remove: (id) => del(id, db()),
  },
  upload: (item, onProgress, signal) => uploadSignedIn(item, onProgress, signal),
  precheck: (item) => {
    const list = campaignCache.read<CampaignList>(cacheId(item.userId, CAMPAIGNS)).data;
    const card = list?.campaigns?.find((c) => c.campaign_id === item.campaignId);
    return precheckFromCard(card?.next_step);
  },
  submit: (missionId, metadata) => submitRecording(missionId, metadata),
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
  withLock: (run) =>
    typeof navigator !== "undefined" && navigator.locks?.request
      ? navigator.locks.request("afriklang-campaign-outbox", run).then(() => undefined)
      : run(),
});

/** Ask the browser not to evict takes under storage pressure (best effort, once). */
let askedPersist = false;
export function keepTakesSafe() {
  if (askedPersist) return;
  askedPersist = true;
  void navigator.storage?.persist?.().catch(() => false);
}

/** Save a take and start sending it. */
export async function enqueueTake(item: OutboxItem) {
  keepTakesSafe();
  await outbox.add(item);
  void outbox.drain(item.userId);
}

/**
 * Keep the outbox moving for the signed-in user, and keep the screens in step with what it sends.
 * Mounted once, by the campaign shell.
 */
export function useOutboxRunner(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const kick = () => void outbox.drain(userId).then(schedule);
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      // Takes waiting for the network wake on "online", not on a timer (APP-006).
      if (navigator.onLine === false) return;
      const at = outbox.nextWake(userId);
      if (at == null) return;
      timer = setTimeout(kick, Math.max(MIN_WAKE_MS, at - Date.now()));
    };
    const onVisible = () => document.visibilityState === "visible" && kick();
    const offEvent = outbox.onEvent((e: OutboxEvent) => onOutboxEvent(userId, e));

    void outbox.refresh().then(kick);
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      offEvent();
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);
}

function onOutboxEvent(userId: string, e: OutboxEvent) {
  const base = { campaignId: e.item.campaignId, missionId: e.item.missionId, missionCode: e.item.missionCode };
  switch (e.type) {
    case "sent":
      markSubmitted(userId, e.item.campaignId, e.item.missionId);
      logActivity(userId, { ...base, type: "sent" });
      break;
    case "rejected":
      logActivity(userId, { ...base, type: "rejected", detail: e.reason });
      refreshCampaign(userId, e.item.campaignId);
      break;
    case "superseded":
      refreshCampaign(userId, e.item.campaignId);
      break;
    case "failed":
      logActivity(userId, { ...base, type: "failed", detail: e.code });
      refreshCampaign(userId, e.item.campaignId);
      break;
    case "dropped":
      refreshCampaign(userId, e.item.campaignId);
      break;
    case "held":
      break;
  }
}

/**
 * Withdraw the campaign consent and delete that campaign's takes from the phone (APP-004). Sending
 * them stops before the call (a take must not reach Sayari once the speaker asked to withdraw);
 * if the call fails, sending resumes and nothing is deleted.
 */
export async function withdrawFromCampaign(userId: string, campaignId: string) {
  outbox.block(campaignId);
  try {
    const res = await withdrawConsent(campaignId);
    if (!res.ok) return { ok: false as const, failure: res };
    const deleted = await outbox.discardCampaign(userId, campaignId);
    return { ok: true as const, deleted };
  } finally {
    outbox.unblock(campaignId);
  }
}

/** What is on the phone waiting to be sent (no audio), and which one is going now. */
export function useOutbox() {
  const snap = useSyncExternalStore(outbox.subscribe, outbox.snapshot, outbox.snapshot);
  return snap;
}
