/**
 * Phone booking helpers — pure, no I/O.
 *
 * The engine owns the conversation; the scheduling backend owns availability
 * and the reservation (see phone-booking.ts). Nothing here may say a time is
 * booked: only a `confirmed` reserve result can.
 */

import { zonedParts } from "@/product/sms-automation/window";
import { normalizeSpeech } from "./nlu";
import type {
  OfferedSlot,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "./types";

export type OpenSlot = { startAt: string; endAt: string };

export type OpeningsResult =
  | {
      ok: true;
      /** Zone the business hours are defined in; labels are rendered in it. */
      timezone: string;
      service: { id?: string; name: string };
      slots: OpenSlot[];
    }
  | { ok: false; reason: "not_bookable" | "unavailable" };

export type ReserveResult =
  | { status: "confirmed"; appointmentId: string; startAt: string }
  | { status: "conflict"; alternatives: OpenSlot[] }
  | { status: "request"; reason: string }
  | { status: "error" };

/** What the engine needs from the scheduling backend. */
export type ReceptionistScheduler = {
  listOpenings(input: {
    config: ReceptionistConfig;
    issue?: string;
    /** Set after the first round so the same service is kept. */
    serviceId?: string;
    serviceAddress?: string;
    language: ReceptionistLanguage;
    from: Date;
    until?: Date;
  }): Promise<OpeningsResult>;
  reserve(input: {
    config: ReceptionistConfig;
    serviceId?: string;
    serviceName?: string;
    startAt: string;
    callerName?: string;
    callbackE164?: string;
    serviceAddress?: string;
    language: ReceptionistLanguage;
    idempotencyKey: string;
  }): Promise<ReserveResult>;
};

/* ------------------------------------------------------------------------- */
/* Zones and labels                                                           */
/* ------------------------------------------------------------------------- */

const OFFER_COUNT = 3;
/** Picks are at least this far apart so three offers are not three neighbours. */
const MIN_SPACING_MS = 90 * 60_000;

function offsetMs(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return shown - Math.floor(at.getTime() / 60_000) * 60_000;
}

function localMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
) {
  const guess = Date.UTC(year, month - 1, day, 0, 0);
  // Two passes so a daylight-saving change on that day still lands on 00:00.
  let instant = guess - offsetMs(new Date(guess), timeZone);
  instant = guess - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** [00:00, next 00:00) of a business-local calendar day. */
export function localDayWindow(
  dateKey: string,
  timeZone: string,
): { from: Date; until: Date } {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return {
    from: localMidnight(y, m, d, timeZone),
    until: localMidnight(y, m, d + 1, timeZone),
  };
}

/** "mardi 21 octobre à 14 h 30" / "Tuesday, October 21 at 2:30 PM". */
export function spokenSlotLabel(
  startAt: string,
  timeZone: string,
  language: ReceptionistLanguage,
): string {
  const at = new Date(startAt);
  const p = zonedParts(at, timeZone);
  const locale = language === "fr" ? "fr-CA" : "en-CA";
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
  }).format(at);
  const month = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "long",
  }).format(at);
  if (language === "fr") {
    const day = p.day === 1 ? "1er" : String(p.day);
    const time =
      p.minute === 0
        ? `${p.hour} h`
        : `${p.hour} h ${String(p.minute).padStart(2, "0")}`;
    return `${weekday} ${day} ${month} à ${time}`;
  }
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const suffix = p.hour < 12 ? "AM" : "PM";
  const time =
    p.minute === 0
      ? `${hour12} ${suffix}`
      : `${hour12}:${String(p.minute).padStart(2, "0")} ${suffix}`;
  return `${weekday}, ${month} ${p.day} at ${time}`;
}

export function toOfferedSlots(
  slots: OpenSlot[],
  timeZone: string,
  language: ReceptionistLanguage,
): OfferedSlot[] {
  return slots.map((slot) => ({
    startAt: slot.startAt,
    endAt: slot.endAt,
    label: spokenSlotLabel(slot.startAt, timeZone, language),
  }));
}

/** "1, mardi …; 2, mercredi …" — numbered so the caller can also press a key. */
export function readOptions(offered: OfferedSlot[]): string {
  return offered.map((slot, i) => `${i + 1}, ${slot.label}`).join("; ");
}

/* ------------------------------------------------------------------------- */
/* What the caller asked for                                                  */
/* ------------------------------------------------------------------------- */

export type TimePreference = {
  /** Business-local calendar day, YYYY-MM-DD. */
  dateKey?: string;
  part?: "morning" | "afternoon" | "evening";
  /** Minutes after local midnight. */
  minutes?: number;
};

const WEEKDAY_WORDS: [string[], number][] = [
  [["sunday", "dimanche"], 0],
  [["monday", "lundi"], 1],
  [["tuesday", "mardi"], 2],
  [["wednesday", "mercredi"], 3],
  [["thursday", "jeudi"], 4],
  [["friday", "vendredi"], 5],
  [["saturday", "samedi"], 6],
];

const MONTH_WORDS =
  "january|february|march|april|may|june|july|august|september|october|november|december|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";

function hasWord(normalized: string, words: string[]): boolean {
  const padded = ` ${normalized} `;
  return words.some((w) => padded.includes(` ${w} `));
}

function weekdayMentioned(normalized: string): number | null {
  for (const [words, index] of WEEKDAY_WORDS) {
    if (hasWord(normalized, words)) return index;
  }
  return null;
}

function partOfDay(normalized: string): TimePreference["part"] {
  if (/\b(?:apres midi|afternoon)\b/.test(normalized)) return "afternoon";
  if (/\b(?:matin|morning|avant midi)\b/.test(normalized)) return "morning";
  if (/\b(?:soir|evening|tonight)\b/.test(normalized)) return "evening";
  return undefined;
}

/**
 * A clock time in local minutes, or null. Bare small hours ("at 2") are read
 * as afternoon: nobody books a 2 AM visit by phone.
 */
export function extractClockMinutes(
  normalized: string,
  part?: TimePreference["part"],
): number | null {
  const withoutParts = normalized.replace(/\b(?:apres|avant) midi\b/g, " ");
  if (/\b(?:midi|noon)\b/.test(withoutParts)) return 12 * 60;

  const meridiem = withoutParts.match(/\b(\d{1,2})(?: (\d{2}))? ?(a|p) ?m\b/);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    if (hour < 1 || hour > 12) return null;
    const minute = Number(meridiem[2] ?? 0);
    if (meridiem[3] === "p" && hour < 12) hour += 12;
    if (meridiem[3] === "a" && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  const spoken =
    withoutParts.match(/\b(\d{1,2}) ?(?:h|heures?|hrs?)(?: ?(\d{2}))?\b/) ??
    withoutParts.match(
      new RegExp(
        `\\b(?:at|a|vers|around|about|avant|apres|before|after) (\\d{1,2})(?: (\\d{2}))?\\b(?! (?:${MONTH_WORDS}))`,
      ),
    );
  if (!spoken) return null;
  let hour = Number(spoken[1]);
  const minute = Number(spoken[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  if (hour >= 1 && hour <= 6) hour += 12;
  if ((part === "afternoon" || part === "evening") && hour < 12) hour += 12;
  return hour * 60 + minute;
}

/** Best-effort reading of "demain après-midi", "Friday at 2", "lundi matin". */
export function parseTimePreference(
  text: string,
  now: Date,
  timeZone: string,
): TimePreference {
  const n = normalizeSpeech(text);
  if (!n) return {};
  const pref: TimePreference = {};

  const part = partOfDay(n);
  if (part) pref.part = part;
  const minutes = extractClockMinutes(n, part);
  if (minutes != null) pref.minutes = minutes;

  const today = zonedParts(now, timeZone);
  const addDays = (days: number) =>
    new Date(Date.UTC(today.year, today.month - 1, today.day + days))
      .toISOString()
      .slice(0, 10);

  if (/\b(?:apres demain|day after tomorrow)\b/.test(n)) {
    pref.dateKey = addDays(2);
  } else if (/\b(?:demain|tomorrow)\b/.test(n)) {
    pref.dateKey = addDays(1);
  } else if (
    /\b(?:aujourd'hui|aujourd hui|today|ce soir|tonight|ce matin|this morning|cet apres midi|this afternoon)\b/.test(
      n,
    )
  ) {
    pref.dateKey = addDays(0);
  } else {
    const weekday = weekdayMentioned(n);
    if (weekday != null) {
      let delta = (weekday - today.weekday + 7) % 7;
      if (delta === 0 && /\b(?:next|prochain|prochaine)\b/.test(n)) delta = 7;
      pref.dateKey = addDays(delta);
    }
  }
  return pref;
}

function hasPreference(pref: TimePreference): boolean {
  return pref.dateKey != null || pref.part != null || pref.minutes != null;
}

const PART_RANGES: Record<
  NonNullable<TimePreference["part"]>,
  [number, number]
> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

function localOf(startAt: string, timeZone: string) {
  const p = zonedParts(new Date(startAt), timeZone);
  return {
    dateKey: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    minutes: p.hour * 60 + p.minute,
  };
}

function spaced(slots: OpenSlot[], spacingMs: number): OpenSlot[] {
  const out: OpenSlot[] = [];
  for (const slot of slots) {
    const last = out.at(-1);
    if (
      !last ||
      Date.parse(slot.startAt) - Date.parse(last.startAt) >= spacingMs
    ) {
      out.push(slot);
    }
    if (out.length === OFFER_COUNT) break;
  }
  return out;
}

/**
 * Up to three distinct start times to read out. `exact` is false when nothing
 * matched the caller's wish and these are simply the next openings.
 */
export function pickOffers(
  slots: OpenSlot[],
  pref: TimePreference,
  timeZone: string,
): { picks: OpenSlot[]; exact: boolean } {
  const seen = new Set<string>();
  const all = slots
    .filter((slot) => {
      if (seen.has(slot.startAt)) return false;
      seen.add(slot.startAt);
      return true;
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (all.length === 0) return { picks: [], exact: false };
  if (!hasPreference(pref)) {
    return { picks: spaced(all, MIN_SPACING_MS), exact: true };
  }

  const matches = all.filter((slot) => {
    const local = localOf(slot.startAt, timeZone);
    if (pref.dateKey && local.dateKey !== pref.dateKey) return false;
    if (pref.part) {
      const [from, to] = PART_RANGES[pref.part];
      if (local.minutes < from || local.minutes >= to) return false;
    }
    return true;
  });
  if (matches.length === 0) {
    return { picks: spaced(all, MIN_SPACING_MS), exact: false };
  }
  if (pref.minutes != null) {
    const wanted = pref.minutes;
    const closest = [...matches]
      .sort(
        (a, b) =>
          Math.abs(localOf(a.startAt, timeZone).minutes - wanted) -
            Math.abs(localOf(b.startAt, timeZone).minutes - wanted) ||
          a.startAt.localeCompare(b.startAt),
      )
      .slice(0, OFFER_COUNT)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    return { picks: closest, exact: true };
  }
  return { picks: spaced(matches, MIN_SPACING_MS), exact: true };
}

/* ------------------------------------------------------------------------- */
/* What the caller answered                                                   */
/* ------------------------------------------------------------------------- */

export type OfferAnswer =
  { kind: "pick"; index: number } | { kind: "decline" } | { kind: "unclear" };

const ORDINALS: [string[], number | "last"][] = [
  [["first", "1st", "premier", "premiere", "1er", "1ere"], 0],
  [["second", "2nd", "deuxieme", "seconde", "2e", "2eme"], 1],
  [["third", "3rd", "troisieme", "3e", "3eme"], 2],
  [["last", "dernier", "derniere"], "last"],
];

const BARE_NUMBERS: Record<string, number> = {
  "1": 0,
  one: 0,
  un: 0,
  une: 0,
  "2": 1,
  two: 1,
  deux: 1,
  "3": 2,
  three: 2,
  trois: 2,
};

const FILLER = new Set([
  "the",
  "le",
  "la",
  "les",
  "numero",
  "number",
  "option",
  "choix",
  "choice",
  "one",
  "please",
  "s'il",
  "vous",
  "plait",
  "je",
  "prends",
  "prend",
  "take",
  "i'll",
  "i",
  "will",
  "ll",
  "want",
  "veux",
  "voudrais",
  "would",
  "like",
]);

const DECLINE_PHRASES = [
  "none of those",
  "none of them",
  "none",
  "neither",
  "another",
  "something else",
  "something different",
  "different",
  "other",
  "later",
  "aucun",
  "aucune",
  "autre",
  "autres",
  "pas ces",
  "pas celles",
  "plus tard",
  "ca ne marche pas",
  "ne marche pas",
  "doesn't work",
  "does not work",
  "not those",
];

function hasPhraseIn(normalized: string, phrases: string[]): boolean {
  const padded = ` ${normalized} `;
  return phrases.some((p) => padded.includes(` ${normalizeSpeech(p)} `));
}

export function matchOffered(
  utterance: string,
  digits: string | undefined,
  offered: OfferedSlot[],
  timeZone: string,
): OfferAnswer {
  if (offered.length === 0) return { kind: "unclear" };

  const key = digits?.replace(/\D/g, "");
  if (key && key.length === 1) {
    const index = Number(key) - 1;
    if (index >= 0 && index < offered.length) return { kind: "pick", index };
  }

  const n = normalizeSpeech(utterance);
  if (!n) return { kind: "unclear" };
  const tokens = n.split(" ");

  // "the second one", "le premier", "the last".
  for (const [words, target] of ORDINALS) {
    if (words.some((w) => tokens.includes(w))) {
      const index = target === "last" ? offered.length - 1 : target;
      if (index < offered.length) return { kind: "pick", index };
    }
  }

  // "2", "number two", "le trois" — only when nothing else is being said.
  const core = tokens.filter((t) => !FILLER.has(t) || t in BARE_NUMBERS);
  if (core.length === 1 && core[0]! in BARE_NUMBERS) {
    const index = BARE_NUMBERS[core[0]!]!;
    if (index < offered.length) return { kind: "pick", index };
  }

  // "the 2 PM one", "à 10 heures", "Tuesday".
  const weekday = weekdayMentioned(n);
  const clock = extractClockMinutes(n, partOfDay(n));
  if (clock != null || weekday != null) {
    const matches = offered
      .map((slot, index) => ({
        index,
        local: zonedParts(new Date(slot.startAt), timeZone),
      }))
      .filter(({ local }) => {
        if (weekday != null && local.weekday !== weekday) return false;
        if (clock != null && local.hour * 60 + local.minute !== clock) {
          return false;
        }
        return true;
      });
    if (matches.length === 1) return { kind: "pick", index: matches[0]!.index };
    if (matches.length > 1) return { kind: "unclear" };
  }

  if (offered.length === 1) {
    const words = tokens.length;
    if (
      hasPhraseIn(n, [
        "yes",
        "yeah",
        "yep",
        "sure",
        "ok",
        "okay",
        "oui",
        "d'accord",
        "parfait",
        "that works",
        "ca marche",
        "ca me va",
      ]) &&
      words <= 5
    ) {
      return { kind: "pick", index: 0 };
    }
  }

  if (
    hasPhraseIn(n, DECLINE_PHRASES) ||
    (tokens.length <= 5 &&
      hasPhraseIn(n, [
        "no",
        "non",
        "nope",
        "no thanks",
        "non merci",
        "pas vraiment",
      ]))
  ) {
    return { kind: "decline" };
  }
  return { kind: "unclear" };
}

/* ------------------------------------------------------------------------- */
/* Guardrail against invented confirmations                                   */
/* ------------------------------------------------------------------------- */

const BOOKING_CLAIMS = [
  /\byou(?:'re| are) (?:all set|booked|scheduled|confirmed|good to go)\b/,
  /\b(?:appointment|booking|visit|slot|time) (?:is |has been |was )?(?:booked|confirmed|scheduled|reserved|set)\b/,
  /\bi(?:'ve| have| just)? (?:booked|scheduled|confirmed|reserved)\b/,
  /\b(?:booked|confirmed|scheduled|reserved) (?:you|for you|your)\b/,
  /\bwe(?:'ll| will) see you (?:on|at|then|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/,
  /\brendez vous (?:est |a ete )?(?:confirme|reserve|fixe|pris|planifie)\b/,
  /\bj'ai (?:reserve|confirme|fixe|planifie)\b/,
  /\bvous etes (?:inscrit|inscrite|reserve|reservee|confirme|confirmee)\b/,
  /\bc'est (?:confirme|reserve|fixe)\b/,
  /\b(?:reserve|confirme|fixe|planifie) pour vous\b/,
  /\bon vous attend\b/,
];

/** True when a model-written reply states that a time is booked or confirmed. */
export function claimsBooking(reply: string): boolean {
  const n = normalizeSpeech(reply);
  return BOOKING_CLAIMS.some((re) => re.test(n));
}
