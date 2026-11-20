import { homePathFor, loginPath } from "./route-helpers";
import { peekRefreshToken } from "./refresh-token";
import { getAuthSecret } from "./secret";
import { requireBillingContext, requireTenantContext } from "../tenant";

/**
 * Where a visitor's account lives, decided on the server from verified
 * sign-in data (the signed access token and the session row, or a refresh
 * token that is still good). Used by the site header's profile icon (through
 * GET /api/auth/session) and by the sign-in page, so both always agree with
 * the real sign-in rules in tenant.ts and refresh-token.ts.
 *
 * A browser never works out its own role: it is only ever told a destination.
 * The destination pages enforce access again (the /app and /admin layouts and
 * every API route), so a wrong answer here could mislead a link but never
 * open anything.
 */

export type AccountRole = "customer" | "admin" | "billing";

export type AccountState =
  | {
      state: "signed_in";
      role: AccountRole;
      /** The page this person lands on: already localized ("/fr/app"). */
      destination: string;
    }
  | {
      state: "anonymous";
      /** The sign-in page, already localized. */
      destination: string;
      /**
       * Sign-in cookies came with the request but no longer work (session ended,
       * revoked, expired or tampered with). The caller may clear them.
       */
      invalid: boolean;
    };

function signedIn(
  locale: "en" | "fr",
  who: { billingOnly: boolean; isPlatformAdmin: boolean },
): AccountState {
  return {
    state: "signed_in",
    role: who.billingOnly ? "billing" : who.isPlatformAdmin ? "admin" : "customer",
    destination: homePathFor(locale, who.billingOnly, who.isPlatformAdmin),
  };
}

/**
 * Throws when the sign-in store cannot be reached. That must never be read as
 * "signed out": callers answer "unavailable" and leave the cookies alone.
 */
export async function resolveAccountState(input: {
  locale: "en" | "fr";
  /**
   * The raw refresh cookie, when the request carries one. Only /api/auth/*
   * requests do (the cookie is scoped to that path), so a page request is
   * judged on its access token alone.
   */
  refreshToken?: string;
  /** Whether the request carried any sign-in cookie at all. */
  hasCredentials: boolean;
}): Promise<AccountState> {
  const { locale } = input;
  const anonymous = (invalid: boolean): AccountState => ({
    state: "anonymous",
    destination: loginPath(locale),
    invalid,
  });

  // Without the signing secret nothing can be verified, and nothing may be cleared.
  if (!getAuthSecret()) return anonymous(false);

  const auth = await requireTenantContext();
  if (auth.ok) {
    return signedIn(locale, {
      billingOnly: false,
      isPlatformAdmin: auth.ctx.isPlatformAdminIdentity,
    });
  }

  if (auth.status === 403) {
    // A valid sign-in for a business that is not active may only reach billing.
    const billing = await requireBillingContext();
    if (billing.ok && billing.ctx.organization.status !== "active") {
      return signedIn(locale, {
        billingOnly: true,
        isPlatformAdmin: billing.ctx.isPlatformAdminIdentity,
      });
    }
    // Signed in, but with nothing they may open: send them to sign in again,
    // and keep their cookies (they are valid, just not useful).
    return anonymous(false);
  }

  // No usable access token. A refresh token that is still good means the
  // person is signed in and the access token is simply due for renewal, which
  // happens on the way to the destination (see src/proxy.ts).
  if (input.refreshToken) {
    const peek = await peekRefreshToken(input.refreshToken);
    if (peek) return signedIn(locale, peek);
  }
  return anonymous(input.hasCredentials);
}
