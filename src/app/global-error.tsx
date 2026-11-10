"use client";

import { useEffect } from "react";

import { reportException } from "@/lib/analytics/client";

/**
 * Last-resort boundary for errors in the root layout. It replaces the
 * layout (and therefore the next-intl provider), so no translations here.
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
        <p style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          style={{
            padding: "8px 24px",
            borderRadius: 999,
            border: 0,
            background: "#fff",
            color: "#000",
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      </body>
    </html>
  );
}
