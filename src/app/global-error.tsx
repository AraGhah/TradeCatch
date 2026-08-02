"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
    try {
      void fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: String(error.message ?? "client_error").slice(0, 300),
          digest: error.digest?.slice(0, 80),
          stack: error.digest ? undefined : error.stack?.slice(0, 800),
          path: window.location.pathname,
          buildId: process.env.NEXT_PUBLIC_BUILD_ID?.slice(0, 64),
        }),
        keepalive: true,
      });
    } catch {
      // ignore
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F4F1EC",
          color: "#1A2430",
          fontFamily:
            '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
          padding: 24,
          textAlign: "center",
        }}
      >
        <main>
          <p
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#5C6875",
              margin: 0,
            }}
          >
            TradeCatch
          </p>
          <h1
            style={{
              fontSize: "clamp(28px, 4vw, 42px)",
              letterSpacing: "-0.04em",
              margin: "16px 0 0",
            }}
          >
            Something went wrong.
          </h1>
          <p style={{ color: "#5C6875", marginTop: 12, lineHeight: 1.6 }}>
            Please try again, or call 438·993·6997.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 28,
              background: "#E4762B",
              color: "#0C141E",
              border: "none",
              borderRadius: 11,
              padding: "14px 22px",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
