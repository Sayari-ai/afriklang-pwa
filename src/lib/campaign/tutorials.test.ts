import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TUTORIALS, clock, tutorialFiles, videoLocale, type TutorialId } from "./tutorials";

const PUBLIC = path.resolve(__dirname, "../../../public");

describe("tutorial videos", () => {
  it("plays French for a French app and English for anything else", () => {
    expect(videoLocale("fr")).toBe("fr");
    expect(videoLocale("fr-SN")).toBe("fr");
    expect(videoLocale("en")).toBe("en");
    expect(videoLocale("wo")).toBe("en");
    expect(tutorialFiles("s2", "fr")).toEqual({ video: "/tutorials/s2-record-campaign.fr.mp4", poster: "/tutorials/s2-record-campaign.fr.jpg" });
  });

  it("writes the length as m:ss", () => {
    expect(clock(89)).toBe("1:29");
    expect(clock(65)).toBe("1:05");
  });

  it("has every file, and the sizes the button shows are the files' sizes", () => {
    for (const id of Object.keys(TUTORIALS) as TutorialId[]) {
      for (const lang of ["en", "fr"] as const) {
        const { video, poster } = tutorialFiles(id, lang);
        const bytes = statSync(path.join(PUBLIC, video)).size;
        expect(Math.round((bytes / 1e6) * 10) / 10, `${video} size`).toBe(TUTORIALS[id].mb[lang]);
        expect(statSync(path.join(PUBLIC, poster)).size).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the videos out of the service worker's precache", () => {
    const config = readFileSync(path.resolve(__dirname, "../../../next.config.ts"), "utf8");
    expect(config).toMatch(/publicExcludes:\s*\[[^\]]*"!tutorials\/\*\*\/\*"/);
  });
});
