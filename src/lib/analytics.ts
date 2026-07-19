export const CONSENT_STORAGE_KEY = "tradecatch-cookie-consent";
export const CONSENT_EVENT = "tradecatch:consent";

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  (window as GtagWindow).gtag?.("event", name, params);
}

export function hasAnalyticsConsent() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CONSENT_STORAGE_KEY) === "accepted";
}
