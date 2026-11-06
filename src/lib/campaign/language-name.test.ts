import { describe, expect, it } from "vitest";
import { languageInText } from "./language-name";

describe("a language name inside a sentence", () => {
  it("French: lower case, as in the emails", () => {
    expect(languageInText("Pulaar", "fr")).toBe("pulaar");
    expect(languageInText("Wolof", "fr-SN")).toBe("wolof");
    expect(languageInText("Éwé", "fr")).toBe("éwé");
    expect(languageInText("Pulaar du Fouta", "fr")).toBe("pulaar du Fouta");
  });

  it("French: already lower case, a code or an initialism stays as it is", () => {
    expect(languageInText("wolof", "fr")).toBe("wolof");
    expect(languageInText("FUC", "fr")).toBe("FUC");
    expect(languageInText("WOL_GEN", "fr")).toBe("WOL_GEN");
    expect(languageInText("N'Ko", "fr")).toBe("N'Ko");
    expect(languageInText("X", "fr")).toBe("X");
    expect(languageInText("", "fr")).toBe("");
  });

  it("English never changes", () => {
    expect(languageInText("Pulaar", "en")).toBe("Pulaar");
    expect(languageInText("Wolof", "en-GB")).toBe("Wolof");
  });
});
