import { setRequestLocale } from "next-intl/server";
import { PaymentsConsole } from "@/components/admin/console/PaymentsConsole";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PaymentsConsole />;
}
