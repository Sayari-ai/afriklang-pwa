/**
 * Tiny localStorage wrapper that no-ops on the server.
 *
 * Stores import this directly rather than going through Zustand's
 * `persist` middleware every store has tiny, schema-stable state and
 * we want full control over keys (they need to match Flutter's
 * SharedPreferences exactly). Zustand's middleware would prefix or
 * version the values without that match.
 *
 * On the client we delegate to `window.localStorage`; on the server
 * everything no-ops, which is exactly the behaviour Zustand stores
 * need before the `<AppHydration>` boundary catches up.
 */

const isBrowser = typeof window !== "undefined";

export const safeStorage = {
  getItem(name: string): string | null {
    if (!isBrowser) return null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      // Private browsing / quota / disabled storage. Treat as empty.
      return null;
    }
  },
  setItem(name: string, value: string): void {
    if (!isBrowser) return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Quota errors are non-fatal best effort.
    }
  },
  removeItem(name: string): void {
    if (!isBrowser) return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};
