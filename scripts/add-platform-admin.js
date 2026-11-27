#!/usr/bin/env node
/**
 * Operator-only: makes an address a TradeCatch platform administrator in the
 * database that DATABASE_URL points at.
 *
 * Public registration is closed, and the password-reset email only goes to an
 * address that already has a user row and a business membership. So this
 * creates, idempotently:
 *   - the user (platform_role = 'admin', a super administrator on every
 *     environment that shares this database, whatever TRADECATCH_ADMIN_EMAILS
 *     says there),
 *   - an internal "TradeCatch Admin" organization (account_type = 'demo', so it
 *     is not counted as a paying customer) and an owner membership in it.
 *
 * No password is created or printed. The administrator then opens the sign-in
 * page, chooses "Forgot password" and sets their own through the emailed link.
 *
 * Usage:
 *   node scripts/add-platform-admin.js --email admin@example.com             # dry run
 *   node scripts/add-platform-admin.js --email admin@example.com --confirm   # apply
 *   (optional) --name "Full Name"   --locale en|fr
 *
 * Run it once per database (local, staging, production) to keep them in sync.
 */
const crypto = require("node:crypto");
const { Client } = require("pg");

const ORG_SLUG = "tradecatch-admin";
const ORG_NAME = "TradeCatch Admin";

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

const id = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const email = argValue("--email")?.trim().toLowerCase();
  const locale = argValue("--locale") === "fr" ? "fr" : "en";
  const confirm = process.argv.includes("--confirm");

  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Pass a valid address with --email.");
    process.exit(1);
  }
  const name = argValue("--name")?.trim() || email.split("@")[0];

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.info(`Database: ${describeTarget(url)}`);
    const user = await client.query(
      `SELECT id, platform_role FROM tc_users WHERE lower(email) = $1`,
      [email],
    );
    const org = await client.query(`SELECT id FROM tc_organizations WHERE slug = $1`, [ORG_SLUG]);
    const membership = user.rowCount
      ? await client.query(`SELECT 1 FROM tc_memberships WHERE user_id = $1 LIMIT 1`, [
          user.rows[0].id,
        ])
      : { rowCount: 0 };

    const plan = [];
    if (!user.rowCount) plan.push(`create user ${email} (platform_role=admin)`);
    else if (user.rows[0].platform_role !== "admin") plan.push("set platform_role=admin on the existing user");
    if (!membership.rowCount) {
      plan.push(org.rowCount ? `add owner membership in "${ORG_NAME}"` : `create organization "${ORG_NAME}" and an owner membership`);
    }
    if (!plan.length) {
      console.info("Already an administrator with a membership. Nothing to do.");
      console.info("They can still use 'Forgot password' on the sign-in page.");
      return;
    }
    plan.forEach((line) => console.info(`Will: ${line}`));
    if (!confirm) {
      console.info("Dry run. Re-run with --confirm to apply.");
      return;
    }

    await client.query("BEGIN");
    try {
      let userId = user.rows[0]?.id;
      if (!userId) {
        userId = id("usr");
        await client.query(
          `INSERT INTO tc_users (id, email, name, locale, platform_role) VALUES ($1, $2, $3, $4, 'admin')`,
          [userId, email, name, locale],
        );
      } else if (user.rows[0].platform_role !== "admin") {
        await client.query(`UPDATE tc_users SET platform_role = 'admin', updated_at = now() WHERE id = $1`, [userId]);
      }
      if (!membership.rowCount) {
        let orgId = org.rows[0]?.id;
        if (!orgId) {
          orgId = id("org");
          await client.query(
            `INSERT INTO tc_organizations (id, name, slug, plan, status, account_type)
             VALUES ($1, $2, $3, 'professional', 'active', 'demo')`,
            [orgId, ORG_NAME, ORG_SLUG],
          );
        }
        await client.query(
          `INSERT INTO tc_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')
           ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [id("mem"), orgId, userId],
        );
      }
      await client.query(
        `INSERT INTO tc_audit_logs (id, organization_id, actor_user_id, action, target, detail, created_at)
         VALUES ($1, NULL, NULL, 'platform_admin_added_by_operator', $2, 'scripts/add-platform-admin.js', now())`,
        [id("aud"), userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.info("Done. Ask them to use 'Forgot password' on the sign-in page to set their password.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
