import { setRequestLocale } from "next-intl/server";
import { BusinessesConsole } from "@/components/admin/console/BusinessesConsole";

export const dynamic = "force-dynamic";

export default async function AdminBusinessesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BusinessesConsole />;
}
