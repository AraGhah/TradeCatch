import { setRequestLocale } from "next-intl/server";
import { WebsiteRequestsConsole } from "@/components/admin/console/WebsiteRequestsConsole";

export const dynamic = "force-dynamic";

export default async function AdminWebsiteRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <WebsiteRequestsConsole />;
}
