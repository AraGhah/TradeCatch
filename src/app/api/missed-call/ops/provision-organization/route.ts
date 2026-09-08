import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  getOpsSecret,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getSaasStore } from "@/product/saas/runtime";
import { normalizeEmail } from "@/product/saas/store";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    email: z.string().trim().email().max(200),
    organizationName: z.string().trim().min(2).max(120),
    ownerName: z.string().trim().min(1).max(120),
    locale: z.enum(["en", "fr"]),
    plan: z.enum(["starter", "growth"]),
  })
  .strict();

/** Founder-only provisioning for a pilot owner and organization. */
export async function POST(request: NextRequest) {
  // Provisioning changes tenant access, so fail closed even in local/dev when
  // the shared ops secret has not been configured.
  if (!getOpsSecret() || !authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }

  const audit = logOpsAccess(request, "ops.provision_organization");
  if (!request.headers.get("x-ops-actor")?.trim() || audit.missingActor) {
    return missingOpsActorResponse();
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const input = parsed.data;
  const email = normalizeEmail(input.email);
  const store = getSaasStore();

  try {
    const existingUser = await store.getUserByEmail(email);
    if (existingUser) {
      const memberships = await store.listMembershipsForUser(existingUser.id);
      for (const membership of memberships) {
        const organization = await store.getOrganization(
          membership.organizationId,
        );
        if (organization) {
          logOpsAccess(request, "ops.provision_organization.existing", {
            organizationId: organization.id,
          });
          return NextResponse.json({
            ok: true,
            created: false,
            owner: existingUser,
            organization,
          });
        }
      }
    }

    const created = await store.createOrganizationWithOwner({
      name: input.organizationName,
      ownerEmail: email,
      ownerName: input.ownerName,
      locale: input.locale,
      plan: input.plan,
    });
    logOpsAccess(request, "ops.provision_organization.created", {
      organizationId: created.organization.id,
    });
    return NextResponse.json(
      {
        ok: true,
        created: true,
        owner: created.user,
        organization: created.organization,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[ops/provision-organization]", err);
    return NextResponse.json(
      { error: "Failed to provision organization." },
      { status: 500 },
    );
  }
}
