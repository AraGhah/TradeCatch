import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { safeEqual } from "@/lib/safe-compare";
import { getPgPool } from "@/product/missed-call/postgres-store";
import {
  InstallationConflict,
  installationCommand,
  normalizeInstallationOrigin,
  type InstallationCommand,
  type InstallationDomain,
  type InstallationAudit,
} from "./model";

const digest = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
type DomainReceipt = {
  domainId: string;
  installationId: string;
  credential?: string;
};
type RevokeReceipt = { installationId: string; revoked: number };
export class InstallationRegistry {
  constructor(private readonly pool: Pool) {}
  async list() {
    const domains = await this.pool
      .query<InstallationDomain>(`SELECT d.id, d.installation_id AS "installationId", i.label, d.origin, d.status, d.revision, d.updated_at AS "updatedAt"
      FROM tc_installation_domains d JOIN tc_installations i ON i.id=d.installation_id
      ORDER BY d.updated_at DESC,d.id LIMIT 200`);
    const audit = await this.pool
      .query<InstallationAudit>(`SELECT id,domain_id AS "domainId",actor,action,reason,from_status AS "fromStatus",to_status AS "toStatus",created_at AS "createdAt"
      FROM tc_installation_audit ORDER BY created_at DESC,id LIMIT 100`);
    return { domains: domains.rows, audit: audit.rows };
  }
  async command(
    input: Extract<InstallationCommand, { action: "revoke_installation" }>,
    actor: string,
  ): Promise<RevokeReceipt>;
  async command(
    input: Exclude<InstallationCommand, { action: "revoke_installation" }>,
    actor: string,
  ): Promise<DomainReceipt>;
  async command(
    input: InstallationCommand,
    actor: string,
  ): Promise<DomainReceipt | RevokeReceipt>;
  async command(input: InstallationCommand, actor: string) {
    const cmd = installationCommand.parse(input);
    if (!actor || actor.length > 200)
      throw new Error("Administrator identity required");
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      if (cmd.action === "revoke_installation") {
        const installation = await db.query(
          "SELECT id FROM tc_installations WHERE id=$1 FOR UPDATE",
          [cmd.installationId],
        );
        if (!installation.rowCount)
          throw new InstallationConflict("Installation not found");
        const domains = await db.query<{ id: string; status: string }>(
          "SELECT id,status FROM tc_installation_domains WHERE installation_id=$1 AND status <> 'revoked' ORDER BY id FOR UPDATE",
          [cmd.installationId],
        );
        if (!domains.rowCount)
          throw new InstallationConflict("Installation is already revoked");
        for (const row of domains.rows) {
          await db.query(
            "UPDATE tc_installation_domains SET status='revoked',revision=revision+1,updated_at=now() WHERE id=$1",
            [row.id],
          );
          await db.query(
            "INSERT INTO tc_installation_audit(id,domain_id,actor,action,reason,from_status,to_status) VALUES ($1,$2,$3,'revoked',$4,$5,'revoked')",
            [crypto.randomUUID(), row.id, actor, cmd.reason, row.status],
          );
        }
        await db.query("COMMIT");
        return {
          installationId: cmd.installationId,
          revoked: domains.rowCount,
        };
      }
      const domainId =
        cmd.action === "decide" ? cmd.domainId : crypto.randomUUID();
      let installationId: string;
      let credential: string | undefined;
      let fromStatus: string | null = null;
      let toStatus = "pending";
      if (cmd.action === "register") {
        installationId = crypto.randomUUID();
        credential = randomBytes(32).toString("base64url");
        await db.query(
          "INSERT INTO tc_installations(id,label,credential_hash) VALUES ($1,$2,$3)",
          [installationId, cmd.label, digest(credential)],
        );
      } else if (cmd.action === "add_domain") {
        installationId = cmd.installationId;
        const found = await db.query(
          "SELECT id FROM tc_installations WHERE id=$1 FOR UPDATE",
          [installationId],
        );
        if (!found.rowCount)
          throw new InstallationConflict("Installation not found");
      } else {
        // Use the same installation->domain lock order as full revocation and
        // alias registration. A stale approval cannot race a whole-install revoke.
        const parent = await db.query<{ installation_id: string }>(
          "SELECT installation_id FROM tc_installation_domains WHERE id=$1",
          [domainId],
        );
        if (!parent.rows[0]) throw new InstallationConflict("Domain not found");
        await db.query(
          "SELECT id FROM tc_installations WHERE id=$1 FOR UPDATE",
          [parent.rows[0].installation_id],
        );
        const found = await db.query<{
          installation_id: string;
          status: string;
          revision: number;
        }>(
          "SELECT installation_id,status,revision FROM tc_installation_domains WHERE id=$1 FOR UPDATE",
          [domainId],
        );
        const row = found.rows[0];
        if (
          !row ||
          row.revision !== cmd.revision ||
          row.status === cmd.status ||
          (cmd.status === "revoked" && row.status !== "approved") ||
          (cmd.status === "rejected" && row.status !== "pending")
        )
          throw new InstallationConflict(
            "Approval changed; refresh before deciding",
          );
        installationId = row.installation_id;
        fromStatus = row.status;
        toStatus = cmd.status;
        await db.query(
          "UPDATE tc_installation_domains SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1",
          [domainId, toStatus],
        );
      }
      if (cmd.action !== "decide")
        await db.query(
          "INSERT INTO tc_installation_domains(id,installation_id,origin) VALUES ($1,$2,$3)",
          [domainId, installationId, cmd.origin],
        );
      await db.query(
        "INSERT INTO tc_installation_audit(id,domain_id,actor,action,reason,from_status,to_status) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          crypto.randomUUID(),
          domainId,
          actor,
          cmd.action === "decide" ? cmd.status : cmd.action,
          cmd.reason,
          fromStatus,
          toStatus,
        ],
      );
      await db.query("COMMIT");
      // Only returned on initial registration. Never stored plaintext or logged.
      return {
        domainId,
        installationId,
        ...(credential ? { credential } : {}),
      };
    } catch (error) {
      await db.query("ROLLBACK");
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new InstallationConflict("Origin is already registered");
      throw error;
    } finally {
      db.release();
    }
  }
  async verify(
    installationId: string,
    credential: string,
    rawOrigin: string,
  ): Promise<boolean> {
    if (
      !/^[0-9a-f-]{36}$/i.test(installationId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(credential)
    )
      return false;
    let origin: string;
    try {
      origin = normalizeInstallationOrigin(rawOrigin);
    } catch {
      return false;
    }
    const result = await this.pool.query<{
      credential_hash: string;
      status: string;
    }>(
      `SELECT i.credential_hash,d.status FROM tc_installations i
      JOIN tc_installation_domains d ON d.installation_id=i.id WHERE i.id=$1 AND d.origin=$2`,
      [installationId, origin],
    );
    const row = result.rows[0];
    const matches = safeEqual(
      digest(credential),
      row?.credential_hash ?? "0".repeat(64),
    );
    return matches && row?.status === "approved";
  }
}

export function installationRegistry(url = process.env.DATABASE_URL) {
  if (!url?.trim())
    throw new Error("Installation registry requires PostgreSQL");
  return new InstallationRegistry(getPgPool(url.trim()));
}
