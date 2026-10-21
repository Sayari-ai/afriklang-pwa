import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioUploadError, errorCodeOf, IDLE_TIMEOUT_MS, recordingIdFromResponse, RESPONSE_TIMEOUT_MS, uploadAudio } from "./audio";

describe("recordingIdFromResponse", () => {
  it("finds an id in the shapes an upload endpoint plausibly answers with", () => {
    expect(recordingIdFromResponse({ id: "a1" })).toBe("a1");
    expect(recordingIdFromResponse({ audio_id: 42 })).toBe("42");
    expect(recordingIdFromResponse([{ id: "x" }])).toBe("x");
    expect(recordingIdFromResponse({ files: [{ audio_id: "f9" }] })).toBe("f9");
    expect(recordingIdFromResponse({ results: [{ recording_id: "r1" }] })).toBe("r1");
  });

  it("answers null, never throws, when there is nothing usable", () => {
    for (const b of [null, undefined, "text", 5, [], {}, { id: "" }, { id: {} }, { files: [] }, { files: ["str"] }]) expect(recordingIdFromResponse(b)).toBeNull();
    expect(recordingIdFromResponse({ id: "x".repeat(500) })?.length).toBe(200);
  });
});

describe("errorCodeOf", () => {
  it("reads the proxy's error code, and nothing that is not one", () => {
    expect(errorCodeOf('{"error":"server_misconfigured","message":"SAYARI_UPLOAD_KEY is not set"}')).toBe("server_misconfigured");
    expect(errorCodeOf('{"error":"ticket_required"}')).toBe("ticket_required");
    for (const t of ["", "<html>500</html>", '{"error":"Expected multipart/form-data"}', '{"detail":"invalid_wav"}', '{"error":5}', "null", "[]"]) expect(errorCodeOf(t)).toBeNull();
  });
});

describe("uploadAudio over a slow link", () => {
  /** A stand-in XMLHttpRequest the test drives by hand. */
  class FakeXhr {
    static last: FakeXhr | null = null;
    upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    status = 0;
    statusText = "";
    responseText = "";
    aborted = false;
    headers: Record<string, string> = {};
    constructor() {
      FakeXhr.last = this;
    }
    open() {}
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send() {}
    abort() {
      this.aborted = true;
    }
    getResponseHeader(h: string) {
      return h === "retry-after" ? "120" : null;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const args = { file: new Blob(["x"]), filename: "a.wav", languageIso: "wol", consentRecorded: true, accessToken: "tok" };

  it("keeps going for as long as bytes move, and reports progress", async () => {
    const seen: number[] = [];
    const p = uploadAudio({ ...args, onProgress: (s) => seen.push(s) });
    const x = FakeXhr.last!;
    expect(x.headers.Authorization).toBe("Bearer tok");
    // Five minutes of a slow but moving upload: never aborted.
    for (let i = 1; i <= 20; i++) {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1000);
      x.upload.onprogress!({ loaded: i, total: 20, lengthComputable: true });
    }
    x.upload.onload!();
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS - 1000);
    x.status = 200;
    x.responseText = JSON.stringify({ id: "rec-1" });
    x.onload!();
    await expect(p).resolves.toEqual({ recordingId: "rec-1" });
    expect(x.aborted).toBe(false);
    expect(seen).toHaveLength(20);
  });

  it("sends the upload ticket in X-Campaign-Ticket, and no such header without one", async () => {
    void uploadAudio({ ...args, ticket: "aGVhZA.bWFj" }).catch(() => undefined);
    expect(FakeXhr.last!.headers).toEqual({ Authorization: "Bearer tok", "X-Campaign-Ticket": "aGVhZA.bWFj" });
    FakeXhr.last!.onabort?.();
    void uploadAudio(args).catch(() => undefined);
    expect(FakeXhr.last!.headers).toEqual({ Authorization: "Bearer tok" });
    FakeXhr.last!.onabort?.();
  });

  it("aborts as a network failure when nothing moves", async () => {
    const p = uploadAudio(args);
    const err = p.catch((e) => e);
    FakeXhr.last!.upload.onprogress!({ loaded: 1, total: 20, lengthComputable: true });
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1);
    const e = await err;
    expect(e).toBeInstanceOf(AudioUploadError);
    expect(e.isNetwork).toBe(true);
    expect(FakeXhr.last!.aborted).toBe(true);
  });

  it("passes the status and Retry-After of a refusal", async () => {
    const p = uploadAudio(args).catch((e) => e);
    const x = FakeXhr.last!;
    x.status = 429;
    x.responseText = '{"error":"rate_limited"}';
    x.onload!();
    const e = await p;
    expect(e.status).toBe(429);
    expect(e.retryAfterS).toBe(120);
    expect(e.code).toBe("rate_limited");
  });
});
