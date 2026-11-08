"use client";

import { useRef, useState } from "react";
import { ReferralShare } from "@/components/app/ReferralShare";

type Links = { en: string; fr: string };

type Labels = {
  getLink: string;
  getLinkHelp: string;
  creating: string;
  ready: string;
  retry: string;
  signIn: string;
  errors: {
    unauthorized: string;
    forbidden: string;
    rateLimited: string;
    unavailable: string;
    notEligible: string;
    invalid: string;
  };
  share: {
    linkLabel: string;
    copy: string;
    copied: string;
    copyFailed: string;
    copiedStatus: string;
    share: string;
    email: string;
    sms: string;
    otherLanguage: string;
    emailSubject: string;
    /** The share message with {link} left in, so the language chosen decides the link. */
    shareMessageTemplate: string;
  };
};

type State =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "ready"; links: Links; justCreated: boolean }
  | { phase: "error"; kind: keyof Labels["errors"] };

/** Pulls a usable pair of links out of the server's answer, or null: never trust a half answer. */
function readLinks(body: unknown): Links | null {
  if (!body || typeof body !== "object") return null;
  const links = (body as { links?: unknown }).links;
  if (!links || typeof links !== "object") return null;
  const { en, fr } = links as { en?: unknown; fr?: unknown };
  const ok = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        Boolean(url.searchParams.get("ref"))
      );
    } catch {
      return false;
    }
  };
  return ok(en) && ok(fr) ? { en, fr } : null;
}

/**
 * The customer's own referral link. If they already have one it is shown; if
 * not, "Get your link" creates it. The button works once at a time (a second
 * click while the first is running does nothing, and the server would return the
 * same link anyway), shows what is happening, and never displays a link that
 * the server did not confirm it saved.
 */
export function ReferralLinkCard({
  locale,
  initialLinks,
  loginHref,
  labels,
}: {
  locale: "en" | "fr";
  initialLinks: Links | null;
  /** Where "Sign in" goes when the session has ended: login, returning here. */
  loginHref: string;
  labels: Labels;
}) {
  const [state, setState] = useState<State>(
    initialLinks
      ? { phase: "ready", links: initialLinks, justCreated: false }
      : { phase: "idle" },
  );
  const inFlight = useRef(false);

  async function create() {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ phase: "creating" });
    try {
      const res = await fetch("/api/app/referrals/link", {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (res.ok) {
        const links = readLinks(body);
        if (links) {
          setState({
            phase: "ready",
            links,
            justCreated: (body as { created?: boolean }).created === true,
          });
        } else {
          // A success without a real link is not a success.
          setState({ phase: "error", kind: "invalid" });
        }
        return;
      }
      setState({
        phase: "error",
        kind:
          res.status === 401
            ? "unauthorized"
            : res.status === 403
              ? "forbidden"
              : res.status === 429
                ? "rateLimited"
                : res.status === 409
                  ? "notEligible"
                  : "unavailable",
      });
    } catch {
      setState({ phase: "error", kind: "unavailable" });
    } finally {
      inFlight.current = false;
    }
  }

  if (state.phase === "ready") {
    const link = state.links[locale];
    const otherLocale = locale === "fr" ? "en" : "fr";
    return (
      <div className="flex flex-col gap-3" data-testid="referral-link-ready">
        {state.justCreated ? (
          <p className="text-sm font-medium text-signal-text" role="status">
            {labels.ready}
          </p>
        ) : null}
        <ReferralShare
          link={link}
          otherLink={state.links[otherLocale]}
          labels={{
            linkLabel: labels.share.linkLabel,
            copy: labels.share.copy,
            copied: labels.share.copied,
            copyFailed: labels.share.copyFailed,
            copiedStatus: labels.share.copiedStatus,
            share: labels.share.share,
            email: labels.share.email,
            sms: labels.share.sms,
            otherLanguage: labels.share.otherLanguage,
            shareMessage: labels.share.shareMessageTemplate.replace("{link}", link),
            emailSubject: labels.share.emailSubject,
          }}
        />
      </div>
    );
  }

  const creating = state.phase === "creating";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-navy/70">{labels.getLinkHelp}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={create}
          disabled={creating}
          aria-busy={creating}
          data-testid="referral-get-link"
          className="rounded-md bg-orange px-5 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
        >
          {creating
            ? labels.creating
            : state.phase === "error"
              ? labels.retry
              : labels.getLink}
        </button>
        {state.phase === "error" && state.kind === "unauthorized" ? (
          <a className="text-sm font-semibold text-navy underline" href={loginHref}>
            {labels.signIn}
          </a>
        ) : null}
      </div>
      <p
        className={`min-h-[1.25rem] text-sm ${
          state.phase === "error" ? "text-red-700" : "text-navy/70"
        }`}
        role={state.phase === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {creating
          ? labels.creating
          : state.phase === "error"
            ? labels.errors[state.kind]
            : ""}
      </p>
    </div>
  );
}
