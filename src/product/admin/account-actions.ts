import type { MemberRole, OrgStatus } from "@/product/saas/types";

const STATUSES: OrgStatus[] = ["active", "suspended", "churned"];
const ROLES: MemberRole[] = ["owner", "admin", "member", "viewer"];

const CONFIRM: Record<OrgStatus, string> = {
  active: "activate",
  suspended: "suspend",
  churned: "deactivate",
};

export type ActionError = "status" | "confirm" | "own-session" | "role" | "last-owner" | "member";

export function decideStatusChange(input: {
  next: string;
  confirm: string;
  sessionOrganizationId: string;
  targetOrganizationId: string;
}): { ok: true; status: OrgStatus } | { ok: false; error: ActionError } {
  if (!STATUSES.includes(input.next as OrgStatus)) return { ok: false, error: "status" };
  const status = input.next as OrgStatus;
  if (input.confirm.trim().toLowerCase() !== CONFIRM[status]) {
    return { ok: false, error: "confirm" };
  }
  if (status !== "active" && input.targetOrganizationId === input.sessionOrganizationId) {
    return { ok: false, error: "own-session" };
  }
  return { ok: true, status };
}

export function decideRoleChange(input: {
  members: { userId: string; role: MemberRole }[];
  userId: string;
  next: string;
}): { ok: true; role: MemberRole } | { ok: false; error: ActionError } {
  if (!ROLES.includes(input.next as MemberRole)) return { ok: false, error: "role" };
  const role = input.next as MemberRole;
  const current = input.members.find((member) => member.userId === input.userId);
  if (!current) return { ok: false, error: "member" };
  const owners = input.members.filter((member) => member.role === "owner").length;
  if (current.role === "owner" && role !== "owner" && owners <= 1) {
    return { ok: false, error: "last-owner" };
  }
  return { ok: true, role };
}

export function confirmationWord(status: OrgStatus): string {
  return CONFIRM[status];
}
