"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[global-error]", error);

  if (typeof window !== "undefined") {
    try {
      void fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          digest: error.digest,
          stack: error.stack?.slice(0, 2000),
          path: window.location.pathname,
        }),
        keepalive: true,
      });
    } catch {
      // ignore
    }
  }

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
        <div>
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
        </div>
      </body>
    </html>
  );
}
