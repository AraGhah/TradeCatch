export const CONSENT_STORAGE_KEY = "tradecatch-cookie-consent";
export const CONSENT_EVENT = "tradecatch:consent";
export const MANAGE_COOKIES_EVENT = "tradecatch:manage-cookies";

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

export type ConsentRecord = {
  analytics: boolean;
  // Wording + timestamp of the choice, kept for consent record-keeping
  // (see the Privacy Policy's SMS/email consent and CASL sections).
  wording: string;
  decidedAt: string;
};

export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  (window as GtagWindow).gtag?.("event", name, params);
}

export function readConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.analytics === "boolean") return parsed as ConsentRecord;
    return null;
  } catch {
    return null;
  }
}

export function writeConsent(analytics: boolean, wording: string) {
  if (typeof window === "undefined") return;
  const record: ConsentRecord = {
    analytics,
    wording,
    decidedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: record }));
}

export function hasAnalyticsConsent() {
  return readConsent()?.analytics === true;
}
