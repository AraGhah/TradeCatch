import {
  Building2,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  PhoneCall,
  PhoneIncoming,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

/** Bar heights (px) of the decorative call waveform. */
const WAVE = [7, 12, 18, 10, 22, 15, 20, 9, 16, 24, 13, 18, 8, 12, 6];

const FLOATING_CARD =
  "absolute hidden items-center gap-2.5 rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface py-2 pr-3.5 pl-2.5 shadow-[0_18px_36px_-20px_rgb(var(--ink-rgb)/0.38)] sm:flex";

/**
 * What TradeCatch does, shown on a phone: one call traced down a rail from
 * ringing to the business's dashboard. The rail is the same idea as the one on
 * the Pricing and Rewards cards. Everything here is an illustration: no names,
 * numbers or figures that could read as real customer data. Shared by the home
 * page hero and the sign-in panel. `data-motion` marks what the hero animates.
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
  const stages = [
    { icon: PhoneCall, title: t("request"), detail: t("service") },
    ...(showScheduling
      ? [
          {
            icon: CalendarCheck,
            title: t("appointment"),
            detail: t("scheduling"),
          },
        ]
      : []),
    { icon: LayoutDashboard, title: t("recorded"), detail: t("recordedNote") },
  ];

  return (
    <figure
      aria-label={t("label")}
      className={cn(
        "relative isolate m-0 overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--ink-rgb)/0.12)] bg-paper-deep/55 px-4 pt-4 pb-3.5 sm:px-6",
        className,
      )}
    >
      {/* Drafting grid, faded toward the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background-image:linear-gradient(to_right,rgb(var(--ink-rgb)/0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--ink-rgb)/0.055)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,#000,transparent_78%)]"
      />

      <p className="m-0 flex items-center justify-between gap-3 text-[13px]">
        <span className="font-bold text-ember-text">{t("badge")}</span>
        <span className="text-secondary">{t("example")}</span>
      </p>

      <div className="relative mx-auto mt-3 flex w-full max-w-[468px] justify-center sm:pb-4">
        {/* Phone */}
        <div
          data-motion="phone"
          className="w-full max-w-[272px] rounded-[40px] border-[7px] border-navy bg-paper shadow-[0_30px_50px_-30px_rgb(var(--ink-rgb)/0.55),inset_0_0_0_1px_rgb(var(--ink-rgb)/0.08)]"
        >
          <div className="px-3 pt-2 pb-3">
            <div
              aria-hidden
              className="mx-auto h-[18px] w-[74px] rounded-full bg-navy"
            />

            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="m-0 leading-tight">
                <span className="block text-[11px] text-muted">
                  {t("business")}
                </span>
                <span className="block text-[14px] font-extrabold tracking-[-0.02em] text-heading">
                  {t("dashboard")}
                </span>
              </p>
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface text-heading"
              >
                <Building2 className="h-4 w-4" strokeWidth={1.9} />
              </span>
            </div>

            <ol aria-label={t("railLabel")} className="m-0 mt-3 list-none p-0">
              {/* The ringing call */}
              <li data-motion="stage" className="relative pb-2.5">
                <div className="rounded-[var(--radius-md)] bg-navy p-3 text-white">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-orange text-navy"
                    >
                      <PhoneIncoming className="h-4 w-4" strokeWidth={2.1} />
                    </span>
                    <p className="m-0 min-w-0 leading-tight">
                      <span className="block text-[13.5px] font-bold">
                        {t("incoming")}
                      </span>
                      <span className="block text-[11.5px] text-white/75">
                        {t("customer")}
                      </span>
                    </p>
                  </div>
                  <div
                    aria-hidden
                    className="mt-2.5 flex h-6 items-center justify-between"
                  >
                    {WAVE.map((height, index) => (
                      <span
                        key={index}
                        data-motion="bar"
                        className="w-[3px] rounded-full bg-orange/80"
                        style={{ height }}
                      />
                    ))}
                  </div>
                </div>
                <span
                  aria-hidden
                  className="absolute bottom-0 left-[27px] h-2.5 border-l border-navy/40"
                />
              </li>

              {stages.map((stage, index) => {
                const Icon = stage.icon;
                const last = index === stages.length - 1;
                return (
                  <li
                    key={stage.title}
                    data-motion="stage"
                    className={cn("relative", !last && "pb-2.5")}
                  >
                    <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface py-2 pr-2 pl-3">
                      <span
                        aria-hidden
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
                          last
                            ? "border-orange bg-orange text-navy"
                            : "border-navy bg-navy text-white",
                        )}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.9} />
                      </span>
                      <p className="m-0 min-w-0 leading-tight">
                        <span className="block text-[12.5px] font-bold text-heading">
                          {stage.title}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted">
                          {stage.detail}
                        </span>
                      </p>
                    </div>
                    {last ? null : (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-[28px] h-2.5 border-l border-navy/40"
                      />
                    )}
                  </li>
                );
              })}
            </ol>

            <div
              aria-hidden
              className="mx-auto mt-3 h-1 w-20 rounded-full bg-navy/25"
            />
          </div>
        </div>

        {/* Floating notices. They repeat the rail, so they are decoration only.
            They sit level with the phone's notch and home bar, its two empty
            areas, so they cover none of its text however narrow the frame. */}
        <div
          aria-hidden
          data-motion="notice"
          className={cn(FLOATING_CARD, "-top-1.5 left-0")}
        >
          <PhoneCall className="h-4 w-4 text-ember-text" strokeWidth={2.1} />
          <span className="max-w-[88px] text-[12px] leading-tight font-bold text-heading">
            {t("handled")}
          </span>
        </div>
        <div
          aria-hidden
          data-motion="notice"
          className={cn(FLOATING_CARD, "right-0 bottom-0")}
        >
          {showScheduling ? (
            <ClipboardList
              className="h-4 w-4 text-signal-text"
              strokeWidth={2.1}
            />
          ) : (
            <CheckCircle2
              className="h-4 w-4 text-signal-text"
              strokeWidth={2.1}
            />
          )}
          <span className="max-w-[88px] text-[12px] leading-tight font-bold text-heading">
            {t("qualified")}
          </span>
        </div>
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
