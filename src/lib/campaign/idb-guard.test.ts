import { describe, expect, it, vi } from "vitest";
import { OutboxStorageError, asStorageError, guardStore, quietRunner } from "./idb-guard";

describe("guardStore (GitHub #50)", () => {
  it("passes results through", async () => {
    const reopen = vi.fn();
    const store = guardStore({ get: async (id: string) => `item ${id}` }, reopen);
    await expect(store.get("a")).resolves.toBe("item a");
    expect(reopen).not.toHaveBeenCalled();
  });

  it("turns a null rejection (iOS IndexedDB) into a named error and reopens the database", async () => {
    const reopen = vi.fn();
    const store = guardStore({ put: () => Promise.reject(null) }, reopen);
    const err = await store.put().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutboxStorageError);
    expect((err as Error).message).toContain("no error (null)");
    expect(reopen).toHaveBeenCalledOnce();
  });

  it("keeps the original error's name and message", async () => {
    const lost = Object.assign(new Error("Connection to Indexed Database server lost. Refresh the page to try again"), { name: "UnknownError" });
    const store = guardStore({ all: () => Promise.reject(lost) }, vi.fn());
    const err = (await store.all().catch((e: unknown) => e)) as OutboxStorageError;
    expect(err.message).toBe("Outbox storage (IndexedDB) failed: UnknownError: Connection to Indexed Database server lost. Refresh the page to try again");
    expect(err.original).toBe(lost);
  });

  it("works again after the reopen", async () => {
    let broken = true;
    const reopen = () => {
      broken = false;
    };
    const store = guardStore({ get: () => (broken ? Promise.reject(null) : Promise.resolve("ok")) }, reopen);
    await expect(store.get()).rejects.toBeInstanceOf(OutboxStorageError);
    await expect(store.get()).resolves.toBe("ok");
  });
});

describe("quietRunner", () => {
  it("never rejects and reports only the first failure", async () => {
    const report = vi.fn();
    const run = quietRunner(report);
    await expect(run(() => Promise.reject(null))).resolves.toBeUndefined();
    await expect(run(() => Promise.reject(new Error("again")))).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0]).toBeInstanceOf(OutboxStorageError);
  });

  it("survives a task that throws synchronously", async () => {
    const report = vi.fn();
    await expect(
      quietRunner(report)(() => {
        throw new Error("sync");
      }),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "sync" }));
  });

  it("resolves normally when the task works", async () => {
    const report = vi.fn();
    await expect(quietRunner(report)(async () => undefined)).resolves.toBeUndefined();
    expect(report).not.toHaveBeenCalled();
    expect(asStorageError(new OutboxStorageError(null))).toBeInstanceOf(OutboxStorageError);
  });
});
