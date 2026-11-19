import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

/**
 * Billing used to be a catalog-priced estimate. It now lives in the Subscriptions
 * and Payments views, which read the real Stripe prices, statuses and invoices.
 * The old address keeps working so bookmarks do not break.
 */
export default async function AdminBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect(locale === "fr" ? "/fr/admin/subscriptions" : "/admin/subscriptions");
}
