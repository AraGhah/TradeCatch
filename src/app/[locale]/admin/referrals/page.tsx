import { setRequestLocale } from "next-intl/server";
import { ReferralAdmin } from "@/components/admin/ReferralAdmin";

export default async function AdminReferralsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The admin layout gates the session; the API independently authorizes every read and write.
  return <ReferralAdmin />;
}
