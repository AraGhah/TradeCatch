/**
 * Fails CI when a credential is committed.
 *
 * Scans every file git tracks or would add (so ignored files such as .env.local
 * are never read) for well-known credential shapes, and refuses env, key or
 * certificate files. Findings print the file, line and rule, never the value.
 *
 * To accept a deliberate fixture, put `secret-scan: allow` on the same line.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");

const MAX_BYTES = 1_000_000;

const RULES = [
  ["stripe-secret-key", /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/],
  ["stripe-test-key", /\b(?:sk|rk)_test_[0-9A-Za-z]{16,}/],
  ["stripe-webhook-secret", /\bwhsec_[0-9A-Za-z]{16,}/],
  ["aws-access-key-id", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key-block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["google-oauth-client-secret", /\bGOCSPX-[0-9A-Za-z_-]{20,}/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}/],
  ["slack-token", /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ["slack-webhook-url", /hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9A-Za-z]{16,}/],
  ["discord-webhook-url", /discord(?:app)?\.com\/api\/webhooks\/\d+\/[0-9A-Za-z_-]{30,}/],
  ["elevenlabs-key", /\bsk_[0-9a-f]{40,}\b/],
  ["openai-key", /\bsk-(?:proj-)?[0-9A-Za-z_-]{32,}/],
  ["anthropic-key", /\bsk-ant-[0-9A-Za-z_-]{20,}/],
  [
    "database-url-with-password",
    /postgres(?:ql)?:\/\/[^:/\s'"@]+:(?!password|pass|user|\$|<|\[|\{|%s|\*)[^@\s'"]{6,}@(?!localhost|127\.0\.0\.1|host\b)/,
  ],
  ["signed-jwt", /\beyJ[0-9A-Za-z_-]{20,}\.eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}/],
  [
    "hardcoded-secret",
    /\b(?:auth_secret|session_secret|jwt_secret|api[_-]?secret|client_secret|webhook_secret)\b\s*[:=]\s*["']([0-9A-Za-z+/_-]{24,})["']/i,
  ],
];

// A value that says what it is. Real credentials do not spell this out.
const OBVIOUS_FAKE = /not-for-production|example|placeholder|changeme|dummy|fake|redacted/i;

const FORBIDDEN_FILE = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, "environment file"],
  [/(^|\/)\.dev\.vars(\.(?!example$)[^/]*)?$/, "Wrangler local secrets"],
  [/\.(pem|p12|pfx|key|keystore|jks)$/i, "key or certificate file"],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, "SSH private key"],
];

const SKIP_FILES = /(^|\/)(package-lock\.json|THIRD-PARTY-LICENSES\.md)$/;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|mp4|webm|mov|woff2?|ttf|otf|pdf|zip|gz|wav|mp3)$/i;

function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 4000 || line.includes("secret-scan: allow")) continue;
    for (const [rule, pattern] of RULES) {
      const match = pattern.exec(line);
      if (!match) continue;
      if (OBVIOUS_FAKE.test(match[1] ?? match[0])) continue;
      findings.push({ line: index + 1, rule });
    }
  }
  return findings;
}

/** `KEY=value` lines in an env template must not carry a real-looking value. */
function scanEnvTemplate(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, name, value] = match;
    if (!/(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE|DATABASE_URL|CREDENTIAL)/.test(name)) continue;
    if (/^[0-9A-Za-z+/_=-]{20,}$/.test(value.trim()) && !OBVIOUS_FAKE.test(value)) {
      findings.push({ line: index + 1, rule: `env-template-value:${name}` });
    }
  }
  return findings;
}

function forbiddenFileReason(path) {
  for (const [pattern, reason] of FORBIDDEN_FILE) if (pattern.test(path)) return reason;
  return null;
}

/** Tracked files plus new ones git would pick up; ignored files (.env.local) are never read. */
function candidateFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split("\0").filter(Boolean))];
}

function main() {
  const problems = [];
  let scanned = 0;
  for (const file of candidateFiles()) {
    const reason = forbiddenFileReason(file);
    if (reason) problems.push(`${file}: ${reason} must not be committed`);
    if (BINARY.test(file) || SKIP_FILES.test(file) || !fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) continue;
    const text = fs.readFileSync(file, "utf8");
    if (text.includes("\0")) continue;
    scanned += 1;
    const findings = scanText(text);
    if (file.endsWith(".env.example")) findings.push(...scanEnvTemplate(text));
    for (const finding of findings) problems.push(`${file}:${finding.line}: ${finding.rule}`);
  }
  if (problems.length > 0) {
    console.error("Secret scan failed. Values are not printed; rotate anything real.");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("A deliberate test fixture can carry `secret-scan: allow` on its line.");
    process.exit(1);
  }
  console.log(`Secret scan OK (${scanned} files)`);
}

if (require.main === module) main();

module.exports = { scanText, scanEnvTemplate, forbiddenFileReason, RULES };
