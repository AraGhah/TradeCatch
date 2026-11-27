import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { wire, buildNodes, sharedPrefix, rewriteLanguage, LANGUAGE_REWRITES, FRENCH_ONLY, CONNECTION_REWRITES, PARAGRAPH_REWRITES, STALE_CONNECTION } = require("../../scripts/bland-pathway-wire.js") as {
  wire: (base: Pathway, built: Record<string, Node>) => Pathway;
  buildNodes: (input: { base: Pathway; host: string; secret: string }) => Record<string, Node>;
  sharedPrefix: (nodes: Node[]) => string;
  rewriteLanguage: (value: unknown, hits: number[], paragraphHits?: number[]) => unknown;
  LANGUAGE_REWRITES: [string, string][];
  FRENCH_ONLY: RegExp;
  CONNECTION_REWRITES: [string, string][];
  PARAGRAPH_REWRITES: [string, string][];
  STALE_CONNECTION: RegExp;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bland node data is free-form JSON
type Node = { id: string; type: string; data: Record<string, any> };
type Edge = { id?: string; source: string; target: string; data?: { label?: string } };
type Pathway = { nodes: Node[]; edges: Edge[] };

// The dashboard pathway's French-only rules, exactly as the script expects them.
const [[FRENCH_RESPONSE_RULE], [FRENCH_LANGUAGE_RULE], [FRENCH_VARIABLE_RULE]] = LANGUAGE_REWRITES;
// The pre-integration guard every step carried, as the script expects it.
const STALE_GUARD =
  "CURRENT CONNECTION STATE: No TradeCatch configuration, customer lookup, dashboard writer, calendar, quote, callback or notification tool is attached. Native cold phone-transfer steps now exist. Other actions remain unconnected. Do not pretend to call a tool. No authenticated TradeCatch integration success is possible in this draft. Do not promise a callback, dispatch, booking, cancellation, SMS or contractor notification.";
const STALE_INTAKE =
  "INTAKE: Clarify the service/problem and urgency first. Before collecting personal information, explain briefly that you can discuss details but cannot submit a request here, ask consent, and wait.";
const STALE_BOOKING =
  "BOOKING CONTRACT: Preferences are not available slots. A future real calendar workflow must gather details. Do not perform these actions in the current unconnected draft.";
const GUARD = `SHARED GUARD LINE ONE.\n${FRENCH_RESPONSE_RULE}\n${STALE_GUARD}\n${STALE_INTAKE}\n`;
const RECEPTION_STAY =
  "Remain only while answering general contractor questions or natural small talk. Release immediately for service intake, booking, transfer or explicit end.";
const SECRET = "s".repeat(48);
const HOST = "https://tradecatch.example";
const DENY_1 = "No authenticated TradeCatch integration success is possible in this draft.";
const DENY_2 =
  "No optional TradeCatch backend integration is currently executable; native transfers are separately gated and disabled by default.";
const NO_CALLBACK =
  "Do not promise a callback, message or dispatch: no callback delivery integration exists. Offer only help that is possible now, without collecting personal details for an undeliverable request.";

function base(): Pathway {
  const conv = (id: string, own: string, type = "Vector DB Knowledge Base"): Node => ({
    id,
    type,
    data: {
      name: id,
      componentId: "reception-task",
      prompt: GUARD + own,
      extractVars: [
        ["caller_name", "string", "name"],
        ["conversation_language", "string", FRENCH_VARIABLE_RULE],
      ],
      ...(id === "reception" ? { condition: RECEPTION_STAY } : {}),
    },
  });
  return {
    nodes: [
      {
        globalConfig: {
          globalPrompt: `Be kind. ${DENY_1} Keep it short. ${DENY_2} ${FRENCH_LANGUAGE_RULE}\n${STALE_GUARD}\n${STALE_BOOKING}\nDATA MINIMIZATION: Never request passwords, authentication codes or payment details in this unconnected draft.`,
        },
      } as unknown as Node,
      { id: "__start", type: "Default", data: { name: "Start", isStart: true } },
      { id: "reception-task", type: "Component", data: { name: "Contractor reception", entryNodeId: "greeting" } },
      { ...conv("greeting", "Greet once."), data: { ...conv("greeting", "Greet once.").data, kbTool: "kb-123" } },
      conv("reception", "Reception instructions."),
      conv("scheduling", "There is no connected calendar: never book."),
      conv("closing", "Anything else?", "Default"),
      conv("emergency", "Emergency."),
      conv("transfer-fallback", `If execution returns here, say you cannot confirm the connection. ${NO_CALLBACK}`),
      { id: "transfer", type: "Route", data: { name: "transfer", componentId: "reception-task" } },
      { id: "transfer-emergency-channel", type: "Route", data: { name: "em", componentId: "reception-task" } },
      {
        id: "transfer-emergency-native",
        type: "Transfer Call",
        data: { name: "te", componentId: "reception-task", transferNumber: "{{tc_emergency_transfer_number}}" },
      },
      { id: "flow-end", type: "Component Exit", data: { name: "end", componentId: "reception-task" } },
      {
        id: "transfer-regular-native",
        type: "Transfer Call",
        data: { name: "t", componentId: "reception-task", transferNumber: "{{tc_regular_transfer_number}}" },
      },
    ],
    edges: [
      { source: "__start", target: "reception-task", data: { label: "Start" } },
      { source: "reception", target: "scheduling", data: { label: "Appointment requested" } },
      { source: "transfer-regular-native", target: "transfer-fallback", data: { label: "If native execution returns" } },
      { source: "reception", target: "transfer", data: { label: "Human / owner / contractor requested" } },
      { source: "emergency", target: "transfer-emergency-channel", data: { label: "Approved emergency transfer after safety" } },
    ],
  };
}

function wired(): Pathway {
  const b = base();
  return wire(b, buildNodes({ base: b, host: HOST, secret: SECRET }));
}

const byId = (p: Pathway, id: string) => p.nodes.find((n) => n.id === id)!;
const globalPrompt = (p: Pathway) =>
  (
    p.nodes.find((n) => (n as unknown as { globalConfig?: unknown }).globalConfig) as unknown as {
      globalConfig: { globalPrompt: string };
    }
  ).globalConfig.globalPrompt;

describe("Bland pathway wiring (scripts/bland-pathway-wire.js)", () => {
  it("answers in the customer's language: no French-only rule survives anywhere", () => {
    const p = wired();
    for (const node of p.nodes) assert.doesNotMatch(JSON.stringify(node), FRENCH_ONLY, node.id ?? "global config");
    const [[, responseRule], [, languageRule], [, variableRule]] = LANGUAGE_REWRITES;
    // Existing steps and the steps the script adds share the same rule.
    for (const id of ["reception", "scheduling", "tc-offer", "tc-collect-details", "tc-booked"]) {
      assert.ok(byId(p, id).data.prompt.includes(responseRule), id);
    }
    assert.ok(globalPrompt(p).includes(languageRule));
    const described = byId(p, "reception").data.extractVars.find((v: string[]) => v[0] === "conversation_language");
    assert.equal(described[2], variableRule);
  });

  it("sends the conversation language so times are read in the customer's language", () => {
    const p = wired();
    for (const hook of p.nodes.filter((n) => n.type === "Webhook" && n.data.method === "POST")) {
      assert.ok(String(hook.data.body).includes('"language": "{{conversation_language}}"'), hook.id);
      // Fixed text cannot follow the language: webhook steps never carry any.
      assert.equal(hook.data.text, undefined, hook.id);
    }
  });

  it("rewrites the language rule inside any value, and counts each rule it applied", () => {
    const hits: number[] = [];
    const out = rewriteLanguage({ a: [FRENCH_RESPONSE_RULE], b: { c: `x ${FRENCH_RESPONSE_RULE}` } }, hits);
    assert.doesNotMatch(JSON.stringify(out), FRENCH_ONLY);
    assert.equal(hits[0], 2);
  });

  it("refuses a pathway whose language rule changed instead of leaving French-only text behind", () => {
    const b = base();
    for (const n of b.nodes) {
      if (n.data?.prompt) n.data.prompt = n.data.prompt.replace(FRENCH_RESPONSE_RULE, "Speak French.");
      if (n.data?.extractVars) n.data.extractVars = [["caller_name", "string", "name"]];
    }
    b.nodes[0] = { globalConfig: { globalPrompt: "Be kind." } } as unknown as Node;
    assert.throws(() => wire(b, buildNodes({ base: base(), host: HOST, secret: SECRET })), /language: expected sentence not found/);
  });

  it("tells every step that the calendar and booking are connected, never that no tool is attached", () => {
    const p = wired();
    const left = p.nodes.find((n) => STALE_CONNECTION.test(JSON.stringify(n)));
    assert.equal(left, undefined, "no 'unconnected draft' text left, global prompt included");
    const [[, connection], [, intake], [, booking]] = PARAGRAPH_REWRITES;
    for (const id of ["reception", "scheduling", "tc-collect-details", "tc-offer"]) {
      const prompt = byId(p, id).data.prompt;
      assert.ok(prompt.includes(connection), id);
      assert.ok(prompt.includes(intake), id);
    }
    const global = globalPrompt(p);
    // Each paragraph is replaced whole, once, on its own line.
    assert.equal(global.split("\n").filter((l) => l === connection).length, 1);
    assert.ok(global.includes(booking));
    assert.match(global, /Only the step that offers openings .* may name an open time/);
    assert.match(global, /never say you are checking or will check the calendar/);
    // The global prompt and the steps say the same thing about success.
    assert.ok(global.includes(CONNECTION_REWRITES[0][1]));
    assert.ok(global.includes(CONNECTION_REWRITES[1][1]));
  });

  it("does not rewrite a paragraph whose label only appears mid-line", () => {
    const hits: number[] = [];
    const text = "Say: INTAKE: is a word here.";
    assert.equal(rewriteLanguage(text, [], hits), text);
    assert.equal(hits.length, 0);
  });

  it("refuses a pathway that still says it is unconnected anywhere the rewrites do not reach", () => {
    const b = base();
    // Reworded and moved off its labelled line: no rule can replace it.
    const scheduling = b.nodes.find((n) => n.id === "scheduling")!;
    scheduling.data.prompt += "\nRemember: do not perform actions in this unconnected draft.";
    assert.throws(
      () => wire(b, buildNodes({ base: base(), host: HOST, secret: SECRET })),
      /connection: the "no TradeCatch tool is attached" guard/,
    );
  });

  it("lets reception hand the caller on: its condition is met by any real request", () => {
    const condition = byId(wired(), "reception").data.condition;
    assert.match(condition, /^Met as soon as the conversation so far/);
    assert.match(condition, /request for a human/);
    assert.match(condition, /new appointment/);
  });

  it("answers the first message in the same turn after loading the configuration", () => {
    const p = wired();
    const load = byId(p, "tc-load-config");
    // It speaks exactly as the greeting would, with the same knowledge base.
    assert.equal(load.data.prompt, byId(p, "greeting").data.prompt);
    assert.equal(load.data.kbTool, "kb-123");
    // The greeting already happened: the component starts where requests are routed.
    assert.equal(byId(p, "reception-task").data.entryNodeId, "reception");
    assert.doesNotMatch(load.data.prompt, FRENCH_ONLY);
    assert.deepEqual(
      load.data.responsePathways.map((r: unknown[]) => [...r.slice(0, 3), (r[3] as { id: string }).id]),
      [
        ["tc_booking_enabled", "==", "true", "reception-task"],
        ["tc_booking_enabled", "==", "false", "reception-task"],
      ],
    );
  });

  it("extracts the guard text every conversational node shares, cut at a line end", () => {
    assert.equal(sharedPrefix(base().nodes), GUARD);
  });

  it("loads the business configuration before the first step, and only from TradeCatch", () => {
    const p = wired();
    const out = p.edges.filter((e) => e.source === "__start");
    assert.deepEqual(out.map((e) => e.target), ["tc-load-config"]);
    assert.ok(p.edges.some((e) => e.source === "tc-load-config" && e.target === "reception-task"));
    const load = byId(p, "tc-load-config");
    assert.equal(load.type, "Webhook");
    assert.equal(load.data.method, "GET");
    assert.ok(String(load.data.url).startsWith(`${HOST}/api/bland/config?`));
    const mapped = Object.fromEntries(load.data.responseData.map((r: { name: string; data: string }) => [r.name, r.data]));
    assert.equal(mapped.tc_regular_transfer_ready, "$.config.transfer_available");
    assert.equal(mapped.tc_regular_transfer_number, "$.config.normal_transfer_number");
    assert.equal(mapped.tc_emergency_transfer_ready, "$.config.emergency_transfer_available");
    assert.equal(mapped.tc_emergency_transfer_number, "$.config.emergency_transfer_number");
    assert.equal(mapped.tc_booking_enabled, "$.config.booking_enabled");
    // Silent: no spoken text before the greeting.
    assert.equal(load.data.text, undefined);
  });

  it("authenticates every TradeCatch call with the tool secret and sends the call identifiers", () => {
    const p = wired();
    const hooks = p.nodes.filter((n) => n.type === "Webhook");
    assert.equal(hooks.length, 9);
    for (const hook of hooks) {
      assert.deepEqual(hook.data.headers, [["Authorization", `Bearer ${SECRET}`]], hook.id);
      assert.ok(String(hook.data.url).startsWith(`${HOST}/api/bland/`), hook.id);
      if (hook.data.method === "POST") {
        const body = JSON.parse(hook.data.body.replace(/\{\{[^}]+\}\}/g, "x"));
        for (const key of ["to", "from", "call_id"]) assert.ok(key in body, `${hook.id} ${key}`);
      }
    }
  });

  it("reaches 'booked' ONLY from a confirmed booking", () => {
    const p = wired();
    const into = p.edges.filter((e) => e.target === "tc-booked").map((e) => e.source).sort();
    assert.deepEqual(into, ["tc-book", "tc-book-retry"]);
    for (const id of ["tc-book", "tc-book-retry"]) {
      const step = byId(p, id);
      const toBooked = step.data.responsePathways.filter((r: unknown[]) => (r[3] as { id: string }).id === "tc-booked");
      assert.deepEqual(toBooked.map((r: unknown[]) => r.slice(0, 3)), [["booking_status", "==", "confirmed"]], id);
    }
    // An error is retried once with the same (idempotent) request; a second
    // error, a timeout or an unknown answer never confirms.
    const firstError = byId(p, "tc-book").data.responsePathways.find((r: unknown[]) => r[2] === "error");
    assert.equal((firstError[3] as { id: string }).id, "tc-book-retry");
    assert.equal(byId(p, "tc-book-retry").data.body, byId(p, "tc-book").data.body, "the retry is the same request");
    const secondError = byId(p, "tc-book-retry").data.responsePathways.find((r: unknown[]) => r[2] === "error");
    assert.equal((secondError[3] as { id: string }).id, "tc-booking-callback");
    const completion = p.edges.find((e) => e.source === "tc-book-retry" && e.data?.label === "API Request Completion");
    assert.equal(completion?.target, "tc-booking-callback");
  });

  it("offers only times the calendar returned, and books the exact chosen startAt", () => {
    const p = wired();
    const offer = byId(p, "tc-offer");
    assert.match(offer.data.prompt, /\{\{availability_offers\}\}/);
    assert.match(offer.data.prompt, /Never name, round or invent/);
    // The pathway's shared guards, with the language rule already fixed.
    assert.ok(offer.data.prompt.startsWith(rewriteLanguage(GUARD, []) as string), "keeps the pathway's shared guards");
    assert.ok(offer.data.extractVars.some((v: string[]) => v[0] === "chosen_start_at"));
    assert.match(byId(p, "tc-book").data.body, /"start_at": "\{\{chosen_start_at\}\}"/);
    const availability = byId(p, "tc-availability");
    const failed = availability.data.responsePathways.find((r: unknown[]) => r[2] === "false");
    assert.equal((failed[3] as { id: string }).id, "tc-booking-callback");
  });

  it("asks the calendar right after one confirmed read-back; the server's refusal falls back to a callback", () => {
    const p = wired();
    // No second collecting step in between: on a yes, scheduling saves the details at once.
    const out = p.edges.filter((e) => e.source === "scheduling").map((e) => e.target);
    assert.ok(out.includes("tc-save-details"));
    assert.ok(!out.includes("tc-collect-details"));
    // tc-collect-details is reached only when the server refused or misses details.
    const intoCollect = p.edges.filter((e) => e.target === "tc-collect-details").map((e) => e.source).sort();
    assert.deepEqual(intoCollect, ["tc-book", "tc-book-retry", "tc-save-details"]);
    // The openings depend on the service address: the calendar is asked only once the details are saved.
    const intoAvailability = p.edges.filter((e) => e.target === "tc-availability").map((e) => e.source).sort();
    assert.deepEqual(intoAvailability, ["tc-offer", "tc-save-details", "tc-taken"]);
    // Only a save that left every booking detail on the call reaches the calendar;
    // "saved" alone is not enough (a save of still-empty variables is "saved" too).
    const save = byId(p, "tc-save-details");
    const branches = save.data.responsePathways.map((r: unknown[]) => [r[0], r[2], (r[3] as { id: string }).id]);
    assert.deepEqual(branches, [
      ["details_ready", "yes", "tc-availability"],
      ["details_ready", "no", "tc-collect-details"],
    ]);
    assert.ok(save.data.responseData.some((r: { name: string; data: string }) => r.name === "details_ready" && r.data === "$.details.ready"));
    assert.match(save.data.prompt, /^If \{\{details_ready\}\} is yes/);
    assert.equal(p.nodes.filter((n) => n.type === "Route" && n.id.startsWith("tc-")).length, 0, "no Route gates of our own");
    const scheduling = byId(p, "scheduling");
    assert.equal(scheduling.type, "Default");
    assert.equal(scheduling.data.kbTool, undefined, "no knowledge base that repeats the old limitation");
    assert.doesNotMatch(scheduling.data.prompt, /no connected calendar/);
    assert.match(scheduling.data.condition, /^Met only when ALL of these are known from the conversation so far/);
    assert.match(scheduling.data.condition, /said yes to that read-back/);
    // It extracts what the save request sends, next to the pathway's own variables.
    const vars = scheduling.data.extractVars.map((v: string[]) => v[0]);
    for (const name of ["caller_name", "use_caller_id", "address_province", "details_confirmed"]) assert.ok(vars.includes(name), name);
    assert.match(scheduling.data.prompt, /ONE read-back/);
    assert.match(scheduling.data.prompt, /never say you are checking or will check the calendar/);
  });

  it("every request for a person goes through a fresh TradeCatch check before any transfer", () => {
    const p = wired();
    assert.equal(p.edges.filter((e) => e.target === "transfer" || e.target === "transfer-emergency-channel").length, 0);
    assert.ok(p.edges.some((e) => e.source === "reception" && e.target === "tc-transfer-check"));
    assert.ok(p.edges.some((e) => e.source === "emergency" && e.target === "tc-emergency-check"));
    for (const [check, ready, number, native] of [
      ["tc-transfer-check", "tc_regular_transfer_ready", "tc_regular_transfer_number", "transfer-regular-native"],
      ["tc-emergency-check", "tc_emergency_transfer_ready", "tc_emergency_transfer_number", "transfer-emergency-native"],
    ] as const) {
      const node = byId(p, check);
      assert.equal(node.type, "Webhook");
      assert.ok(String(node.data.url).startsWith(`${HOST}/api/bland/config?`));
      assert.ok(node.data.responseData.some((r: { name: string }) => r.name === number), check);
      const toNative = node.data.responsePathways.filter((r: unknown[]) => (r[3] as { id: string }).id === native);
      assert.deepEqual(toNative.map((r: unknown[]) => r.slice(0, 3)), [[ready, "==", "true"]], check);
      const completion = p.edges.find((e) => e.source === check && e.data?.label === "API Request Completion");
      assert.equal(completion?.target, "transfer-fallback", check);
      const into = p.edges.filter((e) => e.target === native).map((e) => e.source);
      assert.deepEqual(into, [check], `only ${check} reaches ${native}`);
    }
  });

  it("books only a time the calendar offered after the caller's details were saved", () => {
    const p = wired();
    const intoBook = p.edges.filter((e) => e.target === "tc-book").map((e) => e.source).sort();
    assert.deepEqual(intoBook, ["tc-offer", "tc-taken"]);
    const intoOffer = p.edges.filter((e) => e.target === "tc-offer").map((e) => e.source);
    assert.deepEqual(intoOffer, ["tc-availability"]);
  });

  it("keeps the existing transfer nodes and their fallback to a callback", () => {
    const p = wired();
    assert.equal(byId(p, "transfer-regular-native").data.transferNumber, "{{tc_regular_transfer_number}}");
    assert.ok(p.edges.some((e) => e.source === "transfer-regular-native" && e.target === "transfer-fallback"));
  });

  it("replaces the pathway's 'nothing is connected' rules with the connected ones", () => {
    const p = wired();
    assert.doesNotMatch(globalPrompt(p), /No authenticated TradeCatch integration|No optional TradeCatch backend integration/);
    assert.match(globalPrompt(p), /only when tc_booking_enabled is "true"/);
    assert.match(globalPrompt(p), /^Be kind\. /, "the rest of the global prompt is untouched");
  });

  it("refuses to wire a pathway whose text no longer matches, instead of half-rewriting it", () => {
    const b = base();
    const fallback = b.nodes.find((n) => n.id === "transfer-fallback")!;
    fallback.data.prompt = GUARD + "Edited by hand.";
    assert.throws(() => wire(b, buildNodes({ base: b, host: HOST, secret: SECRET })), /expected sentence not found/);
  });

  it("a failed or unavailable transfer offers a callback that is confirmed only once TradeCatch stored it", () => {
    const p = wired();
    const fallback = byId(p, "transfer-fallback");
    assert.doesNotMatch(fallback.data.prompt, /no callback delivery integration exists/);
    assert.match(fallback.data.prompt, /Never say the callback is arranged before that step confirms it/);
    assert.ok(p.edges.some((e) => e.source === "transfer-fallback" && e.target === "tc-callback-save"));
    assert.ok(p.edges.some((e) => e.source === "tc-booking-callback" && e.target === "tc-callback-save"));
    assert.ok(p.edges.some((e) => e.source === "tc-callback-save" && e.target === "tc-callback-report"));
    const into = p.edges.filter((e) => e.target === "tc-callback-done").map((e) => e.source);
    assert.deepEqual(into, ["tc-callback-report"]);
    const report = byId(p, "tc-callback-report");
    const toDone = report.data.responsePathways.filter((r: unknown[]) => (r[3] as { id: string }).id === "tc-callback-done");
    assert.deepEqual(toDone.map((r: unknown[]) => r.slice(0, 3)), [["callback_recorded", "==", "true"]]);
    const completion = p.edges.find((e) => e.source === "tc-callback-report" && e.data?.label === "API Request Completion");
    assert.equal(completion?.target, "tc-callback-failed");
    assert.match(report.data.body, /"intent": "\{\{callback_intent\}\}"/);
  });

  it("is idempotent: wiring an already wired pathway adds no duplicate steps", () => {
    const once = wired();
    const twice = wire(once, buildNodes({ base: once, host: HOST, secret: SECRET }));
    assert.equal(twice.nodes.length, once.nodes.length);
    assert.equal(twice.edges.length, once.edges.length);
    const ids = twice.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
