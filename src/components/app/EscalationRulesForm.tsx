"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  EscalationContact,
  EscalationRule,
} from "@/product/notifications/types";

import { RequestTimeoutError, timedFetch } from "@/lib/client/timed-fetch";
import { useGuarded } from "@/lib/client/use-single-flight";
import { LoadingRegion, SkeletonLines } from "@/components/ui/Skeleton";
import { BusyLabel } from "@/components/ui/Spinner";

const fieldClass = "mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5";

export function EscalationRulesForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.alerts");
  const tFeedback = useTranslations("feedback");
  const [rule, setRule] = useState<EscalationRule | null>(null);
  const [contacts, setContacts] = useState<EscalationContact[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Declared before the early returns below (hooks run on every render), and
  // guarded so a burst of clicks or a held Enter key sends one request.
  const save = useGuarded(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rule) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/escalation-rules`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule),
        },
      );
      const data = (await response.json()) as {
        rule?: EscalationRule;
        code?: string;
      };
      if (!response.ok) {
        const codes = [
          "contactUnavailable",
          "sameContact",
          "smsNeedsVerifiedPhones",
        ] as const;
        const code = codes.find((candidate) => candidate === data.code);
        setMessage(code ? t(code) : t("error"));
      } else {
        if (!data.rule) throw new Error("invalid_response");
        setRule(data.rule);
        setMessage(t("saved"));
      }
    } catch (cause) {
      // No answer in time, or the connection dropped: it may have been saved.
      setMessage(
        cause instanceof RequestTimeoutError
          ? tFeedback("errors.timeoutUnknown")
          : cause instanceof TypeError
            ? tFeedback("errors.networkUnknown")
            : t("error"),
      );
    } finally {
      setSaving(false);
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await timedFetch(
          `/api/businesses/${organizationId}/escalation-rules`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("load_failed");
        const data = (await response.json()) as {
          rule?: EscalationRule;
          contacts?: EscalationContact[];
        };
        if (!data.rule || !Array.isArray(data.contacts))
          throw new Error("load_failed");
        if (!controller.signal.aborted) {
          setRule(data.rule);
          setContacts(data.contacts);
          setLoadFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [organizationId, retry]);

  if (loadFailed && !rule)
    return (
      <div role="alert" className="text-sm">
        <p>{t("contactLoadError")}</p>
        <button
          type="button"
          onClick={() => setRetry(retry + 1)}
          className="mt-2 underline"
        >
          {t("refresh")}
        </button>
      </div>
    );
  if (!rule)
    return (
      <LoadingRegion label={t("contactsLoading")}>
        <SkeletonLines lines={4} />
      </LoadingRegion>
    );

  const contactSelect = (
    field: "primaryUserId" | "secondaryUserId",
    label: string,
    empty: string,
  ) => (
    <label className="text-sm">
      {label}
      <select
        value={rule[field] ?? ""}
        onChange={(event) =>
          setRule({ ...rule, [field]: event.target.value || undefined })
        }
        className={fieldClass}
      >
        <option value="">{empty}</option>
        {rule[field] &&
        !contacts.some((contact) => contact.userId === rule[field]) ? (
          <option value={rule[field]} disabled>
            {t("contactUnavailable")}
          </option>
        ) : null}
        {contacts.map((contact) => (
          <option key={contact.userId} value={contact.userId}>
            {contact.name} · {t(`contactRoles.${contact.role}`)} ·{" "}
            {contact.verifiedPhoneE164
              ? `${contact.verifiedPhoneE164} (${t("phoneVerified")})`
              : t("phoneNotVerified")}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form
      className="grid max-w-lg gap-3"
      aria-busy={saving}
      onSubmit={(event) => void save(event)}
    >
      <fieldset disabled={saving} className="grid gap-3">
        <label className="text-sm">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) =>
              setRule({ ...rule, enabled: event.target.checked })
            }
          />{" "}
          {t("enabled")}
        </label>
        {contactSelect("primaryUserId", t("primary"), t("defaultPrimary"))}
        {contactSelect("secondaryUserId", t("backup"), t("noBackup"))}
        {contacts.length === 0 ? (
          <p className="text-sm text-navy/70">{t("noContacts")}</p>
        ) : null}
        <p className="text-sm text-navy/70">{t("verifiedPhoneHelp")}</p>
        <label className="text-sm">
          {t("delay")}
          <input
            type="number"
            min={1}
            max={240}
            required
            value={rule.delayMinutes}
            onChange={(event) =>
              setRule({ ...rule, delayMinutes: Number(event.target.value) })
            }
            className={fieldClass}
          />
        </label>
        <label className="text-sm">
          {t("attempts")}
          <input
            type="number"
            min={1}
            max={5}
            required
            value={rule.maxAttempts}
            onChange={(event) =>
              setRule({ ...rule, maxAttempts: Number(event.target.value) })
            }
            className={fieldClass}
          />
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={rule.acknowledgementRequired}
            onChange={(event) =>
              setRule({
                ...rule,
                acknowledgementRequired: event.target.checked,
              })
            }
          />{" "}
          {t("ackRequired")}
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={rule.afterHours}
            onChange={(event) =>
              setRule({ ...rule, afterHours: event.target.checked })
            }
          />{" "}
          {t("afterHours")}
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={rule.emailEnabled}
            onChange={(event) =>
              setRule({ ...rule, emailEnabled: event.target.checked })
            }
          />{" "}
          {t("email")}
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={rule.smsEnabled}
            onChange={(event) =>
              setRule({ ...rule, smsEnabled: event.target.checked })
            }
          />{" "}
          {t("sms")}
        </label>
        <button aria-busy={saving}
          type="submit"
          className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
        >
          <BusyLabel pending={saving} busyLabel={t("saving")}>{t("save")}</BusyLabel>
        </button>
      </fieldset>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
