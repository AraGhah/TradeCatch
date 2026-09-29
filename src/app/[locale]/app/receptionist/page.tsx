import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { ReceptionistSettingsForm } from "@/components/app/ReceptionistSettingsForm";

export default async function AppReceptionistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const { organization, membership } = auth.ctx;

  if (!orgHasFeature(organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("receptionist.entitlement")}</p>;
  }

  let client = null;
  if (organization.missedCallClientId) {
    try {
      const { store } = await ensureMissedCallReady();
      client = await store.getClient(organization.missedCallClientId);
    } catch {
      client = null;
    }
  }

  const profile = await getReceptionistRuntime().profileStore.getProfile(
    organization.id,
  );
  const activated = profile?.activated ?? false;
  const number = profile?.phoneNumberE164;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("receptionist.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("receptionist.intro")}</p>
      </header>

      {!client ? (
        <p className="rounded-md border border-navy/15 bg-white px-4 py-3 text-sm text-navy/80">
          {t("receptionist.notLinked")}
        </p>
      ) : (
        <>
          <p
            className={`rounded-md border px-4 py-3 text-sm ${
              activated
                ? "border-green-300 bg-green-50 text-green-900"
                : "border-navy/15 bg-white text-navy/80"
            }`}
          >
            {activated && number
              ? t("receptionist.statusActive", { number })
              : t("receptionist.statusInactive")}
          </p>
          {membership.role === "member" ? (
            <p className="text-sm text-navy/70">{t("receptionist.readOnly")}</p>
          ) : null}
          <ReceptionistSettingsForm
            readOnly={membership.role === "member"}
            initial={profile?.settings ?? defaultProfileSettings()}
            defaultHours={client.businessHours}
          />
        </>
      )}
    </div>
  );
}
