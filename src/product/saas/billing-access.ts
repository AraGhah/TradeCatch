/** Billing is restricted to the organization's own owner/admin membership. */
export function canManageBilling(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function isStripePortalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "billing.stripe.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      (url.pathname === "/p/session" || url.pathname.startsWith("/p/session/"))
    );
  } catch {
    return false;
  }
}

export function isStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "checkout.stripe.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/c/pay/")
    );
  } catch {
    return false;
  }
}
