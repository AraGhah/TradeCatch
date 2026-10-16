import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { SecurityPanel } from "@/components/app/SecurityPanel";

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.security");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("headline")}</h1>
      <p className="max-w-2xl text-sm text-navy/70">{t("intro")}</p>
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">{t("sessions")}</h2>
      <SecurityPanel organizationId={auth.ctx.organization.id} isAdmin={auth.ctx.isPlatformAdmin} />
      {auth.ctx.isPlatformAdmin ? <p className="text-sm text-navy/70">{t("mfaHint")}</p> : null}
    </div>
  );
}
