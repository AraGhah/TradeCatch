import { setRequestLocale } from "next-intl/server";
import { AdminBillingPanel } from "@/components/admin/AdminBillingPanel";
import { AdminDemoBusinesses } from "@/components/admin/AdminDemoBusinesses";
import { AdminSystemAlerts } from "@/components/admin/AdminSystemAlerts";

export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex flex-col gap-8">
      <AdminSystemAlerts />
      <AdminBillingPanel />
      <AdminDemoBusinesses />
    </div>
  );
}
