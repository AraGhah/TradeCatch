/**
 * True when Intl accepts the IANA zone name. Safe in the browser and the
 * Worker: no imports, no I/O. An empty or missing value is never valid.
 */
export function isValidTimeZone(timeZone: string | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
