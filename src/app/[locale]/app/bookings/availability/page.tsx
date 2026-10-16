import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { AvailabilityEditor } from "@/components/app/AvailabilityEditor";
import { ScheduleSubnav } from "@/components/app/ScheduleSubnav";

export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.schedule");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("navHours")}</h1>
        <p className="mt-2 text-navy/70">{t("hoursIntro")}</p>
      </header>
      <ScheduleSubnav />
      <AvailabilityEditor organizationId={auth.ctx.organization.id} />
    </div>
  );
}
