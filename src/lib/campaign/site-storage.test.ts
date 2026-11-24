import { describe, expect, it } from "vitest";
import { siteStorageBlocked } from "./site-storage";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const securityError = () => Object.assign(new Error("Failed to read the 'sessionStorage' property from 'Window': Access is denied for this document."), { name: "SecurityError" });

describe("siteStorageBlocked (GitHub #86)", () => {
  it("is false where both storages work", () => {
    expect(siteStorageBlocked({ localStorage: memoryStorage(), sessionStorage: memoryStorage() })).toBe(false);
  });

  it("is true when reading window.sessionStorage throws (Chrome with site data blocked)", () => {
    const host = {
      localStorage: memoryStorage(),
      get sessionStorage(): Storage {
        throw securityError();
      },
    };
    expect(siteStorageBlocked(host)).toBe(true);
  });

  it("is true when reading window.localStorage throws", () => {
    const host = {
      get localStorage(): Storage {
        throw securityError();
      },
      sessionStorage: memoryStorage(),
    };
    expect(siteStorageBlocked(host)).toBe(true);
  });

  it("is true when a storage is missing or refuses writes", () => {
    expect(siteStorageBlocked({ localStorage: memoryStorage(), sessionStorage: null })).toBe(true);
    const refusing = { ...memoryStorage(), setItem: () => { throw securityError(); } } as Storage;
    expect(siteStorageBlocked({ localStorage: refusing, sessionStorage: memoryStorage() })).toBe(true);
  });

  it("is false when a storage is only full (the session can still be read)", () => {
    const full = { ...memoryStorage(), setItem: () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); } } as Storage;
    expect(siteStorageBlocked({ localStorage: full, sessionStorage: memoryStorage() })).toBe(false);
  });

  it("is false on the server", () => {
    expect(siteStorageBlocked(undefined)).toBe(false);
  });

  it("leaves nothing behind", () => {
    const s = memoryStorage();
    siteStorageBlocked({ localStorage: s, sessionStorage: s });
    expect(s.length).toBe(0);
  });
});
