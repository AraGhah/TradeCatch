import type { ServiceAreaRule, ServiceAreaVerdict } from "./types";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function postalTokens(normalized: string): string[] {
  const tokens: string[] = [];
  const caPostal = normalized.match(/\b([a-z]\d[a-z])\s?(\d[a-z]\d)?\b/g);
  if (caPostal) {
    for (const m of caPostal) {
      const compact = m.replace(/\s/g, "");
      tokens.push(compact.slice(0, 3));
      tokens.push(compact);
    }
  }
  return tokens;
}

export type ServiceAreaCheckResult = {
  verdict: ServiceAreaVerdict;
  matchedRuleId?: string;
  matchedToken?: string;
  sendToHuman: boolean;
};

export function checkServiceArea(
  address: string,
  rules: ServiceAreaRule[],
): ServiceAreaCheckResult {
  const normalized = normalize(address);
  if (!normalized || normalized.length < 3) {
    return { verdict: "uncertain", sendToHuman: true };
  }

  if (rules.length === 0) {
    return { verdict: "uncertain", sendToHuman: true };
  }

  const addressTokens = new Set([
    ...normalized.split(" "),
    ...postalTokens(normalized),
  ]);

  let bestInside: ServiceAreaCheckResult | null = null;

  for (const rule of rules) {
    for (const raw of rule.matchTokens) {
      const token = normalize(raw);
      if (token.length < 2) continue;

      const tokenParts = token.split(" ").filter(Boolean);
      const multiWord = tokenParts.length > 1 ? token : null;

      if (multiWord && normalized.includes(multiWord)) {
        bestInside = {
          verdict: "inside",
          matchedRuleId: rule.id,
          matchedToken: multiWord,
          sendToHuman: false,
        };
        continue;
      }

      if (addressTokens.has(token) || normalized.includes(token)) {
        bestInside = {
          verdict: "inside",
          matchedRuleId: rule.id,
          matchedToken: token,
          sendToHuman: false,
        };
      }
    }
  }

  if (bestInside) return bestInside;

  const hasStreetNumber =
    /^\d+\s/.test(address.trim()) ||
    /\b(rue|street|av|ave|boulevard|blvd|chemin)\b/i.test(address);
  if (!hasStreetNumber) {
    return { verdict: "uncertain", sendToHuman: true };
  }

  return { verdict: "outside", sendToHuman: true };
}
