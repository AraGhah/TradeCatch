const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Verifies a Cloudflare Turnstile token server-side. If TURNSTILE_SECRET_KEY
// isn't configured yet (e.g. before the account is set up), this no-ops and
// logs a warning rather than silently accepting every submission as human —
// callers must decide how to treat an unconfigured verifier (see route.ts).
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<{ configured: boolean; success: boolean }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn(
      "[turnstile] TURNSTILE_SECRET_KEY is not set — skipping bot verification."
    );
    return { configured: false, success: false };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success: boolean };
    return { configured: true, success: Boolean(data.success) };
  } catch (error) {
    console.error("[turnstile] verification request failed", error);
    return { configured: true, success: false };
  }
}
