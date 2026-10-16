import { setRequestLocale } from "next-intl/server";
import { AdminDemoBusinesses } from "@/components/admin/AdminDemoBusinesses";

export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminDemoBusinesses />;
}
