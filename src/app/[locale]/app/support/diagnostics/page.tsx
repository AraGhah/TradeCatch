import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { DiagnosticsPanel } from "@/components/app/DiagnosticsPanel";

export default async function DiagnosticsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.support");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("diagnostics")}</h1>
      <DiagnosticsPanel organizationId={auth.ctx.organization.id} />
    </div>
  );
}
