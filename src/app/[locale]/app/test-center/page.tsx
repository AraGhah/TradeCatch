import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { TestCenterActions } from "@/components/app/TestCenterActions";

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

      <TestCenterActions
        organizationId={auth.ctx.organization.id}
        isDemo={isDemo}
        isAdmin={auth.ctx.isPlatformAdmin}
      />
    </div>
  );
}
