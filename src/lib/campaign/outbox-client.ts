"use client";

/**
 * The app's outbox (see outbox.ts), wired to the browser: IndexedDB for the takes, the Sayari
 * upload proxy, the campaign bridge, and a runner that wakes on start, when the network returns,
 * when the app comes back to the foreground, and when a waiting take is due.
 */

import { createStore, del, set, values, type UseStore } from "idb-keyval";
import { useEffect, useSyncExternalStore } from "react";
import { AudioUploadError, uploadAudio } from "@/lib/api/audio";
import { logActivity } from "./activity";
import { submitRecording } from "./api";
import { campaignAccessToken } from "./auth-client";
import { createOutbox, type OutboxEvent } from "./outbox";
import type { OutboxItem } from "./outbox-logic";
import { markSubmitted, refreshCampaign } from "./queries";

/**
 * Upload with the contributor's session (the proxy refuses anonymous uploads). A 401 on a token
 * the client still thought valid gets one renewal and one more try; a second 401 goes back to
 * the outbox, which holds the take until the speaker is signed in again.
 */
async function uploadSignedIn(item: OutboxItem) {
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
    });
  const token = await campaignAccessToken();
  if (!token) throw new AudioUploadError("Sign in to send your recordings.", 401, false);
  try {
    return await send(token);
  } catch (e) {
    if (!(e instanceof AudioUploadError) || e.status !== 401) throw e;
    const fresh = await campaignAccessToken(true);
    if (!fresh) throw e;
    return send(fresh);
  }
}

// Its own database: idb-keyval opens one store per database (see storage/progress-queue.ts).
let idb: UseStore | null = null;
const db = () => (idb ??= createStore("afriklang.campaign.outbox", "takes"));

export const outbox = createOutbox({
  store: {
    all: () => values<OutboxItem>(db()),
    put: (item) => set(item.id, item, db()),
    remove: (id) => del(id, db()),
  },
  upload: (item) => uploadSignedIn(item),
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
      const at = outbox.nextWake(userId);
      if (at == null) return;
      // Takes waiting for the network wake on "online", not on a timer.
      timer = setTimeout(kick, Math.max(1000, at - Date.now()));
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
    case "held":
      break;
  }
}

/** What is on the phone waiting to be sent (no audio), and which one is going now. */
export function useOutbox() {
  const snap = useSyncExternalStore(outbox.subscribe, outbox.snapshot, outbox.snapshot);
  return snap;
}
