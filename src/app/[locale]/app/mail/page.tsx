import { getTranslations, setRequestLocale } from "next-intl/server";
import { GmailInbox } from "@/components/app/GmailInbox";
import { getGmailStore } from "@/product/gmail/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

const PAGE = 30;

export default async function MailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.gmail");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  // Reads the local copy only. Fetching from Google is the background poller's
  // job, so a slow or failing Gmail can never slow down or break this page.
  const { organization, user } = auth.ctx;
  const store = getGmailStore();
  const [account, rows, unread] = await Promise.all([
    store.getAccount(organization.id, user.id),
    store.listMessages(organization.id, user.id, { limit: PAGE + 1 }),
    store.countUnread(organization.id, user.id),
  ]);
  const messages = rows.slice(0, PAGE);
  const last = messages[messages.length - 1];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("inboxTitle")}
        </h1>
        <p className="mt-2 text-navy/80">{t("inboxIntro")}</p>
      </header>
      <GmailInbox
        initial={{
          messages,
          next: rows.length > PAGE && last ? `${last.receivedAt}|${last.id}` : null,
          unread,
        }}
        connected={account?.status === "connected"}
        needsReconnect={account?.status === "needs_reconnect"}
        lastError={account?.lastError ?? null}
      />
    </div>
  );
}
