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
 *   scheduling -> tc-collect-details -> tc-save-details (POST /details)
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

// No "language": the business's default applies. A Bland variable that was
// never set arrives as its literal "{{name}}" text.
const BASE_BODY = '"to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}"';

function webhook({ id, name, path, method = "POST", body, responseData, responsePathways, text, timeout = 10000, secret, host, componentId }) {
  const url = host + path;
  return {
    id,
    type: "Webhook",
    data: {
      name,
      ...(componentId ? { componentId } : {}),
      ...(text ? { text } : {}),
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

function buildNodes({ base, host, secret }) {
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
    text: "Un instant, je regarde l'horaire.",
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
      "Collect only what is still missing: full name; the callback number (ask if the number they are calling from is the right one: if yes, use_caller_id is \"true\"); the service address (civic number, street, unit if any, city, province, postal code).",
      "Then read the name, number and full address back ONCE and wait for an explicit yes. Do not say the appointment is booked.",
    ].join("\n"),
    {
      extractVars: withVars([
        ["use_caller_id", "string", "\"true\" only if the caller said to use the number they are calling from, otherwise \"false\"."],
        ["address_province", "string", "Province of the service address as confirmed (name or QC/ON/...); empty if not given."],
        ["details_confirmed", "string", "\"true\" only after the caller explicitly confirmed the read-back of name, number and address."],
      ]),
      condition:
        "Remain until ALL of these are known: full name, callback number (or the caller agreed to use the number they are calling from), civic number, street, city and province; AND you read them back in one sentence AND the caller said yes to that read-back. A yes to a single question (for example about the phone number) is not the final confirmation. Release early only for a changed intent, a human/transfer request, an emergency, opt-out or an explicit end.",
    },
  );

  const saveDetails = webhook({
    id: "tc-save-details",
    name: "TradeCatch — save confirmed caller details",
    componentId: C,
    path: "/api/bland/details",
    host,
    secret,
    body: `{ ${BASE_BODY}, "caller_name": "{{caller_name}}", "callback_phone": "{{caller_phone}}", "use_caller_id": "{{use_caller_id}}", "street": "{{address_civic_number}} {{address_street}}", "unit": "{{address_unit}}", "city": "{{address_city}}", "province": "{{address_province}}", "postal_code": "{{address_postal_code}}" }`,
    responseData: [
      { name: "details_status", data: "$.details.status", context: "saved or rejected" },
      { name: "details_missing", data: "$.details.missing", context: "What is still needed before booking" },
      { name: "address_problem", data: "$.details.address.problem", context: "Why the address was refused" },
      { name: "address_missing", data: "$.details.address.missing", context: "Address parts still missing" },
    ],
    responsePathways: [
      ["details_status", "==", "saved", to("tc-availability", "TradeCatch — check real availability")],
      ["details_status", "==", "rejected", to("tc-collect-details", "Booking — confirm name, callback number and address")],
    ],
  });

  // The server may finish saving after its own time budget and answer
  // "error" for a booking that exists (seen in production). Repeating the
  // same call is idempotent (same call id and time) and then answers
  // "confirmed", so one retry runs before the caller hears "not booked".
  const bookStep = (id, name, text, onError) =>
    webhook({
      id,
      name,
      componentId: C,
      path: "/api/bland/book",
      host,
      secret,
      text,
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
  const book = bookStep("tc-book", "TradeCatch — book the chosen time", "Parfait, je réserve ce moment.", to("tc-book-retry", "TradeCatch — confirm the booking (retry)"));
  const bookRetry = bookStep("tc-book-retry", "TradeCatch — confirm the booking (retry)", "Un instant, je vérifie que c'est bien enregistré.", to("tc-booking-callback", "Booking not possible now — callback"));

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
    "TradeCatch is connected only through this pathway's TradeCatch steps (business configuration, availability, booking, caller details, callback request); only a result those steps return counts as success.",
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

function edge(id, source, target, label) {
  return { id, source, target, type: "custom", data: { label } };
}

function wire(base, built) {
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
  scheduling.data.condition =
    "Remain only until both the job (what needs to be done) and the caller's preferred day or time (or 'first available') are known; then release at once to confirm the caller's details, then the real availability. Release immediately for a changed intent, an existing appointment, a human/transfer request, an emergency, opt-out or an explicit end. A correction, a language request or small talk is answered here without restarting.";
  scheduling.data.name = "Availability and booking — connected";
  scheduling.data.prompt =
    prefix +
    [
      "BOOKING. You can check the business's real calendar and book, but only through the booking steps that follow; you never know availability yourself.",
      "Collect, one question at a time and only if missing: what the job is (reason_for_call) and when the caller would like the visit (appointment_preference; \"first available\" is fine). Opening hours and appointment length are not available slots: never name a time here.",
      "As soon as both are known, move on: the caller's name, callback number and service address are confirmed next, because the real openings depend on the address. Never name a time before the calendar answered.",
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
  edges.push(
    edge("tc-e-start", start.id, b.loadConfig.id, "Start"),
    edge("tc-e-config-done", b.loadConfig.id, firstStep, "API Request Completion"),
    edge("tc-e-sched-collect", "scheduling", b.collect.id, "Caller gave the job and a preferred time (or wants the first opening)"),
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

module.exports = { sharedPrefix, buildNodes, wire };
