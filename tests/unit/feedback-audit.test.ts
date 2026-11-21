import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

/**
 * KAN-26 static guard. These do not prove the behaviour (the unit tests on the
 * runner and the Playwright LOAD specs do); they stop the old problems coming
 * back by accident: a request with no timeout, a write nothing protects from a
 * double click, a busy button with no visible spinner.
 *
 * An exception is allowed only with a written reason, in the lists below.
 */

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

type ClientFile = { path: string; rel: string; text: string };
const clientFiles: ClientFile[] = sourceFiles(SRC)
  .map((path) => ({
    path,
    rel: relative(ROOT, path).replace(/\\/g, "/"),
    text: readFileSync(path, "utf8"),
  }))
  .filter(({ text }) => /^\s*["']use client["']/.test(text.slice(0, 200)));

/** A client file may call `fetch(` directly only for these, each for a stated reason. */
const RAW_FETCH_ALLOWED: Record<string, string> = {
  "src/app/global-error.tsx": "error-boundary reporting: fire and forget, no UI state to clear",
  "src/app/[locale]/error.tsx": "error-boundary reporting: fire and forget, no UI state to clear",
  "src/components/useDemoVoice.ts": "streams audio; a total-time cap would cut speech off",
  "src/components/demo-video/useDemoAudio.ts": "streams audio; a total-time cap would cut speech off",
};

/** The ways a write is protected from running twice at once. */
const GUARD =
  /useSingleFlight\(|useKeyedSingleFlight\(|useAction\(|useGuarded\(|useAdminAction\(|createSingleFlight\(|createActionRunner\(|inFlight\.current|moving\.current/;

/** A client file that writes with no guard of its own, each for a stated reason. */
const WRITE_UNGUARDED_ALLOWED: Record<string, string> = {
  "src/app/global-error.tsx": "error-boundary reporting, not a user action",
  "src/app/[locale]/error.tsx": "error-boundary reporting, not a user action",
  "src/components/useDemoVoice.ts": "audio request made by the voice hook, one per spoken line",
  "src/components/admin/AdminTokenGate.tsx": "runs once on mount (an effect), never from a click",
  "src/components/app/GmailSyncBadge.tsx": "background poller (createPoller keeps one in flight), not a click",
};

/** A file that disables controls while busy yet imports no spinner itself, each for a stated reason. */
const BUSY_WITHOUT_OWN_INDICATOR_ALLOWED: Record<string, string> = {
  "src/components/admin/console/SubscriptionsConsole.tsx":
    "its row buttons only open the confirm panel and are disabled while that panel's request runs; the panel's own button (ConfirmPanel in admin/console/ui.tsx) shows the spinner and 'Working…'",
};

const WRITE_METHOD = /method:\s*(?:[^"'`,}]*\?\s*)?["'`](POST|PUT|PATCH|DELETE)["'`]/;
// `[^)]*` already spans newlines, so no dot-all flag is needed.
const REQUEST_JSON_WRITE = /requestJson\([^)]*method:\s*["'](POST|PUT|PATCH|DELETE)/;

describe("feedback audit (KAN-26)", () => {
  it("finds the client files it is supposed to audit", () => {
    assert.ok(clientFiles.length > 100, `only ${clientFiles.length} client files found`);
  });

  it("no client component calls fetch() directly (it would never time out)", () => {
    const offenders = clientFiles
      .filter(({ text }) => /(^|[^\w.])fetch\(/.test(text))
      .map(({ rel }) => rel)
      .filter((rel) => !RAW_FETCH_ALLOWED[rel]);
    assert.deepEqual(
      offenders,
      [],
      `Use timedFetch() or requestJson() so the request always ends:\n${offenders.join("\n")}`,
    );
  });

  it("every client file that writes has a double-submit guard", () => {
    const offenders = clientFiles
      .filter(({ text }) => WRITE_METHOD.test(text) || REQUEST_JSON_WRITE.test(text))
      .filter(({ text }) => !GUARD.test(text))
      .map(({ rel }) => rel)
      .filter((rel) => !WRITE_UNGUARDED_ALLOWED[rel]);
    assert.deepEqual(
      offenders,
      [],
      `Wrap the handler in useGuarded() (or use useAction / useSingleFlight):\n${offenders.join("\n")}`,
    );
  });

  it("a busy button shows a spinner, not only different words", () => {
    // `{busy ? t("saving") : t("save")}` changes the text but shows nothing is happening.
    // Any condition counts, not only a bare name: `busy === "save" ? …`, `flight.isPending("x") ? …`,
    // and the words may come from `t("…")`, `t("a.b")`, `labels.saving` or `tFeedback("saving")`.
    const WORD_SWAP =
      /\?\s*(?:t|labels|copy|tFeedback)(?:\(["'](?:[\w.]*\.)?(?:saving|sending|working|processing|submitting|signingIn|checking|connecting|disconnecting|loading)\w*["']\)|\.(?:saving|sending|working|processing|submitting)\w*)\s*:/;
    const offenders = clientFiles.filter(({ text }) => WORD_SWAP.test(text)).map(({ rel }) => rel);
    assert.deepEqual(offenders, [], `Use <BusyLabel>:\n${offenders.join("\n")}`);
  });

  it("a control that is disabled while busy sits in a file that shows the busy state", () => {
    // Coarse on purpose: it asks that the file use the shared spinner or skeleton at all. The
    // per-button wording is checked by the Playwright LOAD specs.
    const BUSY_DISABLED =
      /disabled=\{[^}]*\b(pending|busy|saving|sending|loading|submitting|working|running|inFlight|syncing|opening|redirecting|isPending|acting|flight\.pending|action\.pending)\b/;
    const INDICATOR = /BusyLabel|<Spinner|InlineStatus|LoadingRegion|<Skeleton/;
    const offenders = clientFiles
      .filter(({ text }) => BUSY_DISABLED.test(text) && !INDICATOR.test(text))
      .map(({ rel }) => rel)
      .filter((rel) => !BUSY_WITHOUT_OWN_INDICATOR_ALLOWED[rel]);
    assert.deepEqual(
      offenders,
      [],
      `Show a spinner with <BusyLabel> / <InlineStatus> next to the disabled control:\n${offenders.join("\n")}`,
    );
  });

  it("a button label is never swapped for a bare '…' character", () => {
    // An aria-hidden ellipsis tells a sighted person something is happening and a screen-reader user nothing.
    const offenders = clientFiles
      .filter(({ text }) => /aria-hidden[^>]*>\s*(?:…|\.\.\.)\s*</.test(text))
      .map(({ rel }) => rel);
    assert.deepEqual(offenders, [], `Use <InlineStatus> (role="status") instead:\n${offenders.join("\n")}`);
  });

  it("a public-site client component only reads translations the public layout ships", () => {
    // The root layout sends the browser only PUBLIC_CLIENT_NAMESPACES; the signed-in workspace, the
    // admin console and the account forms opt back in to the whole catalog (FullMessagesProvider).
    // Anywhere else, `useTranslations("feedback")` renders the raw key ("feedback.replying") on screen.
    const shipped = new Set(
      [...readFileSync(join(SRC, "i18n", "client-messages.ts"), "utf8").matchAll(/^\s+"([A-Za-z]+)",$/gm)].map(
        (match) => match[1],
      ),
    );
    assert.ok(shipped.has("websiteRequest") && shipped.size >= 8, "could not read PUBLIC_CLIENT_NAMESPACES");
    const insideFullCatalog = (rel: string) =>
      /^src\/components\/(app|admin)\//.test(rel) || /^src\/app\/\[locale\]\/(app|admin|billing|login|account-recovery|forgot-password|set-password)\//.test(rel);
    const publicFiles = clientFiles.filter(({ rel }) => !insideFullCatalog(rel));
    const offenders: string[] = [];
    for (const { rel, text } of publicFiles) {
      // The shared failure component reads `feedback`; it is fine as long as nothing public imports it.
      if (rel === "src/components/ui/FeedbackMessage.tsx") continue;
      for (const match of text.matchAll(/useTranslations\(\s*["']([^"']+)["']\s*\)/g)) {
        if (!shipped.has(match[1].split(".")[0])) offenders.push(`${rel}: useTranslations("${match[1]}")`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `These would show raw message keys on a public page. Pass the words in as props, or add the namespace to PUBLIC_CLIENT_NAMESPACES:\n${offenders.join("\n")}`,
    );
    const publicImportingFeedback = publicFiles
      .filter(({ text }) => text.includes("@/components/ui/FeedbackMessage"))
      .map(({ rel }) => rel);
    assert.deepEqual(
      publicImportingFeedback,
      [],
      `FeedbackMessage reads the "feedback" namespace, which public pages do not receive:\n${publicImportingFeedback.join("\n")}`,
    );
  });

  it("every exception in the allow-lists still exists (no stale entries)", () => {
    const known = new Set(clientFiles.map(({ rel }) => rel));
    for (const name of [
      ...Object.keys(RAW_FETCH_ALLOWED),
      ...Object.keys(WRITE_UNGUARDED_ALLOWED),
      ...Object.keys(BUSY_WITHOUT_OWN_INDICATOR_ALLOWED),
    ]) {
      assert.ok(known.has(name), `${name} is allow-listed but is not a client file any more`);
    }
  });

  it("the shared pieces are what the forms import (one implementation, not copies)", () => {
    const uiKit = ["Spinner.tsx", "Skeleton.tsx", "FeedbackMessage.tsx"].map((name) =>
      readFileSync(join(SRC, "components", "ui", name), "utf8"),
    );
    assert.ok(uiKit.every((text) => text.length > 0));
    const users = clientFiles.filter(({ text }) => text.includes('from "@/components/ui/Spinner"'));
    assert.ok(users.length >= 40, `BusyLabel/InlineStatus used by only ${users.length} files`);
  });
});
