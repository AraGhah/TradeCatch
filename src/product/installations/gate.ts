import { installationRegistry } from "./registry";
import { normalizeInstallationOrigin } from "./model";

export type InstallationEnvironment = {
  INSTALLATION_ENFORCEMENT?: string;
  INSTALLATION_INVENTORY_CONFIRMED?: string;
  INSTALLATION_ID?: string;
  INSTALLATION_CREDENTIAL?: string;
  INSTALLATION_AUTHORITY_MODE?: string;
  DATABASE_URL?: string;
};
export type InstallationVerifier = (
  id: string,
  secret: string,
  origin: string,
) => Promise<boolean>;
export const INSTALLATION_AUTHORITY_URL =
  "https://tradecatch.ca/api/installations/verify";

/** Remote installations never receive the authority's DB credentials or admin key. */
export async function verifyAtAuthority(
  id: string,
  secret: string,
  origin: string,
): Promise<boolean> {
  const response = await fetch(INSTALLATION_AUTHORITY_URL, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ installationId: id, origin }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Installation authority unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid authority response");
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512) {
      await reader.cancel();
      throw new Error("Invalid authority response");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const result: unknown = JSON.parse(text);
  if (
    !result ||
    typeof result !== "object" ||
    !("approved" in result) ||
    typeof result.approved !== "boolean"
  )
    throw new Error("Invalid authority response");
  return result.approved;
}

/** Worker ingress policy. Off is deliberately the shipping default: zero I/O. */
export async function enforceInstallationRequest(
  request: Request,
  env: InstallationEnvironment,
  verify?: InstallationVerifier,
): Promise<Response | null> {
  const mode = env.INSTALLATION_ENFORCEMENT?.trim() || "off";
  if (mode === "off") return null;
  const denied = (status: number) =>
    Response.json(
      {
        error:
          status === 403
            ? "Installation or domain is not approved."
            : "Installation approval is temporarily unavailable.",
      },
      {
        status,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  if (mode !== "enforce" || env.INSTALLATION_INVENTORY_CONFIRMED !== "1")
    return denied(503);
  const id = env.INSTALLATION_ID?.trim();
  const secret = env.INSTALLATION_CREDENTIAL?.trim();
  if (!id || !secret) return denied(403);
  try {
    const origin = normalizeInstallationOrigin(new URL(request.url).origin);
    // Misconfiguring the authority itself as a remote client must not recurse
    // through its own ingress until the subrequest budget is exhausted.
    if (
      !verify &&
      origin === new URL(INSTALLATION_AUTHORITY_URL).origin &&
      env.INSTALLATION_AUTHORITY_MODE !== "local"
    )
      return denied(503);
    // Never trust Host/X-Forwarded-Host as approval evidence. Existing webhooks
    // without Origin still require an approved ingress and their normal auth.
    const callerOrigin = request.headers.get("origin");
    const caller = callerOrigin
      ? normalizeInstallationOrigin(callerOrigin)
      : origin;
    const check =
      verify ??
      (env.INSTALLATION_AUTHORITY_MODE === "local"
        ? (id: string, secret: string, origin: string) =>
            installationRegistry(env.DATABASE_URL).verify(id, secret, origin)
        : env.INSTALLATION_AUTHORITY_MODE === "remote" ||
            !env.INSTALLATION_AUTHORITY_MODE
          ? verifyAtAuthority
          : null);
    if (!check) return denied(503);
    if (!(await check(id, secret, origin))) return denied(403);
    if (caller !== origin && !(await check(id, secret, caller)))
      return denied(403);
    return null;
  } catch {
    return denied(503);
  }
}
