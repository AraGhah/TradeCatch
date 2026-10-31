/**
 * Pull everything useful out of ONE sentence (pure, FR-CA + EN).
 *
 * "Hi, my name is John. I need someone to paint my kitchen next Thursday. I'm
 * in Laval." gives name John, service painting, project kitchen, date "next
 * Thursday" and location Laval — so none of them is asked again.
 *
 * Everything returned is something the caller literally said (or a fixed label
 * for a trade word they used). Nothing is guessed from the caller's phone
 * number, and an unrecognised word is simply left out rather than invented.
 */

import { normalizeSpeech } from "./nlu";
import type { ReceptionistLanguage } from "./types";

export type TradeKey =
  | "painting"
  | "plumbing"
  | "electrical"
  | "hvac"
  | "roofing"
  | "landscaping"
  | "renovation"
  | "flooring"
  | "carpentry"
  | "masonry"
  | "windows"
  | "cleaning";

type Trade = {
  key: TradeKey;
  label: Record<ReceptionistLanguage, string>;
  /** Words that name the trade itself ("painting", "plomberie"). */
  strong: string[];
  /** Things that usually mean the trade ("faucet", "fournaise"). */
  weak: string[];
  /** One question about the job, asked at most once. */
  scope?: Record<ReceptionistLanguage, string>;
};

const TRADES: Trade[] = [
  {
    key: "painting",
    label: { fr: "la peinture", en: "painting" },
    strong: ["paint", "peintur", "peindre", "peintr", "repaint"],
    weak: [],
    scope: {
      fr: "C'est pour de la peinture intérieure ou extérieure?",
      en: "Is this for interior or exterior painting?",
    },
  },
  {
    key: "plumbing",
    label: { fr: "la plomberie", en: "plumbing" },
    strong: ["plumb", "plomb"],
    weak: [
      "leak",
      "fuite",
      "drain",
      "egout",
      "sewer",
      "toilet",
      "toilette",
      "faucet",
      "robinet",
      "sink",
      "evier",
      "pipe",
      "tuyau",
      "water heater",
      "chauffe eau",
      "clog",
      "bouch",
      "refoul",
    ],
    scope: {
      fr: "Pouvez-vous m'en dire un peu plus sur ce qui se passe?",
      en: "Can you tell me a little more about what's happening?",
    },
  },
  {
    key: "electrical",
    label: { fr: "l'électricité", en: "electrical work" },
    strong: ["electric", "electri"],
    weak: [
      "outlet",
      "prise",
      "breaker",
      "disjoncteur",
      "wiring",
      "filage",
      "luminaire",
      "light fixture",
      "electrical panel",
      "panneau electrique",
    ],
    scope: {
      fr: "Qu'est-ce qui se passe exactement avec l'électricité?",
      en: "What exactly is going on with the electrical?",
    },
  },
  {
    key: "hvac",
    label: { fr: "le chauffage et la climatisation", en: "heating and cooling" },
    strong: [
      "hvac",
      "chauffage",
      "climatis",
      "heating",
      "air condition",
      "thermopompe",
      "heat pump",
      "ventilation",
    ],
    weak: [
      "furnace",
      "fournaise",
      "boiler",
      "chaudiere",
      "thermostat",
      "radiat",
      "air conditioner",
    ],
    scope: {
      fr: "Est-ce que le système ne fonctionne pas du tout, ou il chauffe mal?",
      en: "Is the system not working at all, or is it just not heating properly?",
    },
  },
  {
    key: "roofing",
    label: { fr: "la toiture", en: "roofing" },
    strong: ["roof", "toit", "couvreur", "bardeau", "shingle"],
    weak: ["gutter", "gouttiere", "soffit"],
    scope: {
      fr: "C'est pour une réparation ou un remplacement de toiture?",
      en: "Is this a roof repair or a full replacement?",
    },
  },
  {
    key: "landscaping",
    label: { fr: "l'aménagement paysager", en: "landscaping" },
    strong: ["landscap", "paysag", "pelouse", "lawn", "gazon", "tonte", "deneigement", "snow removal"],
    weak: ["jardin", "garden"],
    scope: {
      fr: "C'est pour de l'entretien ou pour un nouvel aménagement?",
      en: "Is this for maintenance or a new design?",
    },
  },
  {
    key: "renovation",
    label: { fr: "la rénovation", en: "renovation" },
    strong: ["renov", "remodel", "agrandissement", "construction"],
    weak: [],
    scope: {
      fr: "Quelle partie de la maison voulez-vous rénover?",
      en: "Which part of the house are you looking to renovate?",
    },
  },
  {
    key: "flooring",
    label: { fr: "les planchers", en: "flooring" },
    strong: ["flooring", "plancher", "hardwood", "parquet", "carrelage"],
    weak: ["tile", "ceramique", "floor"],
    scope: {
      fr: "Quel genre de plancher est-ce, et pour quelle pièce?",
      en: "What kind of floor is it, and for which room?",
    },
  },
  {
    key: "carpentry",
    label: { fr: "la menuiserie", en: "carpentry" },
    strong: ["carpent", "menuis"],
    weak: ["cabinet", "armoire", "deck", "terrasse", "patio", "fence", "cloture"],
  },
  {
    key: "masonry",
    label: { fr: "la maçonnerie", en: "masonry" },
    strong: ["mason", "macon", "brick", "brique", "concrete", "beton", "pavage", "paving"],
    weak: ["foundation", "fondation", "asphalt", "asphalte"],
  },
  {
    key: "windows",
    label: { fr: "les portes et fenêtres", en: "windows and doors" },
    strong: ["window", "fenetre"],
    weak: ["door", "porte"],
  },
  {
    key: "cleaning",
    label: { fr: "le nettoyage", en: "cleaning" },
    strong: ["cleaning", "nettoyage", "menage", "pressure wash", "lavage"],
    weak: [],
  },
];

const TRADE_BY_KEY = new Map(TRADES.map((t) => [t.key, t]));

function plain(text: string): string {
  return normalizeSpeech(text).replace(/'/g, " ").replace(/\s+/g, " ").trim();
}

function mentions(padded: string, words: string[]): boolean {
  // Stems match at the start of a word ("paint" → painting, painter, repaint).
  return words.some((w) => new RegExp(`(?:^| )${w}`).test(padded));
}

export type TradeMatch = { strong: TradeKey[]; any: TradeKey[] };

/** Trades named in some text — a caller's sentence or an owner's service list. */
export function detectTrades(text: string): TradeMatch {
  const n = plain(text);
  const strong: TradeKey[] = [];
  const any: TradeKey[] = [];
  for (const trade of TRADES) {
    const isStrong = mentions(n, trade.strong);
    if (isStrong) strong.push(trade.key);
    if (isStrong || mentions(n, trade.weak)) any.push(trade.key);
  }
  return { strong, any };
}

export function tradeLabel(
  key: TradeKey,
  language: ReceptionistLanguage,
): string {
  return TRADE_BY_KEY.get(key)!.label[language];
}

export function tradeScopeQuestion(
  key: TradeKey,
  language: ReceptionistLanguage,
): string | undefined {
  return TRADE_BY_KEY.get(key)?.scope?.[language];
}

/**
 * Is the requested service something this business does? Only answers "no" when
 * it is sure: the caller named a trade, the owner's list names at least one
 * trade we recognise, and none of the caller's trades is in it. Anything
 * unrecognised on either side is treated as "possibly offered".
 */
export function serviceOffered(
  requestedText: string,
  configuredServices: readonly string[],
): { offered: boolean; requested?: TradeKey } {
  const wanted = detectTrades(requestedText);
  const requested = wanted.strong[0];
  if (!requested || configuredServices.length === 0) return { offered: true, requested };
  const offered = new Set<TradeKey>();
  for (const service of configuredServices) {
    for (const key of detectTrades(service).any) offered.add(key);
  }
  if (offered.size === 0) return { offered: true, requested };
  const covered = wanted.any.some((key) => offered.has(key));
  return { offered: covered, requested };
}

/* ------------------------------------------------------------------------- */
/* Project, date, place, name                                                 */
/* ------------------------------------------------------------------------- */

const PROJECT_NOUNS: { en: string; fr: string; words: string[] }[] = [
  { en: "kitchen", fr: "la cuisine", words: ["kitchen", "cuisine"] },
  { en: "bathroom", fr: "la salle de bain", words: ["bathroom", "washroom", "salle de bain", "salle d eau"] },
  { en: "bedroom", fr: "la chambre", words: ["bedroom", "bedrooms", "chambre", "chambres"] },
  { en: "living room", fr: "le salon", words: ["living room", "salon", "livingroom"] },
  { en: "basement", fr: "le sous-sol", words: ["basement", "sous sol"] },
  { en: "garage", fr: "le garage", words: ["garage"] },
  { en: "roof", fr: "la toiture", words: ["roof", "toit", "toiture"] },
  { en: "deck", fr: "la terrasse", words: ["deck", "terrasse", "patio"] },
  { en: "fence", fr: "la clôture", words: ["fence", "cloture"] },
  { en: "exterior", fr: "l'extérieur", words: ["exterior", "outside", "exterieur", "dehors"] },
  { en: "interior", fr: "l'intérieur", words: ["interior", "inside", "interieur"] },
  { en: "whole house", fr: "toute la maison", words: ["whole house", "entire house", "toute la maison", "maison complete"] },
  { en: "house", fr: "la maison", words: ["house", "maison"] },
  { en: "condo", fr: "le condo", words: ["condo"] },
  { en: "apartment", fr: "l'appartement", words: ["apartment", "appartement"] },
  { en: "office", fr: "le bureau", words: ["office", "bureau"] },
];

/** The part of the property the job is about, labelled in the call language. */
export function detectProject(
  text: string,
  language: ReceptionistLanguage,
): string | undefined {
  // "three bedrooms" / "3 chambres": keep the count, in the caller's own words.
  const counted =
    /\b(\d+|one|two|three|four|five|six|seven|eight|un|une|deux|trois|quatre|cinq|sept|huit)\s+(?:bed ?rooms?|rooms?|chambres?|pi[eè]ces?)\b/i.exec(
      text,
    );
  if (counted) return counted[0];
  const n = ` ${plain(text)} `;
  for (const noun of PROJECT_NOUNS) {
    if (noun.words.some((w) => n.includes(` ${w} `))) return noun[language];
  }
  return undefined;
}

const WD_EN = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const WD_FR = "(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)";
const PART_EN = "(?:morning|afternoon|evening)";
const PART_FR = "(?:matin|apr[eèé]s-?midi|soir)";
const MONTH_EN = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";
const MONTH_FR = "(?:janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)";
const COUNT_EN = "(?:\\d+|a|an|one|two|three|four|five|a couple of)";
const COUNT_FR = "(?:\\d+|un|une|deux|trois|quatre|cinq)";

// "at 3 pm", "à 15 h 30", "vers 9 h" — a clock time that goes with the day.
const TIME_TAIL =
  "(?: (?:at|around|vers|[àa]) \\d{1,2}(?:(?::|\\s?h\\s?)\\d{2})?\\s?(?:am|pm|h)?)?";

const WHEN_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:(?:next|this|coming) )${WD_EN}(?: ${PART_EN})?${TIME_TAIL}`, "i"),
  new RegExp(`\\b${WD_FR}(?: (?:prochain|de la semaine prochaine|cette semaine))?(?: (?:en )?${PART_FR})?${TIME_TAIL}`, "i"),
  new RegExp(`\\b(?:on )?${WD_EN}(?: ${PART_EN})?${TIME_TAIL}\\b`, "i"),
  new RegExp(`\\btomorrow(?: ${PART_EN})?${TIME_TAIL}\\b`, "i"),
  new RegExp(`\\bdemain(?: ${PART_FR})?${TIME_TAIL}`, "i"),
  new RegExp(`\\b(?:today|tonight|this ${PART_EN})\\b`, "i"),
  new RegExp(`\\b(?:aujourd['’]?hui|ce soir|ce matin|cet apr[eèé]s-?midi)`, "i"),
  /\b(?:next|this) (?:week|weekend|month)\b/i,
  /\b(?:la |cette )?(?:semaine prochaine|fin de semaine|le mois prochain|cette semaine|ce week-?end)/i,
  /\b(?:as soon as possible|asap|right away|as soon as you can)\b/i,
  /\b(?:d[eè]s que possible|le plus t[oô]t possible|tout de suite|d[eè]s maintenant)/i,
  new RegExp(`\\bin ${COUNT_EN} (?:day|days|week|weeks)\\b`, "i"),
  new RegExp(`\\bdans ${COUNT_FR} (?:jour|jours|semaine|semaines)`, "i"),
  new RegExp(`\\b(?:on |the )?\\d{1,2}(?:st|nd|rd|th)?(?: of)? ${MONTH_EN}\\b`, "i"),
  new RegExp(`\\b${MONTH_EN} \\d{1,2}(?:st|nd|rd|th)?\\b`, "i"),
  new RegExp(`\\ble \\d{1,2}(?:er)? ${MONTH_FR}`, "i"),
];

// "since this morning", "depuis lundi": when a problem started, not when to come.
const SINCE_BEFORE =
  /(?:depuis|since|jusqu['’]?[àa]|until|started|commenc[ée]e?|a commenc[ée])\s+(?:(?:le|la|l['’]|this|ce|cette|last|dernier|derni[èe]re|on|à|at)\s*)*$/i;

/** A date or time phrase exactly as the caller said it ("next Thursday"). */
export function detectWhen(text: string): string | undefined {
  let best: { index: number; text: string } | undefined;
  for (const re of WHEN_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    if (SINCE_BEFORE.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
    // Earliest wins; on a tie the longer phrase ("next Thursday morning").
    if (
      !best ||
      m.index < best.index ||
      (m.index === best.index && m[0].length > best.text.length)
    ) {
      best = { index: m.index, text: m[0] };
    }
  }
  return best?.text.trim().replace(/^(?:on|the) /i, "");
}

/** Cities and regions callers in this market actually name. */
const PLACES = [
  "Montréal", "Laval", "Longueuil", "Brossard", "Terrebonne", "Repentigny",
  "Boucherville", "Blainville", "Boisbriand", "Mascouche", "Mirabel", "Saint-Jérôme",
  "Saint-Laurent", "Saint-Léonard", "Anjou", "Verdun", "Lasalle", "LaSalle", "Outremont",
  "Westmount", "Pointe-Claire", "Dorval", "Kirkland", "Beaconsfield", "Dollard-des-Ormeaux",
  "Vaudreuil", "Châteauguay", "Candiac", "La Prairie", "Saint-Lambert", "Chambly",
  "Saint-Hyacinthe", "Granby", "Sherbrooke", "Trois-Rivières", "Québec", "Lévis",
  "Gatineau", "Ottawa", "Toronto", "Mississauga", "Brampton", "Hamilton", "Rive-Nord",
  "Rive-Sud", "Rosemont", "Villeray", "Ahuntsic", "Hochelaga", "Plateau", "Griffintown",
  "Côte-des-Neiges", "Notre-Dame-de-Grâce", "Mont-Royal", "Saint-Eustache", "Deux-Montagnes",
];

const NOT_PLACES = new Set(
  [
    "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
    "lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche",
    "january","february","march","april","may","june","july","august","september","october","november","december",
    "janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre",
    "i","je","the","a","an","le","la","les","un","une","english","french","canada",
  ],
);

/**
 * A city or area the caller named. Known places win; otherwise "in/à <Capitalised
 * word>" is taken as a place (speech recognition normally capitalises names).
 */
export function detectLocation(
  text: string,
  serviceAreas: readonly string[] = [],
): string | undefined {
  const n = ` ${plain(text)} `;
  const known = [...serviceAreas, ...PLACES];
  for (const place of known) {
    const p = plain(place);
    if (p.length >= 3 && n.includes(` ${p} `)) return place;
  }
  // No \b before "à": it is not a word character, so a boundary never forms there.
  const m =
    /(?:^|[\s,.;])(?:[Ii]n|[Aa]t|[Nn]ear|[Ff]rom|[Aa]round|[Àà]|[Aa]|[Aa]u|[Aa]ux|[Dd]ans|[Pp]r[èe]s de|[Vv]ers)\s+([A-ZÀ-ÖØ-Þ][\p{L}'’-]+(?:[ -][A-ZÀ-ÖØ-Þ][\p{L}'’-]+){0,2})/u.exec(
      text,
    );
  const candidate = m?.[1];
  if (candidate && !NOT_PLACES.has(plain(candidate))) return candidate;
  return undefined;
}

const NAME_STOP = new Set(
  [
    "and","but","i","im","ive","id","je","j","jai","et","mais","calling","called","from","at","in","on","about","for",
    "with","to","need","needs","want","wants","have","has","would","could","looking","besoin","voudrais","aimerais",
    "appelle","call","phone","pour","de","du","des","d","a","au","aux","dans","chez","ici","here","there","the",
    "an","le","la","les","un","une","not","just","so","because","parce","que","qui","my","ma","mon","mes","is","est",
  ],
);
const NOT_A_NAME = new Set(
  [
    "urgent","important","interested","looking","trying","having","calling","sorry","desole","desolee","pas","not",
    "still","also","only","just","here","there","ok","okay","fine","good","bon","bien","parfait","correct","right",
    "sure","certain","sur","pret","prete","ready","back","new","nouveau","yes","oui","non","no","moi","me","him",
    "elle","lui","possible","ca","cela","that","this","those","these","what","quoi","english","french",
  ],
);

const STRONG_NAME_INTRO =
  /(?:my name is|my name's|name's|call me|je m'appelle|je m’appelle|mon nom (?:est|c'est|c’est))\s+(\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*){0,3})/iu;
const WEAK_NAME_INTRO =
  /(?:this is|it's|it’s|i am|i'm|i’m|je suis|moi c'est|moi c’est|c'est|c’est)\s+(\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*){0,3})/iu;

function cleanName(raw: string, requireCapital: boolean): string | undefined {
  const words: string[] = [];
  for (const word of raw.split(/\s+/)) {
    const key = plain(word).replace(/ /g, "");
    if (!key) break;
    if (NAME_STOP.has(key) || NOT_A_NAME.has(key)) break;
    if (requireCapital && !/^\p{Lu}/u.test(word)) break;
    words.push(word);
    if (words.length === 3) break;
  }
  if (words.length === 0) return undefined;
  const name = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return name.length >= 2 && name.length <= 60 ? name : undefined;
}

/** A name offered inside a longer sentence ("Hi, my name is John. I need…"). */
export function detectNameInSentence(text: string): string | undefined {
  const strong = STRONG_NAME_INTRO.exec(text);
  if (strong?.[1]) {
    const name = cleanName(strong[1], false);
    if (name) return name;
  }
  const weak = WEAK_NAME_INTRO.exec(text);
  if (weak?.[1]) return cleanName(weak[1], true);
  return undefined;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

const STREET_TYPE =
  "(?:[Rr]ue|[Aa]venue|[Aa]ve|[Bb]oulevard|[Bb]oul|[Bb]lvd|[Cc]hemin|[Rr]oute|[Rr]ang|[Pp]lace|[Mm]ont[ée]e|[Ii]mpasse|[Cc]roissant|[Aa]ll[ée]e|[Ss]treet|[Ss]t|[Rr]oad|[Rr]d|[Dd]rive|[Dd]r|[Ll]ane|[Ll]n|[Cc]ourt|[Cc]t|[Cc]rescent|[Ww]ay|[Tt]errace|[Cc]ircle)";
// "123 Main Street" (name words, then the type) or "12 rue des Pins" (type, then the name).
const STREET_ADDRESS = new RegExp(
  `(?<![\\p{L}\\d])(\\d{1,5}[A-Za-z]?(?:-\\d{1,5})?)\\s+((?:\\p{Lu}[\\p{L}'’-]*\\s+){0,2})(${STREET_TYPE})(?![\\p{L}])\\.?` +
    `((?:\\s+(?:(?:de la|du|des|de|d['’]|la|le|les|l['’])\\s*)?(?:\\p{Lu}[\\p{L}'’-]*|\\d+[A-Za-z]*)){0,4})`,
  "u",
);

/**
 * A street address inside a sentence ("I'm at 123 Main Street", "non, c'est
 * 45 rue Principale"). Conservative: it needs a number and a street type, and a
 * French-style "12 rue" with no street name after it is not an address yet.
 */
export function detectStreetAddress(text: string): string | undefined {
  const m = STREET_ADDRESS.exec(text);
  if (!m) return undefined;
  const [whole, , nameBefore, , nameAfter] = m;
  if (!nameBefore && !nameAfter) return undefined;
  const address = whole.trim().replace(/\s+/g, " ");
  return address.length <= 120 ? address : undefined;
}

export type CallDetails = {
  callerName?: string;
  /** A street address (number, street type, name); the city is in `location`. */
  serviceAddress?: string;
  service?: string;
  tradeKey?: TradeKey;
  project?: string;
  preferredTime?: string;
  location?: string;
  email?: string;
};

/** Everything recognisable in one utterance. Fields it cannot find stay undefined. */
export function extractCallDetails(
  text: string,
  language: ReceptionistLanguage,
  opts: { serviceAreas?: readonly string[] } = {},
): CallDetails {
  const trades = detectTrades(text);
  const tradeKey = trades.strong[0] ?? trades.any[0];
  const email = EMAIL.exec(text)?.[0];
  const details: CallDetails = {
    callerName: detectNameInSentence(text),
    serviceAddress: detectStreetAddress(text),
    tradeKey,
    service: tradeKey ? tradeLabel(tradeKey, language) : undefined,
    project: detectProject(text, language),
    preferredTime: detectWhen(text),
    location: detectLocation(text, opts.serviceAreas),
    email,
  };
  for (const key of Object.keys(details) as (keyof CallDetails)[]) {
    if (details[key] === undefined) delete details[key];
  }
  return details;
}
