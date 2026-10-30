/**
 * Self-hosted latin subsets. Loaded with next/font/local so the build never
 * calls Google Fonts (Next 16 + Turbopack fails when Google returns
 * extensionless /l/font?kit=…&skey=… URLs — vercel/next.js#99114).
 */
import localFont from "next/font/local";

export const archivo = localFont({
  variable: "--font-archivo",
  display: "swap",
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

export const plexSans = localFont({
  variable: "--font-plex-sans",
  display: "swap",
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
