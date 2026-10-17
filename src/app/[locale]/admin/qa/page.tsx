import { setRequestLocale } from "next-intl/server";
import { QaDesk } from "@/components/admin/QaDesk";

export default async function AdminQaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <QaDesk />;
}
