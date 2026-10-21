import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { EscalationRulesForm } from "@/components/app/EscalationRulesForm";
import { allows } from "@/product/security/permissions";

export default async function EscalationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.alerts");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("escalation")}
        </h1>
      </header>
      {allows(
        auth.ctx.membership.role,
        "manage_settings",
        auth.ctx.isPlatformAdmin,
      ) ? (
        <EscalationRulesForm
          key={auth.ctx.organization.id}
          organizationId={auth.ctx.organization.id}
        />
      ) : (
        <p className="text-sm text-navy/70">{t("manageContactsRequired")}</p>
      )}
    </div>
  );
}
