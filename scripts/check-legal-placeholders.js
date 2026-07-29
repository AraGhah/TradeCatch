/**
 * Fails CI if public legal copy still contains unfinished placeholders.
 * Engineering readiness gate — not a substitute for counsel review.
 */
const fs = require("fs");
const path = require("path");

const roots = [
  path.join("src", "messages", "en.json"),
  path.join("src", "messages", "fr.json"),
];

const banned = [
  /\[TODO\b/i,
  /\[TODO\s*:/i,
  /Draft for internal use/i,
  /Ébauche à usage interne/i,
  /not yet reviewed by a lawyer/i,
  /non encore révisée par un avocat/i,
];

let failed = false;
for (const file of roots) {
  const text = fs.readFileSync(file, "utf8");
  for (const re of banned) {
    if (re.test(text)) {
      console.error(`Legal placeholder check failed in ${file}: /${re.source}/`);
      failed = true;
    }
  }
}

if (failed) {
  console.error(
    "Remove [TODO]/draft lawyer notices from public legal copy, or move unfinished text out of shipped messages.",
  );
  process.exit(1);
}

console.log("Legal placeholder check OK");
