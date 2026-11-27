import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import {
  WorkflowPhone,
  type WorkflowPhoneCopy,
} from "@/components/ui/workflow-phone";

/**
 * What TradeCatch does, shown on a phone: a call missed while the contractor
 * is on a job, texted back at once, followed by text to a confirmed visit and
 * a notification. Everything here is an illustration: no names, numbers or
 * figures that could read as real customer data. Shared by the home page hero
 * and the sign-in panel. Strings are resolved here, on the server, so the
 * client player needs no message namespace of its own.
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
  // Booking is promised only once the operator has verified scheduling.
  // Before that, the same conversation ends with a request the owner
  // confirms, which is what the product does in that mode.
  const booked = showScheduling;
  const copy: WorkflowPhoneCopy = {
    screenLabel: booked ? t("screenLabelBooked") : t("screenLabelRequest"),
    busy: t("busy"),
    incoming: t("incoming"),
    line: t("line"),
    customer: t("customer"),
    service: t("service"),
    decline: t("decline"),
    answer: t("answer"),
    missed: t("missed"),
    textingBack: t("textingBack"),
    auto: t("auto"),
    sms1: t("sms1"),
    sms2: t("sms2"),
    sms3: t("sms3"),
    sms4: t("sms4"),
    sms5: booked ? t("sms5Booked") : t("sms5Request"),
    sms6: t("sms6"),
    sms7: booked ? t("sms7Booked") : t("sms7Request"),
    cardTitle: booked ? t("calTitle") : t("reqTitle"),
    cardWorking: booked ? t("calWorking") : t("reqWorking"),
    cardFound: booked ? t("calFound") : t("reqDone"),
    cardDone: booked ? t("calDone") : t("reqDone"),
    chips: booked
      ? [t("slotWed"), t("slotThu"), t("slotFri")]
      : [t("reqService"), t("reqName"), t("reqAddress")],
    slotBusy: t("slotBusy"),
    notifyApp: t("notifyApp"),
    notifyNow: t("notifyNow"),
    notifyTitle: booked ? t("notifyBookedTitle") : t("notifyRequestTitle"),
    notifyBody: booked ? t("notifyBookedBody") : t("notifyRequestBody"),
    resultFrom: t("resultFrom"),
    resultTo: booked ? t("resultBooked") : t("resultRequest"),
    resultNote: t("resultNote"),
    composer: t("composer"),
    noticeLeft: t("noticeLeft"),
    noticeRight: booked ? t("noticeBooked") : t("noticeRequest"),
    pause: t("pause"),
    play: t("play"),
  };

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
        <WorkflowPhone copy={copy} booked={booked} />
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
