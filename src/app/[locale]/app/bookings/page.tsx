import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { AppointmentDesk } from "@/components/app/AppointmentDesk";
import { ScheduleSubnav } from "@/components/app/ScheduleSubnav";

export default async function AppBookingsPage({
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
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>
      <ScheduleSubnav />
      <AppointmentDesk organizationId={auth.ctx.organization.id} />
    </div>
  );
}
