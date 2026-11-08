/**
 * Where signing in may send someone afterwards.
 *
 * A sign-in page that redirects to whatever the address says is an open
 * redirect: a link on another site could land a customer on a hostile page
 * straight after they typed their password. So only our own signed-in
 * workspace paths are accepted ("/app/..." and "/fr/app/..."), written as a
 * plain path. Anything else (another site, a scheme, "//host", a backslash,
 * control characters, the login page itself) is ignored and the person lands on
 * their usual home instead. Pure and dependency-free so the Edge-bundled login
 * preview can use it too.
 */
const MAX_LENGTH = 300;
const WORKSPACE_PATH = /^\/(?:fr\/)?app(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@-]*)*$/;
// Control characters and backslashes never belong in a path we send people to.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  if (UNSAFE_CHARACTERS.test(value)) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  const separator = value.indexOf("?");
  const path = separator === -1 ? value : value.slice(0, separator);
  const query = separator === -1 ? "" : value.slice(separator + 1);
  if (value.includes("#")) return null;
  if (!WORKSPACE_PATH.test(path)) return null;
  // Encoded dot segments would let "/app/%2e%2e/..." climb out of the workspace.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.split("/").some((part) => part === ".." || part === ".")) return null;
  if (UNSAFE_CHARACTERS.test(decoded) || decoded.includes("//")) return null;
  return query ? `${path}?${query}` : path;
}
