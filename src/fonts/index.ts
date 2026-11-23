/**
 * Self-hosted latin subsets. Loaded with next/font/local so the build never
 * calls Google Fonts (Next 16 + Turbopack fails when Google returns
 * extensionless /l/font?kit=…&skey=… URLs — vercel/next.js#99114).
 */
import localFont from "next/font/local";

/** Legacy heading face — kept for gradual migration; prefer Cabinet via --font-heading. */
export const archivo = localFont({
  variable: "--font-archivo",
  display: "swap",
  preload: false,
  fallback: ["Arial", "Helvetica Neue", "sans-serif"],
  src: [
    {
      path: "./archivo-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./archivo-latin-800-normal.woff2",
      weight: "800",
      style: "normal",
    },
  ],
});

/** Legacy body face — body now uses Cabinet; variable retained for any residual refs. */
export const plexSans = localFont({
  variable: "--font-plex-sans",
  display: "swap",
  preload: false,
  fallback: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
  src: [
    {
      path: "./ibm-plex-sans-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./ibm-plex-sans-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./ibm-plex-sans-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./ibm-plex-sans-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
});

export const plexMono = localFont({
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
  fallback: ["Consolas", "Menlo", "monospace"],
  src: [
    {
      path: "./ibm-plex-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./ibm-plex-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./ibm-plex-mono-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
});

/**
 * Primary UI type — Cabinet Grotesk (Fontshare, free for commercial use).
 * Weights: 400 Regular, 500 Medium, 700 Bold, 800 ExtraBold.
 */
export const cabinetGrotesk = localFont({
  variable: "--font-cabinet-grotesk",
  display: "swap",
  preload: true,
  fallback: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
  src: [
    {
      path: "./cabinet-grotesk-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./cabinet-grotesk-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./cabinet-grotesk-700.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./cabinet-grotesk-800.woff2",
      weight: "800",
      style: "normal",
    },
  ],
});
