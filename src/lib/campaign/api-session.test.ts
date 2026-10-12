// The API client must never send a signed-in speaker back to Google sign-in in a loop.
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() }));
vi.mock("./auth-client", () => ({ getCampaignAuth: () => ({ auth }) }));

const fetchMock = vi.fn();
const refused = () => new Response(JSON.stringify({ error: "unauthorized", message: "Sign in again." }), { status: 401 });
const ok = () => new Response(JSON.stringify({ contributor: {}, campaigns: [] }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "old" } } });
  auth.refreshSession.mockReset().mockResolvedValue({ data: { session: { access_token: "new" } }, error: null });
  auth.signOut.mockReset().mockResolvedValue({ error: null });
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
