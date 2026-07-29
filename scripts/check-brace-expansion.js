#!/usr/bin/env node
/**
 * Confirms brace-expansion overrides landed on patched releases.
 * npm audit may still list GHSA-mh99-v99m-4gvg against the eslint tree
 * even after overrides; this check is the authoritative gate.
 */
const { execSync } = require("node:child_process");

const out = execSync("npm ls brace-expansion --all", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const versions = new Set();
for (const match of out.matchAll(/brace-expansion@([\w.-]+)/g)) {
  versions.add(match[1]);
}

const allowed = new Set(["1.1.17", "2.1.3", "3.0.3", "5.0.8"]);
const bad = [...versions].filter((v) => !allowed.has(v));
if (bad.length || versions.size === 0) {
  console.error("Unpatched brace-expansion detected:", [...versions]);
  console.error("Expected only patched releases:", [...allowed]);
  process.exit(1);
}

console.log(
  `brace-expansion overrides OK (${[...versions].sort().join(", ")})`,
);
