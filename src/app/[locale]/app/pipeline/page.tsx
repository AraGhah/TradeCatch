import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getGrowthStore } from "@/product/growth";
import { PipelineBoard } from "@/components/app/PipelineBoard";

export default async function AppPipelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "ADVANCED_PIPELINE")) {
    return <p className="text-navy/70">{t("pipeline.entitlement")}</p>;
  }

  const cards = await getGrowthStore().listPipeline(auth.ctx.organization.id);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("pipeline.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("pipeline.intro")}</p>
      </header>

      <PipelineBoard cards={cards} />
    </div>
  );
}
