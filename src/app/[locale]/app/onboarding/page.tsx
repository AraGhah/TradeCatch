import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { getGrowthStore } from "@/product/growth";
import { OnboardingWizard } from "@/components/app/OnboardingWizard";
import { OnboardingWebsiteOffer } from "@/components/app/OnboardingWebsiteOffer";
import { canManageBilling } from "@/product/saas/billing-access";
import { orgHasFeature } from "@/product/saas/entitlements";

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
        <h1 className="font-heading text-2xl font-extrabold text-navy">
          {t("onboarding.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("onboarding.intro")}</p>
      </header>

      <OnboardingWizard
        initialNotifyEmail={settings.notifyEmail}
        initialGoogleReviewUrl={settings.googleReviewUrl}
        reviewsIncluded={orgHasFeature(
          auth.ctx.organization.plan,
          "REVIEW_AUTOMATION",
        )}
        alreadyComplete={Boolean(settings.onboardingCompletedAt)}
      />

      {/* Optional and separate from the subscription: it only records a request. */}
      {canManageBilling(auth.ctx.membership.role) ? (
        <OnboardingWebsiteOffer
          defaults={{
            businessName: auth.ctx.organization.name,
            contactName: auth.ctx.user.name,
            contactEmail: auth.ctx.user.email,
          }}
        />
      ) : null}
    </div>
  );
}
