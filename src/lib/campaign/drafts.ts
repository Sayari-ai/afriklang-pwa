"use client";

/**
 * The take on the review screen, saved on the phone the moment recording stops (APP-005), so a
 * crash, a phone call or a closed tab between Stop and Submit does not lose it. One per user and
 * campaign; the studio offers it again when it reopens, and drops it once the take is submitted,
 * recorded again or discarded.
 */

import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import type { FullAnalysis } from "@/lib/audio/analyze";

export type Draft = {
  v: 1;
  userId: string;
  campaignId: string;
  missionId: string;
  blob: Blob;
  analysis: FullAnalysis;
  recordedAt: number;
  inputSampleRate: number;
  processing: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean };
  quietHintShown: boolean;
  takeNumber: number;
};

let idb: UseStore | null = null;
const db = () => (idb ??= createStore("afriklang.campaign.drafts", "takes"));
const key = (userId: string, campaignId: string) => `${userId}|${campaignId}`;

/** Best effort: storage may be full or blocked; the take is still on screen. */
export async function saveDraft(d: Draft): Promise<void> {
  try {
    await set(key(d.userId, d.campaignId), d, db());
  } catch {
    // not kept
  }
}

export async function loadDraft(userId: string, campaignId: string): Promise<Draft | null> {
  try {
    const d = await get<Draft>(key(userId, campaignId), db());
    return d && d.v === 1 && d.blob instanceof Blob && d.userId === userId ? d : null;
  } catch {
    return null;
  }
}

export async function clearDraft(userId: string, campaignId: string): Promise<void> {
  try {
    await del(key(userId, campaignId), db());
  } catch {
    // ignore
  }
}

/** Every draft of a person (sign-out). */
export async function clearDrafts(userId: string): Promise<void> {
  try {
    const all = await keys<string>(db());
    await Promise.all(all.filter((k) => typeof k === "string" && k.startsWith(`${userId}|`)).map((k) => del(k, db())));
  } catch {
    // ignore
  }
}
