/**
 * Windows-only: patch @opennextjs/aws copyTracedFiles to use NTFS junctions
 * instead of symlinks (EPERM without Developer Mode / admin).
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

if (source.includes('symlinkSync(target, to, "junction")')) {
  process.exit(0);
}

const needle = [
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

const longPathPrefix = ["\\", "\\", "?", "\\"].join("");

const replacement = [
  "        if (symlink) {",
  "            try {",
  '                if (process.platform === "win32") {',
  "                    // Windows: recreate as junction (no admin/Developer Mode).",
  `                    const rawTarget = symlink.startsWith(${JSON.stringify(longPathPrefix)})`,
  "                        ? symlink.slice(4)",
  "                        : symlink;",
  "                    const target = path.isAbsolute(rawTarget)",
  "                        ? rawTarget",
  "                        : path.resolve(path.dirname(to), rawTarget);",
  '                    symlinkSync(target, to, "junction");',
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

if (!source.includes(needle)) {
  console.warn(
    "[patch-opennext-windows] Unexpected @opennextjs/aws layout; skip patch."
  );
  process.exit(0);
}

fs.writeFileSync(target, source.replace(needle, replacement));
console.log("[patch-opennext-windows] Applied Windows junction patch.");
