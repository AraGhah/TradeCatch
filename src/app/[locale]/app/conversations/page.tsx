import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ConversationControlSelect } from "@/components/app/ConversationControlSelect";
import { getCrmService } from "@/product/crm/runtime";
import { orgHasFeature } from "@/product/saas/entitlements";
import { requireTenantContext } from "@/product/saas/tenant";

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.crm");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  if (!orgHasFeature(auth.ctx.organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("entitlement")}</p>;
  }

  let conversations: Awaited<
    ReturnType<ReturnType<typeof getCrmService>["listConversations"]>
  > = [];
  try {
    conversations = await getCrmService().listConversations(
      auth.ctx.organization.id,
    );
  } catch {
    conversations = [];
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("conversationsHeadline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("conversationsIntro")}</p>
      </header>
      {conversations.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("noMessages")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {conversations.map((conversation) => {
            const title =
              conversation.customer.displayName || conversation.customer.phoneE164;
            const inner = (
              <div className="flex flex-col gap-1">
                <p className="font-semibold text-navy">{title}</p>
                <p className="text-sm text-navy/70">
                  {conversation.lastMessage?.body || t("noMessages")}
                  {conversation.lastMessage?.simulated ? ` · ${t("simulated")}` : ""}
                </p>
              </div>
            );
            return (
              <li
                key={conversation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
              >
                {conversation.leadId ? (
                  <Link
                    href={{
                      pathname: "/app/leads/[id]",
                      params: { id: conversation.leadId },
                    }}
                    className="min-w-0 flex-1"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">{inner}</div>
                )}
                <ConversationControlSelect
                  organizationId={auth.ctx.organization.id}
                  conversationId={conversation.id}
                  control={conversation.control}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
