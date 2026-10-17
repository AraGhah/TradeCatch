import type { MemberRole } from "@/product/saas/types";

export function canManageAccount(role: MemberRole, platformAdmin: boolean) {
  return platformAdmin || role === "owner" || role === "admin";
}

export function canCloseAccount(role: MemberRole, platformAdmin: boolean) {
  return platformAdmin || role === "owner";
}
