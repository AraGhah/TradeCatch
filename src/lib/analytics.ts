export const CONSENT_STORAGE_KEY = "tradecatch-cookie-consent";
export const CONSENT_EVENT = "tradecatch:consent";
export const MANAGE_COOKIES_EVENT = "tradecatch:manage-cookies";
export const CONSENT_VERSION = 1;
const CONSENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

type GtagWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
};

export type ConsentRecord = {
  version: number;
  analytics: boolean;
  // Wording + timestamp of the choice, kept for consent record-keeping
  // (see the Privacy Policy's SMS/email consent and CASL sections).
  wording: string;
  decidedAt: string;
  expiresAt: string;
};

const GA_COOKIE_PREFIXES = ["_ga", "_gid", "_gat"];

function gtag(...args: unknown[]) {
  const w = window as GtagWindow;
  if (typeof w.gtag === "function") {
    w.gtag(...args);
    return;
  }
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(args);
}

/** Google Consent Mode defaults — call as early as possible, before GA loads. */
export function applyConsentDefaults() {
  if (typeof window === "undefined") return;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    wait_for_update: 500,
  });
}

export function updateGoogleConsent(analyticsGranted: boolean) {
  if (typeof window === "undefined") return;
  const value = analyticsGranted ? "granted" : "denied";
  gtag("consent", "update", {
    analytics_storage: value,
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
}

function clearAnalyticsCookies() {
  if (typeof document === "undefined") return;
  const host = window.location.hostname;
  const domains = [undefined, host, `.${host}`, host.replace(/^www\./, "")];
  for (const raw of document.cookie.split(";")) {
    const name = raw.split("=")[0]?.trim();
    if (!name) continue;
    if (!GA_COOKIE_PREFIXES.some((p) => name === p || name.startsWith(`${p}_`))) {
      continue;
    }
    for (const domain of domains) {
      const domainPart = domain ? `; domain=${domain}` : "";
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domainPart}`;
    }
  }
}

export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!hasAnalyticsConsent()) return;
  (window as GtagWindow).gtag?.("event", name, params);
}

export function readConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.version === CONSENT_VERSION &&
      typeof parsed.analytics === "boolean" &&
      typeof parsed.expiresAt === "string" &&
      Date.parse(parsed.expiresAt) > Date.now()
    ) {
      return parsed as ConsentRecord;
    }
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
    return null;
  } catch {
    // Storage blocked / quota / private mode — treat as no consent.
    return null;
  }
}

export function writeConsent(analytics: boolean, wording: string) {
  if (typeof window === "undefined") return;
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    analytics,
    wording,
    decidedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CONSENT_TTL_MS).toISOString(),
  };
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Still apply runtime consent even if persistence fails.
  }
  updateGoogleConsent(analytics);
  if (!analytics) {
    clearAnalyticsCookies();
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: record }));
}

export function hasAnalyticsConsent() {
  return readConsent()?.analytics === true;
}
