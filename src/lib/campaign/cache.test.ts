import { describe, expect, it, vi } from "vitest";
import { createCache, FRESH_MS } from "./cache";
import type { CampaignResult } from "./types";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    map: m,
  };
}

const ok = <T,>(data: T): CampaignResult<T> => ({ ok: true, data });

describe("campaign cache", () => {
  it("shares one request between callers and stores the answer", async () => {
    const s = memoryStorage();
    const c = createCache({ storage: () => s });
    const loader = vi.fn(() => Promise.resolve(ok({ n: 1 })));
    await Promise.all([c.load("u|a", loader), c.load("u|a", loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(c.read("u|a").data).toEqual({ n: 1 });
    expect([...s.map.keys()]).toEqual(["afriklang.campaign.cache.v1:u|a"]);
  });

  it("does not fetch a fresh copy again, unless forced", async () => {
    let t = 1000;
    const c = createCache({ storage: () => memoryStorage(), now: () => t });
    const loader = vi.fn(() => Promise.resolve(ok(1)));
    await c.load("k", loader);
    await c.load("k", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    await c.load("k", loader, true);
    expect(loader).toHaveBeenCalledTimes(2);
    t += FRESH_MS + 1;
    await c.load("k", loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("paints the saved copy from storage, and keeps it when a refresh fails", async () => {
    const s = memoryStorage();
    s.setItem("afriklang.campaign.cache.v1:k", JSON.stringify({ data: { saved: true }, at: 1 }));
    const c = createCache({ storage: () => s });
    expect(c.read("k").data).toEqual({ saved: true });
    await c.load("k", () => Promise.resolve({ ok: false, status: 0, code: "offline", message: "" }));
    expect(c.read("k").data).toEqual({ saved: true });
    expect(c.read("k").failure?.code).toBe("offline");
  });

  it("update edits in place and notifies; clear forgets the device copy", async () => {
    const s = memoryStorage();
    const c = createCache({ storage: () => s });
    await c.load("k", () => Promise.resolve(ok({ n: 1 })));
    const spy = vi.fn();
    c.subscribe(spy);
    c.update<{ n: number }>("k", (d) => ({ n: d.n + 1 }));
    expect(c.read("k").data).toEqual({ n: 2 });
    expect(spy).toHaveBeenCalled();
    c.clear();
    expect(s.length).toBe(0);
    expect(c.read("k").data).toBeNull();
  });

  it("a thrown loader becomes a failure, not an exception", async () => {
    const c = createCache({ storage: () => null });
    await c.load("k", () => Promise.reject(new Error("boom")));
    expect(c.read("k").failure?.code).toBe("unknown");
  });
});
