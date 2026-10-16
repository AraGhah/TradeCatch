import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { LeadWorkspace } from "@/components/app/LeadWorkspace";
import { getCrmService } from "@/product/crm/runtime";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getSaasStore } from "@/product/saas/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.crm");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  if (!orgHasFeature(auth.ctx.organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("entitlement")}</p>;
  }

  const orgId = auth.ctx.organization.id;
  const service = getCrmService();
  const lead = await service.getLead(orgId, id);
  if (!lead) notFound();
  const events = await service.listEvents(orgId, id);
  const bundle = lead.conversationId
    ? await service.getConversationBundle(orgId, lead.conversationId)
    : null;

  const memberships = await getSaasStore().listMembershipsForOrganization(orgId);
  const people: { id: string; name: string }[] = [];
  for (const membership of memberships) {
    const user = await getSaasStore().getUser(membership.userId);
    if (user) people.push({ id: user.id, name: user.name || user.email });
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/leads" className="text-sm font-semibold text-navy underline">
        {t("back")}
      </Link>
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {lead.customer.displayName || lead.customer.phoneE164}
        </h1>
        <p className="mt-2 text-navy/70">{t("detailIntro")}</p>
      </header>
      <LeadWorkspace
        organizationId={orgId}
        lead={lead}
        events={events}
        messages={bundle?.messages ?? []}
        control={bundle?.conversation.control ?? "ai_managed"}
        people={people}
      />
    </div>
  );
}
