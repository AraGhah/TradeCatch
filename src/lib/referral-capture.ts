/**
 * Remembers which customer's referral link a visitor arrived through, so the
 * founder can credit them when the visitor becomes a customer weeks later.
 *
 * First-party only: one code in this browser's localStorage for 60 days, used
 * for nothing but that credit (the referral page says so). Nothing is sent
 * anywhere until the visitor submits the audit form.
 */
import { normalizeReferralCode } from "@/product/referrals/code";

const KEY = "tc_referral";
export const REFERRAL_CAPTURE_DAYS = 60;

type Saved = { code: string; savedAt: number };

export function rememberReferralCode(raw: string | null | undefined): string | null {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  try {
    const saved: Saved = { code, savedAt: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked (private mode): the code still works for this visit.
  }
  return code;
}

export function recallReferralCode(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Saved>;
    const fresh =
      typeof saved.savedAt === "number" &&
      Date.now() - saved.savedAt < REFERRAL_CAPTURE_DAYS * 86_400_000;
    const code = fresh ? normalizeReferralCode(saved.code) : null;
    if (!code) window.localStorage.removeItem(KEY);
    return code;
  } catch {
    return null;
  }
}

/** The code from `?ref=` if present (and remembered), else the remembered one. */
export function referralCodeForThisVisit(search: string): string | null {
  const fromLink = new URLSearchParams(search).get("ref");
  return rememberReferralCode(fromLink) ?? recallReferralCode();
}
