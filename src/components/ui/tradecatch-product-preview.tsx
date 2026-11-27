import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import {
  CallJourneyPhone,
  type CallJourneyCopy,
} from "@/components/ui/call-journey-phone";

/**
 * What TradeCatch does, shown on a phone: one call from the first ring to the
 * owner's dashboard, on a loop, with a rail that shows where the information
 * goes. Everything is an illustration: no names, numbers or figures that could
 * read as real customer data. Translation happens here, on the server, so the
 * client phone needs no message namespace of its own (the public layout ships
 * only a few). Shared by the home page hero and the sign-in panel.
 */
export function TradeCatchProductPreview({
  className,
  showScheduling = false,
  showCaption = false,
}: {
  className?: string;
  /** Pass the operator's launch flag: booking is advertised only once verified. */
  showScheduling?: boolean;
  /** The headline and line under the phone, for places that have none of their own. */
  showCaption?: boolean;
}) {
  const t = useTranslations("productPreview");
  const c = (key: string) => t(`call.${key}`);
  const booking = showScheduling;

  const copy: CallJourneyCopy = {
    incoming: c("incoming"),
    caller: c("caller"),
    callerLine: c("callerLine"),
    answeredBy: c("answeredBy"),
    onCall: c("onCall"),
    callEnded: c("callEnded"),
    speakerCaller: c("speakerCaller"),
    speakerAgent: c("speakerAgent"),
    caller1: c("caller1"),
    agent1: c("agent1"),
    caller2: c("caller2"),
    agent2: booking ? c("agent2") : c("agent2Request"),
    qualifyTitle: c("qualifyTitle"),
    facts: [
      [c("factService"), c("factServiceValue")],
      [c("factUrgency"), c("factUrgencyValue")],
      [c("factAddress"), c("factAddressValue")],
      [c("factContact"), c("factContactValue")],
    ],
    stepTitle: booking ? c("bookTitle") : c("requestTitle"),
    stepWorking: booking ? c("bookWorking") : c("requestWorking"),
    slots: booking ? [c("slot1"), c("slot2"), c("slot3")] : null,
    slotTaken: c("slotTaken"),
    stepDone: booking ? c("bookDone") : c("requestDone"),
    stepDoneNote: booking ? c("bookDoneNote") : c("requestDoneNote"),
    notifyApp: c("notifyApp"),
    notifyNow: c("notifyNow"),
    newBadge: c("newBadge"),
    notifyTitle: booking ? c("notifyTitleBooked") : c("notifyTitleRequest"),
    notifyBody: booking ? c("notifyBodyBooked") : c("notifyBodyRequest"),
    dashTitle: c("dashTitle"),
    dashNew: c("dashNew"),
    dashNewMeta: booking ? c("dashNewMetaBooked") : c("dashNewMetaRequest"),
    dashOld: [
      [c("dashOld1"), c("dashOld1Meta")],
      [c("dashOld2"), c("dashOld2Meta")],
    ],
    rail: [
      { title: c("railAnswered"), detail: c("railAnsweredDetail") },
      { title: c("railTalk"), detail: c("railTalkDetail") },
      { title: c("railQualified"), detail: c("railQualifiedDetail") },
      booking
        ? { title: c("railBooked"), detail: c("railBookedDetail") }
        : { title: c("railRequest"), detail: c("railRequestDetail") },
      { title: c("railDashboard"), detail: c("railDashboardDetail") },
    ],
    pause: c("pause"),
    play: c("play"),
  };

  return (
    <figure
      aria-label={t("label")}
      className={cn(
        "relative isolate m-0 overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--ink-rgb)/0.12)] bg-paper-deep/55 px-4 pt-4 pb-5 sm:px-6",
        className,
      )}
    >
      {/* Drafting grid, faded toward the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background-image:linear-gradient(to_right,rgb(var(--ink-rgb)/0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--ink-rgb)/0.055)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,#000,transparent_78%)]"
      />

      <p className="m-0 flex items-center gap-3 pr-10 text-[13px]">
        <span className="font-bold text-ember-text">{t("badge")}</span>
        <span className="text-secondary">{t("example")}</span>
      </p>
      <p className="sr-only">{booking ? c("summaryBooked") : c("summaryRequest")}</p>

      <div className="mt-4">
        <CallJourneyPhone copy={copy} booking={booking} />
      </div>

      {showCaption ? (
        <figcaption className="mx-auto mt-5 max-w-sm pb-2 text-center">
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
