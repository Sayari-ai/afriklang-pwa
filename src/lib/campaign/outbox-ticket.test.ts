// The outbox with upload tickets: ticket -> upload -> submit (docs/CAMPAIGN_PIPELINE_COMPLETION_PLAN.md §3.2).
import { describe, expect, it, vi } from "vitest";
import { createOutbox, type OutboxDeps, type OutboxEvent } from "./outbox";
import { decideTicket, reusableTicket, storedTicketFrom, TICKET_MAX_LIFETIME_MS, type OutboxItem } from "./outbox-logic";
import type { CampaignErrorCode, CampaignResult } from "./types";

const NOW = 1_760_000_000_000;
const MIN = 60_000;
const T1 = "eyJ2IjoxfQ.bWFjMQ";
const T2 = "eyJ2IjoyfQ.bWFjMg";

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
  metadata: { format: "wav", sample_rate: 16000, channels: 1, duration_s: 4, level_dbfs: -20, source_sha256: "a".repeat(64) },
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
  return { m, all: async () => [...m.values()], get: async (id: string) => m.get(id), put: async (i: OutboxItem) => void m.set(i.id, i), remove: async (id: string) => void m.delete(id) };
}

type TicketRes = CampaignResult<{ ticket: string; expires_at: string }>;
const issued = (ticket = T1, inMs = 30 * MIN): TicketRes => ({ ok: true, data: { ticket, expires_at: new Date(NOW + inMs).toISOString() } });
const refused = (code: CampaignErrorCode, status = 403): TicketRes => ({ ok: false, status, code, message: "" });

function setup(store: ReturnType<typeof memStore>, requestTicket: OutboxDeps["requestTicket"], over: Partial<OutboxDeps> = {}) {
  const upload = vi.fn<OutboxDeps["upload"]>(async () => ({ recordingId: "say-1" }));
  const submit = vi.fn(async () => ({ ok: true as const, data: { duplicate: false } }));
  const log = vi.fn();
  const ob = createOutbox({ store, upload, submit, requestTicket, log, online: () => true, now: () => NOW, ...over });
  const events: OutboxEvent[] = [];
  ob.onEvent((e) => events.push(e));
  return { ob, upload, submit, log, events };
}

describe("outbox with upload tickets", () => {
  it("asks for a ticket for this file, saves it before uploading, sends it, then submits", async () => {
    const store = memStore([item()]);
    const requestTicket = vi.fn(async () => issued());
    const { ob, upload, submit, events } = setup(store, requestTicket);
    upload.mockImplementation(async () => {
      // The ticket is on the stored take before the upload starts (an app killed now resumes with it).
      expect(store.m.get("sha1")!.ticket).toEqual({ value: T1, expiresAt: NOW + 30 * MIN });
      return { recordingId: "say-1" };
    });
    await ob.drain("u1");
    expect(requestTicket).toHaveBeenCalledWith(expect.objectContaining({ missionId: "m1", metadata: expect.objectContaining({ source_sha256: "a".repeat(64), duration_s: 4 }) }));
    expect(upload).toHaveBeenCalledWith(expect.anything(), expect.any(Function), expect.any(AbortSignal), T1);
    expect(submit).toHaveBeenCalledWith("m1", expect.objectContaining({ sayari_recording_id: "say-1" }));
    expect(store.m.size).toBe(0);
    expect(events.map((e) => e.type)).toEqual(["sent"]);
  });

  it("reuses a saved ticket with more than 2 minutes left, asks again under that", async () => {
    const store = memStore([item({ ticket: { value: T1, expiresAt: NOW + 10 * MIN } }), item({ id: "sha2", missionId: "m2", createdAt: 2, ticket: { value: T1, expiresAt: NOW + 90_000 } })]);
    const requestTicket = vi.fn(async () => issued(T2));
    const { ob, upload } = setup(store, requestTicket);
    await ob.drain("u1");
    expect(requestTicket).toHaveBeenCalledTimes(1);
    expect(requestTicket).toHaveBeenCalledWith(expect.objectContaining({ id: "sha2" }));
    expect(upload.mock.calls.map((c) => [c[0].id, c[3]])).toEqual([
      ["sha1", T1],
      ["sha2", T2],
    ]);
  });

  it("resumes after a restart with the saved ticket (no new ticket while it is valid)", async () => {
    const store = memStore([item()]);
    const first = setup(store, vi.fn(async () => issued()));
    first.upload.mockRejectedValue({ status: 0, isNetwork: true });
    await first.ob.drain("u1");
    expect(store.m.get("sha1")).toMatchObject({ ticket: { value: T1 }, uploaded: false, lastCode: "network" });

    // The app is closed and opened again: a new outbox on the same storage, a few minutes later.
    store.m.set("sha1", { ...store.m.get("sha1")!, nextAttemptAt: 0 });
    const requestTicket = vi.fn(async () => issued(T2));
    const second = setup(store, requestTicket, { now: () => NOW + 5 * MIN });
    await second.ob.drain("u1");
    expect(requestTicket).not.toHaveBeenCalled();
    expect(second.upload.mock.calls[0][3]).toBe(T1);
    expect(store.m.size).toBe(0);
  });

  it("a refusal that cannot clear is final: audio kept, shown as failed with its reason, never retried by itself", async () => {
    for (const [code, status] of [["campaign_closed", 410], ["not_assigned", 404], ["campaign_not_open", 403], ["blocked", 403], ["not_linked", 403]] as const) {
      const store = memStore([item()]);
      const requestTicket = vi.fn(async () => refused(code, status));
      const { ob, upload, events } = setup(store, requestTicket);
      await ob.drain("u1");
      await ob.drain("u1");
      await ob.retryNow("u1");
      expect(requestTicket, code).toHaveBeenCalledTimes(1);
      expect(upload).not.toHaveBeenCalled();
      const kept = store.m.get("sha1")!;
      expect(kept, code).toMatchObject({ state: "failed", lastCode: code, uploaded: false });
      expect(kept.blob.size).toBe(1);
      expect(events).toEqual([expect.objectContaining({ type: "failed", code })]);
      expect(ob.nextWake("u1")).toBeNull();
    }
  });

  it("a refusal that may clear holds the take, as a submit would, and does not upload", async () => {
    for (const code of ["campaign_paused", "account_consent", "partner_consent", "consent_version_changed", "profile_incomplete", "unauthorized"] as const) {
      const store = memStore([item()]);
      const { ob, upload } = setup(store, vi.fn(async () => refused(code, code === "unauthorized" ? 401 : 403)));
      await ob.drain("u1");
      expect(upload, code).not.toHaveBeenCalled();
      const held = store.m.get("sha1")!;
      expect(held, code).toMatchObject({ state: "held", lastCode: code, attempts: 1 });
      expect(held.nextAttemptAt).toBeGreaterThanOrEqual(NOW + MIN);
    }
  });

  it("a withdrawn campaign consent deletes the take, as a submit would (its audio must not reach Sayari)", async () => {
    const store = memStore([item()]);
    const { ob, upload, events } = setup(store, vi.fn(async () => refused("campaign_consent")));
    await ob.drain("u1");
    expect(upload).not.toHaveBeenCalled();
    expect(store.m.size).toBe(0);
    expect(events.map((e) => e.type)).toEqual(["dropped"]);
  });

  it("an older dashboard (no ticket route) uploads without a ticket, exactly as before, and says so once", async () => {
    const store = memStore([item(), item({ id: "sha2", missionId: "m2", createdAt: 2 })]);
    const requestTicket = vi.fn(async () => refused("unsupported", 404));
    const { ob, upload, submit, log } = setup(store, requestTicket);
    await ob.drain("u1");
    expect(upload.mock.calls.map((c) => c[3])).toEqual([null, null]);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(store.m.size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("without requestTicket (tickets not wired), uploads as before", async () => {
    const store = memStore([item()]);
    const { ob, upload } = setup(store, undefined);
    await ob.drain("u1");
    expect(upload.mock.calls[0][3]).toBeNull();
  });

  it("a ticket call lost on the network rides the upload backoff and stops the run", async () => {
    const store = memStore([item(), item({ id: "sha2", missionId: "m2", createdAt: 2 })]);
    const requestTicket = vi.fn(async (): Promise<TicketRes> => ({ ok: false, status: 0, code: "network", message: "" }));
    const { ob, upload } = setup(store, requestTicket);
    await ob.drain("u1");
    expect(requestTicket).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(store.m.get("sha1")).toMatchObject({ state: "pending", lastCode: "network", attempts: 1 });
    expect(store.m.get("sha1")!.nextAttemptAt - NOW).toBeGreaterThanOrEqual(12_000);
    expect(store.m.get("sha2")!.attempts).toBe(0);
  });

  it("a thrown ticket call counts as a network failure; offline leaves the take untouched", async () => {
    const store = memStore([item()]);
    const { ob } = setup(store, vi.fn(async () => Promise.reject(new Error("boom"))));
    await ob.drain("u1");
    expect(store.m.get("sha1")).toMatchObject({ lastCode: "network" });

    const store2 = memStore([item()]);
    const { ob: ob2 } = setup(store2, vi.fn(async (): Promise<TicketRes> => ({ ok: false, status: 0, code: "offline", message: "" })));
    await ob2.drain("u1");
    expect(store2.m.get("sha1")).toMatchObject({ attempts: 0, lastCode: null, state: "pending" });
  });

  it("an answer without a usable ticket is retried later, never uploaded with", async () => {
    const store = memStore([item()]);
    const { ob, upload } = setup(store, vi.fn(async (): Promise<TicketRes> => ({ ok: true, data: { ticket: "not a ticket", expires_at: "soon" } })));
    await ob.drain("u1");
    expect(upload).not.toHaveBeenCalled();
    expect(store.m.get("sha1")).toMatchObject({ state: "pending", lastCode: "bridge_error" });
    expect(store.m.get("sha1")!.ticket).toBeUndefined();
  });

  it("Sayari refusing the ticket (409 from the proxy) drops it, and the next try asks for a new one", async () => {
    const store = memStore([item()]);
    const requestTicket = vi.fn(async () => issued(T1)).mockResolvedValueOnce(issued(T1)).mockResolvedValueOnce(issued(T2));
    const { ob, upload, submit } = setup(store, requestTicket);
    upload.mockRejectedValueOnce({ status: 409, isNetwork: false });
    await ob.drain("u1");
    expect(store.m.get("sha1")).toMatchObject({ state: "pending", ticket: null });
    store.m.set("sha1", { ...store.m.get("sha1")!, nextAttemptAt: 0 });
    await ob.drain("u1");
    expect(upload.mock.calls.map((c) => c[3])).toEqual([T1, T2]);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("a take deleted while its ticket was being asked for is not written back", async () => {
    const store = memStore([item()]);
    const requestTicket = vi.fn(async () => {
      store.m.delete("sha1");
      return issued();
    });
    const { ob, upload } = setup(store, requestTicket);
    await ob.drain("u1");
    expect(store.m.size).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("an already uploaded take goes straight to submit, no ticket", async () => {
    const store = memStore([item({ uploaded: true, sayariId: "say-9" })]);
    const requestTicket = vi.fn(async () => issued());
    const { ob, submit } = setup(store, requestTicket);
    await ob.drain("u1");
    expect(requestTicket).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("ticket decisions", () => {
  it("keeps a ticket's shape and caps its lifetime at 30 minutes of the phone's clock", () => {
    expect(storedTicketFrom({ ticket: T1, expires_at: new Date(NOW + 20 * MIN).toISOString() }, NOW)).toEqual({ value: T1, expiresAt: NOW + 20 * MIN });
    expect(storedTicketFrom({ ticket: T1, expires_at: (NOW + 20 * MIN) / 1000 }, NOW)).toEqual({ value: T1, expiresAt: NOW + 20 * MIN });
    expect(storedTicketFrom({ ticket: `${T1}.c2ln`, expires_at: new Date(NOW + 5 * 3_600_000).toISOString() }, NOW)).toEqual({ value: `${T1}.c2ln`, expiresAt: NOW + TICKET_MAX_LIFETIME_MS });
    for (const bad of [null, {}, { ticket: T1 }, { ticket: T1, expires_at: "later" }, { ticket: "a b.c", expires_at: NOW }, { ticket: "nodot", expires_at: NOW }, { ticket: `a.${"b".repeat(5000)}`, expires_at: NOW }, { ticket: 5, expires_at: NOW }]) {
      expect(storedTicketFrom(bad, NOW)).toBeNull();
    }
  });

  it("reuses a ticket only with more than 2 minutes left", () => {
    expect(reusableTicket({ ticket: { value: T1, expiresAt: NOW + 2 * MIN + 1 } }, NOW)).toBe(T1);
    expect(reusableTicket({ ticket: { value: T1, expiresAt: NOW + 2 * MIN } }, NOW)).toBeNull();
    expect(reusableTicket({ ticket: null }, NOW)).toBeNull();
    expect(reusableTicket({}, NOW)).toBeNull();
  });

  it("maps ticket refusals", () => {
    expect(decideTicket({ ok: false, code: "unsupported" }, 0)).toEqual({ kind: "without" });
    expect(decideTicket({ ok: false, code: "campaign_closed" }, 0)).toEqual({ kind: "fail", code: "campaign_closed" });
    expect(decideTicket({ ok: false, code: "campaign_paused" }, 0)).toMatchObject({ kind: "hold", code: "campaign_paused" });
    expect(decideTicket({ ok: false, code: "already_submitted" }, 0)).toEqual({ kind: "superseded" });
    expect(decideTicket({ ok: false, code: "invalid_input" }, 0)).toEqual({ kind: "fail", code: "invalid_input" });
    expect(decideTicket({ ok: false, code: "offline" }, 0)).toEqual({ kind: "retry", code: "offline", delayMs: 0 });
    // Retry-After is honoured, and nothing is retried faster than an upload would be.
    expect(decideTicket({ ok: false, code: "rate_limited", retryAfterS: 600 }, 0, () => 0.5)).toEqual({ kind: "retry", code: "rate_limited", delayMs: 600_000 });
    expect(decideTicket({ ok: false, code: "server_error" }, 0, () => 0.5)).toEqual({ kind: "retry", code: "server_error", delayMs: 15_000 });
  });
});
