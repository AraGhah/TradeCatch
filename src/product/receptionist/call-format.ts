/**
 * How a call's duration and time are shown. Pure and dependency-free so the
 * server page and the browser component share one implementation.
 */

/** "5m 00s", "42s", "1h 02m 03s"; nothing when the duration is unknown. */
export function formatCallDuration(seconds: number | undefined | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${two(m)}m ${two(s)}s`;
  if (m > 0) return `${m}m ${two(s)}s`;
  return `${s}s`;
}

/**
 * A stored UTC instant as the business's own date and time ("2026-11-17,
 * 9:05 a.m." in Montreal), never the server's or the viewer's zone. An unknown
 * zone falls back to Toronto, the product's default, rather than UTC.
 */
export function formatCallTime(
  iso: string,
  timeZone: string,
  lang: "fr" | "en",
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  };
  const locale = lang === "fr" ? "fr-CA" : "en-CA";
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "America/Toronto",
    }).format(at);
  }
}
