/**
 * Windows-only: patch @opennextjs/aws copyTracedFiles to copy instead of
 * creating symlinks/junctions (EPERM under OneDrive / without Developer Mode).
 * Safe no-op on non-Windows and when already patched / package missing.
 */
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "win32") {
  process.exit(0);
}

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "@opennextjs",
  "aws",
  "dist",
  "build",
  "copyTracedFiles.js"
);

if (!fs.existsSync(target)) {
  process.exit(0);
}

let source = fs.readFileSync(target, "utf8");

if (source.includes("Windows/OneDrive: symlinks and junctions often hit EPERM")) {
  process.exit(0);
}

const unpatchedNeedle = [
  "        if (symlink) {",
  "            try {",
  "                symlinkSync(symlink, to);",
  "            }",
  "            catch (e) {",
  '                if (e.code !== "EEXIST") {',
  "                    throw e;",
  "                }",
  "            }",
  "        }",
].join("\n");

const junctionNeedle = [
  "        if (symlink) {",
  "            try {",
  '                if (process.platform === "win32") {',
  "                    // Windows: recreate as junction (no admin/Developer Mode).",
].join("\n");

const replacement = [
  "        if (symlink) {",
  "            try {",
  '                if (process.platform === "win32") {',
  "                    // Windows/OneDrive: symlinks and junctions often hit EPERM.",
  "                    // Always dereference and copy instead of linking.",
  "                    cpSync(from, to, { recursive: true, dereference: true });",
  "                }",
  "                else {",
  "                    symlinkSync(symlink, to);",
  "                }",
  "            }",
  "            catch (e) {",
  '                if (e.code === "EEXIST") {',
  "                    // already linked",
  "                }",
  '                else if (e.code === "EPERM" || e.code === "EACCES") {',
  "                    try {",
  "                        cpSync(from, to, { recursive: true, dereference: true });",
  "                    }",
  "                    catch (copyErr) {",
  '                        logger.debug("Error copying after symlink failure:", copyErr);',
  "                        erroredFiles.push(to);",
  "                    }",
  "                }",
  "                else {",
  "                    throw e;",
  "                }",
  "            }",
  "        }",
].join("\n");

if (source.includes(unpatchedNeedle)) {
  fs.writeFileSync(target, source.replace(unpatchedNeedle, replacement));
  console.log("[patch-opennext-windows] Applied Windows copy patch.");
  process.exit(0);
}

// Upgrade older junction patch → copy patch
if (source.includes(junctionNeedle)) {
  const start = source.indexOf(junctionNeedle);
  const endMarker = "        else {\n            // Adding this inside a try-catch to handle errors on Next 16+";
  const end = source.indexOf(endMarker, start);
  if (start !== -1 && end !== -1) {
    const updated = source.slice(0, start) + replacement + "\n" + source.slice(end);
    fs.writeFileSync(target, updated);
    console.log("[patch-opennext-windows] Upgraded junction patch to copy patch.");
    process.exit(0);
  }
}

console.warn(
  "[patch-opennext-windows] Unexpected @opennextjs/aws layout; skip patch."
);
