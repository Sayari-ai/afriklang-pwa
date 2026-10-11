import { describe, expect, it } from "vitest";
import { recordingIdFromResponse } from "./audio";

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
