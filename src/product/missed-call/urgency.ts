import type {
  ClientAccount,
  UrgencyClassification,
  UrgencyLevel,
  UrgencyRubricEntry,
} from "./types";

export const HARDCODED_CRITICAL_TRIGGERS: {
  id: string;
  patterns: RegExp[];
}[] = [
  {
    id: "critical_gas",
    patterns: [
      /\b(gazs?|gases?|odeur de gaz|smell of gas|fuite de gaz|gas leak)\b/i,
      /\b(propane|monoxyde|carbon monoxide|co detector)\b/i,
    ],
  },
  {
    id: "critical_fire",
    patterns: [
      /\b(feu|fire|flammes?|fumee|smoke|brule|burning)\b/i,
    ],
  },
  {
    id: "critical_flood",
    patterns: [
      /\b(inondation|flooding|flood|debordement|sewer backup|refoulement)\b/i,
    ],
  },
  {
    id: "critical_electrical",
    patterns: [
      /\b(electrique expose|exposed wire|fil nu|fils nus)\b/i,
      /\b(etincelles?|sparks?|arc electrique|arcing)\b/i,
      /\b(panneau electrique|electrical panel|breaker(s)? spark)/i,
      /\b(panne electrique totale|power outage everywhere|compteur brule)\b/i,
    ],
  },
  {
    id: "critical_structural",
    patterns: [/\b(effondrement|collapse|gaz toxique|toxic)\b/i],
  },
];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ");
}

function matchRubric(
  text: string,
  entry: UrgencyRubricEntry,
): string | undefined {
  const t = normalize(text);
  for (const kw of [...entry.keywordsFr, ...entry.keywordsEn]) {
    const k = normalize(kw);
    if (k.length >= 3 && t.includes(k)) return kw;
  }
  return undefined;
}

export type UrgencyLogEntry = {
  at: string;
  classification: UrgencyClassification;
  textSample: string;
};

export function classifyUrgency(input: {
  issueDescription: string;
  rubric: UrgencyRubricEntry[];
  at?: Date;
}): { classification: UrgencyClassification; log: UrgencyLogEntry } {
  const text = input.issueDescription.trim();
  const normalized = normalize(text);
  const at = (input.at ?? new Date()).toISOString();

  for (const trigger of HARDCODED_CRITICAL_TRIGGERS) {
    for (const pattern of trigger.patterns) {
      if (pattern.test(normalized) || pattern.test(text)) {
        const classification: UrgencyClassification = {
          level: "critical",
          source: trigger.id,
          requiresHuman: true,
          escalated: true,
          matchedKeyword: trigger.id,
        };
        return {
          classification,
          log: { at, classification, textSample: text.slice(0, 200) },
        };
      }
    }
  }

  let best: { level: UrgencyLevel; entry: UrgencyRubricEntry; kw: string } | null =
    null;
  const rank: Record<UrgencyLevel, number> = {
    routine: 0,
    priority: 1,
    critical: 2,
  };

  for (const entry of input.rubric) {
    const kw = matchRubric(normalized, entry);
    if (!kw) continue;
    if (!best || rank[entry.level] > rank[best.level]) {
      best = { level: entry.level, entry, kw };
    }
  }

  if (best) {
    const requiresHuman = best.level === "critical";
    const classification: UrgencyClassification = {
      level: best.level,
      source: `rubric:${best.entry.id}`,
      requiresHuman,
      escalated: requiresHuman,
      matchedKeyword: best.kw,
    };
    return {
      classification,
      log: { at, classification, textSample: text.slice(0, 200) },
    };
  }

  if (text.length < 8) {
    const classification: UrgencyClassification = {
      level: "routine",
      source: "uncertain:short_description",
      requiresHuman: true,
      escalated: true,
    };
    return {
      classification,
      log: { at, classification, textSample: text },
    };
  }

  const classification: UrgencyClassification = {
    level: "routine",
    source: "default:routine",
    requiresHuman: false,
    escalated: false,
  };
  return {
    classification,
    log: { at, classification, textSample: text.slice(0, 200) },
  };
}

export function defaultUrgencyRubric(): UrgencyRubricEntry[] {
  return [
    {
      id: "priority_no_heat",
      level: "priority",
      keywordsFr: ["pas de chaleur", "chaudiere en panne", "congel", "gel"],
      keywordsEn: ["no heat", "furnace down", "frozen pipe"],
    },
    {
      id: "priority_water_leak",
      level: "priority",
      keywordsFr: ["fuite d'eau", "fuite importante", "eau partout"],
      keywordsEn: ["water leak", "major leak", "water everywhere"],
    },
    {
      id: "routine_maintenance",
      level: "routine",
      keywordsFr: ["entretien", "devis", "installation planifiee"],
      keywordsEn: ["maintenance", "quote", "scheduled install"],
    },
  ];
}

export function rosterTechnician(
  client: ClientAccount,
  id: string,
): { id: string; name: string; phone: string } | null {
  const fromRoster = client.technicianRoster.find((t) => t.id === id && t.active);
  if (fromRoster) {
    return { id: fromRoster.id, name: fromRoster.name, phone: fromRoster.phone };
  }
  const legacy = client.onCallTechnicians.find((t) => t.id === id && t.active);
  if (legacy) return legacy;
  return null;
}
