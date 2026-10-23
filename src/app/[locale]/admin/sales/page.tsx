import { setRequestLocale } from "next-intl/server";
import { AdminSalesLeads } from "@/components/admin/AdminSalesLeads";

export default async function SalesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminSalesLeads />;
}
