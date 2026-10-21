import { z } from "zod";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { isE2eHarness, isProductionRuntime } from "@/lib/config";
import type { Organization } from "./types";
import { isStripePortalUrl } from "./billing-access";
import { stripeSecretKey } from "./stripe-key";

export class BillingPortalError extends Error {
  constructor(
    public readonly code: "not_linked" | "unavailable",
    public readonly status = 503,
  ) {
    super("Billing portal unavailable.");
  }
}

const sessionSchema = z.object({
  customer: z.string(),
  livemode: z.boolean(),
  url: z.string(),
});

/** No customer ID, mode or return URL is accepted from the browser. */
export async function createStripePortalSession(
  organization: Pick<Organization, "id" | "accountType">,
  locale: "en" | "fr",
): Promise<string> {
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    throw new BillingPortalError("unavailable");
  }
  const row = (
    await getPgPool(url).query(
      "SELECT customer_id,livemode FROM tc_stripe_customers WHERE organization_id=$1",
      [organization.id],
    )
  ).rows[0] as { customer_id: string; livemode: boolean } | undefined;
  if (!row) throw new BillingPortalError("not_linked", 409);
  if (
    !/^cus_[a-zA-Z0-9_]+$/.test(row.customer_id) ||
    typeof row.livemode !== "boolean" ||
    row.livemode !== (organization.accountType !== "demo")
  ) {
    throw new BillingPortalError("unavailable");
  }
  const key = stripeSecretKey(row.livemode);
  const site = new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://tradecatch.ca",
  );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
  if (
    site.username ||
    site.password ||
    (site.protocol !== "https:" &&
      !(
        site.protocol === "http:" &&
        local &&
        (!isProductionRuntime() || isE2eHarness())
      ))
  ) {
    throw new BillingPortalError("unavailable");
  }
  const returnUrl = new URL(
    locale === "fr" ? "/fr/facturation" : "/billing",
    site.origin,
  ).href;
  const configuration = (
    row.livemode
      ? process.env.STRIPE_BILLING_PORTAL_CONFIGURATION
      : process.env.STRIPE_TEST_BILLING_PORTAL_CONFIGURATION
  )?.trim();
  if (configuration && !/^bpc_[a-zA-Z0-9_]+$/.test(configuration))
    throw new BillingPortalError("unavailable");
  const params = new URLSearchParams({
    customer: row.customer_id,
    return_url: returnUrl,
    locale,
  });
  if (configuration) params.set("configuration", configuration);
  const response = await fetch(
    "https://api.stripe.com/v1/billing_portal/sessions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Stripe-Version": "2025-02-24.acacia",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new BillingPortalError("unavailable");
  const session = sessionSchema.parse(await response.json());
  if (
    session.customer !== row.customer_id ||
    session.livemode !== row.livemode ||
    !isStripePortalUrl(session.url)
  ) {
    throw new BillingPortalError("unavailable");
  }
  return session.url;
}
