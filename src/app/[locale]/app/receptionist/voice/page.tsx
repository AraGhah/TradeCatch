import { getTranslations, setRequestLocale } from "next-intl/server";
import { ReceptionistVoicePanel } from "@/components/app/ReceptionistVoicePanel";
import { Link } from "@/i18n/navigation";
import { getVoiceService } from "@/product/receptionist/custom-voice/runtime";
import { canManageBilling } from "@/product/saas/billing-access";
import { orgHasFeature } from "@/product/saas/entitlements";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

export default async function AppReceptionistVoicePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.voice");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const { organization, membership, user } = auth.ctx;

  // Same gate as the rest of the Receptionist section.
  if (!orgHasFeature(organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("entitlement")}</p>;
  }

  let status = null;
  try {
    // Keyed by the caller's own business and plan from the session.
    status = await getVoiceService().status({
      organizationId: organization.id,
      plan: organization.plan,
      userId: user.id,
    });
  } catch (error) {
    console.error("[custom-voice] page load failed", error instanceof Error ? error.name : "error");
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-[44em] text-navy/70">{t("intro")}</p>
        <Link
          href="/app/receptionist"
          className="mt-3 inline-block text-sm font-semibold text-navy underline"
        >
          {t("back")}
        </Link>
      </header>

      {status === null ? (
        <p
          role="alert"
          className="rounded-md border border-navy/10 bg-white px-5 py-4 text-sm text-navy"
        >
          {t("loadFailed")}
        </p>
      ) : (
        <>
          {!canManageBilling(membership.role) ? (
            <p className="text-sm text-navy/70">{t("readOnly")}</p>
          ) : null}
          <ReceptionistVoicePanel
            initialStatus={status}
            canManage={canManageBilling(membership.role)}
          />
        </>
      )}
    </div>
  );
}
