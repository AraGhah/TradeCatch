"use client";

// Hosts known to support being embedded in an iframe (both explicitly
// document/allow it). Anything else — including Google Calendar appointment
// schedules, which refuse to be framed — falls back to an "open in a new
// tab" link instead of a blank/broken iframe.
const EMBEDDABLE_HOSTS = ["cal.com", "calendly.com"];

function isEmbeddable(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return EMBEDDABLE_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

/**
 * Renders a calendar booking widget after a successful audit request when
 * NEXT_PUBLIC_CALENDAR_URL is configured (Cal.com, Calendly, Google
 * Appointment schedules, etc.). Embeds inline for hosts that support it;
 * otherwise falls back to a plain link that opens in a new tab.
 */
export function CalendarBookingCta({
  label,
  hint,
  openInNewTabLabel,
}: {
  label: string;
  hint: string;
  openInNewTabLabel: string;
}) {
  const calendarUrl = process.env.NEXT_PUBLIC_CALENDAR_URL?.trim();
  if (!calendarUrl) return null;

  const embeddable = isEmbeddable(calendarUrl);

  return (
    <div className="mt-8 rounded-[14px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-5 py-5 text-left">
      <p className="text-[14px] leading-[1.55] text-muted">{hint}</p>

      {embeddable ? (
        <div className="mt-4 overflow-hidden rounded-[11px] border border-[rgb(var(--ink-rgb)/0.1)]">
          <iframe
            src={calendarUrl}
            title={label}
            loading="lazy"
            className="h-[680px] w-full bg-white"
          />
        </div>
      ) : null}

      <a
        href={calendarUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={
          embeddable
            ? "mt-3 inline-flex items-center justify-center text-[13px] font-medium text-ember-text underline underline-offset-4 hover:text-heading"
            : "mt-4 inline-flex items-center justify-center rounded-[11px] bg-orange px-[22px] py-[14px] text-[15px] font-semibold text-navy shadow-cta transition-[transform,background] duration-200 hover:translate-y-[-2px] hover:bg-orange-dark"
        }
      >
        {embeddable ? openInNewTabLabel : label}
      </a>
    </div>
  );
}
