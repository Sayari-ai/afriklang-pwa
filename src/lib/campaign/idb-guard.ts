/**
 * IndexedDB failures in the outbox, made survivable (GitHub issue #50).
 *
 * idb-keyval rejects a failed request with `request.error`, which Safari on iOS can leave `null`
 * (for example when iOS drops the IndexedDB connection while the app was in the background). Two
 * things then went wrong:
 *   - the outbox runner started `drain()` without handling its rejection, so error tracking only
 *     saw "Non-Error promise rejection captured with value: null", and the runner stopped
 *     scheduling the next wake;
 *   - idb-keyval keeps its opened database for the life of the page, so once the connection was
 *     lost every later read and write failed too, until the app was reloaded.
 *
 * `guardStore` turns any failure into a named Error and makes the next call open the database
 * again; `settleQuietly` lets the runner carry on and reports the first failure only.
 */

/** A storage failure with a name and message error tracking can group, whatever was rejected. */
export class OutboxStorageError extends Error {
  constructor(public readonly original: unknown) {
    const detail = original instanceof Error ? `${original.name}: ${original.message}` : original === null ? "the browser gave no error (null)" : `a ${typeof original} was rejected`;
    super(`Outbox storage (IndexedDB) failed: ${detail}`);
    this.name = "OutboxStorageError";
  }
}

export function asStorageError(e: unknown): Error {
  return e instanceof OutboxStorageError ? e : new OutboxStorageError(e);
}

/**
 * Wrap each store operation: on failure, `reopen()` drops the cached database (the next call opens
 * it again) and the rejection becomes an OutboxStorageError.
 */
export function guardStore<S extends Record<string, (...args: never[]) => Promise<unknown>>>(store: S, reopen: () => void): S {
  const out = {} as Record<string, unknown>;
  for (const [name, op] of Object.entries(store)) {
    out[name] = (...args: never[]) =>
      op(...args).catch((e: unknown) => {
        reopen();
        throw asStorageError(e);
      });
  }
  return out as S;
}

/**
 * Run a background task (the outbox drain) so it never rejects: the first failure of the page is
 * reported, later ones only resolve.
 */
export function quietRunner(report: (e: Error) => void): (task: () => Promise<void>) => Promise<void> {
  let reported = false;
  return (task) => {
    let p: Promise<void>;
    try {
      p = task();
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.catch((e: unknown) => {
      if (reported) return;
      reported = true;
      report(e instanceof Error ? e : asStorageError(e));
    });
  };
}
