import { setRequestLocale } from "next-intl/server";
import { AdminAccountRecovery } from "@/components/admin/AdminAccountRecovery";

export const dynamic = "force-dynamic";

export default async function AdminAccountRecoveryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        Account recovery
      </h1>
      <p className="max-w-2xl text-sm text-navy/70">
        Customers who lost access to the email on their account. Verify the
        person&apos;s identity against our own records (call back the phone
        number on file, match billing details, or a video call with photo ID)
        before changing anything. Changing the email signs nobody in: the new
        address receives a single-use password link, the old address gets a
        notice, and every step is audited. Business data is never touched.
      </p>
      <AdminAccountRecovery />
    </div>
  );
}
