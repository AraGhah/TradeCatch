import { setRequestLocale } from "next-intl/server";
import { LaunchReadinessPanel } from "@/components/admin/LaunchReadinessPanel";

export default async function LaunchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LaunchReadinessPanel />;
}
