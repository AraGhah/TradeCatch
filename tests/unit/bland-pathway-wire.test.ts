import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { wire, buildNodes, sharedPrefix } = require("../../scripts/bland-pathway-wire.js") as {
  wire: (base: Pathway, built: Record<string, Node>) => Pathway;
  buildNodes: (input: { base: Pathway; host: string; secret: string }) => Record<string, Node>;
  sharedPrefix: (nodes: Node[]) => string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bland node data is free-form JSON
type Node = { id: string; type: string; data: Record<string, any> };
type Edge = { id?: string; source: string; target: string; data?: { label?: string } };
type Pathway = { nodes: Node[]; edges: Edge[] };

const GUARD = "SHARED GUARD LINE ONE.\nSHARED GUARD LINE TWO.\n";
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
    data: { name: id, componentId: "reception-task", prompt: GUARD + own, extractVars: [["caller_name", "string", "name"]] },
  });
  return {
    nodes: [
      { globalConfig: { globalPrompt: `Be kind. ${DENY_1} Keep it short. ${DENY_2}` } } as unknown as Node,
      { id: "__start", type: "Default", data: { name: "Start", isStart: true } },
      { id: "reception-task", type: "Component", data: { name: "Contractor reception" } },
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
    assert.ok(offer.data.prompt.startsWith(GUARD), "keeps the pathway's shared guards");
    assert.ok(offer.data.extractVars.some((v: string[]) => v[0] === "chosen_start_at"));
    assert.match(byId(p, "tc-book").data.body, /"start_at": "\{\{chosen_start_at\}\}"/);
    const availability = byId(p, "tc-availability");
    const failed = availability.data.responsePathways.find((r: unknown[]) => r[2] === "false");
    assert.equal((failed[3] as { id: string }).id, "tc-booking-callback");
  });

  it("asks the calendar as soon as the job and time are known; the server's refusal falls back to a callback", () => {
    const p = wired();
    assert.ok(p.edges.some((e) => e.source === "scheduling" && e.target === "tc-collect-details"));
    // The openings depend on the service address: the calendar is asked only once the details are saved.
    const intoAvailability = p.edges.filter((e) => e.target === "tc-availability").map((e) => e.source).sort();
    assert.deepEqual(intoAvailability, ["tc-offer", "tc-save-details", "tc-taken"]);
    const saved = byId(p, "tc-save-details").data.responsePathways.find((r: unknown[]) => r[2] === "saved");
    assert.equal((saved[3] as { id: string }).id, "tc-availability");
    assert.equal(p.nodes.filter((n) => n.type === "Route" && n.id.startsWith("tc-")).length, 0, "no Route gates of our own");
    const scheduling = byId(p, "scheduling");
    assert.equal(scheduling.type, "Default");
    assert.equal(scheduling.data.kbTool, undefined, "no knowledge base that repeats the old limitation");
    assert.doesNotMatch(scheduling.data.prompt, /no connected calendar/);
    assert.match(scheduling.data.condition, /release at once/);
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
