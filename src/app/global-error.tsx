"use client";

import { useEffect } from "react";

import { reportException } from "@/lib/analytics/client";

/**
 * Last-resort boundary for errors in the root layout. It replaces the
 * layout (and therefore the next-intl provider), so no translations here:
 * the text is in English and French, and the button reloads the page (a
 * file missing after an update needs a full load, APP2-22).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportException(error, { boundary: "app/global-error.tsx", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#000",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p style={{ fontSize: 18, fontWeight: 600, margin: 0, textAlign: "center", padding: "0 16px" }}>Something went wrong</p>
        <p lang="fr" style={{ fontSize: 18, fontWeight: 600, margin: 0, textAlign: "center", padding: "0 16px" }}>
          Un problème est survenu
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              window.location.reload();
            } catch {
              unstable_retry();
            }
          }}
          style={{
            padding: "8px 24px",
            borderRadius: 999,
            border: 0,
            background: "#fff",
            color: "#000",
            fontWeight: 600,
            minHeight: 48,
          }}
        >
          Reload · Recharger
        </button>
      </body>
    </html>
  );
}
