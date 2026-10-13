import { describe, expect, it, vi } from "vitest";
import { createOutbox, type OutboxEvent } from "./outbox";
import { backoffMs, decideSubmit, decideUploadFailure, dueItems, uploadBackoffMs, type OutboxItem } from "./outbox-logic";
import { shiftProgress } from "./queries";
import { byDay, streakDays } from "./activity";

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  v: 1,
  id: "sha1",
  userId: "u1",
  campaignId: "c1",
  missionId: "m1",
  missionCode: "M1",
  missionType: "read",
  createdAt: 1,
  blob: new Blob(["x"]),
  filename: "f.wav",
  upload: { languageIso: "wol", englishDescription: "hi", speakerId: "SPK-1", extraFields: {} },
  metadata: { format: "wav", sample_rate: 16000, channels: 1, duration_s: 4, level_dbfs: -20, source_sha256: "sha1" },
  uploaded: false,
  sayariId: null,
  state: "pending",
  attempts: 0,
  nextAttemptAt: 0,
  lastCode: null,
  ...over,
});

function memStore(initial: OutboxItem[] = []) {
  const m = new Map(initial.map((i) => [i.id, i]));
  return { m, all: async () => [...m.values()], put: async (i: OutboxItem) => void m.set(i.id, i), remove: async (id: string) => void m.delete(id) };
}

describe("outbox decisions", () => {
  it("waits for the network without counting it against the take", () => {
    expect(decideUploadFailure({ status: 0, isNetwork: true }, 3, false)).toEqual({ kind: "retry", code: "offline", delayMs: 0 });
  });
  it("gives up on a refused or too-large file", () => {
    expect(decideUploadFailure({ status: 413, isNetwork: false }, 0, true).kind).toBe("fail");
    expect(decideUploadFailure({ status: 401, isNetwork: false }, 0, true)).toEqual({ kind: "hold", code: "unauthorized", delayMs: 60_000 });
    expect(decideUploadFailure({ status: 400, isNetwork: false }, 0, true).kind).toBe("fail");
    expect(decideUploadFailure({ status: 503, isNetwork: false }, 0, true).kind).toBe("retry");
  });
  it("maps submit answers", () => {
    expect(decideSubmit({ ok: true, duplicate: true }, 0)).toEqual({ kind: "done", duplicate: true });
    expect(decideSubmit({ ok: false, code: "recording_rejected", reason: "level" }, 0)).toEqual({ kind: "rejected", reason: "level" });
    expect(decideSubmit({ ok: false, code: "already_submitted" }, 0).kind).toBe("superseded");
    expect(decideSubmit({ ok: false, code: "campaign_paused" }, 0).kind).toBe("hold");
    expect(decideSubmit({ ok: false, code: "campaign_closed" }, 0).kind).toBe("fail");
    expect(decideSubmit({ ok: false, code: "server_error" }, 0).kind).toBe("retry");
    expect(decideSubmit({ ok: false, code: "invalid_input" }, 0).kind).toBe("fail");
    expect(decideSubmit({ ok: false, code: "rate_limited", retryAfterS: 7 }, 0)).toEqual({ kind: "retry", code: "rate_limited", delayMs: 7000 });
  });
  it("backs off, capped at five minutes", () => {
    expect(backoffMs(0, () => 0.5)).toBe(5000);
    expect(backoffMs(20, () => 0.5)).toBe(300000);
  });
  it("waits longer after an upload lost on the network (each retry resends the file)", () => {
    expect(uploadBackoffMs(0, () => 0.5)).toBe(15_000);
    expect(uploadBackoffMs(30, () => 0.5)).toBe(15 * 60_000);
    expect(decideUploadFailure({ status: 0, isNetwork: true }, 0, true, () => 0.5)).toEqual({ kind: "retry", code: "network", delayMs: 15_000 });
  });
  it("sends what is cheapest first: uploaded takes, then the smallest files", () => {
    const list = [item({ id: "big", blob: new Blob(["x".repeat(100)]), createdAt: 1 }), item({ id: "small", blob: new Blob(["x"]), createdAt: 2 }), item({ id: "up", uploaded: true, blob: new Blob(["x".repeat(500)]), createdAt: 3 })];
    expect(dueItems(list, "u1", 10).map((i) => i.id)).toEqual(["up", "small", "big"]);
  });
  it("sends only this user's due takes, oldest first, never failed ones", () => {
    const list = [item({ id: "b", createdAt: 2 }), item({ id: "a", createdAt: 1 }), item({ id: "f", state: "failed" }), item({ id: "o", userId: "u2" }), item({ id: "later", nextAttemptAt: 99 })];
    expect(dueItems(list, "u1", 10).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("outbox runner", () => {
  it("uploads, then submits with the Sayari id, then removes the take", async () => {
    const store = memStore([item()]);
    const upload = vi.fn(async () => ({ recordingId: "say-1" }));
    const submit = vi.fn(async () => ({ ok: true as const, data: { duplicate: false } }));
    const ob = createOutbox({ store, upload, submit, online: () => true });
    const events: OutboxEvent[] = [];
    ob.onEvent((e) => events.push(e));
    await ob.drain("u1");
    expect(submit).toHaveBeenCalledWith("m1", expect.objectContaining({ sayari_recording_id: "say-1" }));
    expect(store.m.size).toBe(0);
    expect(events.map((e) => e.type)).toEqual(["sent"]);
  });

  it("never uploads twice: a failed submit keeps the uploaded flag", async () => {
    const store = memStore([item()]);
    const upload = vi.fn(async () => ({ recordingId: null }));
    const submit = vi.fn(async () => ({ ok: false as const, status: 502, code: "bridge_unreachable" as const, message: "" }));
    const ob = createOutbox({ store, upload, submit, online: () => true, now: () => 100 });
    await ob.drain("u1");
    const saved = store.m.get("sha1")!;
    expect(saved.uploaded).toBe(true);
    expect(saved.state).toBe("pending");
    expect(saved.nextAttemptAt).toBeGreaterThan(100);
    store.m.set("sha1", { ...saved, nextAttemptAt: 0 });
    await ob.drain("u1");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("stops at once when offline and leaves takes untouched", async () => {
    const store = memStore([item(), item({ id: "sha2", missionId: "m2", createdAt: 2 })]);
    const upload = vi.fn();
    const ob = createOutbox({ store, upload, submit: vi.fn(), online: () => false });
    await ob.drain("u1");
    expect(upload).not.toHaveBeenCalled();
    expect(store.m.get("sha1")!.attempts).toBe(0);
  });

  it("stops the run after a network failure instead of trying every take on a dead link", async () => {
    const store = memStore([item(), item({ id: "sha2", missionId: "m2", createdAt: 2 })]);
    const upload = vi.fn(async () => {
      throw { status: 0, isNetwork: true };
    });
    const ob = createOutbox({ store, upload, submit: vi.fn(), online: () => true, now: () => 100 });
    await ob.drain("u1");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(store.m.get("sha1")!.lastCode).toBe("network");
    expect(store.m.get("sha2")!.attempts).toBe(0);
  });

  it("reports upload progress for the take being sent, then clears it", async () => {
    const store = memStore([item()]);
    const seen: (number | null)[] = [];
    const ob = createOutbox({
      store,
      upload: async (_i, onProgress) => {
        onProgress(10, 100);
        onProgress(11, 100);
        onProgress(11, 100);
        onProgress(100, 100);
        return { recordingId: null };
      },
      submit: async () => ({ ok: true as const, data: { duplicate: false } }),
      online: () => true,
    });
    ob.subscribe(() => seen.push(ob.snapshot().progress?.sent ?? null));
    await ob.drain("u1");
    expect(seen.filter((v) => v !== null)).toEqual([10, 11, 100]);
    expect(ob.snapshot().progress).toBeNull();
  });

  it("a refused take is dropped and reported so the mission is recorded again", async () => {
    const store = memStore([item({ uploaded: true })]);
    const ob = createOutbox({ store, upload: vi.fn(), submit: async () => ({ ok: false, status: 422, code: "recording_rejected", reason: "silence", message: "" }), online: () => true });
    const events: OutboxEvent[] = [];
    ob.onEvent((e) => events.push(e));
    await ob.drain("u1");
    expect(store.m.size).toBe(0);
    expect(events[0]).toMatchObject({ type: "rejected", reason: "silence" });
  });
});

describe("progress and activity helpers", () => {
  it("moves one mission to submitted", () => {
    const p = { total: 10, todo: 5, submitted: 1, accepted: 2, rejected: 2 };
    expect(shiftProgress(p, "todo")).toEqual({ ...p, todo: 4, submitted: 2 });
    expect(shiftProgress(p, "rejected")).toEqual({ ...p, rejected: 1, submitted: 2 });
    expect(shiftProgress(p, "accepted")).toBe(p);
  });
  it("counts a streak ending today or yesterday", () => {
    const day = 86_400_000;
    const now = new Date(2026, 9, 12, 12).getTime();
    const sent = (t: number) => ({ at: t, type: "sent" as const });
    expect(streakDays([sent(now), sent(now - day), sent(now - 3 * day)], now)).toBe(2);
    expect(streakDays([sent(now - day), sent(now - 2 * day)], now)).toBe(2);
    expect(streakDays([sent(now - 2 * day)], now)).toBe(0);
    expect(byDay([sent(now), sent(now - day), sent(now - 10)]).map((g) => g.items.length)).toEqual([2, 1]);
  });
});
