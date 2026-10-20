import type { Organization } from "@/product/saas/types";
import { getCrmRuntime } from "@/product/crm/runtime";
import { getSchedulingStore } from "@/product/scheduling/runtime";
import { getGrowthStore } from "@/product/growth/runtime";
import { getStarterStore } from "@/product/starter/runtime";
import { getMissedCallReadStore } from "@/product/missed-call/runtime";
import { getReceptionistReadStore } from "@/product/receptionist/runtime";
import { getSupportService } from "@/product/support/runtime";
import { EXPORT_LIMITS, type ExportSource, type SourceResult } from "./archive";
import type { ExportRow } from "./csv";

const N = EXPORT_LIMITS.rows + 1;
const fields = (text: string) => text.split(" ");
function pick(row: object, columns: readonly string[]): ExportRow {
  const result: ExportRow = {};
  const record = row as Record<string, unknown>;
  for (const key of columns) {
    const value = record[key];
    if (
      value != null &&
      !["string", "number", "boolean"].includes(typeof value)
    )
      throw new Error("Invalid export field");
    result[key] = value as ExportRow[string];
  }
  return result;
}
function scoped<T extends object>(rows: T[], key: string, id: string): T[] {
  if (rows.some((row) => (row as Record<string, unknown>)[key] !== id))
    throw new Error("Invalid source scope");
  return rows;
}
function memo<T>(read: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => (pending ??= Promise.resolve().then(read));
}

export async function collectChildren<
  P extends { id: string },
  C extends object,
>(
  parents: P[],
  read: (parent: P, limit: number) => Promise<{ rows: C[]; capped?: boolean }>,
  project: (row: C, parent: P) => ExportRow,
  signal?: AbortSignal,
): Promise<SourceResult> {
  const rows: ExportRow[] = [];
  const warnings: string[] = [];
  let failed = 0,
    visited = 0;
  if (parents.length > EXPORT_LIMITS.parents) warnings.push("parent_limit");
  for (const parent of parents.slice(0, EXPORT_LIMITS.parents)) {
    if (signal?.aborted) break;
    visited++;
    try {
      const children = await read(parent, N - rows.length);
      if (children.capped) warnings.push("child_limit:" + parent.id);
      for (const child of children.rows) {
        rows.push(project(child, parent));
        if (rows.length >= N) break;
      }
    } catch {
      failed++;
      warnings.push("child_unavailable:" + parent.id);
    }
    if (rows.length >= N) {
      warnings.push("row_limit");
      break;
    }
  }
  return {
    rows,
    warnings,
    status:
      failed === visited && visited > 0 && rows.length === 0
        ? "failed"
        : warnings.length
          ? "partial"
          : undefined,
  };
}

/** Each getter runs inside its source's error boundary, never at factory time. */
export function accountExportSources(org: Organization): ExportSource[] {
  const id = org.id,
    client = org.missedCallClientId;
  const crm = () => getCrmRuntime().store;
  const conv = memo(async () =>
    scoped(await crm().listConversations(id, N), "organizationId", id),
  );
  const calls = memo(async () =>
    client
      ? scoped(
          await getReceptionistReadStore().listSessions({
            clientAccountId: client,
            limit: N,
          }),
          "clientAccountId",
          client,
        )
      : [],
  );
  const missed = memo(async () =>
    client
      ? scoped(
          await getMissedCallReadStore().listLeads(client, N),
          "clientAccountId",
          client,
        )
      : [],
  );
  const quotes = memo(async () =>
    scoped(
      await getStarterStore().listQuoteThreads(id, N),
      "organizationId",
      id,
    ),
  );
  const support = () => getSupportService();
  const tickets = memo(async () =>
    scoped(await support().list(id, N), "organizationId", id),
  );
  const noPhone = () =>
    !client ? { rows: [], notApplicable: "no_linked_phone_client" } : undefined;
  function source<T extends object>(
    name: string,
    description: string,
    columns: string,
    read: () => Promise<T[]>,
    phones: string = "",
  ): ExportSource {
    const keys = fields(columns);
    return {
      name,
      description,
      columns: keys,
      phones: phones ? fields(phones) : [],
      load: async () => ({
        rows: (await read()).map((row) => pick(row, keys)),
      }),
    };
  }
  const orgColumns =
    "id name slug status industry phoneE164 city serviceArea timezone localeDefault accountType createdAt updatedAt";
  const conversationColumns =
    "id customerId leadId channel control lastMessageAt createdAt updatedAt";
  const callColumns =
    "id callSid fromE164 toE164 language status intent outcome afterHours durationSeconds startedAt endedAt transcriptPurgedAt";
  const missedColumns =
    "id workflowId callId callerE164 customerName serviceAddress issueDescription outcome humanReviewRequired becameBooking estimatedValue finalValue createdAt updatedAt";
  const sources: ExportSource[] = [
    source(
      "quote_threads",
      "Customer quote follow-up threads; not Stripe billing",
      "id customerPhoneE164 customerName quoteRef quoteAmount quoteSentAt locale status stopReason conversationMode lastCustomerReplyAt createdAt updatedAt",
      quotes,
      "customerPhoneE164",
    ),
    {
      name: "quote_messages",
      description: "Customer quote follow-up messages",
      columns: fields("id threadId direction body at"),
      load: async (signal) =>
        collectChildren(
          await quotes(),
          async (parent) => ({
            rows: (await getStarterStore().listQuoteMessages(parent.id, N)).map(
              (row) => {
                if (row.threadId !== parent.id) throw Error("Invalid parent");
                return row;
              },
            ),
          }),
          (row) => pick(row, fields("id threadId direction body at")),
          signal,
        ),
    },
    source(
      "organization",
      "Business profile; no credentials or billing records",
      orgColumns,
      async () => [org],
      "phoneE164",
    ),
    source(
      "customers",
      "CRM customers, including customers with no leads",
      "id firstName lastName displayName phoneE164 email serviceAddress preferredLanguage allowSms allowEmail firstContactAt lastContactAt notes createdAt updatedAt",
      async () =>
        scoped(await crm().listCustomers(id, N), "organizationId", id),
      "phoneE164",
    ),
    source(
      "leads",
      "Unified CRM leads",
      "id customerId source service description location priority status assignedToUserId assignedToName callSessionId callSid missedCallLeadId websiteLeadId conversationId urgencyNote createdAt updatedAt",
      async () => {
        const rows = [];
        for (let offset = 0; rows.length < N; offset += 200) {
          const page = scoped(
            await crm().listLeads(id, { limit: 200, offset }),
            "organizationId",
            id,
          );
          rows.push(...page);
          if (page.length < 200) break;
        }
        return rows.slice(0, N);
      },
    ),
    source(
      "website_leads",
      "Original website lead records; may overlap unified leads",
      "id name email phoneE164 message serviceRequested status conversationMode consentAt consentWording createdAt updatedAt",
      async () =>
        scoped(
          await getStarterStore().listWebsiteLeads(id, N),
          "organizationId",
          id,
        ),
      "phoneE164",
    ),
    {
      ...source(
        "missed_call_leads",
        "Original missed-call lead records; may overlap unified leads",
        missedColumns,
        missed,
        "callerE164",
      ),
      load: async () =>
        noPhone() ?? {
          rows: (await missed()).map((row) => pick(row, fields(missedColumns))),
        },
    },
    source(
      "appointments",
      "Current scheduling appointments",
      "id customerName customerPhoneE164 customerEmail serviceAddress serviceId serviceName technicianId technicianName leadId startAt endAt timezone status bookingSource appointmentKind cancelReason simulated holdExpiresAt createdAt updatedAt",
      async () =>
        scoped(
          await getSchedulingStore().listAppointments(id, N),
          "organizationId",
          id,
        ),
      "customerPhoneE164",
    ),
    source(
      "legacy_appointments",
      "Older Growth appointment records; may overlap scheduling appointments",
      "id customerName customerPhoneE164 customerEmail title startsAt endsAt status source sourceRefId notes createdAt updatedAt",
      async () =>
        scoped(
          await getGrowthStore().listAppointments(id, N),
          "organizationId",
          id,
        ),
      "customerPhoneE164",
    ),
    {
      ...source(
        "calls",
        "AI receptionist call metadata; excludes audio URLs, notification credentials and system context",
        callColumns,
        calls,
        "fromE164 toE164",
      ),
      load: async () =>
        noPhone() ?? {
          rows: (await calls()).map((row) => ({
            ...pick(row, fields(callColumns)),
            summary: row.summary?.headline ?? null,
            issue: row.summary?.issue ?? null,
            callerName: row.summary?.callerName ?? null,
          })),
        },
      columns: [...fields(callColumns), "summary", "issue", "callerName"],
    },
    {
      ...source(
        "missed_calls",
        "Stored missed-call metadata, including calls with no lead",
        "id callerE164 calledAt disposition durationSeconds twilioCallSid",
        async () =>
          client
            ? scoped(
                await getMissedCallReadStore().listCalls(client, N),
                "clientAccountId",
                client,
              )
            : [],
        "callerE164",
      ),
      load: async () =>
        noPhone() ?? {
          rows: scoped(
            await getMissedCallReadStore().listCalls(client!, N),
            "clientAccountId",
            client!,
          ).map((row) =>
            pick(
              row,
              fields(
                "id callerE164 calledAt disposition durationSeconds twilioCallSid",
              ),
            ),
          ),
        },
    },
    source(
      "conversations",
      "Unified CRM conversation metadata; SMS and call channels only",
      conversationColumns,
      conv,
    ),
    {
      name: "conversation_messages",
      description:
        "Stored CRM SMS/call messages for exported conversation parents; no connected-mailbox data",
      columns: fields(
        "id conversationId direction body fromE164 toE164 automated deliveryStatus simulated at",
      ),
      phones: fields("fromE164 toE164"),
      load: async (signal) =>
        collectChildren(
          await conv(),
          async (parent) => ({
            rows: scoped(
              await crm().listMessages(id, parent.id, N),
              "organizationId",
              id,
            ).map((row) => {
              if (row.conversationId !== parent.id)
                throw Error("Invalid message parent");
              return row;
            }),
          }),
          (row) =>
            pick(
              row,
              fields(
                "id conversationId direction body fromE164 toE164 automated deliveryStatus simulated at",
              ),
            ),
          signal,
        ),
    },
    {
      name: "call_transcripts",
      description:
        "Retained caller/agent turns; excludes system prompts and audio",
      columns: fields("callId at speaker text"),
      load: async (signal) =>
        noPhone() ??
        (await collectChildren(
          await calls(),
          async (call) => ({
            rows: call.turns.filter((turn) => turn.speaker !== "system"),
          }),
          (turn, call) => ({
            callId: call.id,
            ...pick(turn, fields("at speaker text")),
          }),
          signal,
        )),
    },
    {
      name: "missed_call_messages",
      description:
        "Stored customer recovery conversation messages; excludes technician messages and media",
      columns: fields("leadId at direction fromE164 toE164 body"),
      phones: fields("fromE164 toE164"),
      load: async (signal) =>
        noPhone() ??
        (await collectChildren(
          await missed(),
          async (lead) => ({
            rows: lead.conversation.filter(
              (m) =>
                m.actor !== "technician" &&
                m.fromE164 !== "system" &&
                (m.fromE164 === lead.callerE164 ||
                  m.toE164 === lead.callerE164),
            ),
          }),
          (message, lead) => ({
            leadId: lead.id,
            ...pick(message, fields("at direction fromE164 toE164 body")),
          }),
          signal,
        )),
    },
    source(
      "support_tickets",
      "Customer-visible support ticket fields; no internal assignments or notes",
      "id subject category kind description priority status contactEmail relatedCallId createdAt updatedAt",
      tickets,
    ),
    {
      name: "support_messages",
      description:
        "Customer-visible support replies; internal notes are excluded",
      columns: fields("id ticketId authorRole body createdAt"),
      load: async (signal) =>
        collectChildren(
          await tickets(),
          async (ticket) => {
            const result = await support().forBusiness(id, ticket.id, N);
            return {
              rows: result.messages.filter((m) => !m.internal),
              capped: result.capped,
            };
          },
          (row) => pick(row, fields("id ticketId authorRole body createdAt")),
          signal,
        ),
    },
    source(
      "account_requests",
      "Account deletion, suspension and reactivation requests",
      "id kind status phoneRouting createdAt",
      async () =>
        scoped(await support().accountRequests(id, N), "organizationId", id),
    ),
  ];
  return sources;
}
