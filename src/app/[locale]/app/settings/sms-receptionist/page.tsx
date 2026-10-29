import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext, tenantHasFeature } from "@/product/saas/tenant";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { SmsReceptionistSettingsForm } from "@/components/app/SmsReceptionistSettingsForm";

export default async function SmsReceptionistSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.smsReceptionist");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const { organization, membership, isPlatformAdmin } = auth.ctx;

  if (!tenantHasFeature(auth.ctx, "MISSED_CALL_RECOVERY")) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="text-navy/70">{t("entitlement")}</p>
      </div>
    );
  }

  const client = organization.missedCallClientId
    ? await (async () => {
        const { store } = await ensureMissedCallReady();
        return store.getClient(organization.missedCallClientId!);
      })()
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>
      {client ? (
        <SmsReceptionistSettingsForm
          smsFromNumber={client.smsFromNumber}
          canEdit={
            membership.role === "owner" ||
            membership.role === "admin" ||
            isPlatformAdmin
          }
          initial={{
            contractorDisplayName: client.contractorDisplayName,
            timezone: client.timezone,
            businessHours: client.businessHours,
            technicianRoster: client.technicianRoster,
            humanReviewPhone: client.humanReviewPhone ?? null,
          }}
        />
      ) : (
        <p className="rounded-md border border-dashed border-navy/20 bg-white/60 px-4 py-6 text-sm text-navy/70">
          {t("notLinked")}
        </p>
      )}
    </div>
  );
}
