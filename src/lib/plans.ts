/**
 * Single source of truth for plan prices (CAD). The strings shown in
 * src/messages/{en,fr}.json are written from these numbers, and
 * tests/unit/plan-prices.test.ts fails if the copy and these numbers diverge.
 */
export const PLAN_PRICES = {
  starter: { setup: 799.99, monthly: 349.99 },
  growth: { setup: 1499.99, monthly: 749.99 },
  receptionist: { setup: 1999.99, monthly: 999.99 },
} as const;

export type PlanId = keyof typeof PLAN_PRICES;

export function priceLocale(locale: string): "fr-CA" | "en-CA" {
  return locale.startsWith("fr") ? "fr-CA" : "en-CA";
}

/** "$1,999.99" in English, "1 999,99 $" in Québec French (non-breaking spaces). */
export function formatPlanMoney(
  amount: number,
  locale: string,
  fractionDigits = 2,
): string {
  return new Intl.NumberFormat(priceLocale(locale), {
    style: "currency",
    currency: "CAD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

/** How many months one job of `jobValue` pays a monthly fee. */
export function monthsCovered(jobValue: number, monthly: number): number {
  return jobValue / monthly;
}

const MAX_MONEY_INPUT = 1_000_000;

/**
 * Reads what a visitor types as an amount: "1500", "1,500", "1 500",
 * "1500.50" and "1 500,50" all work; anything else (or zero, or more than a
 * million) is `null`. A separator followed by exactly three digits is a
 * thousands group, otherwise it is the decimal mark.
 */
export function parseMoneyInput(raw: string): number | null {
  const compact = raw.replace(/[\s\u00a0$]/g, "");
  let normalized: string | null = null;
  if (/^\d+$/.test(compact)) {
    normalized = compact;
  } else if (/^\d{1,3}(?:[,.]\d{3})+$/.test(compact)) {
    normalized = compact.replace(/[,.]/g, "");
  } else if (/^\d+[,.]\d{1,2}$/.test(compact)) {
    normalized = compact.replace(",", ".");
  } else if (/^\d{1,3}(?:[,.]\d{3})+[,.]\d{1,2}$/.test(compact)) {
    const mark = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
    normalized = `${compact.slice(0, mark).replace(/[,.]/g, "")}.${compact.slice(mark + 1)}`;
  }
  if (normalized === null) return null;
  const value = Number(normalized);
  return value > 0 && value <= MAX_MONEY_INPUT ? value : null;
}
