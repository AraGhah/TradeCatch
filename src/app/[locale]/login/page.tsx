import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LoginForm, type LoginNotice } from "@/components/app/LoginForm";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";
import { TradeCatchSignIn } from "@/components/ui/tradecatch-sign-in";
import { schedulingVerified } from "@/lib/launch-flags";
import { resolveAccountState } from "@/product/saas/auth/account-destination";
import { safeReturnPath } from "@/product/saas/auth/return-path";

// Every public page now links here from the header, so keep it out of search results.
export const metadata = { robots: { index: false, follow: false } };

/** Turns the code a sign-in route put in the address into one of our own messages. */
function noticeFrom(
  error: string | undefined,
  notice: string | undefined,
): LoginNotice | null {
  if (notice === "password_saved") return "passwordSaved";
  if (!error) return null;
  return error === "rate_limited" ? "linkRateLimited" : "linkInvalid";
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    error?: string | string[];
    notice?: string | string[];
    next?: string | string[];
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const notice = noticeFrom(
    typeof query.error === "string" ? query.error : undefined,
    typeof query.notice === "string" ? query.notice : undefined,
  );

  // Where to go after signing in. Only our own workspace pages are accepted.
  const returnTo = safeReturnPath(
    typeof query.next === "string" ? query.next : undefined,
  );

  // Someone who is already signed in has no use for this form: send them where
  // their account lives (or on to the page they were heading to). Skipped when
  // a message is waiting (a rejected sign-in link, a saved password), which
  // they should see. Judged on the access token alone: the page is not sent
  // the refresh cookie. This is the same check the dashboards make, so the two
  // can never send a person back and forth.
  if (!notice) {
    const account = await resolveAccountState({
      locale: locale === "fr" ? "fr" : "en",
      hasCredentials: false,
    }).catch(() => null);
    if (account?.state === "signed_in") {
      redirect(
        returnTo && account.role !== "billing" ? returnTo : account.destination,
      );
    }
  }

  // Only plain values from the address travel with a language switch.
  const kept: Record<string, string> = {};
  for (const key of ["error", "notice", "next"] as const) {
    const value = query[key];
    if (typeof value === "string") kept[key] = value;
  }

  return (
    <TradeCatchSignIn
      locale={locale === "fr" ? "fr" : "en"}
      query={kept}
      showScheduling={schedulingVerified()}
    >
      <FullMessagesProvider>
        <LoginForm notice={notice} returnTo={returnTo} />
      </FullMessagesProvider>
    </TradeCatchSignIn>
  );
}
