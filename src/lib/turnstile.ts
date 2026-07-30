const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Verifies a Cloudflare Turnstile token server-side. If TURNSTILE_SECRET_KEY
// isn't configured yet (e.g. before the account is set up), this no-ops and
// logs a warning rather than silently accepting every submission as human —
// callers must decide how to treat an unconfigured verifier (see route.ts).
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<{ configured: boolean; success: boolean; error?: string }> {
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
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      success?: unknown;
      hostname?: unknown;
      "error-codes"?: unknown;
    };
    if (typeof data.success !== "boolean") {
      throw new Error("Cloudflare returned an invalid verification response");
    }
    if (!data.success) {
      return {
        configured: true,
        success: false,
        error: Array.isArray(data["error-codes"])
          ? data["error-codes"].join(", ")
          : "challenge rejected",
      };
    }

    const allowedHosts = new Set(["localhost"]);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (siteUrl) {
      try {
        allowedHosts.add(new URL(siteUrl).hostname.toLowerCase());
      } catch {
        throw new Error("NEXT_PUBLIC_SITE_URL is not a valid URL");
      }
    }
    const hostname =
      typeof data.hostname === "string" ? data.hostname.toLowerCase() : "";
    if (!hostname || !allowedHosts.has(hostname)) {
      return {
        configured: true,
        success: false,
        error: `unexpected hostname: ${hostname || "missing"}`,
      };
    }
    return { configured: true, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[turnstile] verification failed unexpectedly: ${message}`);
    return { configured: true, success: false, error: message };
  }
}
