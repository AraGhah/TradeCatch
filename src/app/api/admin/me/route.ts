import { adminReply, guardAdmin } from "@/lib/admin-route";
import { permissionsOf } from "@/lib/admin-rbac";

export const dynamic = "force-dynamic";

/**
 * Who the console thinks the caller is: their role and what it allows. The page
 * uses this to hide or disable actions the role cannot perform. It is a
 * convenience only: every action is enforced again on the server, so a page
 * that ignores this still cannot do anything the role does not permit.
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const { actor } = guard.access;
  return adminReply({
    ok: true,
    role: actor.role,
    permissions: permissionsOf(actor.role),
    // The operations secret has no person behind it.
    via: actor.via,
    label: actor.email ?? actor.label,
  });
}
