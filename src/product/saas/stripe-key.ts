export function stripeSecretKey(livemode: boolean): string {
  const key = (
    livemode
      ? process.env.STRIPE_SECRET_KEY
      : process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY
  )?.trim();
  if (!key?.startsWith(livemode ? "sk_live_" : "sk_test_")) {
    throw new Error("Stripe API key is missing or has the wrong mode.");
  }
  return key;
}
