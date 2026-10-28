import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Agent checkouts are linted in their own workspace, not recursively here.
    ".claude/worktrees/**",
    // Default ignores of eslint-config-next:
    ".artifacts/**",
    "test-results/**",
    "playwright-report/**",
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
    "worker-configuration.d.ts",
    "TradeCatch UI redesign/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
