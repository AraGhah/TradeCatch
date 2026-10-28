import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const LINKS = [
  ["/app/bookings", "navList"],
  ["/app/bookings/availability", "navHours"],
  ["/app/bookings/services", "navServices"],
  ["/app/settings/calendar", "navCalendar"],
] as const;

export async function ScheduleSubnav({ showTeam = false }: { showTeam?: boolean } = {}) {
  const t = await getTranslations("app.schedule");
  const links = showTeam
    ? ([...LINKS, ["/app/settings/team", "navTeam"]] as const)
    : LINKS;
  return (
    <nav className="flex flex-wrap gap-2">
      {links.map(([href, key]) => (
        <Link
          key={href}
          href={href}
          className="rounded-md border border-navy/15 bg-white px-3 py-1.5 text-sm font-semibold text-navy hover:bg-navy/5"
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
