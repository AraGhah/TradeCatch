"use client";

/**
 * Renders a calendar booking CTA after a successful audit request when
 * NEXT_PUBLIC_CALENDAR_URL is configured (Cal.com, Calendly, Google
 * Appointment schedules, etc.).
 */
export function CalendarBookingCta({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  const calendarUrl = process.env.NEXT_PUBLIC_CALENDAR_URL?.trim();
  if (!calendarUrl) return null;

  return (
    <div className="mt-8 rounded-[14px] border border-[rgba(12,20,30,0.1)] bg-paper px-5 py-5 text-left">
      <p className="text-[14px] leading-[1.55] text-muted">{hint}</p>
      <a
        href={calendarUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center justify-center rounded-[11px] bg-orange px-[22px] py-[14px] text-[15px] font-semibold text-navy shadow-cta transition-[transform,background] duration-200 hover:translate-y-[-2px] hover:bg-orange-dark"
      >
        {label}
      </a>
    </div>
  );
}
