import { isRealProductionRuntime } from "@/lib/environment";

export type CheckStatus = "ready" | "needs_attention" | "failed";

export type LaunchCheck = {
  component: string;
  status: CheckStatus;
  detail: string;
};

const CRITICAL = new Set(["authentication", "database", "phone", "ai", "security"]);

export function evaluateLaunchReadiness(env: NodeJS.ProcessEnv, database: { ok: boolean; error?: string }): { overall: CheckStatus; checks: LaunchCheck[] } {
  const production = isRealProductionRuntime(env);
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() || "";
  const databaseUrl = env.DATABASE_URL?.trim() || "";
  const stripe = env.STRIPE_SECRET_KEY?.trim() || "";
  const checks: LaunchCheck[] = [
    {
      component: "website",
      status: site.startsWith("https://") ? "ready" : "needs_attention",
      detail: site ? "Public site URL is set." : "Public site URL is not set.",
    },
    {
      component: "authentication",
      status: env.AUTH_SECRET?.trim() ? "ready" : "failed",
      detail: env.AUTH_SECRET?.trim() ? "Auth secret is configured." : "AUTH_SECRET is missing.",
    },
    databaseCheck(production, databaseUrl, database),
    verified(production, Boolean(env.ANTHROPIC_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()), env.LAUNCH_AI_VERIFIED === "1", "ai", "Receptionist provider key"),
    verified(production, Boolean(env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim()), env.LAUNCH_PHONE_VERIFIED === "1", "phone", "Twilio"),
    stripeCheck(production, stripe, env.LAUNCH_STRIPE_VERIFIED === "1"),
    {
      component: "security",
      status: production && env.NEXT_PUBLIC_DEMO_MODE === "1" ? "failed" : env.AUTH_SECRET?.trim() && env.NEXT_PUBLIC_DEMO_MODE !== "1" && production ? "ready" : "needs_attention",
      detail: production && env.NEXT_PUBLIC_DEMO_MODE === "1"
        ? "Demo mode is enabled on production."
        : env.AUTH_SECRET?.trim() && production
          ? "Production auth is configured and demo mode is off."
          : "Production authentication has not been verified.",
    },
    {
      component: "monitoring",
      status: env.ADMIN_ALERT_EMAIL?.trim() ? "ready" : "needs_attention",
      detail: env.ADMIN_ALERT_EMAIL?.trim() ? "Administrator alert email is set." : "No administrator alert email is configured.",
    },
  ];
  const critical = checks.filter((check) => CRITICAL.has(check.component));
  const overall: CheckStatus = critical.some((check) => check.status === "failed")
    ? "failed"
    : critical.some((check) => check.status === "needs_attention")
      ? "needs_attention"
      : "ready";
  return { overall, checks };
}

function databaseCheck(production: boolean, url: string, database: { ok: boolean; error?: string }): LaunchCheck {
  if (!url) return { component: "database", status: "needs_attention", detail: "DATABASE_URL is not set." };
  if (!database.ok) return { component: "database", status: "failed", detail: database.error || "Database check failed." };
  if (!production || /staging/i.test(url)) return { component: "database", status: "needs_attention", detail: "This database is not verified as the separate production database." };
  return { component: "database", status: "ready", detail: "Production database responded." };
}

function verified(production: boolean, configured: boolean, verifiedLive: boolean, component: string, label: string): LaunchCheck {
  if (!configured) return { component, status: "needs_attention", detail: `${label} is not configured.` };
  if (!production || !verifiedLive) return { component, status: "needs_attention", detail: `${label} is configured. A staging test is not production verification.` };
  return { component, status: "ready", detail: `${label} was verified in production.` };
}

function stripeCheck(production: boolean, secret: string, verifiedLive: boolean): LaunchCheck {
  if (!secret) return { component: "stripe", status: "needs_attention", detail: "Stripe secret is not configured." };
  if (secret.startsWith("sk_test_")) return { component: "stripe", status: production ? "failed" : "needs_attention", detail: "Stripe is using a test secret." };
  if (!secret.startsWith("sk_live_") || !production || !verifiedLive) return { component: "stripe", status: "needs_attention", detail: "Live Stripe billing has not been verified." };
  return { component: "stripe", status: "ready", detail: "Live Stripe billing was verified." };
}
