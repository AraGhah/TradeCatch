"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AiReceptionistOverview } from "@/product/receptionist/ai-receptionist-service";
import type { VoiceCapabilities } from "@/product/receptionist/plan-limits";
import type { ProfileSettings } from "@/product/receptionist/profile";
import { ReceptionistOverview } from "./ReceptionistOverview";
import { ReceptionistSettingsForm } from "./ReceptionistSettingsForm";
import { ReceptionistTestPanel } from "./ReceptionistTestPanel";
import { ReceptionistCallHistory } from "./ReceptionistCallHistory";

type Hours = { start: string; end: string; days: number[] };

export function ReceptionistManager({
  organizationId,
  overview,
  initialSettings,
  defaultHours,
  readOnly,
  voiceCapabilities,
}: {
  organizationId: string;
  overview: AiReceptionistOverview;
  initialSettings: ProfileSettings;
  defaultHours: Hours;
  readOnly: boolean;
  voiceCapabilities?: VoiceCapabilities;
}) {
  const t = useTranslations("app.receptionist");
  const [panel, setPanel] = useState<"overview" | "edit" | "test" | "history">(
    "overview",
  );

  return (
    <div className="flex flex-col gap-6">
      <ReceptionistOverview
        organizationId={organizationId}
        overview={overview}
        readOnly={readOnly}
        onEdit={() => setPanel("edit")}
        onTest={() => setPanel("test")}
        onHistory={() => setPanel("history")}
      />

      {panel === "edit" ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="min-h-9 self-start text-sm font-semibold text-navy underline"
            aria-label={t("backToOverview")}
            onClick={() => setPanel("overview")}
          >
            <span aria-hidden="true">← </span>
            {t("backToOverview")}
          </button>
          <ReceptionistSettingsForm
            organizationId={organizationId}
            readOnly={readOnly}
            initial={initialSettings}
            defaultHours={defaultHours}
            voiceCapabilities={voiceCapabilities}
          />
        </div>
      ) : null}

      {panel === "test" ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="min-h-9 self-start text-sm font-semibold text-navy underline"
            aria-label={t("backToOverview")}
            onClick={() => setPanel("overview")}
          >
            <span aria-hidden="true">← </span>
            {t("backToOverview")}
          </button>
          <ReceptionistTestPanel organizationId={organizationId} />
        </div>
      ) : null}

      {panel === "history" ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="min-h-9 self-start text-sm font-semibold text-navy underline"
            aria-label={t("backToOverview")}
            onClick={() => setPanel("overview")}
          >
            <span aria-hidden="true">← </span>
            {t("backToOverview")}
          </button>
          <ReceptionistCallHistory organizationId={organizationId} />
        </div>
      ) : null}
    </div>
  );
}
