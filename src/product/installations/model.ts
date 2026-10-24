import { z } from "zod";

/** Exact origins only. Never accept wildcard, forwarded-host or suffix matches. */
export function normalizeInstallationOrigin(raw: string): string {
  if (
    raw.length > 300 ||
    !/^https?:\/\/[^/?#\\\s]+\/?$/i.test(raw) ||
    /[\\*?#]/.test(raw)
  )
    throw new Error("An exact origin is required");
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.hostname.endsWith(".")
  )
    throw new Error("An HTTPS origin or local loopback origin is required");
  return url.origin;
}

export const originSchema = z
  .string()
  .min(1)
  .max(300)
  .transform((raw, ctx) => {
    try {
      return normalizeInstallationOrigin(raw);
    } catch {
      ctx.addIssue({
        code: "custom",
        message:
          "Use an exact HTTPS origin (HTTP is allowed only for localhost).",
      });
      return z.NEVER;
    }
  });
const reason = z.string().trim().min(5).max(500);
export const installationCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("revoke_installation"),
      installationId: z.uuid(),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("register"),
      label: z.string().trim().min(1).max(100),
      origin: originSchema,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("add_domain"),
      installationId: z.uuid(),
      origin: originSchema,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("decide"),
      domainId: z.uuid(),
      status: z.enum(["approved", "rejected", "revoked"]),
      revision: z.number().int().min(0),
      reason,
    })
    .strict(),
]);
export type InstallationCommand = z.infer<typeof installationCommand>;
export type ApprovalStatus = "pending" | "approved" | "rejected" | "revoked";
export type InstallationDomain = {
  id: string;
  installationId: string;
  label: string;
  origin: string;
  status: ApprovalStatus;
  revision: number;
  updatedAt: string;
};
export type InstallationAudit = {
  id: string;
  domainId: string;
  actor: string;
  action: string;
  reason: string;
  fromStatus: ApprovalStatus | null;
  toStatus: ApprovalStatus;
  createdAt: string;
};
export class InstallationConflict extends Error {}

export const installationSnapshot = z.object({
  domains: z.array(
    z.object({
      id: z.uuid(),
      installationId: z.uuid(),
      label: z.string(),
      origin: z.string(),
      status: z.enum(["pending", "approved", "rejected", "revoked"]),
      revision: z.number().int().min(0),
      updatedAt: z.string(),
    }),
  ),
  audit: z.array(
    z.object({
      id: z.uuid(),
      domainId: z.uuid(),
      actor: z.string(),
      action: z.string(),
      reason: z.string(),
      fromStatus: z
        .enum(["pending", "approved", "rejected", "revoked"])
        .nullable(),
      toStatus: z.enum(["pending", "approved", "rejected", "revoked"]),
      createdAt: z.string(),
    }),
  ),
  enforcement: z.string(),
});
export const installationReceipt = z.object({
  ok: z.literal(true),
  installationId: z.uuid(),
  credential: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
});
