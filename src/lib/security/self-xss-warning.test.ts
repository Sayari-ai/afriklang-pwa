import { describe, expect, it, vi } from "vitest";
import { printSelfXssWarning } from "./self-xss-warning";

describe("printSelfXssWarning", () => {
  it("prints the bilingual warning once per page load", () => {
    const log = vi.fn();
    printSelfXssWarning(log);
    printSelfXssWarning(log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain("Stop! / Arrêtez !");
    expect(log.mock.calls[1][0]).toContain("scam");
    expect(log.mock.calls[1][0]).toContain("arnaque");
  });
});
