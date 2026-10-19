/**
 * Runs pg_dump / pg_restore for the backup scripts.
 *
 * Uses the PostgreSQL client tools on PATH when there are any, otherwise a
 * throwaway Docker container (PG_DOCKER_IMAGE, default postgres:17 — a client
 * at least as new as the server it talks to). The connection is handed over as
 * libpq environment variables, never on the command line, so the password does
 * not appear in a process list or in this script's output.
 */
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const DOCKER_IMAGE = process.env.PG_DOCKER_IMAGE || "postgres:17";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hasLocalTool(tool) {
  return spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
}

function canUseDocker() {
  return spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" }).status === 0;
}

/** host:port/database, for comparing two URLs without ever printing credentials. */
function identity(url) {
  const u = new URL(url);
  const host = LOOPBACK.has(u.hostname) ? "localhost" : u.hostname.toLowerCase();
  return `${host}:${u.port || "5432"}/${decodeURIComponent(u.pathname.slice(1))}`;
}

function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function libpqEnv(url, { inContainer }) {
  const u = new URL(url);
  const env = {
    PGHOST: inContainer && LOOPBACK.has(u.hostname) ? "host.docker.internal" : u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  };
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/**
 * Runs `tool args…` against `url`. `stdin` and `stdout` are optional streams.
 * `args` is a list, or a function that receives `file(hostPath)` and returns the
 * list; `file` gives the path the tool must use for a file on this machine
 * (the same path locally, a read-only mount inside the container).
 * Resolves with { code, stderr }.
 */
function runPg(tool, args, { url, stdin, stdout }) {
  const local = hasLocalTool(tool);
  if (!local && !canUseDocker()) {
    throw new Error(`${tool} was not found and Docker is not available. Install the PostgreSQL client tools or Docker.`);
  }
  const connection = libpqEnv(url, { inContainer: !local });
  const mounts = new Map();
  const file = (hostPath) => {
    if (local) return hostPath;
    const dir = path.dirname(path.resolve(hostPath));
    if (!mounts.has(dir)) mounts.set(dir, `/mnt/${mounts.size}`);
    return `${mounts.get(dir)}/${path.basename(hostPath)}`;
  };
  const toolArgs = typeof args === "function" ? args(file) : args;
  let command;
  let commandArgs;
  if (local) {
    command = tool;
    commandArgs = toolArgs;
  } else {
    command = "docker";
    commandArgs = [
      "run",
      "--rm",
      "-i",
      "--add-host=host.docker.internal:host-gateway",
      ...[...mounts].flatMap(([host, inside]) => ["-v", `${host}:${inside}:ro`]),
      ...Object.keys(connection).flatMap((key) => ["-e", key]),
      DOCKER_IMAGE,
      tool,
      ...toolArgs,
    ];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      env: { ...process.env, ...connection },
      stdio: [stdin ? "pipe" : "ignore", stdout ? "pipe" : "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8000) stderr += chunk.toString();
    });
    if (stdin) stdin.pipe(child.stdin);
    if (stdout) child.stdout.pipe(stdout);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
  });
}

module.exports = { runPg, identity, databaseName, hasLocalTool, DOCKER_IMAGE };
