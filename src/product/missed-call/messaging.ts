import type {
  ApprovedQuestion,
  ClientAccount,
  CollectionStep,
  ConversationLanguage,
  CollectedLead,
} from "./types";

const OPT_OUT_DEFAULT = ["stop", "arret", "arrêt", "unsubscribe", "desabonner", "désabonner"];

export function isOptOut(body: string, client: ClientAccount): boolean {
  const normalized = body
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const keywords = [...client.optOutKeywords, ...OPT_OUT_DEFAULT].map((k) =>
    k
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, ""),
  );
  return keywords.some((k) => normalized === k || normalized.startsWith(`${k} `));
}

/** Customer asked to switch to English. */
export function isEnglishRequest(body: string): boolean {
  const t = body.trim().toLowerCase();
  return (
    t === "en" ||
    t === "english" ||
    t === "anglais" ||
    t.startsWith("en ") ||
    t.includes("english")
  );
}

export function isFrenchRequest(body: string): boolean {
  const t = body.trim().toLowerCase();
  return t === "fr" || t === "francais" || t === "français" || t === "french";
}

export function enabledQuestions(client: ClientAccount): ApprovedQuestion[] {
  return client.approvedQuestions.filter(
    (q) => q.enabled && q.id !== "language" && q.id !== "done",
  );
}

export function nextCollectionStep(
  client: ClientAccount,
  collected: CollectedLead,
  current: CollectionStep,
): CollectionStep {
  const order = enabledQuestions(client).map((q) => q.id);
  if (current === "language") {
    return order[0] ?? "done";
  }
  const idx = order.indexOf(current);
  if (idx === -1) return "done";

  // Photo is skippable if not required and customer says skip
  for (let i = idx + 1; i < order.length; i++) {
    const step = order[i];
    if (step === "name" && collected.customerName) continue;
    if (step === "address" && collected.serviceAddress) continue;
    if (step === "description" && collected.issueDescription) continue;
    if (step === "photo" && collected.photoUrls.length > 0) continue;
    return step;
  }
  return "done";
}

export function promptForStep(
  client: ClientAccount,
  step: CollectionStep,
  lang: ConversationLanguage,
): string | null {
  if (step === "done") return null;
  if (step === "language") {
    return lang === "fr"
      ? `Bonjour, ici ${client.contractorDisplayName}. Nous avons manqué votre appel. Répondez à ce texto pour qu'on puisse vous aider. For English, reply EN.`
      : `Hi, this is ${client.contractorDisplayName}. We missed your call. Reply to this text so we can help. Pour le français, répondez FR.`;
  }
  const q = client.approvedQuestions.find((x) => x.id === step && x.enabled);
  if (!q) return null;
  return lang === "fr" ? q.promptFr : q.promptEn;
}

export function openingSms(client: ClientAccount): string {
  // Always begin in French per product requirement.
  return promptForStep(client, "language", "fr")!;
}

export function applyAnswer(
  step: CollectionStep,
  body: string,
  mediaUrls: string[],
  collected: CollectedLead,
): CollectedLead {
  const next = { ...collected, photoUrls: [...collected.photoUrls] };
  const text = body.trim();

  switch (step) {
    case "name":
      next.customerName = text;
      break;
    case "address":
      next.serviceAddress = text;
      break;
    case "description":
      next.issueDescription = text;
      break;
    case "photo":
      if (mediaUrls.length) next.photoUrls.push(...mediaUrls);
      else if (!/^pass|skip|non|no|plus tard|later$/i.test(text)) {
        // Treat text as note if no media; still advance via caller
        next.photoUrls = next.photoUrls;
      }
      break;
    default:
      break;
  }
  return next;
}

export function isPhotoSkip(body: string): boolean {
  return /^(pass|skip|non|no|plus tard|later|aucune|none)$/i.test(body.trim());
}

export function technicianAlertBody(
  client: ClientAccount,
  collected: CollectedLead,
  callerE164: string,
): string {
  const lines = [
    `${client.contractorDisplayName} — nouvelle demande`,
    `Appelant: ${callerE164}`,
    collected.customerName ? `Nom: ${collected.customerName}` : null,
    collected.serviceAddress ? `Adresse: ${collected.serviceAddress}` : null,
    collected.issueDescription ? `Problème: ${collected.issueDescription}` : null,
    collected.photoUrls.length
      ? `Photos: ${collected.photoUrls.length}`
      : "Photos: aucune",
    "Répondez OUI pour accepter, NON pour refuser.",
  ];
  return lines.filter(Boolean).join("\n");
}

export function customerNotifyAccepted(
  client: ClientAccount,
  lang: ConversationLanguage,
  techName: string,
): string {
  if (lang === "en") {
    return `${client.contractorDisplayName}: ${techName} accepted your request and will call you shortly. Reply STOP to opt out.`;
  }
  return `${client.contractorDisplayName}: ${techName} a accepté votre demande et vous rappellera sous peu. Répondez ARRET pour vous désabonner.`;
}

export function defaultApprovedQuestions(): ApprovedQuestion[] {
  return [
    {
      id: "name",
      enabled: true,
      required: true,
      promptFr: "Quel est votre nom complet?",
      promptEn: "What is your full name?",
    },
    {
      id: "address",
      enabled: true,
      required: true,
      promptFr: "Quelle est l'adresse du service (numéro, rue, ville)?",
      promptEn: "What is the service address (number, street, city)?",
    },
    {
      id: "description",
      enabled: true,
      required: true,
      promptFr: "Décrivez brièvement le problème.",
      promptEn: "Please briefly describe the issue.",
    },
    {
      id: "photo",
      enabled: true,
      required: false,
      promptFr:
        "Pouvez-vous envoyer une photo du problème? (ou répondez NON pour passer)",
      promptEn: "Can you send a photo of the issue? (or reply NO to skip)",
    },
  ];
}
