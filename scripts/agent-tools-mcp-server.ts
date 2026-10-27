#!/usr/bin/env node
/**
 * MCP server exposing the agent-tools typed tool layer (send_sms, get_lead,
 * update_lead, get_business_hours, get_calendar_slots, create_booking,
 * notify_owner) so any MCP-compatible agent runtime (Claude Agent SDK,
 * Claude Code, etc.) can call them without touching Postgres/Twilio
 * directly. Every call still goes through `withAgentRun`, so it is logged
 * to `agent_runs` exactly like a call made from in-process TypeScript.
 *
 *   npx tsx scripts/agent-tools-mcp-server.ts
 */
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createBooking,
  getBusinessHours,
  getCalendarSlots,
  getLead,
  notifyOwner,
  sendSms,
  updateLead,
  withAgentRun,
} from "../src/product/agent-tools/tools";

const ROOT = path.join(import.meta.dirname, "..");
loadEnvConfig(ROOT, process.env.NODE_ENV !== "production");

const server = new McpServer({
  name: "tradecatch-agent-tools",
  version: "0.1.0",
});

/** Every tool call runs inside `withAgentRun` so it lands in `agent_runs`
 * under the calling agent's name — passed by the MCP client as the first
 * `_agent` field on each call, defaulting to "mcp-client" when absent. */
function registerTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  run: (input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
) {
  // The SDK's own generics can't be driven from a wrapper like this one —
  // `inputSchema` is cast at this one boundary so every call site above
  // keeps full type safety on `shape` and `run`.
  const callback = async (rawInput: Record<string, unknown>) => {
    const { _agent, _organizationId, ...rest } = rawInput as Record<
      string,
      unknown
    > & { _agent?: string; _organizationId?: string };
    const typedInput = rest as z.infer<z.ZodObject<Shape>>;
    try {
      const result = await withAgentRun(
        {
          agentName: _agent ?? "mcp-client",
          trigger: `mcp:${name}`,
          organizationId: _organizationId ?? null,
          input: typedInput,
        },
        async (log) => {
          const started = Date.now();
          const output = await run(typedInput);
          log({
            tool: name,
            input: typedInput,
            output,
            durationMs: Date.now() - started,
          });
          return output;
        },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  };

  server.registerTool(
    name,
    { description, inputSchema: shape },
    callback as never,
  );
}

const agentMeta = {
  _agent: z.string().optional().describe("Name of the calling agent, for the agent_runs audit log."),
  _organizationId: z.string().optional().describe("Tenant organization id, for the agent_runs audit log."),
};

registerTool(
  "send_sms",
  "Send an SMS to a customer. Refuses to send if the customer's last inbound message was a STOP/opt-out reply.",
  {
    ...agentMeta,
    to: z.string().describe("E.164 phone number, e.g. +15145550100"),
    body: z.string(),
    lastInboundBody: z
      .string()
      .optional()
      .describe("The customer's most recent inbound message, if any — checked for opt-out."),
  },
  (input) => sendSms(input),
);

registerTool(
  "get_lead",
  "Fetch a lead by id for the given organization.",
  { ...agentMeta, organizationId: z.string(), leadId: z.string() },
  (input) => getLead(input.organizationId, input.leadId),
);

registerTool(
  "update_lead",
  "Update a lead's status, priority, service, description, location, or assignment.",
  {
    ...agentMeta,
    organizationId: z.string(),
    leadId: z.string(),
    status: z.string().optional(),
    priority: z.string().optional(),
    service: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    assignedToUserId: z.string().nullable().optional(),
    assignedToName: z.string().nullable().optional(),
    actor: z.string().optional(),
  },
  (input) => updateLead(input.organizationId, input.leadId, input),
);

registerTool(
  "get_business_hours",
  "Fetch the organization's scheduling rules (hours, timezone, holidays, booking windows).",
  { ...agentMeta, organizationId: z.string() },
  (input) => getBusinessHours(input.organizationId),
);

registerTool(
  "get_calendar_slots",
  "List open calendar slots for a service within an organization.",
  {
    ...agentMeta,
    organizationId: z.string(),
    serviceId: z.string().optional(),
    from: z.string().optional(),
    until: z.string().optional(),
    serviceAddress: z.string().optional(),
    technicianId: z.string().optional(),
  },
  (input) => getCalendarSlots(input),
);

registerTool(
  "create_booking",
  "Book an appointment. Reserves the slot through the scheduling service — conflict-safe and idempotent.",
  {
    ...agentMeta,
    organizationId: z.string(),
    serviceId: z.string().optional(),
    serviceName: z.string().optional(),
    startAt: z.string(),
    customerName: z.string().optional(),
    customerPhoneE164: z.string().optional(),
    customerEmail: z.string().optional(),
    serviceAddress: z.string().optional(),
    technicianId: z.string().optional(),
    leadId: z.string().optional(),
    source: z.enum(["ai_receptionist", "manual", "dashboard", "simulation"]),
    idempotencyKey: z.string().optional(),
    simulated: z.boolean().optional(),
    requestIfUnavailable: z.boolean().optional(),
  },
  (input) => createBooking(input),
);

registerTool(
  "notify_owner",
  "Queue an owner notification (email/SMS per their preferences). Best-effort — never throws on delivery failure.",
  {
    ...agentMeta,
    organizationId: z.string(),
    type: z.string(),
    idempotencyKey: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
  },
  (input) => notifyOwner(input as Parameters<typeof notifyOwner>[0]),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[agent-tools-mcp] listening on stdio");
}

main().catch((error) => {
  console.error("[agent-tools-mcp] fatal", error);
  process.exit(1);
});
