const { createHash } = require("crypto");
const HASH_ROW_LIMIT = 200_000;

async function fingerprint(client) {
  const tables = (
    await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
    )
  ).rows.map((row) => row.table_name);
  const md5 = async (sql) =>
    createHash("md5")
      .update(JSON.stringify((await client.query(sql)).rows))
      .digest("hex");
  const schema = {
    columns: await md5(
      "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
    ),
    indexes: await md5(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexdef",
    ),
    constraints: await md5(
      "SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2",
    ),
    rls: await md5(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1",
    ),
  };
  const rows = {};
  for (const table of tables) {
    const quoted = `"${table.replace(/"/g, '""')}"`;
    const count = Number(
      (await client.query(`SELECT count(*) AS n FROM ${quoted}`)).rows[0].n,
    );
    const hash =
      count <= HASH_ROW_LIMIT
        ? (
            await client.query(
              `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text COLLATE "C"), '')) AS h FROM ${quoted} t`,
            )
          ).rows[0].h
        : null;
    rows[table] = { count, hash };
  }
  return { tables, schema, rows };
}

module.exports = { fingerprint };
