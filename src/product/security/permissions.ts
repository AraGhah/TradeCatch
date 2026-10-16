import type { MemberRole } from "@/product/saas/types";

export type SecurityAction =
  | "read"
  | "write_leads"
  | "manage_billing"
  | "manage_ai"
  | "manage_security"
  | "manage_members"
  | "view_recordings";

const MEMBER_ALLOWED = new Set<SecurityAction>(["read", "write_leads"]);

export function allows(role: MemberRole, action: SecurityAction, platformAdmin = false): boolean {
  if (platformAdmin) return true;
  if (role === "owner" || role === "admin") return true;
  if (role === "member") return MEMBER_ALLOWED.has(action);
  return action === "read";
}

export function maskPhone(phone: string, role: MemberRole, platformAdmin = false): string {
  if (platformAdmin || role === "owner" || role === "admin") return phone;
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-2)}`;
}

export function redactAuditDetail(value: string): string {
  return value
    .replace(/\+\d{8,15}/g, "[phone]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:sk_|whsec_|Bearer\s+)\S+/gi, "[secret]")
    .slice(0, 240);
}
