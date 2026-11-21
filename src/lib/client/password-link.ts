/**
 * Reading the secret out of an emailed set-password address, in the browser.
 *
 * New links keep it in the fragment (`/set-password#token=...`), which is never
 * sent to any server, so it cannot appear in access logs, Cloudflare traces or
 * Referer headers. Links emailed before that change kept it in the query
 * string (`?token=...`) and must keep working until they expire.
 */

/** Mirrors the server's TOKEN_SHAPE (43 base64url characters); a test keeps them equal. */
export const PASSWORD_LINK_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type PasswordLinkToken = {
  token: string;
  /** True for an older link whose secret arrived in the query string. */
  fromQuery: boolean;
};

export function readPasswordLinkToken(location: {
  hash: string;
  search: string;
}): PasswordLinkToken | null {
  const fromFragment = new URLSearchParams(location.hash.replace(/^#/, ""))
    .get("token")
    ?.trim();
  if (fromFragment && PASSWORD_LINK_TOKEN_SHAPE.test(fromFragment)) {
    return { token: fromFragment, fromQuery: false };
  }
  const fromQuery = new URLSearchParams(location.search).get("token")?.trim();
  if (fromQuery && PASSWORD_LINK_TOKEN_SHAPE.test(fromQuery)) {
    return { token: fromQuery, fromQuery: true };
  }
  return null;
}

/**
 * Moves a secret from the query string into the fragment of the address bar,
 * so a reload, a shared screenshot of the history or a later request does not
 * carry it to a server again. The page keeps working on reload.
 */
export function moveTokenToFragment(token: string): void {
  try {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}#token=${encodeURIComponent(token)}`,
    );
  } catch {
    // Some embedded browsers refuse history edits; the page still works.
  }
}
