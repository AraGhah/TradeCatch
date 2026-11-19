import { setRequestLocale } from "next-intl/server";
import { AuditLogConsole } from "@/components/admin/console/AuditLogConsole";

export const dynamic = "force-dynamic";

export default async function AdminAuditLogsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AuditLogConsole />;
}
