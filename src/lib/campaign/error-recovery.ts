/**
 * What the "Retry" button of the error screens (app/error.tsx, app/global-error.tsx) calls.
 *
 * Next renamed the prop it passes to error boundaries: `unstable_retry` (16.2) became `retry`
 * (16.3), and 16.4 no longer passes `unstable_retry` at all. The app kept calling
 * `unstable_retry` after the bump to 16.4.6, so Retry threw "t is not a function" on every tap
 * and left the speaker stuck on the error screen. The props are typed by hand in those files, so
 * the type check could not see the rename.
 *
 * This takes whichever function Next gave and, when it gave none, reloads the page: a future
 * rename can make Retry heavier, never dead.
 */

export type ErrorBoundaryActions = {
  /** Re-fetch and re-render the segment (Next 16.3+). */
  retry?: unknown;
  /** Re-render without re-fetching (every Next version). */
  reset?: unknown;
  /** The 16.2 name, gone in 16.4. Kept so an older build still works. */
  unstable_retry?: unknown;
};

const isFunction = (f: unknown): f is () => void => typeof f === "function";

/** The function the Retry button should call. Never throws when called. */
export function retryAction(props: ErrorBoundaryActions, reload: () => void = () => window.location.reload()): () => void {
  const fn = [props.retry, props.unstable_retry, props.reset].find(isFunction);
  return () => {
    try {
      if (fn) fn();
      else reload();
    } catch {
      reload();
    }
  };
}
