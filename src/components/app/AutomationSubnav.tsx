import { Link } from "@/i18n/navigation";

const LINKS = [
  { href: "/app/automations", key: "overview" },
  { href: "/app/automations/missed-call", key: "missedCall" },
  { href: "/app/automations/quotes", key: "quotes" },
  { href: "/app/automations/templates", key: "templates" },
  { href: "/app/automations/history", key: "history" },
] as const;

export function AutomationSubnav({
  labels,
  current,
}: {
  labels: Record<(typeof LINKS)[number]["key"], string>;
  current: (typeof LINKS)[number]["key"];
}) {
  return (
    <nav className="flex flex-wrap gap-2 text-sm">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={current === link.key ? "page" : undefined}
          className={`rounded-md px-3 py-2 ${
            current === link.key
              ? "bg-navy/10 font-semibold text-navy"
              : "text-navy/70 hover:bg-navy/5"
          }`}
        >
          {labels[link.key]}
        </Link>
      ))}
    </nav>
  );
}
