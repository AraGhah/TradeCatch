import type { Probe } from "./service";
import type { ServiceName } from "./types";

/** Connectivity is not proof of a call, payment, inference or delivery. */
export async function providerProbes(
  env: Partial<NodeJS.ProcessEnv>,
  fetchImpl = fetch,
): Promise<Probe[]> {
  async function check(
    service: ServiceName,
    url: string,
    headers: Record<string, string>,
    valid: (body: Record<string, unknown>) => boolean,
  ): Promise<Probe> {
    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return {
          service,
          status: "unavailable",
          state: "configured",
          detail: `Provider check returned HTTP ${response.status}`,
        };
      }
      const body = (await response.json()) as Record<string, unknown>;
      if (!valid(body))
        return {
          service,
          status: "degraded",
          state: "configured",
          detail: "Provider response did not establish an active connection",
        };
      return {
        service,
        status: "unknown",
        state: "connected",
        detail:
          "Authenticated read succeeded; real operation/delivery not verified",
      };
    } catch {
      return {
        service,
        status: "unavailable",
        state: "configured",
        detail: "Provider check failed or timed out",
      };
    }
  }
  const off = (service: ServiceName): Probe => ({
    service,
    status: "unknown",
    state: "unconfigured",
    detail: "Provider credentials not configured",
  });
  const probes: Probe[] = [];
  const sid = env.TWILIO_ACCOUNT_SID?.trim(),
    token = env.TWILIO_AUTH_TOKEN?.trim();
  if (sid && token && /^AC[a-f0-9]{32}$/i.test(sid)) {
    const voice = await check(
      "twilio_voice",
      `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      },
      (b) => b.sid === sid && b.status === "active",
    );
    probes.push(voice, { ...voice, service: "twilio_sms" });
  } else probes.push(off("twilio_voice"), off("twilio_sms"));
  const stripe = env.STRIPE_SECRET_KEY?.trim();
  probes.push(
    stripe
      ? await check(
          "stripe",
          "https://api.stripe.com/v1/account",
          { authorization: `Bearer ${stripe}` },
          (b) =>
            b.object === "account" &&
            typeof b.id === "string" &&
            b.charges_enabled === true,
        )
      : {
          ...off("stripe"),
          detail:
            "Live Stripe key not configured; test mode does not verify production billing",
        },
  );
  const provider = env.RECEPTIONIST_LLM_PROVIDER?.trim();
  if (provider === "rules" || provider === "none")
    probes.push({
      service: "ai_receptionist",
      status: "unknown",
      state: "configured",
      detail: "Rule-based mode; live voice flow not verified",
    });
  else if (
    (provider === "anthropic" || !provider) &&
    env.ANTHROPIC_API_KEY?.trim()
  ) {
    probes.push(
      await check(
        "ai_receptionist",
        "https://api.anthropic.com/v1/models?limit=1",
        {
          "x-api-key": env.ANTHROPIC_API_KEY.trim(),
          "anthropic-version": "2023-06-01",
        },
        (b) => Array.isArray(b.data) && b.data.length > 0,
      ),
    );
  } else if (
    (provider === "openai" || !provider) &&
    env.OPENAI_API_KEY?.trim() &&
    !env.RECEPTIONIST_LLM_BASE_URL?.trim()
  ) {
    probes.push(
      await check(
        "ai_receptionist",
        "https://api.openai.com/v1/models",
        { authorization: `Bearer ${env.OPENAI_API_KEY.trim()}` },
        (b) => Array.isArray(b.data) && b.data.length > 0,
      ),
    );
  } else
    probes.push({
      ...off("ai_receptionist"),
      state: env.RECEPTIONIST_LLM_BASE_URL ? "configured" : "unconfigured",
      detail:
        "No supported provider connection check; live voice flow not verified",
    });
  return probes;
}
