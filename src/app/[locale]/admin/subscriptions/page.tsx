import { setRequestLocale } from "next-intl/server";
import { SubscriptionsConsole } from "@/components/admin/console/SubscriptionsConsole";

export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SubscriptionsConsole />;
}
