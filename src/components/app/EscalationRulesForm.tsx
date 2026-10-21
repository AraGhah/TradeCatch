"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  EscalationContact,
  EscalationRule,
} from "@/product/notifications/types";

const fieldClass = "mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5";

export function EscalationRulesForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.alerts");
  const [rule, setRule] = useState<EscalationRule | null>(null);
  const [contacts, setContacts] = useState<EscalationContact[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
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
      <p role="status" className="text-sm text-navy/70">
        {t("contactsLoading")}
      </p>
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
            {contact.name} — {t(`contactRoles.${contact.role}`)} —{" "}
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
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setMessage(null);
        try {
          const response = await fetch(
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
        } catch {
          setMessage(t("error"));
        } finally {
          setSaving(false);
        }
      }}
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
        <button
          type="submit"
          className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
        >
          {saving ? t("saving") : t("save")}
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
