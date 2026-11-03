import { getTranslations, setRequestLocale } from "next-intl/server";
import { WebsiteServiceNewRequest } from "@/components/app/WebsiteServiceNewRequest";
import { formatPlanMoney } from "@/lib/plans";
import { canManageBilling } from "@/product/saas/billing-access";
import { requireTenantContext } from "@/product/saas/tenant";
import {
  toWebsiteRequestView,
  type WebsiteRequestStatus,
  type WebsiteRequestView,
} from "@/product/website-services/model";
import { getWebsiteRequestService } from "@/product/website-services/runtime";

export const dynamic = "force-dynamic";

const CARD = "rounded-md border border-navy/10 bg-white px-5 py-4";
const H2 = "text-sm font-semibold uppercase tracking-[0.06em] text-navy/50";

/** The happy path, in order. A cancelled request is shown as a badge instead. */
const STEPS: WebsiteRequestStatus[] = [
  "submitted",
  "in_review",
  "quoted",
  "in_progress",
  "delivered",
];

export default async function AppWebsiteServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale === "fr" ? "fr" : "en";
  const t = await getTranslations("app.websiteServices");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const { organization, membership, user } = auth.ctx;
  const canRequest = canManageBilling(membership.role);

  let requests: WebsiteRequestView[] | null = null;
  try {
    // Keyed by the caller's own organization: another business's requests
    // cannot appear here.
    requests = (
      await getWebsiteRequestService().listForOrganization(organization.id)
    ).map(toWebsiteRequestView);
  } catch (error) {
    console.error("[website-services] page load failed", error);
  }

  const date = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-[44em] text-navy/70">{t("intro")}</p>
        <p className="mt-2 max-w-[44em] text-sm font-medium text-navy">
          {t("priceNote")}
        </p>
      </header>

      <section aria-labelledby="ws-requests" className="flex flex-col gap-3">
        <h2 id="ws-requests" className={H2}>
          {t("requestsTitle")}
        </h2>
        {requests === null ? (
          <p className={CARD} role="alert">
            {t("unavailable")}
          </p>
        ) : requests.length === 0 ? (
          <p className={CARD}>{t("empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {requests.map((request) => {
              const stepIndex = STEPS.indexOf(request.status);
              const cancelled = request.status === "cancelled";
              return (
                <li key={request.id} className={CARD}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="font-semibold text-navy">
                      {t(`type.${request.requestType}`)}
                      <span className="font-normal text-navy/60">
                        {" · "}
                        {request.businessName}
                      </span>
                    </p>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        cancelled
                          ? "bg-navy/10 text-navy/70"
                          : request.status === "delivered"
                            ? "bg-[rgba(47,158,104,0.16)] text-[#1f6b46]"
                            : "bg-[rgba(228,118,43,0.14)] text-[#9a4a12]"
                      }`}
                    >
                      {t(`status.${request.status}`)}
                    </span>
                  </div>

                  {!cancelled ? (
                    <ol
                      aria-label={t("progress")}
                      className="mt-3 grid list-none grid-cols-5 gap-1 p-0"
                    >
                      {STEPS.map((step, index) => (
                        <li
                          key={step}
                          aria-current={step === request.status ? "step" : undefined}
                          className="flex flex-col gap-1.5"
                        >
                          <span
                            aria-hidden
                            className={`h-1.5 rounded-full ${
                              index <= stepIndex ? "bg-orange" : "bg-navy/10"
                            }`}
                          />
                          <span
                            className={`text-[11px] leading-tight ${
                              step === request.status
                                ? "font-semibold text-navy"
                                : "text-navy/55"
                            }`}
                          >
                            {t(`status.${step}`)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : null}

                  <p className="mt-3 text-sm text-navy/75">
                    {t(`statusHelp.${request.status}`)}
                  </p>

                  {request.quotedPriceCad !== null || request.scopeSummary ? (
                    <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-navy/10 pt-3 text-sm sm:grid-cols-[auto_1fr]">
                      {request.quotedPriceCad !== null ? (
                        <>
                          <dt className="text-navy/55">{t("quotedPrice")}</dt>
                          <dd className="m-0 font-semibold text-navy">
                            {formatPlanMoney(request.quotedPriceCad, lang)} CAD
                          </dd>
                        </>
                      ) : null}
                      {request.scopeSummary ? (
                        <>
                          <dt className="text-navy/55">{t("scope")}</dt>
                          <dd className="m-0 whitespace-pre-line text-navy/85">
                            {request.scopeSummary}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  ) : null}

                  <p className="mt-3 text-xs text-navy/50">
                    {t("requestedOn")} {date.format(new Date(request.createdAt))}
                    {" · "}
                    {t("updatedOn")} {date.format(new Date(request.updatedAt))}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="ws-new" className={`${CARD} flex flex-col gap-4`}>
        <div>
          <h2 id="ws-new" className="text-lg font-bold text-navy">
            {t("newTitle")}
          </h2>
          <p className="mt-1 text-sm text-navy/70">
            {canRequest ? t("newIntro") : t("restricted")}
          </p>
        </div>
        {canRequest ? (
          <WebsiteServiceNewRequest
            source="dashboard"
            defaults={{
              businessName: organization.name,
              contactName: user.name,
              contactEmail: user.email,
            }}
            submittedMessage={t("submitted")}
          />
        ) : null}
      </section>
    </div>
  );
}
