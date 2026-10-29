import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext, tenantHasFeature } from "@/product/saas/tenant";
import { ScheduleSubnav } from "@/components/app/ScheduleSubnav";
import { TeamCalendarsPanel } from "@/components/app/TeamCalendarsPanel";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { USAGE_ALLOWANCES } from "@/lib/plans";

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.team");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const entitled = tenantHasFeature(auth.ctx, "MULTI_CREW_CALENDARS");
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>
      <ScheduleSubnav showTeam />
      {entitled ? (
        <TeamCalendarsPanel
          initialTechnicians={await getSchedulingService().listTechnicians(
            auth.ctx.organization.id,
          )}
          calendarLimit={USAGE_ALLOWANCES.receptionist.calendars}
        />
      ) : (
        <p className="rounded-md border border-dashed border-navy/20 bg-white/60 px-4 py-6 text-sm text-navy/70">
          {t("upsell")}
        </p>
      )}
    </div>
  );
}
