/**
 * Compares flattened key paths in en.json vs fr.json.
 * Exit 1 if either locale is missing keys the other has.
 */
const fs = require("fs");
const path = require("path");

function flatten(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flatten(v, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}

const root = path.join(__dirname, "..");
const en = JSON.parse(fs.readFileSync(path.join(root, "src/messages/en.json"), "utf8"));
const fr = JSON.parse(fs.readFileSync(path.join(root, "src/messages/fr.json"), "utf8"));

const enKeys = new Set(flatten(en));
const frKeys = new Set(flatten(fr));

const missingInFr = [...enKeys].filter((k) => !frKeys.has(k)).sort();
const missingInEn = [...frKeys].filter((k) => !enKeys.has(k)).sort();

if (missingInFr.length || missingInEn.length) {
  if (missingInFr.length) {
    console.error("Missing in fr.json:\n" + missingInFr.map((k) => `  - ${k}`).join("\n"));
  }
  if (missingInEn.length) {
    console.error("Missing in en.json:\n" + missingInEn.map((k) => `  - ${k}`).join("\n"));
  }
  process.exit(1);
}

console.log(`i18n parity OK (${enKeys.size} keys)`);
