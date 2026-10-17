import { setRequestLocale } from "next-intl/server";
import { AdminSupportDesk } from "@/components/admin/AdminSupportDesk";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";

export default async function AdminSupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">Customer support</h1>
      <p className="max-w-2xl text-sm text-navy/70">Review contractor tickets, reply, and keep investigation notes private. Related logs show error codes only.</p>
      <AdminSupportDesk />
      <AnnouncementForm />
    </div>
  );
}
