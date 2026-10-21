import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { getSaasStore } from "@/product/saas/runtime";
import { canManageBilling } from "@/product/saas/billing-access";
import { AccountManagement } from "@/components/app/AccountManagement";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.account");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const store = getSaasStore();
  const members = await store.listMembershipsForOrganization(
    auth.ctx.organization.id,
  );
  const users = await store.listUsers(members.map((member) => member.userId));
  const byId = new Map(users.map((user) => [user.id, user]));
  const people = members.map((member) => {
    const user = byId.get(member.userId);
    return {
      name: user?.name ?? "",
      email: user?.email ?? "",
      role: member.role,
    };
  });
  const org = auth.ctx.organization;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        {t("headline")}
      </h1>
      <p className="max-w-2xl text-sm text-navy/70">{t("intro")}</p>
      <AccountManagement
        organizationId={org.id}
        initialName={org.name}
        initialPhone={org.phoneE164 ?? ""}
        initialCity={org.city ?? ""}
        initialServiceArea={org.serviceArea ?? ""}
        initialIndustry={org.industry ?? ""}
        members={people}
        canManageBilling={canManageBilling(auth.ctx.membership.role)}
      />
    </div>
  );
}
