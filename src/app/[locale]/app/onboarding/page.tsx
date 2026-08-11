import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { getGrowthStore } from "@/product/growth";
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

  const settings = await getGrowthStore().getOrgSettings(
    auth.ctx.organization.id,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("onboarding.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("onboarding.intro")}</p>
      </header>

      <OnboardingWizard
        initialNotifyEmail={settings.notifyEmail}
        initialGoogleReviewUrl={settings.googleReviewUrl}
        isGrowth={auth.ctx.organization.plan === "growth"}
        alreadyComplete={Boolean(settings.onboardingCompletedAt)}
      />
    </div>
  );
}
