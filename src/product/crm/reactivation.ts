import type { Customer } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * CUSTOMER_REACTIVATION (Receptionist tier): a customer is dormant once
 * they've gone quiet for `dormantAfterDays` since their last tracked
 * contact — the same `lastContactAt` the CRM already updates on every
 * inbound/outbound touch, so no parallel tracking field is needed.
 */
export function isDormantCustomer(
  customer: Customer,
  now: Date,
  dormantAfterDays: number,
): boolean {
  if (!customer.allowSms) return false;
  if (!customer.phoneE164) return false;
  const elapsedMs = now.getTime() - Date.parse(customer.lastContactAt);
  if (!Number.isFinite(elapsedMs)) return false;
  return elapsedMs >= dormantAfterDays * MS_PER_DAY;
}

export function findDormantCustomers(
  customers: Customer[],
  now: Date,
  dormantAfterDays: number,
): Customer[] {
  return customers
    .filter((c) => isDormantCustomer(c, now, dormantAfterDays))
    .sort(
      (a, b) => Date.parse(a.lastContactAt) - Date.parse(b.lastContactAt),
    );
}

export function buildReactivationMessage(
  businessName: string,
  customer: Customer,
): string {
  const name = customer.firstName || customer.displayName;
  if (customer.preferredLanguage === "fr") {
    const hi = name ? `Bonjour ${name}` : "Bonjour";
    return `${hi}, c'est ${businessName}. Besoin d'un service bientôt? Répondez pour réserver ou texter STOP pour ne plus recevoir ces messages.`;
  }
  const hi = name ? `Hi ${name}` : "Hi";
  return `${hi}, it's ${businessName}. Due for service? Reply to book, or text STOP to opt out.`;
}
