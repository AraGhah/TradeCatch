export function formatWhen(iso: string, locale: "en" | "fr"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(isoDate: string, locale: "en" | "fr"): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatMoney(amount: number | null, locale: "en" | "fr"): string {
  if (amount == null) return "—";
  return amount.toLocaleString(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
}

export function formatDuration(seconds: number | null, locale: "en" | "fr"): string {
  if (seconds == null) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (locale === "fr") {
    return minutes > 0 ? `${minutes} min ${remain} s` : `${remain} s`;
  }
  return minutes > 0 ? `${minutes}m ${remain}s` : `${remain}s`;
}

export function formatResponse(ms: number | null, locale: "en" | "fr"): string {
  if (ms == null) return "—";
  return formatDuration(ms / 1000, locale);
}
