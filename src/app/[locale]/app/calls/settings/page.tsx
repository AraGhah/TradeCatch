import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  buildPhoneSettingsView,
  parsePhoneSettings,
} from "@/product/telephony/phone-settings";
import { PhoneSettingsForm } from "@/components/app/PhoneSettingsForm";
import { AiCallHandlingSection } from "@/components/app/AiCallHandlingSection";
import { buildAiCallHandlingView } from "@/product/telephony/ai-call-handling-service";
import { livekitHandoffReady } from "@/product/telephony/livekit-handoff";
import { allows } from "@/product/security/permissions";

export default async function PhoneSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.phoneSettings");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("entitlement")}</p>;
  }

  const { organization, membership } = auth.ctx;
  const runtime = getReceptionistRuntime();
  const profile = await runtime.profileStore.getProfile(organization.id);
  const settings = profile?.settings ?? defaultProfileSettings();
  const phone = parsePhoneSettings(settings.phoneSettings);
  const view = buildPhoneSettingsView({
    organizationId: organization.id,
    activated: profile?.activated ?? false,
    profilePhoneE164: profile?.phoneNumberE164,
    callHandlingMode: settings.callHandlingMode,
    defaultLanguage: settings.defaultLanguage,
    businessHours: settings.businessHours,
    receptionistName: settings.receptionistName,
    phone,
  });
  const aiCallHandling = buildAiCallHandlingView({
    plan: organization.plan,
    activated: profile?.activated ?? false,
    tradecatchNumberE164: phone.tradecatchNumberE164 || profile?.phoneNumberE164,
    phone,
    canEdit: allows(membership.role, "manage_settings", false),
    livekitHandoffReady: livekitHandoffReady(),
    transferTargets: [
      settings.emergencyTransferE164,
      settings.fallbackTransferE164,
      settings.transferSettings?.primaryTransferE164,
      settings.transferSettings?.secondaryTransferE164,
      phone.humanTransferE164,
      phone.backupTransferE164,
      ...settings.routing.map((r) => r.phoneE164),
    ],
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/50">
          <Link href="/app/calls" className="hover:underline">
            {t("backToCalls")}
          </Link>
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("intro")}</p>
      </header>
      <AiCallHandlingSection
        organizationId={organization.id}
        initial={aiCallHandling}
      />
      <PhoneSettingsForm
        organizationId={organization.id}
        initial={view}
        readOnly={membership.role === "member"}
      />
    </div>
  );
}
