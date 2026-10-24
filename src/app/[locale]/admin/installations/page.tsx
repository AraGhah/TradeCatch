import { setRequestLocale } from "next-intl/server";
import { InstallationApprovals } from "@/components/admin/InstallationApprovals";

export default async function InstallationApprovalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Parent layout gates MFA/admin JWT; API independently authorizes all reads/writes.
  return <InstallationApprovals />;
}
