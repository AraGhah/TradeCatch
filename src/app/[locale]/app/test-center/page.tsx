import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireTenantContext } from "@/product/saas/tenant";
import { TestCenterActions } from "@/components/app/TestCenterActions";
import { SimulateLeadButton } from "@/components/app/SimulateLeadButton";

export default async function TestCenterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.testCenter");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const isDemo = auth.ctx.organization.accountType === "demo";

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-navy/50">
          {isDemo ? t("demoBadge") : t("liveBadge")}
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>

      <Link
        href="/app/test-center/live-phone"
        className="rounded-md border border-navy/15 bg-white px-4 py-3 text-sm font-semibold text-navy hover:bg-navy/5"
      >
        {t("livePhoneLink")}
      </Link>

      {isDemo ? (
        <SimulateLeadButton organizationId={auth.ctx.organization.id} />
      ) : null}

      <TestCenterActions
        organizationId={auth.ctx.organization.id}
        isDemo={isDemo}
        isAdmin={auth.ctx.isPlatformAdmin}
      />
    </div>
  );
}
