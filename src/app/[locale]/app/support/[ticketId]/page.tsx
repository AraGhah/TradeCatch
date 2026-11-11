import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { TicketThread } from "@/components/app/TicketThread";
import { SupportError } from "@/product/support/errors";
import { getSupportService } from "@/product/support/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ locale: string; ticketId: string }>;
}) {
  const { locale, ticketId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.support");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  let subject: string;
  try {
    const detail = await getSupportService().forBusiness(
      auth.ctx.organization.id,
      ticketId,
      1,
    );
    subject = detail.ticket.subject;
  } catch (error) {
    if (error instanceof SupportError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-navy/60">{t("details")}</p>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {subject}
        </h1>
      </header>
      <TicketThread
        organizationId={auth.ctx.organization.id}
        ticketId={ticketId}
      />
    </div>
  );
}
