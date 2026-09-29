import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { getAuthSecret } from "@/product/saas/tenant";
import { createResendEmailPort } from "./email-port";
import { createPostgresEmailAutomationStore } from "./postgres-store";
import {
  createEmailAutomationServices,
  type OrgEmailContext,
} from "./services";
import {
  createMemoryEmailAutomationStore,
  type EmailAutomationStore,
} from "./store";
import { createUnsubscribeToken } from "./unsubscribe";

const globalForEmail = globalThis as unknown as {
  __tradecatchEmailAutomation?: {
    store: EmailAutomationStore;
    durable: boolean;
  };
};

function createStore(): { store: EmailAutomationStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  if (wantDurable && url) {
    return { store: createPostgresEmailAutomationStore(url), durable: true };
  }
  if (wantDurable && !url) {
    throw new Error("[email-automation] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[email-automation] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
    );
  }
  return { store: createMemoryEmailAutomationStore(), durable: false };
}

export function getEmailAutomationStore(): EmailAutomationStore {
  if (!globalForEmail.__tradecatchEmailAutomation) {
    globalForEmail.__tradecatchEmailAutomation = createStore();
  }
  return globalForEmail.__tradecatchEmailAutomation.store;
}

export function resetEmailAutomationRuntimeForTests() {
  delete globalForEmail.__tradecatchEmailAutomation;
}

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://tradecatch.ca"
  ).replace(/\/$/, "");
}

async function orgContext(
  organizationId: string,
): Promise<OrgEmailContext | null> {
  const fromEmail =
    process.env.EMAIL_AUTOMATION_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim();
  if (!fromEmail) return null;
  const [{ resolveBusinessNameForOrganization }, { getGrowthStore }] =
    await Promise.all([
      import("@/product/starter/org-context"),
      import("@/product/growth"),
    ]);
  const [businessName, settings] = await Promise.all([
    resolveBusinessNameForOrganization(organizationId),
    getGrowthStore().getOrgSettings(organizationId),
  ]);
  // "Name <addr>" so recipients see the contractor, not TradeCatch.
  const address = fromEmail.match(/<([^>]+)>/)?.[1] ?? fromEmail;
  return {
    businessName,
    fromEmail: `${businessName.replace(/[<>"]/g, "")} <${address}>`,
    replyTo: settings.notifyEmail,
    locale: settings.localeDefault,
  };
}

export function getEmailAutomationServices() {
  return createEmailAutomationServices({
    store: getEmailAutomationStore(),
    email: createResendEmailPort(),
    orgContext,
    unsubscribeUrl(organizationId, email) {
      const secret = getAuthSecret();
      if (!secret) return `${siteOrigin()}/api/email/unsubscribe`;
      const token = createUnsubscribeToken({ organizationId, email }, secret);
      return `${siteOrigin()}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
    },
  });
}
