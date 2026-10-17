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
  const people = await Promise.all(
    members.map(async (member) => {
      const user = await getSaasStore().getUser(member.userId);
      return {
        name: user?.name ?? "",
        email: user?.email ?? "",
        role: member.role,
      };
    }),
  );
  const org = auth.ctx.organization;
  const portal = process.env.STRIPE_BILLING_PORTAL_URL;
  const billingPortalUrl = portal?.startsWith("https://") ? portal : undefined;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("headline")}</h1>
      <p className="max-w-2xl text-sm text-navy/70">{t("intro")}</p>
      <AccountManagement
        organizationId={org.id}
        initialName={org.name}
        initialPhone={org.phoneE164 ?? ""}
        initialCity={org.city ?? ""}
        initialServiceArea={org.serviceArea ?? ""}
        initialIndustry={org.industry ?? ""}
        members={people}
        billingPortalUrl={billingPortalUrl}
      />
    </div>
  );
}
