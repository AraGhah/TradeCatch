import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { TicketThread } from "@/components/app/TicketThread";

export default async function TicketPage({ params }: { params: Promise<{ locale: string; ticketId: string }> }) {
  const { locale, ticketId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.support");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("details")}</h1>
      <TicketThread organizationId={auth.ctx.organization.id} ticketId={ticketId} />
    </div>
  );
}
