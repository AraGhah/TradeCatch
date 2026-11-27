#!/usr/bin/env node
"use strict";
/**
 * Wire a Bland conversational pathway to TradeCatch's booking and transfer API.
 *
 * Why this exists: a Bland pathway built in the dashboard can talk about
 * appointments and has Transfer Call nodes, but it never calls TradeCatch, so
 * it cannot see the calendar, cannot save a booking, and its transfer gates
 * (`tc_regular_transfer_ready`, ...) are never set. This script adds the
 * missing steps as Webhook nodes that call the existing, validated endpoints
 * (docs/BLAND_AI_INTEGRATION.md):
 *
 *   start -> tc-load-config (GET /api/bland/config) -> the existing flow
 *            sets business_name, tc_booking_enabled and the tc_* transfer
 *            variables from the business's real configuration. Nothing else
 *            ever sets them, so a failed load keeps every gate closed.
 *   scheduling (job, time, name, number, address, one read-back) -> tc-save-details (POST /details)
 *     (tc-collect-details only re-asks what the server refused or found missing)
 *            -> tc-availability (POST /availability, with the saved address;
 *            refuses with booking_disabled when phone booking is off)
 *            -> tc-offer -> tc-book (POST /book) -> tc-booked | tc-taken | tc-booking-callback
 *            The agent may only offer times the calendar returned and may only
 *            say "booked" from tc-booked, which is reached only when the
 *            server answered booking_status "confirmed".
 *
 * The transfer nodes already in the pathway are kept; they now receive real
 * values. A transfer that is not completed returns to the existing
 * `transfer-fallback` step, which takes the caller's details for a callback.
 *
 * Usage (reads BLAND_API_KEY and BLAND_TOOL_SECRET from the environment, never
 * prints them):
 *
 *   node scripts/bland-pathway-wire.js --pathway <id> --host https://tradecatch.ca
 *        [--from-version <n>]   base version (default: the production version)
 *        [--promote]            also promote the new version to production
 *        [--persona <id>]       also fix the language rule in that Bland persona's
 *                               prompt (written to its draft; promoted with --promote)
 *
 * Without --promote, live calls are not affected: the new version can be tried
 * with Bland's pathway chat (`pathway_version`) first. Roll back by promoting
 * the previous version number.
 */

const API = "https://api.bland.ai";

/** Node ids this script owns. Re-running replaces them instead of adding copies. */
const OWNED_PREFIX = "tc-";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function bland(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: process.env.BLAND_API_KEY,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    throw new Error(`Bland ${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

/** The text every conversational node of this pathway starts with (guards, language, tone). */
function sharedPrefix(nodes) {
  const prompts = nodes
    .filter((n) => n.data && n.data.componentId && typeof n.data.prompt === "string")
    .map((n) => n.data.prompt);
  if (prompts.length < 2) return "";
  let len = prompts[0].length;
  for (const p of prompts.slice(1)) {
    let i = 0;
    while (i < len && i < p.length && p[i] === prompts[0][i]) i++;
    len = i;
  }
  // Cut at the last full line so a node's own instructions never start mid-sentence.
  const cut = prompts[0].lastIndexOf("\n", len);
  return cut > 0 ? prompts[0].slice(0, cut + 1) : "";
}

// "language" is the conversation's language as the pathway extracts it, so
// times are read back in the customer's language. Before it is known the
// value is empty or the literal "{{conversation_language}}", which the server
// ignores (the business's default language applies).
const BASE_BODY = '"to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}", "language": "{{conversation_language}}"';

/**
 * A Webhook node. Bland answers a webhook node in the same turn only when one of
 * its response pathways matches; a node without one waits silently for the
 * next message (in an SMS, the customer's text would get no answer). `prompt`
 * is what the agent says after the request, in the conversation's language;
 * there is no fixed `text`, because fixed text cannot follow the language.
 */
function webhook({ id, name, path, method = "POST", body, responseData, responsePathways, prompt, timeout = 10000, secret, host, componentId }) {
  const url = host + path;
  return {
    id,
    type: "Webhook",
    data: {
      name,
      ...(componentId ? { componentId } : {}),
      ...(prompt ? { prompt } : {}),
      method,
      url,
      ...(body ? { body } : {}),
      headers: [["Authorization", `Bearer ${secret}`]],
      timeoutValue: Math.round(timeout / 1000),
      retryAttempts: 0,
      responseData,
      ...(responsePathways ? { responsePathways } : {}),
      extractVars: [],
    },
  };
}

const to = (id, name) => ({ id, name });

function buildNodes({ base: original, host, secret }) {
  // The language rule is fixed first, so the steps added here share the new one.
  const base = prepareBase(original).base;
  const C = "reception-task";
  const prefix = sharedPrefix(base.nodes);
  const conv = (id, name, instructions, extra = {}) => ({
    id,
    type: "Default",
    data: { name, componentId: C, prompt: prefix + instructions, extractVars: extra.extractVars || [], ...(extra.condition ? { condition: extra.condition } : {}) },
  });

  const keepVars = (base.nodes.find((n) => n.id === "scheduling") || {}).data?.extractVars || [];
  const withVars = (more) => {
    const names = new Set(more.map((v) => v[0]));
    return [...keepVars.filter((v) => !names.has(v[0])), ...more];
  };

  const loadConfig = webhook({
    id: "tc-load-config",
    name: "TradeCatch — load business configuration",
    method: "GET",
    path: "/api/bland/config?to={{to}}&from={{from}}&call_id={{call_id}}",
    host,
    secret,
    timeout: 8000,
    responseData: [
      { name: "business_name", data: "$.config.business_name", context: "Business name" },
      { name: "tc_booking_enabled", data: "$.config.booking_enabled", context: "\"true\" only when phone booking is on" },
      { name: "tc_regular_transfer_ready", data: "$.config.transfer_available", context: "\"true\" only when a live transfer is allowed now" },
      { name: "tc_regular_transfer_number", data: "$.config.normal_transfer_number", context: "Validated transfer destination" },
      { name: "tc_backup_transfer_number", data: "$.config.backup_transfer_number", context: "Validated backup destination" },
      { name: "tc_emergency_transfer_ready", data: "$.config.emergency_transfer_available", context: "\"true\" only when an emergency transfer is allowed" },
      { name: "tc_emergency_transfer_number", data: "$.config.emergency_transfer_number", context: "Validated emergency destination" },
      { name: "tc_transfer_unavailable_reason", data: "$.config.transfer_unavailable_reason", context: "Why a transfer is unavailable" },
      { name: "tc_after_hours", data: "$.config.after_hours", context: "\"true\" outside business hours" },
      { name: "tc_timezone", data: "$.config.timezone", context: "Business time zone" },
    ],
  });

  // Transfer gates. Bland "Route" nodes never matched in testing (not even with
  // every variable set), and the dashboard pathway's first transfer gate also
  // required a `conversation_channel` variable Bland never sets, so every
  // transfer request ended in the fallback. These checks branch on a webhook
  // response instead (documented `responsePathways`), and re-read the
  // validated numbers from TradeCatch at the moment of the transfer, so the
  // owner's transfer hours apply to the minute.
  const transferCheck = (id, name, readyVar, numberVar, readyPath, numberPath, target) =>
    webhook({
      id,
      name,
      componentId: C,
      method: "GET",
      path: "/api/bland/config?to={{to}}&from={{from}}&call_id={{call_id}}",
      host,
      secret,
      timeout: 8000,
      responseData: [
        { name: readyVar, data: readyPath, context: "\"true\" only when this transfer is allowed now" },
        { name: numberVar, data: numberPath, context: "Validated destination; empty when unusable" },
      ],
      responsePathways: [
        [readyVar, "==", "true", to(target, target)],
        [readyVar, "==", "false", to("transfer-fallback", "Transfer unavailable / unconfirmed — safe help")],
      ],
    });
  const regularCheck = transferCheck(
    "tc-transfer-check",
    "TradeCatch — may this call be transferred now?",
    "tc_regular_transfer_ready",
    "tc_regular_transfer_number",
    "$.config.transfer_available",
    "$.config.normal_transfer_number",
    "transfer-regular-native",
  );
  const emergencyCheck = transferCheck(
    "tc-emergency-check",
    "TradeCatch — may this emergency be transferred now?",
    "tc_emergency_transfer_ready",
    "tc_emergency_transfer_number",
    "$.config.emergency_transfer_available",
    "$.config.emergency_transfer_number",
    "transfer-emergency-native",
  );

  const availability = webhook({
    id: "tc-availability",
    name: "TradeCatch — check real availability",
    componentId: C,
    path: "/api/bland/availability",
    host,
    secret,
    body: `{ ${BASE_BODY}, "preferred_time": "{{appointment_preference}}", "issue": "{{reason_for_call}}" }`,
    responseData: [
      { name: "availability_ok", data: "$.availability.ok", context: "true when real openings were returned" },
      { name: "availability_reason", data: "$.availability.reason", context: "Why no time can be offered" },
      { name: "availability_matches_request", data: "$.availability.matchesRequest", context: "true when the openings match what the caller asked for" },
      { name: "availability_offers", data: "$.availability.offers", context: "The ONLY times that may be offered: label to read aloud, startAt to book" },
      { name: "availability_service_id", data: "$.availability.serviceId", context: "Service to book" },
      { name: "availability_service_name", data: "$.availability.serviceName", context: "Service to book" },
    ],
    responsePathways: [
      ["availability_ok", "==", "true", to("tc-offer", "Offer the real openings")],
      ["availability_ok", "==", "false", to("tc-booking-callback", "Booking not possible now — callback")],
    ],
  });

  const offer = conv(
    "tc-offer",
    "Offer the real openings",
    [
      "BOOKING — OFFER REAL OPENINGS. The calendar returned these openings (JSON): {{availability_offers}}. Matches the caller's request: {{availability_matches_request}}.",
      "If it is false, say briefly that the time asked for is not available, then offer the returned openings instead.",
      "Read at most three labels exactly as written (they are already in the business's time zone). Never name, round or invent any other time, and never say anything is reserved yet.",
      "When the caller picks one, set chosen_start_at to that offer's startAt value copied exactly. If none suit, ask what day or time would suit and update appointment_preference.",
    ].join("\n"),
    { extractVars: withVars([["chosen_start_at", "string", "The exact startAt string of the opening the caller chose from {{availability_offers}}; empty until the caller chooses."]]) },
  );

  const collect = conv(
    "tc-collect-details",
    "Booking — confirm name, callback number and address",
    [
      "BOOKING — DETAILS BEFORE THE CALENDAR. Nothing is booked yet and no time has been offered: the openings depend on the service address, so they are checked right after these details are saved. Last save result: {{details_status}} (missing: {{details_missing}}; address problem: {{address_problem}}; address missing: {{address_missing}}).",
      "Collect only what is still missing: full name; the callback number (ask if the number they are calling from is the right one: if yes, use_caller_id is \"true\"; you cannot see that number, so never say, guess or repeat one the customer did not say); the service address (civic number, street, unit if any, city, province, postal code).",
      "You cannot see the calendar from this step: never name a time, never say a time is available or not, never say you are checking it, and never say the visit is booked or planned. If everything is already known, your reply is the read-back and the question whether it is right, nothing else.",
      "Then read the name, number and full address back ONCE and wait for an explicit yes. Do not say the appointment is booked.",
    ].join("\n"),
    {
      extractVars: withVars(DETAILS_VARS),
      condition:
        "Met only when ALL of these are known from the conversation: full name; callback number (or the customer agreed to use the number they are calling from); civic number, street, city and province; AND you read them back in one sentence AND the customer said yes to that read-back. A yes to a single question (for example about the phone number) is not the final confirmation. Also met at once for a changed intent, a human/transfer request, an emergency, opt-out or an explicit end.",
    },
  );

  const saveDetails = webhook({
    id: "tc-save-details",
    name: "TradeCatch — save confirmed caller details",
    componentId: C,
    path: "/api/bland/details",
    host,
    secret,
    // Spoken while the calendar is checked next (the availability step is silent).
    // "saved" alone is not enough: a save sent before Bland extracted the
    // answers saves nothing and is still "saved". Only ready = yes (every
    // detail booking needs is on the call) goes on to the calendar.
    prompt: "If {{details_ready}} is yes: in the customer's language, say in one short sentence that the details are noted and you are checking the calendar now. Otherwise say nothing.",
    body: `{ ${BASE_BODY}, "caller_name": "{{caller_name}}", "callback_phone": "{{caller_phone}}", "use_caller_id": "{{use_caller_id}}", "street": "{{address_civic_number}} {{address_street}}", "unit": "{{address_unit}}", "city": "{{address_city}}", "province": "{{address_province}}", "postal_code": "{{address_postal_code}}" }`,
    responseData: [
      { name: "details_status", data: "$.details.status", context: "saved or rejected" },
      { name: "details_ready", data: "$.details.ready", context: "yes once every detail booking needs is saved, otherwise no" },
      { name: "details_missing", data: "$.details.missing", context: "What is still needed before booking" },
      { name: "address_problem", data: "$.details.address.problem", context: "Why the address was refused" },
      { name: "address_missing", data: "$.details.address.missing", context: "Address parts still missing" },
    ],
    responsePathways: [
      ["details_ready", "==", "yes", to("tc-availability", "TradeCatch — check real availability")],
      ["details_ready", "==", "no", to("tc-collect-details", "Booking — confirm name, callback number and address")],
    ],
  });

  // The server may finish saving after its own time budget and answer
  // "error" for a booking that exists (seen in production). Repeating the
  // same call is idempotent (same call id and time) and then answers
  // "confirmed", so one retry runs before the caller hears "not booked".
  const bookStep = (id, name, onError) =>
    webhook({
      id,
      name,
      componentId: C,
      path: "/api/bland/book",
      host,
      secret,
      timeout: 20000,
      body: `{ ${BASE_BODY}, "start_at": "{{chosen_start_at}}", "service_id": "{{availability_service_id}}", "service_name": "{{availability_service_name}}" }`,
      responseData: [
        { name: "booking_status", data: "$.booking.status", context: "confirmed, taken, missing_details, details_conflict, request or error" },
        { name: "booking_label", data: "$.booking.label", context: "The booked time to read aloud" },
        { name: "booking_reason", data: "$.booking.reason", context: "Why it was not confirmed" },
        { name: "booking_offers", data: "$.booking.offers", context: "New openings when the time was taken" },
        { name: "booking_missing", data: "$.booking.missing", context: "Details still missing" },
      ],
      responsePathways: [
        ["booking_status", "==", "confirmed", to("tc-booked", "Appointment saved — confirm")],
        ["booking_status", "==", "taken", to("tc-taken", "Time just taken — offer new openings")],
        ["booking_status", "==", "missing_details", to("tc-collect-details", "Booking — confirm name, callback number and address")],
        ["booking_status", "==", "details_conflict", to("tc-collect-details", "Booking — confirm name, callback number and address")],
        ["booking_status", "==", "request", to("tc-booking-callback", "Booking not possible now — callback")],
        ["booking_status", "==", "error", onError],
      ],
    });
  const book = bookStep("tc-book", "TradeCatch — book the chosen time", to("tc-book-retry", "TradeCatch — confirm the booking (retry)"));
  const bookRetry = bookStep("tc-book-retry", "TradeCatch — confirm the booking (retry)", to("tc-booking-callback", "Booking not possible now — callback"));

  const booked = conv(
    "tc-booked",
    "Appointment saved — confirm",
    "BOOKING — CONFIRMED. The calendar saved the appointment: {{booking_label}}. Confirm it once, clearly: the date and time exactly as in that label, and the service address. Say the team will see it in their calendar. Do not offer other times. Then follow the anything-else rule.",
  );

  const taken = conv(
    "tc-taken",
    "Time just taken — offer new openings",
    [
      "BOOKING — TIME TAKEN. Nothing was booked: that time was taken a moment ago. New openings (JSON): {{booking_offers}}.",
      "Apologize briefly, read at most three of these labels exactly, and ask which one suits. Never invent a time.",
      "When the caller picks one, set chosen_start_at to that offer's startAt copied exactly. If none suit, ask what would suit and update appointment_preference.",
    ].join("\n"),
    { extractVars: withVars([["chosen_start_at", "string", "The exact startAt string of the new opening the caller chose from {{booking_offers}}; empty until the caller chooses."]]) },
  );

  const callback = conv(
    "tc-booking-callback",
    "Booking not possible now — callback",
    [
      "BOOKING — NOT CONFIRMED. A live booking cannot be completed on this call (booking on: {{tc_booking_enabled}}; availability: {{availability_reason}}; booking: {{booking_reason}}).",
      "Say plainly that nothing is booked. Offer that the team will call back to confirm a time. If the caller agrees, collect only the missing name, confirmed callback number, service address when needed and the preferred day/time, one question at a time.",
      "Never claim a reservation, a hold or an available slot. Existing appointments route to existing-appointment; danger immediately to emergency.",
    ].join("\n"),
    { extractVars: withVars([]) },
  );

  // Callback: what a caller is told when a transfer is unavailable or not
  // completed, or a booking cannot be confirmed. Only after TradeCatch has
  // stored the caller's confirmed details AND the request may the agent say
  // the team will call back; the receptionist maintenance job then finalizes
  // the call and notifies the owner even if Bland's post-call webhook never
  // arrives (docs/BLAND_AI_INTEGRATION.md, "Post-call webhook").
  const callbackSave = webhook({
    id: "tc-callback-save",
    name: "TradeCatch — save callback contact",
    componentId: C,
    path: "/api/bland/details",
    host,
    secret,
    body: `{ ${BASE_BODY}, "caller_name": "{{caller_name}}", "callback_phone": "{{caller_phone}}", "use_caller_id": "{{use_caller_id}}", "street": "{{address_civic_number}} {{address_street}}", "unit": "{{address_unit}}", "city": "{{address_city}}", "province": "{{address_province}}", "postal_code": "{{address_postal_code}}" }`,
    responseData: [
      { name: "callback_details_status", data: "$.details.status", context: "saved or rejected" },
      { name: "callback_details_missing", data: "$.details.missing", context: "What is still missing" },
    ],
  });

  const callbackReport = webhook({
    id: "tc-callback-report",
    name: "TradeCatch — record callback request",
    componentId: C,
    path: "/api/bland/report",
    host,
    secret,
    body: `{ ${BASE_BODY}, "intent": "{{callback_intent}}", "issue": "{{reason_for_call}}", "preferred_time": "{{appointment_preference}}", "message": "{{callback_message}}", "emergency": "{{urgent}}" }`,
    responseData: [{ name: "callback_recorded", data: "$.report.recorded", context: "true when the request is stored" }],
    responsePathways: [
      ["callback_recorded", "==", "true", to("tc-callback-done", "Callback request saved — confirm")],
      ["callback_recorded", "==", "false", to("tc-callback-failed", "Callback request not saved")],
    ],
  });

  const callbackDone = conv(
    "tc-callback-done",
    "Callback request saved — confirm",
    "CALLBACK — SAVED. The request and the caller's contact were sent to the team. Say briefly that the team will call back at the number confirmed (do not read the number again unless asked) and do not promise a time. Then follow the anything-else rule.",
  );

  const callbackFailed = conv(
    "tc-callback-failed",
    "Callback request not saved",
    "CALLBACK — NOT SAVED. The request could not be sent to the team. Apologize briefly, say it could not be saved right now, and suggest calling back a little later. Never say a callback is arranged. If anyone is in danger, safety and 911 advice comes first.",
  );

  return { loadConfig, regularCheck, emergencyCheck, availability, offer, collect, saveDetails, book, bookRetry, booked, taken, callback, callbackSave, callbackReport, callbackDone, callbackFailed };
}

/**
 * Sentences of a dashboard-built pathway that deny any TradeCatch connection.
 * Each is replaced by the connected rule; a missing sentence is reported (the
 * pathway was edited by hand) instead of silently skipped.
 */
const GLOBAL_REWRITES = [
  [
    "No authenticated TradeCatch integration success is possible in this draft.",
    "TradeCatch is connected only through this pathway's TradeCatch steps (business configuration, availability, booking, caller details, callback request); only a result those steps return counts as success. CALENDAR: you never see the calendar yourself. Only the step that offers openings (it is given the calendar's own labels) may name an open time, and only the confirmation step may say a visit is booked. Everywhere else never name a time as open, never say a time is free, full or taken, never say you are checking or will check the calendar, and never say a visit is booked or planned.",
  ],
  [
    "No optional TradeCatch backend integration is currently executable; native transfers are separately gated and disabled by default.",
    "Calendar booking happens only through the booking steps and only when tc_booking_enabled is \"true\"; a live transfer happens only after TradeCatch confirms, at that moment, that it is allowed and gives the destination.",
  ],
];

const TRANSFER_FALLBACK_REWRITES = [
  [
    "Do not promise a callback, message or dispatch: no callback delivery integration exists. Offer only help that is possible now, without collecting personal details for an undeliverable request.",
    "Offer a callback from the team instead. If the caller wants one, collect only what is missing (full name, the callback number: ask if the number they are calling from is right, and in a few words what it is about), read it back once and wait for a yes; the next step sends it to the team. Never say the callback is arranged before that step confirms it, never promise a time, and never promise dispatch.",
  ],
];

/**
 * The dashboard pathway answered in French unless the caller explicitly asked
 * for English, so an English text or call got French replies. The rule is now
 * "reply in the customer's language". Each sentence must be found at least
 * once in the pathway; afterwards none of FRENCH_ONLY may remain anywhere.
 */
const LANGUAGE_REWRITES = [
  [
    "RESPONSE LANGUAGE — REQUIRED BEFORE EVERY REPLY: Use French unless the conversation contains an explicit request to speak English. Keep that selected language until another explicit language request. How are you?, hello, OK, thanks, an English sentence, an address and transcription noise do not request English. In a French conversation, How are you? MUST receive Je vais très bien, merci! Et vous? in French. ONLY after a request such as Can we speak English? may How are you? receive I’m doing well, thank you! How about you? in English. After English is explicitly selected, French words or Merci do not switch back. A language request changes language only, never intent or collected details.",
    "RESPONSE LANGUAGE — REQUIRED BEFORE EVERY REPLY: Reply in the language of the customer's most recent full sentence, French or English: a question or sentence in English gets an English reply, one in French gets a French reply, even when the knowledge base, these instructions or your earlier replies are in French (translate the facts). Single words (OK, merci, thanks, oui, yes), names, addresses, numbers and transcription noise do not change the language: keep the current one. Only the very first greeting, before the customer has said anything, is in French. A language change changes the language only, never the intent or the details already collected.",
  ],
  [
    "LANGUAGE: French is the default, using natural Canadian French and vous. Switch to English ONLY when the caller clearly and explicitly requests English (for example, Can we speak English? or En anglais, s’il vous plaît). Keep the selected language for the rest of the call until another explicit language request. An English word, an English sentence without a language request, a proper name, an address or a transcription error is NOT a language-switch request.",
    "LANGUAGE: Reply in the customer's language, French (natural Canadian French, vous) or English, decided from the customer's own sentences. Keep it for the rest of the conversation until the customer clearly switches or asks to change. An isolated word, a proper name, an address or a transcription error is NOT a language change. Before the customer has said anything, greet in French.",
  ],
  [
    "From the entire call history, French by default. English only after an explicit request to speak English; thereafter retain English until an explicit French request. Never infer a switch from isolated words, ordinary English speech or transcription errors.",
    "\"fr\" or \"en\": the language of the customer's own sentences (\"fr\" before the customer has said anything). It changes when the customer clearly switches or asks to; isolated words, names, addresses and transcription errors never change it.",
  ],
  ["(French unless English was explicitly requested)", "(the customer's language)"],
  ["Follow the explicit-request-only language policy.", "Follow the RESPONSE LANGUAGE rule."],
];
const FRENCH_ONLY = /French unless|explicit request to speak English|French by default|explicit-request-only|French is the default|explicitly requests English/;

/**
 * The dashboard pathway was written as a draft with nothing connected. Its
 * global prompt (seen by every step) and the INTAKE rule copied into most
 * steps said that no calendar or TradeCatch tool exists, that no request can
 * be submitted and that no appointment may ever be confirmed. The model then
 * either refused to book ("je n'ai pas accès à l'agenda", "je ne peux pas le
 * confirmer ici") or, told it could book, invented openings. These paragraphs
 * are replaced whole, by their label, with what is really connected: the steps
 * do the work, and only a step's result may be quoted.
 */
const CONNECTION_PARAGRAPH = [
  "CURRENT CONNECTION STATE:",
  GLOBAL_REWRITES[0][1],
  "Those steps run on their own as soon as the current step has what it needs. Never pretend to call a tool.",
  "When {{tc_booking_enabled}} is true, booking is available: never say it is impossible, that you cannot see the calendar or that you cannot submit a request; collect what the current step asks for. When it is false, say once that this assistant does not book appointments and offer a callback request instead.",
  "Customer lookup, quotes and sending texts are not connected: for those, say so in one short sentence and offer what you can do.",
  "Never promise a transfer connection; describe an attempt only at a ready native transfer step.",
  "Never claim 'saved', 'sent', 'submitted', 'booked', 'j'ai noté', 'dans le dossier' or an equivalent without the matching step's successful result in this conversation.",
].join(" ");

const PARAGRAPH_REWRITES = [
  ["CURRENT CONNECTION STATE:", CONNECTION_PARAGRAPH],
  [
    "INTAKE:",
    "INTAKE: Clarify the service/problem and urgency first. Then collect only what the current step needs and is still missing (full name, callback number, service address, problem, urgency, preferred time), one question at a time; never make it a condition for answering a general question. Do not ask for payment data, passwords or unnecessary personal information. Acknowledge with Merci/Thank you, not je note or I have noted: details count as saved only after the step that saves them succeeds. If the customer declines to give details, keep helping without them.",
  ],
  [
    "BOOKING CONTRACT:",
    "BOOKING CONTRACT: A preferred time is not an available slot. Openings come only from the calendar step, in the business's time zone, after the customer's details are saved; offer only those, exactly as labelled. Book only the opening the customer explicitly chose; an appointment is booked only when the booking step answers confirmed. A timeout, an error or an unknown result is not a booking: say it could not be confirmed and offer a callback. Rescheduling and cancellation are not done here: offer a callback from the team.",
  ],
];

/** Single sentences of the same draft, outside those paragraphs. */
const CONNECTION_REWRITES = [
  // Same sentence and replacement as the global prompt's rule, so both agree.
  GLOBAL_REWRITES[0],
  [
    "Never request passwords, authentication codes or payment details in this unconnected draft.",
    "Never request passwords, authentication codes or payment details.",
  ],
  [
    "There is no booking tool in this draft, so never claim an appointment is confirmed.",
    "Only the booking step's confirmed result makes an appointment booked.",
  ],
];
const STALE_CONNECTION =
  /No TradeCatch configuration, customer lookup|No authenticated TradeCatch integration success|unconnected draft|cannot submit a request here|no booking tool in this draft|A future real calendar workflow|after hearing no request can be sent/;

/** Replaces every line that starts with a PARAGRAPH_REWRITES label; counts hits per label. */
function rewriteParagraphs(text, hits) {
  return text
    .split("\n")
    .map((line) => {
      const i = PARAGRAPH_REWRITES.findIndex(([label]) => line.startsWith(label));
      if (i < 0 || line === PARAGRAPH_REWRITES[i][1]) return line;
      hits[i] = (hits[i] || 0) + 1;
      return PARAGRAPH_REWRITES[i][1];
    })
    .join("\n");
}

/** What the save-details request needs beyond the pathway's own variables. */
const DETAILS_VARS = [
  ["use_caller_id", "string", "\"true\" only if the caller said to use the number they are calling from, otherwise \"false\"."],
  ["address_province", "string", "Province of the service address as confirmed (name or QC/ON/...); empty if not given."],
  ["details_confirmed", "string", "\"true\" only after the caller explicitly confirmed the read-back of name, number and address."],
];

/** Scheduling ends with one confirmed read-back of everything the calendar needs. */
const SCHEDULING_CONDITION =
  "Met only when ALL of these are known from the conversation so far (any earlier message): what needs to be done; when the customer would like the visit (a day, a time or first available); full name; callback number (or the customer agreed to use the number they are calling from); civic number, street, city and province; AND you read them back in one reply AND the customer said yes to that read-back. A yes to a single question (for example about the address alone) is not that confirmation. Also met at once for a changed intent, an existing appointment, a human/transfer request, an emergency, opt-out or an explicit end.";

/** Reception kept every caller: Bland leaves a node only once its condition is met. */
const RECEPTION_CONDITION_OLD = "Remain only while answering general contractor questions or natural small talk.";
const RECEPTION_CONDITION =
  "Met as soon as the conversation so far (any earlier message, not only the latest) contains a need other than a general question or small talk: a new appointment or availability, a plumbing problem to fix, a request for a human, the owner or a transfer, an emergency, a quote, an existing appointment, a callback, or ending the call. Not met while the caller only asks general questions about the business, makes small talk, thanks you, or asks to change language.";

/**
 * Applies LANGUAGE_REWRITES, CONNECTION_REWRITES and PARAGRAPH_REWRITES to every
 * string under `value`; counts hits per sentence rule (and per paragraph label).
 */
function rewriteLanguage(value, hits, paragraphHits = []) {
  if (typeof value === "string") {
    let out = value;
    [...LANGUAGE_REWRITES, ...CONNECTION_REWRITES].forEach(([from, into], i) => {
      if (out.includes(from)) {
        hits[i] = (hits[i] || 0) + 1;
        out = out.split(from).join(into);
      }
    });
    return rewriteParagraphs(out, paragraphHits);
  }
  if (Array.isArray(value)) return value.map((v) => rewriteLanguage(v, hits, paragraphHits));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteLanguage(v, hits, paragraphHits)]));
  }
  return value;
}

/** The base pathway with the language and reception fixes, or the list of problems. */
function prepareBase(base) {
  const hits = [];
  const nodes = base.nodes.map((n) => rewriteLanguage(n, hits));
  const problems = [];
  const alreadyDone = JSON.stringify(nodes).includes(LANGUAGE_REWRITES[0][1]);
  LANGUAGE_REWRITES.slice(0, 3).forEach(([from], i) => {
    if (!hits[i] && !alreadyDone) problems.push(`language: expected sentence not found: "${from.slice(0, 60)}..."`);
  });
  const left = nodes.find((n) => FRENCH_ONLY.test(JSON.stringify(n.data)));
  if (left) problems.push(`language: a French-only rule is still in node "${left.id}"`);
  // The global prompt lives outside `data`, so the whole node is searched.
  const stale = nodes.find((n) => STALE_CONNECTION.test(JSON.stringify(n)));
  if (stale) {
    problems.push(`connection: the "no TradeCatch tool is attached" guard is still in node "${stale.id || "global prompt"}"`);
  }
  const reception = nodes.find((n) => n.id === "reception");
  if (!reception) problems.push("No 'reception' node in the base pathway.");
  else if (reception.data.condition !== RECEPTION_CONDITION) {
    if (!String(reception.data.condition || "").startsWith(RECEPTION_CONDITION_OLD)) {
      problems.push("reception: its condition changed since this script was written");
    }
    reception.data.condition = RECEPTION_CONDITION;
  }
  return { base: { ...base, nodes }, problems };
}

function rewrite(text, pairs, where, problems) {
  let out = text;
  for (const [from, into] of pairs) {
    if (out.includes(into)) continue;
    if (!out.includes(from)) {
      problems.push(`${where}: expected sentence not found: "${from.slice(0, 60)}..."`);
      continue;
    }
    out = out.split(from).join(into);
  }
  return out;
}

const CALLBACK_VARS = [
  ["callback_intent", "string", "\"transfer\" if the caller wanted a person, \"appointment\" if they wanted to book, otherwise \"message\"."],
  ["callback_message", "string", "In a few words, what the caller wants the team to call back about; empty if not said."],
  ["use_caller_id", "string", "\"true\" only if the caller said to use the number they are calling from, otherwise \"false\"."],
];

function edge(id, source, target, label, description) {
  return { id, source, target, type: "custom", data: { label, ...(description ? { description } : {}) } };
}

function wire(original, built) {
  const prepared = prepareBase(original);
  if (prepared.problems.length) throw new Error("Pathway text changed since this script was written:\n" + prepared.problems.join("\n"));
  const base = prepared.base;
  const nodes = base.nodes.filter((n) => !String(n.id).startsWith(OWNED_PREFIX)).map((n) => JSON.parse(JSON.stringify(n)));
  // On a pathway this script already wired, the pathway's own edges into the
  // transfer checks are mapped back to the original gates first, so they are
  // kept (and redirected again below) instead of being dropped with ours.
  const restored = base.edges.map((e) => {
    if (String(e.source).startsWith(OWNED_PREFIX)) return e;
    if (e.target === "tc-transfer-check") return { ...e, target: "transfer" };
    if (e.target === "tc-emergency-check") return { ...e, target: "transfer-emergency-channel" };
    return e;
  });
  let edges = restored.filter(
    (e) => !String(e.source).startsWith(OWNED_PREFIX) && !String(e.target).startsWith(OWNED_PREFIX),
  );

  const start = nodes.find((n) => n.data && n.data.isStart);
  if (!start) throw new Error("No start node in the base pathway.");
  // On a pathway this script already wired, the first real step is the one
  // after tc-load-config.
  const previousLoad = base.edges.find((e) => e.source === "tc-load-config");
  const startOut = edges.filter((e) => e.source === start.id);
  if (!previousLoad && startOut.length !== 1) {
    throw new Error(`Expected one edge out of the start node, found ${startOut.length}.`);
  }
  const firstStep = previousLoad ? previousLoad.target : startOut[0].target;

  // The scheduling step no longer refuses: it collects the request, then hands
  // off to the availability check. Its shared guards are kept untouched.
  const scheduling = nodes.find((n) => n.id === "scheduling");
  if (!scheduling) throw new Error("No 'scheduling' node in the base pathway.");
  const prefix = sharedPrefix(base.nodes);
  // A plain conversational step: the knowledge base it used to read states the
  // old "no calendar" limitation, and its loop condition kept the caller here
  // "after the limitation is explained".
  scheduling.type = "Default";
  delete scheduling.data.kbTool;
  scheduling.data.loopConditionType = "prompt";
  // One step gathers everything the calendar needs and ends with a single
  // read-back. Handing the caller to a second collecting step stalled: the
  // model announced "je vais vérifier", the next step had nothing left to ask
  // and filled the gap with an invented answer. On a "yes" this step goes
  // straight to saving the details, which runs into the calendar check and the
  // real offer in the same turn.
  scheduling.data.condition = SCHEDULING_CONDITION;
  scheduling.data.name = "Availability and booking — connected";
  const own = new Set((scheduling.data.extractVars || []).map((v) => v[0]));
  scheduling.data.extractVars = [...(scheduling.data.extractVars || []), ...DETAILS_VARS.filter((v) => !own.has(v[0]))];
  scheduling.data.prompt =
    prefix +
    [
      "BOOKING. The business's real calendar is checked by the next steps, right after the customer confirms the details below; you never see it yourself.",
      "Collect, one question at a time and only what is still missing: what the job is (reason_for_call); when the customer would like the visit (appointment_preference; \"first available\" is fine); full name; the callback number (ask if the number they are calling from is the right one: if yes, use_caller_id is \"true\"; you cannot see that number, so never say, guess or repeat a number the customer did not say); the service address (civic number, street, unit if any, city, province, postal code).",
      "When everything is known, your reply is ONE read-back of the job, the preferred time, the name, the number and the full address, ending with the question whether it is all correct. Nothing else in that reply.",
      "Opening hours and appointment length are not available slots. Never name a time as open, never say a time is free or taken, never say you are checking or will check the calendar, and never say the visit is booked.",
      "Existing appointments route to existing-appointment; danger immediately to emergency; topic changes return to reception.",
    ].join("\n");

  const problems = [];
  for (const node of nodes) {
    if (node.globalConfig && typeof node.globalConfig.globalPrompt === "string") {
      node.globalConfig.globalPrompt = rewrite(node.globalConfig.globalPrompt, GLOBAL_REWRITES, "globalPrompt", problems);
    }
  }
  const transferFallback = nodes.find((n) => n.id === "transfer-fallback");
  if (transferFallback) {
    transferFallback.data.prompt = rewrite(transferFallback.data.prompt, TRANSFER_FALLBACK_REWRITES, "transfer-fallback", problems);
    const names = new Set((transferFallback.data.extractVars || []).map((v) => v[0]));
    for (const v of CALLBACK_VARS) if (!names.has(v[0])) transferFallback.data.extractVars = [...(transferFallback.data.extractVars || []), v];
  }
  if (problems.length) throw new Error("Pathway text changed since this script was written:\n" + problems.join("\n"));

  const b = built;
  b.callback.data.extractVars = [...b.callback.data.extractVars.filter((v) => !CALLBACK_VARS.some((c) => c[0] === v[0])), ...CALLBACK_VARS];
  nodes.push(b.loadConfig, b.regularCheck, b.emergencyCheck, b.availability, b.offer, b.collect, b.saveDetails, b.book, b.bookRetry, b.booked, b.taken, b.callback, b.callbackSave, b.callbackReport, b.callbackDone, b.callbackFailed);

  edges = edges.filter((e) => !startOut.includes(e));
  for (const e of edges) {
    if (e.target === "transfer") e.target = "tc-transfer-check";
    if (e.target === "transfer-emergency-channel") e.target = "tc-emergency-check";
  }
  // Answer in the same turn: without a matching response pathway Bland waits
  // for another message before the first step speaks.
  const first = nodes.find((n) => n.id === firstStep);
  // Bland compares as text and "$.ok" arrives as a boolean, so the branch keys on
  // booking_enabled, which the server always sends as "true" or "false".
  const next = to(firstStep, (first && first.data && first.data.name) || firstStep);
  // The load step answers the customer's first message itself (an SMS starts
  // with one), exactly as the greeting would: same instructions, same knowledge
  // base. A webhook step speaks its prompt after the request, so the greeting
  // can name the business it just loaded.
  const greeting = nodes.find((n) => n.id === "greeting");
  if (!greeting) throw new Error("No 'greeting' node in the base pathway.");
  b.loadConfig.data.prompt = greeting.data.prompt;
  if (greeting.data.kbTool) b.loadConfig.data.kbTool = greeting.data.kbTool;
  b.loadConfig.data.extractVars = greeting.data.extractVars || [];
  // ...so the component starts at reception: the customer's next message (the
  // request, on a call) reaches the step that routes it, instead of a second
  // greeting step that would hold it for one more turn.
  const component = nodes.find((n) => n.id === firstStep && n.type === "Component");
  if (component && component.data.entryNodeId === "greeting") component.data.entryNodeId = "reception";
  b.loadConfig.data.responsePathways = [
    ["tc_booking_enabled", "==", "true", next],
    ["tc_booking_enabled", "==", "false", next],
  ];
  edges.push(
    edge("tc-e-start", start.id, b.loadConfig.id, "Start"),
    edge("tc-e-config-loaded", b.loadConfig.id, firstStep, (first && first.data && first.data.name) || firstStep),
    edge("tc-e-config-done", b.loadConfig.id, firstStep, "API Request Completion"),
    // Bland picks an exit by reading the latest message; the request is often
    // several messages back, so this exit describes the state, not a message.
    edge(
      "tc-e-sched-save",
      "scheduling",
      b.saveDetails.id,
      "Customer confirmed the read-back — save the details and check the calendar",
      "You read back the job, preferred time, name, callback number and full address in one reply, and the customer's latest message says it is correct (yes, oui, c'est ça, correct). Take this at once; never answer the customer yourself first.",
    ),
    edge("tc-e-tcheck-native", b.regularCheck.id, "transfer-regular-native", "transfer-regular-native"),
    edge("tc-e-tcheck-fallback", b.regularCheck.id, "transfer-fallback", "API Request Completion"),
    edge("tc-e-echeck-native", b.emergencyCheck.id, "transfer-emergency-native", "transfer-emergency-native"),
    edge("tc-e-echeck-fallback", b.emergencyCheck.id, "transfer-fallback", "API Request Completion"),
    edge("tc-e-avail-offer", b.availability.id, b.offer.id, "Offer the real openings"),
    edge("tc-e-avail-cb", b.availability.id, b.callback.id, "API Request Completion"),
    edge("tc-e-offer-book", b.offer.id, b.book.id, "Caller chose one of the offered times"),
    edge("tc-e-offer-avail", b.offer.id, b.availability.id, "Caller wants a different day or time"),
    edge("tc-e-offer-close", b.offer.id, "closing", "Caller does not want to book"),
    edge("tc-e-collect-save", b.collect.id, b.saveDetails.id, "Caller confirmed the read-back of name, number and address"),
    edge("tc-e-save-avail", b.saveDetails.id, b.availability.id, "Details saved"),
    edge("tc-e-save-collect", b.saveDetails.id, b.collect.id, "API Request Completion"),
    edge("tc-e-book-booked", b.book.id, b.booked.id, "Appointment saved — confirm"),
    edge("tc-e-book-taken", b.book.id, b.taken.id, "Time just taken — offer new openings"),
    edge("tc-e-book-collect", b.book.id, b.collect.id, "Details missing or in conflict"),
    edge("tc-e-book-retry", b.book.id, b.bookRetry.id, "API Request Completion"),
    edge("tc-e-retry-booked", b.bookRetry.id, b.booked.id, "Appointment saved — confirm"),
    edge("tc-e-retry-taken", b.bookRetry.id, b.taken.id, "Time just taken — offer new openings"),
    edge("tc-e-retry-collect", b.bookRetry.id, b.collect.id, "Details missing or in conflict"),
    edge("tc-e-retry-cb", b.bookRetry.id, b.callback.id, "API Request Completion"),
    edge("tc-e-taken-book", b.taken.id, b.book.id, "Caller chose one of the new openings"),
    edge("tc-e-taken-avail", b.taken.id, b.availability.id, "Caller wants a different day or time"),
    edge("tc-e-booked-close", b.booked.id, "closing", "Confirmation given"),
    edge("tc-e-booked-reception", b.booked.id, "reception", "Different question"),
    edge("tc-e-cb-save", b.callback.id, b.callbackSave.id, "Caller wants a callback and confirmed name and callback number"),
    edge("tc-e-tf-save", "transfer-fallback", b.callbackSave.id, "Caller wants a callback and confirmed name and callback number"),
    edge("tc-e-cbsave-report", b.callbackSave.id, b.callbackReport.id, "API Request Completion"),
    edge("tc-e-cbreport-done", b.callbackReport.id, b.callbackDone.id, "Callback request saved — confirm"),
    edge("tc-e-cbreport-failed", b.callbackReport.id, b.callbackFailed.id, "API Request Completion"),
    edge("tc-e-cbdone-close", b.callbackDone.id, "closing", "Confirmation given"),
    edge("tc-e-cbdone-reception", b.callbackDone.id, "reception", "Different question"),
    edge("tc-e-cbfailed-close", b.callbackFailed.id, "closing", "Task discussion complete"),
    edge("tc-e-cbfailed-emergency", b.callbackFailed.id, "emergency", "Immediate urgency or danger"),
    edge("tc-e-cb-close", b.callback.id, "closing", "Task discussion complete"),
    edge("tc-e-cb-reception", b.callback.id, "reception", "Changed intent or further question"),
    edge("tc-e-cb-emergency", b.callback.id, "emergency", "Immediate urgency or danger"),
    edge("tc-e-cb-end", b.callback.id, "flow-end", "Immediate end"),
  );
  for (const target of ["reception", "emergency", "flow-end", "tc-transfer-check"]) {
    for (const source of [b.offer.id, b.collect.id, b.taken.id]) {
      const label = { reception: "Changed intent or further question", emergency: "Immediate urgency or danger", "flow-end": "Immediate end", "tc-transfer-check": "Human / owner / contractor requested" }[target];
      edges.push(edge(`tc-e-${source.slice(3)}-${target.replace(/^tc-/, "")}`, source, target, label));
    }
  }
  return { nodes, edges };
}

/**
 * A persona's prompt is used on every call and text to its numbers, next to the
 * pathway, and carries the same French-only rule. The production prompt is
 * fixed and written to the draft (only the prompt differs between the two, or
 * this refuses), then promoted when asked.
 */
async function fixPersona(personaId, promote) {
  const res = await bland("GET", `/v1/personas/${personaId}`);
  const persona = res.data || res;
  const prod = persona.current_production_version;
  const draft = persona.current_draft_version;
  if (!prod || !draft) throw new Error("The persona has no production or draft version.");
  const IGNORED = new Set(["id", "version_type", "version_number", "created_at", "updated_at", "promoted_from_version_id", "promoted_at", "promoted_by", "personality_prompt"]);
  const differs = [...new Set([...Object.keys(prod), ...Object.keys(draft)])].filter(
    (k) => !IGNORED.has(k) && JSON.stringify(prod[k]) !== JSON.stringify(draft[k]),
  );
  if (differs.length) throw new Error(`The persona draft differs from production in ${differs.join(", ")}; promote or discard it first.`);
  const hits = [];
  const fixed = rewriteLanguage(String(prod.personality_prompt || ""), hits);
  if (FRENCH_ONLY.test(fixed)) throw new Error("A French-only rule is still in the persona prompt.");
  await bland("PATCH", `/v1/personas/${personaId}`, { name: persona.name, personality_prompt: fixed });
  console.log(JSON.stringify({ persona: personaId, languageRulesRewritten: hits.reduce((a, n) => a + (n || 0), 0), draftUpdated: true }));
  if (promote) {
    await bland("POST", `/v1/personas/${personaId}/versions/promote`);
    console.log(JSON.stringify({ persona: personaId, promoted: true }));
  }
}

async function main() {
  const pathwayId = arg("--pathway");
  const host = (arg("--host", "") || "").replace(/\/+$/, "");
  if (!pathwayId || !/^https:\/\/[a-z0-9.-]+$/i.test(host)) {
    throw new Error("Usage: --pathway <id> --host https://your-tradecatch-host [--from-version n] [--promote]");
  }
  if (!process.env.BLAND_API_KEY) throw new Error("BLAND_API_KEY is not set.");
  const secret = process.env.BLAND_TOOL_SECRET || "";
  if (secret.length < 32) throw new Error("BLAND_TOOL_SECRET is missing or too short.");

  const current = await bland("GET", `/v1/pathway/${pathwayId}`);
  const live = current.data || current;
  const fromVersion = Number(arg("--from-version", live.production_version_number));
  const baseRes = await bland("GET", `/v1/pathway/${pathwayId}/version/${fromVersion}`);
  const base = baseRes.data || baseRes;
  if (!Array.isArray(base.nodes) || !Array.isArray(base.edges)) throw new Error("Base version has no nodes/edges.");

  const { nodes, edges } = wire(base, buildNodes({ base, host, secret }));
  const created = await bland("POST", `/v1/pathway/${pathwayId}/version`, {
    name: `TradeCatch booking + transfer (from v${fromVersion})`,
    nodes,
    edges,
  });
  const version = created.data?.version_number;
  console.log(JSON.stringify({ pathwayId, fromVersion, newVersion: version, nodes: nodes.length, edges: edges.length }));
  const personaId = arg("--persona");
  if (personaId) await fixPersona(personaId, process.argv.includes("--promote"));
  if (process.argv.includes("--promote")) {
    if (!version) throw new Error("No version number returned; not promoting.");
    const promoted = await bland("POST", `/v1/pathway/${pathwayId}/publish`, { version_id: version, environment: "production" });
    console.log(JSON.stringify({ promoted: version, message: promoted.message }));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error.message || error).replace(/Bearer\s+\S+/g, "Bearer [redacted]"));
    process.exit(1);
  });
}

module.exports = {
  sharedPrefix,
  buildNodes,
  wire,
  prepareBase,
  rewriteLanguage,
  LANGUAGE_REWRITES,
  FRENCH_ONLY,
  CONNECTION_REWRITES,
  PARAGRAPH_REWRITES,
  STALE_CONNECTION,
};
