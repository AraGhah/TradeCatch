import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireTenantContext } from "@/product/saas/tenant";
import { getMissedCallReadStore } from "@/product/missed-call/runtime";
import { voiceCapabilitiesForPlan } from "@/product/receptionist/plan-limits";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  buildLiveTestInstructions,
  type LiveTestInstructions,
} from "@/product/telephony/live-test-instructions";
import type { SimulationRun } from "@/product/telephony/live-test";
import { listSimulations } from "@/product/telephony/live-test-store";
import { getTelephonyRuntime } from "@/product/telephony/runtime";
import { LivePhoneTesting } from "@/components/app/LivePhoneTesting";

export default async function LivePhoneTestingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.livePhoneTesting");
  const tApp = await getTranslations("app");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const organization = auth.ctx.organization;
  const clientId = organization.missedCallClientId;

  let live: LiveTestInstructions | null = null;
  let runs: SimulationRun[] = [];
  let timeZone = "America/Toronto";
  let loadFailed = false;

  if (clientId) {
    // Everything below is read-only: opening this page never places a call.
    try {
      const runtime = getReceptionistRuntime();
      await runtime.refresh();
      const client = await getMissedCallReadStore().getClient(clientId);
      if (client) {
        timeZone = client.timezone || timeZone;
        const profile = (await runtime.profileStore.getProfile(organization.id)) ?? {
          organizationId: organization.id,
          activated: false,
          settings: defaultProfileSettings(),
          updatedAt: new Date().toISOString(),
        };
        live = buildLiveTestInstructions({
          organizationId: organization.id,
          profile,
          client,
          capabilities: voiceCapabilitiesForPlan(organization.plan),
          configs: runtime.configs,
        });
      } else {
        loadFailed = true;
      }
    } catch {
      loadFailed = true;
    }
    // Saved simulations for this business only: the ids come from the session.
    try {
      runs = await listSimulations(
        { organizationId: organization.id, clientAccountId: clientId },
        { events: getTelephonyRuntime().events, sessions: getReceptionistRuntime().store },
      );
    } catch {
      loadFailed = true;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/50">
          <Link href="/app/test-center" className="hover:underline">
            {t("back")}
          </Link>
        </p>
        <h1 className="mt-2 font-heading text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>
      {clientId ? (
        <LivePhoneTesting
          organizationId={organization.id}
          initialLive={live}
          initialRuns={runs}
          timeZone={timeZone}
          loadFailed={loadFailed}
        />
      ) : (
        <p className="text-sm text-navy/70">{tApp("dashboard.notLinked")}</p>
      )}
    </div>
  );
}
