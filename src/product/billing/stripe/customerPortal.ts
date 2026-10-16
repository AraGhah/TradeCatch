import { readStripeConfig } from "./config";
import type { StripePort } from "./stripeClient";

export async function createCustomerPortalSession(
  stripe: StripePort,
  input: {
    stripeCustomerId: string;
    returnUrl: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!input.stripeCustomerId) {
    return { ok: false, error: "No Stripe customer for this business." };
  }
  const config = readStripeConfig(env);
  const session = await stripe.createPortalSession({
    customerId: input.stripeCustomerId,
    returnUrl: input.returnUrl,
    configuration: config.portalConfigurationId,
  });
  return { ok: true, url: session.url };
}
