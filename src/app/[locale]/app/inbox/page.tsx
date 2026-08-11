import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getStarterStore } from "@/product/starter/runtime";
import { InboxActions } from "@/components/app/InboxActions";

export default async function AppInboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "HUMAN_TAKEOVER")) {
    return <p className="text-navy/70">{t("inbox.entitlement")}</p>;
  }

  // Sync missed-call needs-attention into inbox (same helper path as API).
  try {
    const clientId = auth.ctx.organization.missedCallClientId;
    if (clientId) {
      const { ensureMissedCallReady } = await import(
        "@/product/missed-call/runtime"
      );
      const { store } = await ensureMissedCallReady();
      const leads = await store.listLeads(clientId);
      const starter = getStarterStore();
      for (const lead of leads) {
        if (!lead.humanReviewRequired && lead.outcome !== "human_review") {
          continue;
        }
        await starter.upsertInboxItem({
          organizationId: auth.ctx.organization.id,
          kind: "missed_call",
          refId: lead.id,
          title: lead.customerName || lead.callerE164,
          reason: "Missed-call lead needs human review",
          status: "open",
        });
      }
    }
  } catch {
    // Non-fatal — inbox still shows starter items.
  }

  const items = await getStarterStore().listInbox(auth.ctx.organization.id);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("inbox.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("inbox.intro")}</p>
      </header>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("inbox.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-navy">{item.title}</p>
                  <p className="mt-1 text-sm text-navy/70">{item.reason}</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-navy/50">
                    {item.kind} · {item.status}
                  </p>
                </div>
                {item.status !== "resolved" ? (
                  <InboxActions itemId={item.id} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
