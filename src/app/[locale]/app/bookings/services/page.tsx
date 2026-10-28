import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext, tenantHasFeature } from "@/product/saas/tenant";
import { ScheduleSubnav } from "@/components/app/ScheduleSubnav";
import { ServiceTypeEditor } from "@/components/app/ServiceTypeEditor";

export default async function ServiceTypesPage({
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
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("navServices")}</h1>
        <p className="mt-2 text-navy/70">{t("servicesIntro")}</p>
      </header>
      <ScheduleSubnav showTeam={tenantHasFeature(auth.ctx, "MULTI_CREW_CALENDARS")} />
      <ServiceTypeEditor organizationId={auth.ctx.organization.id} />
    </div>
  );
}
