// The API client must never send a signed-in speaker back to Google sign-in in a loop.
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() }));
const saved = vi.hoisted(() => ({ user: null as { id: string; email: string | null } | null }));
vi.mock("./auth-client", () => ({ getCampaignAuth: () => ({ auth }), storedCampaignUser: () => saved.user }));

const fetchMock = vi.fn();
const refused = () => new Response(JSON.stringify({ error: "unauthorized", message: "Sign in again." }), { status: 401 });
const ok = () => new Response(JSON.stringify({ contributor: {}, campaigns: [] }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "old" } } });
  auth.refreshSession.mockReset().mockResolvedValue({ data: { session: { access_token: "new" } }, error: null });
  auth.signOut.mockReset().mockResolvedValue({ error: null });
  saved.user = null;
  vi.stubGlobal("navigator", { onLine: true });
});

const list = async () => (await import("./api")).listCampaigns();

describe("unauthorized while holding a session", () => {
  it("renews the session once and retries", async () => {
    fetchMock.mockResolvedValueOnce(refused()).mockResolvedValueOnce(ok());
    expect(await list()).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer new");
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("still refused after a good renewal: a service fault, not 'sign in' (no loop)", async () => {
    fetchMock.mockResolvedValueOnce(refused()).mockResolvedValueOnce(refused());
    expect(await list()).toMatchObject({ ok: false, code: "misconfigured" });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("renewal fails: the session is dead, it is dropped and sign-in is asked", async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "expired" } });
    fetchMock.mockResolvedValueOnce(refused());
    expect(await list()).toMatchObject({ ok: false, code: "unauthorized" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("offline with a session that could not be renewed (APP-003)", () => {
  it("offline: answers offline before looking at the session", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await list()).toMatchObject({ ok: false, code: "offline" });
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("no token but a saved session: a network failure, not 'sign in'", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: { name: "AuthRetryableFetchError" } });
    saved.user = { id: "u1", email: null };
    expect(await list()).toMatchObject({ ok: false, code: "network" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no token and nothing saved: signed out", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await list()).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("a renewal that fails on the network keeps the session", async () => {
    const { AuthRetryableFetchError } = await import("@supabase/supabase-js");
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    fetchMock.mockResolvedValueOnce(refused());
    expect(await list()).toMatchObject({ ok: false, code: "network" });
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
