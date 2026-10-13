import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal browser for supabase-js (no jsdom in this project): a URL, history and localStorage.
let href = "http://localhost/";
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
function openPage(path: string) {
  href = new URL(path, "http://localhost").toString();
  const location = {
    get href() { return href; },
    get search() { return new URL(href).search; },
    get hash() { return new URL(href).hash; },
    set hash(v: string) { const u = new URL(href); u.hash = v; href = u.toString(); },
    get pathname() { return new URL(href).pathname; },
    get origin() { return "http://localhost"; },
  };
  const history = { state: null, replaceState: (_s: unknown, _t: string, url: string) => { href = new URL(url, href).toString(); } };
  const noop = () => {};
  vi.stubGlobal("window", { location, history, localStorage, addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal("localStorage", localStorage);
  return location;
}

vi.mock("./dev-mock", () => ({ installCampaignMock: () => {} }));

const STORAGE_KEY = "afriklang.campaign.auth.v1";

async function freshClient() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  return (await import("./auth-client")).getCampaignAuth();
}

const session = {
  access_token: "header.eyJzdWIiOiJ1MSIsImV4cCI6OTk5OTk5OTk5OX0.sig",
  refresh_token: "r1",
  expires_in: 3600,
  expires_at: 9999999999,
  token_type: "bearer",
  user: { id: "u1", aud: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("campaign auth client", () => {
  it("exchanges Google's ?code= on /campaign and removes it from the URL", async () => {
    const location = openPage("/campaign?code=abc123");
    localStorage.setItem(`${STORAGE_KEY}-code-verifier`, JSON.stringify("verifier"));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { data } = await (await freshClient()).auth.getSession();

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/auth/v1/token?grant_type=pkce");
    expect(data.session?.access_token).toBe(session.access_token);
    expect(location.search).toBe("");
  });

  it("leaves the invitation fragment alone when there is no sign-in to finish", async () => {
    const location = openPage("/campaign#t=invite-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { data, error } = await (await freshClient()).auth.getSession();

    expect(error).toBeNull();
    expect(data.session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(location.hash).toBe("#t=invite-token");
  });
});

describe("known speaker offline (APP-003)", () => {
  it("reads the saved session's user only when a refresh token is kept", async () => {
    openPage("/campaign");
    const { storedCampaignUser } = await import("./auth-client");
    expect(storedCampaignUser()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    expect(storedCampaignUser()).toEqual({ id: "u1", email: "a@example.com" });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, refresh_token: "" }));
    expect(storedCampaignUser()).toBeNull();
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(storedCampaignUser()).toBeNull();
  });

  it("an expired token whose renewal fails offline keeps the speaker signed in (unverified)", async () => {
    openPage("/campaign");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, expires_at: 1 }));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const client = await freshClient();
    // supabase-js retries a failed renewal with backoff for a while before giving up.
    vi.useFakeTimers();
    try {
      const pending = client.auth.getSession();
      await vi.advanceTimersByTimeAsync(120_000);
      const { data } = await pending;
      expect(data.session).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    const { sessionStateFor } = await import("./hooks");
    expect(sessionStateFor(null)).toEqual({ status: "signedIn", userId: "u1", email: "a@example.com", verified: false });
    expect(sessionStateFor(null, true)).toEqual({ status: "signedOut" });
  });

  it("a refresh token Auth refuses: signed out", async () => {
    openPage("/campaign");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, expires_at: 1 }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token" }), { status: 400, headers: { "content-type": "application/json" } })));
    const client = await freshClient();
    await client.auth.getSession();
    const { sessionStateFor } = await import("./hooks");
    expect(sessionStateFor(null)).toEqual({ status: "signedOut" });
  });
});
