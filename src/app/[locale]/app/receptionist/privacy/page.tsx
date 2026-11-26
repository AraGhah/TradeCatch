import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { allows } from "@/product/security/permissions";
import { PrivacySettingsForm } from "@/components/app/PrivacySettingsForm";

export default async function ReceptionistPrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.privacy");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-extrabold text-navy">{t("headline")}</h1>
      <p className="max-w-2xl text-sm text-navy/70">{t("intro")}</p>
      <PrivacySettingsForm
        organizationId={auth.ctx.organization.id}
        canEdit={allows(
          auth.ctx.membership.role,
          "manage_security",
          auth.ctx.isPlatformAdmin,
        )}
        analyticsAvailable={Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)}
      />
    </div>
  );
}
