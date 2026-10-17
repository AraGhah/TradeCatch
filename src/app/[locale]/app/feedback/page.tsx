import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { PilotFeedbackForm } from "@/components/app/PilotFeedbackForm";

export default async function FeedbackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.pilot");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("headline")}</h1>
      <p className="max-w-2xl text-sm text-navy/70">{t("intro")}</p>
      <PilotFeedbackForm organizationId={auth.ctx.organization.id} />
    </div>
  );
}
