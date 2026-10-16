/** Digits only, NANP country code stripped, so +1 514… equals (514) …. */
export function phoneKey(phone: string | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

export function normalizeE164(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function samePhone(a: string | undefined, b: string | undefined): boolean {
  const ka = phoneKey(a);
  return ka.length >= 10 && ka === phoneKey(b);
}
