import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { buildOverview } from "@/product/receptionist/ai-receptionist-service";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { ReceptionistManager } from "@/components/app/ReceptionistManager";

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

  const runtime = getReceptionistRuntime();
  let integrationError: string | undefined;
  try {
    await runtime.refresh(true);
  } catch (err) {
    integrationError =
      err instanceof Error ? err.message : "Receptionist runtime unavailable";
  }

  const profile = await runtime.profileStore.getProfile(organization.id);
  const calls = client
    ? await runtime.store.listSessions({
        clientAccountId: client.id,
        limit: 200,
      })
    : [];
  const answering = runtime.configs.some(
    (c) =>
      c.id === `rc_org_${organization.id}` ||
      c.clientAccountId === client?.id,
  );

  const overview = buildOverview({
    organization,
    profile,
    client,
    calls,
    answering,
    integrationError,
  });

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
          {membership.role === "member" ? (
            <p className="text-sm text-navy/70">{t("receptionist.readOnly")}</p>
          ) : null}
          <ReceptionistManager
            organizationId={organization.id}
            overview={overview}
            initialSettings={profile?.settings ?? defaultProfileSettings()}
            defaultHours={client.businessHours}
            readOnly={membership.role === "member"}
          />
        </>
      )}
    </div>
  );
}
