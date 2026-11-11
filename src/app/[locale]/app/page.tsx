import { getTranslations, setRequestLocale } from "next-intl/server";
import { GmailDashboardCard } from "@/components/app/GmailDashboardCard";
import { DashboardView } from "@/components/app/dashboard/DashboardView";
import { loadDashboardOverview } from "@/product/saas/dashboard-load";
import { requireTenantContext, tenantHasFeature } from "@/product/saas/tenant";

export default async function AppDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("app.home");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  // Appointments belong to Professional. Essential never sees the calendar blocks.
  const appointmentsIncluded = tenantHasFeature(auth.ctx, "APPOINTMENT_BOOKING");

  let overview;
  try {
    overview = await loadDashboardOverview({
      organization: auth.ctx.organization,
      userId: auth.ctx.user.id,
      range: query.range,
      from: query.from,
      to: query.to,
    });
  } catch {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-6">
        <h1 className="font-[family-name:var(--font-archivo)] text-xl font-extrabold text-navy">
          {t("loadErrorTitle")}
        </h1>
        <p className="mt-2 text-sm text-navy/80">{t("loadErrorBody")}</p>
      </div>
    );
  }

  // "From" after "To" is read as the same period: show the dates in the
  // order they were applied, so the form matches the numbers on screen.
  const reversed =
    Boolean(query.from && query.to) &&
    (query.from as string) > (query.to as string);
  const customFrom = reversed ? query.to : query.from;
  const customTo = reversed ? query.from : query.to;

  const poll = new URLSearchParams();
  if (query.range) poll.set("range", query.range);
  if (query.from) poll.set("from", query.from);
  if (query.to) poll.set("to", query.to);

  return (
    <DashboardView
      initial={overview}
      pollQuery={poll.toString()}
      customFrom={customFrom}
      customTo={customTo}
      rangeReversed={reversed}
      showProfessionalUpsell={!appointmentsIncluded}
      showAppointments={appointmentsIncluded}
      afterHeader={
        <GmailDashboardCard
          organizationId={auth.ctx.organization.id}
          userId={auth.ctx.user.id}
        />
      }
    />
  );
}
