import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { receptionistCallCopy } from "@/components/ui/receptionist-call-copy";
import { ReceptionistCallPhone } from "@/components/ui/receptionist-call-phone";

/**
 * What TradeCatch does, shown on a phone: a customer calls, the receptionist
 * answers and holds the conversation, captures the job, books it or prepares
 * it for the team, handles a request for a person, and the call ends as a
 * summary on the contractor's dashboard. Everything is an illustration with a
 * fictional business (the one in the demo video); no real names or numbers.
 *
 * Strings are resolved here, on the server, so the client player needs no
 * message namespace of its own; receptionistCallCopy decides what the call
 * promises for the launch flags passed in.
 */
export function TradeCatchProductPreview({
  className,
  showScheduling = false,
  showTransfer = false,
  showCaption = false,
}: {
  className?: string;
  /** Pass the operator's launch flag: booking is advertised only once verified. */
  showScheduling?: boolean;
  /** Pass the operator's call-transfer launch flag. Off at launch. */
  showTransfer?: boolean;
  /** The headline and line under the phone, for places that have none of their own. */
  showCaption?: boolean;
}) {
  const t = useTranslations("productPreview");
  const copy = receptionistCallCopy(t, {
    booking: showScheduling,
    transfer: showTransfer,
  });

  return (
    <figure
      aria-label={t("label")}
      className={cn(
        "relative isolate m-0 overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--ink-rgb)/0.12)] bg-paper-deep/55 px-3 pt-4 pb-3 sm:px-6",
        className,
      )}
    >
      {/* Drafting grid, faded toward the edges, and a warm glow behind the phone. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background-image:linear-gradient(to_right,rgb(var(--ink-rgb)/0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--ink-rgb)/0.055)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,#000,transparent_78%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange/15 blur-3xl"
      />

      <p className="m-0 flex items-center justify-between gap-3 px-1 text-[13px]">
        <span className="font-bold text-ember-text">{t("badge")}</span>
        <span className="text-secondary">{t("example")}</span>
      </p>

      <div className="mt-3">
        <ReceptionistCallPhone
          copy={copy}
          booking={showScheduling}
          transfer={showTransfer}
        />
      </div>

      {showCaption ? (
        <figcaption className="mx-auto mt-4 max-w-sm pb-2 text-center">
          <span className="block font-heading text-[clamp(22px,2vw,28px)] font-extrabold tracking-[-0.03em] text-heading">
            {t("captionTitle")}
          </span>
          <span className="mt-2 block text-[15px] leading-[1.55] text-secondary">
            {t("captionBody")}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
