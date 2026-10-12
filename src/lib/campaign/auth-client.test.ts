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
