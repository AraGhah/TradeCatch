"use client";

import { useEffect, useState } from "react";

/**
 * Renders an `otpauth://` URI as a scannable QR code, entirely in the browser.
 * The URI carries the TOTP secret, so it is never sent to an image service:
 * the matrix is computed here and drawn as an SVG path (no innerHTML, no
 * data: URL, nothing the page's CSP has to be loosened for).
 */
export function OtpauthQr({ value, label }: { value: string; label: string }) {
  const [matrix, setMatrix] = useState<{ size: number; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Loaded on demand so the encoder only ships to people who reach this step.
    void import("./otpauth-qr-path")
      .then(({ qrSvgPath }) => {
        if (!cancelled) setMatrix(qrSvgPath(value));
      })
      .catch(() => {
        if (!cancelled) setMatrix(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!matrix) return null;
  const quiet = 4; // quiet zone the QR standard asks for, in modules
  const span = matrix.size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="mfa-qr"
      viewBox={`${-quiet} ${-quiet} ${span} ${span}`}
      shapeRendering="crispEdges"
      className="mx-auto h-48 w-48 rounded-md bg-white"
    >
      <rect x={-quiet} y={-quiet} width={span} height={span} fill="#fff" />
      <path d={matrix.path} fill="#000" />
    </svg>
  );
}
