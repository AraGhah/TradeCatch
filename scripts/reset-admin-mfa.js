#!/usr/bin/env node
/**
 * Operator-only recovery for an administrator who lost their authenticator.
 *
 * The web app deliberately has no way to switch administrator MFA off or to
 * replace an enabled secret (a stolen session would otherwise be enough to do
 * it), so recovery is a database operation performed by whoever holds
 * DATABASE_URL.
 *
 * Usage:
 *   node scripts/reset-admin-mfa.js --email admin@example.com            # dry run
 *   node scripts/reset-admin-mfa.js --email admin@example.com --confirm  # apply
 *
 * Applying removes the stored secret and every verification record for the
 * user, revokes all of their sessions, clears the code-attempt counter and
 * writes an audit entry. The administrator then signs in again and enrolls a
 * new authenticator. Secrets and ciphertext are never printed.
 */
const crypto = require("node:crypto");
const { Client } = require("pg");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const email = argValue("--email")?.trim().toLowerCase();
  const confirm = process.argv.includes("--confirm");

  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  if (!email || !email.includes("@")) {
    console.error("Pass the administrator's address with --email.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.info(`Database: ${describeTarget(url)}`);
    const user = await client.query(`SELECT id FROM tc_users WHERE lower(email) = $1`, [email]);
    if (user.rowCount === 0) {
      console.error("No user with that address.");
      process.exitCode = 1;
      return;
    }
    const userId = user.rows[0].id;
    const mfa = await client.query(`SELECT enabled FROM tc_mfa_secrets WHERE user_id = $1`, [userId]);
    const sessions = await client.query(
      `SELECT count(*)::int AS n FROM tc_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [userId],
    );

    console.info(`User: ${userId}`);
    console.info(
      `MFA: ${mfa.rowCount === 0 ? "not enrolled" : mfa.rows[0].enabled ? "enabled" : "enrollment pending"}`,
    );
    console.info(`Active sessions: ${sessions.rows[0].n}`);

    if (!confirm) {
      console.info("Dry run. Re-run with --confirm to reset MFA and revoke these sessions.");
      return;
    }

    await client.query("BEGIN");
    try {
      await client.query(`DELETE FROM tc_mfa_verifications WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM tc_mfa_secrets WHERE user_id = $1`, [userId]);
      await client.query(`UPDATE tc_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      await client.query(`DELETE FROM tc_login_attempts WHERE email = $1`, [`mfa:${userId}`]);
      await client.query(
        `INSERT INTO tc_audit_logs (id, organization_id, actor_user_id, action, target, detail, created_at)
         VALUES ($1, NULL, NULL, 'mfa_reset_by_operator', $2, 'scripts/reset-admin-mfa.js', now())`,
        [`aud_${crypto.randomUUID()}`, userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.info("MFA reset. The administrator must sign in again and enroll a new authenticator.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
