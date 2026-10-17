import { setRequestLocale } from "next-intl/server";
import { PilotDesk } from "@/components/admin/PilotDesk";

export default async function PilotsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PilotDesk />;
}
