import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { isCrossSiteMutation } from "@/lib/csrf";
import { readJsonBody } from "@/lib/request-body";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import {
  installationCommand,
  InstallationConflict,
} from "@/product/installations/model";
import { installationRegistry } from "@/product/installations/registry";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });
async function access(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return { response: reply({ error: auth.error }, auth.status) };
  // Licensing decisions require an individually identified MFA administrator,
  // never the legacy shared operations secret or a customer organization owner.
  if (auth.via !== "session" || !auth.ctx)
    return {
      response: reply(
        { error: "An MFA-verified administrator session is required." },
        403,
      ),
    };
  return { actor: auth.ctx.user.id };
}
export async function GET(request: Request) {
  const auth = await access(request);
  if (auth.response) return auth.response;
  try {
    return reply({
      ok: true,
      ...(await installationRegistry().list()),
      enforcement: process.env.INSTALLATION_ENFORCEMENT?.trim() || "off",
    });
  } catch {
    return reply({ error: "Installation registry is unavailable." }, 503);
  }
}
export async function POST(request: Request) {
  if (
    isCrossSiteMutation({
      method: request.method,
      headers: request.headers,
      hosts: [new URL(request.url).host],
    })
  )
    return reply({ error: "Cross-site request blocked." }, 403);
  const auth = await access(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit({
    scope: "installation-admin",
    subject: auth.actor!,
    limit: 30,
    windowMs: 60000,
  });
  if (limited) return limited;
  const body = await readJsonBody(request, 4096);
  if (!body.ok) return reply({ error: body.error }, body.status);
  const parsed = installationCommand.safeParse(body.data);
  if (!parsed.success)
    return reply(
      {
        error:
          "Invalid installation request. Use an exact origin and a decision reason.",
      },
      400,
    );
  try {
    const result = await installationRegistry().command(
      parsed.data,
      auth.actor!,
    );
    return reply(
      { ok: true, ...result },
      parsed.data.action === "decide" ||
        parsed.data.action === "revoke_installation"
        ? 200
        : 201,
    );
  } catch (error) {
    return error instanceof InstallationConflict
      ? reply({ error: error.message }, 409)
      : reply(
          {
            error:
              "Installation change could not be saved. No approval was confirmed.",
          },
          503,
        );
  }
}
