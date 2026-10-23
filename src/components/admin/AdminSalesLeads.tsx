"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  salesLeadPageSchema,
  type SalesLeadPage,
} from "@/product/sales-crm/types";

export function AdminSalesLeads() {
  const t = useTranslations("admin.sales");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<SalesLeadPage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/admin/sales-leads?page=${page}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("unavailable");
        const result = salesLeadPageSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setData(result);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [page, retry]);
  const navigate = (value: number) => {
    setData(null);
    setError(false);
    setPage(value);
  };
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-extrabold text-navy">{t("title")}</h1>
        <p className="mt-2 text-sm text-navy/70">{t("intro")}</p>
      </header>
      {error ? (
        <div role="alert">
          <p>{t("error")}</p>
          <button
            type="button"
            className="underline"
            onClick={() => {
              setError(false);
              setData(null);
              setRetry(retry + 1);
            }}
          >
            {t("retry")}
          </button>
        </div>
      ) : !data ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {data.leads.length === 0 ? (
            <p>{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-navy/10 bg-white">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t("title")}</caption>
                <thead>
                  <tr>
                    {["company", "contact", "request", "received"].map(
                      (key) => (
                        <th scope="col" className="p-3" key={key}>
                          {t(key)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((lead) => (
                    <tr
                      className="border-t border-navy/10 align-top"
                      key={lead.id}
                    >
                      <td className="p-3">
                        <p className="font-semibold">{lead.company}</p>
                        <p>
                          {lead.city} · {lead.trade}
                        </p>
                        <p className="mt-1 text-xs text-navy/60">{lead.id}</p>
                      </td>
                      <td className="p-3">
                        <p>
                          {lead.firstName} {lead.lastName}
                        </p>
                        <p>{lead.email}</p>
                        <p>{lead.phone}</p>
                        <p>{lead.language === "fr" ? "Français" : "English"}</p>
                      </td>
                      <td className="max-w-sm whitespace-pre-wrap break-words p-3">
                        <p>{t(`stages.${lead.stage}`)}</p>
                        {lead.mainProblem}
                      </td>
                      <td className="whitespace-nowrap p-3">
                        {new Date(lead.createdAt).toLocaleString(locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav
            aria-label={t("pages")}
            className="flex items-center gap-4 text-sm"
          >
            <button
              type="button"
              className="underline disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => navigate(page - 1)}
            >
              {t("previous")}
            </button>
            <span>{t("page", { page })}</span>
            <button
              type="button"
              className="underline disabled:opacity-40"
              disabled={!data.hasMore || page >= 1000}
              onClick={() => navigate(page + 1)}
            >
              {t("next")}
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
