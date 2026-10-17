import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { getSaasStore } from "@/product/saas/runtime";
import { AccountManagement } from "@/components/app/AccountManagement";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.account");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const members = await getSaasStore().listMembershipsForOrganization(auth.ctx.organization.id);
  const portal = process.env.STRIPE_BILLING_PORTAL_URL;
  const billingPortalUrl = portal?.startsWith("https://") ? portal : undefined;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("headline")}</h1>
      <p className="max-w-2xl text-sm text-navy/70">{t("intro")}</p>
      <section className="rounded-md border border-navy/10 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-navy">{t("employees")}</h2>
        <ul className="mt-2 text-sm text-navy/80">
          {members.map((member) => <li key={member.userId}>{member.role}</li>)}
        </ul>
      </section>
      <AccountManagement organizationId={auth.ctx.organization.id} initialName={auth.ctx.organization.name} billingPortalUrl={billingPortalUrl} />
    </div>
  );
}
