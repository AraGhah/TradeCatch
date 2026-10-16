import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { OnboardingWizard } from "@/components/app/OnboardingWizard";

export default async function AppOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const { organization, user } = auth.ctx;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("onboarding.headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("onboarding.intro")}</p>
      </header>

      <OnboardingWizard
        organizationId={organization.id}
        locale={locale === "fr" ? "fr" : "en"}
        plan={organization.plan}
        ownerName={user.name}
        ownerEmail={user.email}
        businessName={organization.name}
      />
    </div>
  );
}
