import { setRequestLocale } from "next-intl/server";
import { SystemHealthConsole } from "@/components/admin/console/SystemHealthConsole";

export const dynamic = "force-dynamic";

export default async function AdminSystemHealthPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SystemHealthConsole />;
}
