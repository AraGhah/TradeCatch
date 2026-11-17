/**
 * The exact Bland configuration for the TradeCatch endpoints.
 *
 * Bland custom tools run on Bland's servers. Each tool below is the JSON body
 * for `POST https://api.bland.ai/v1/tools` (fields documented by Bland: name,
 * description, speech, url, method, headers, body, input_schema, timeout). The
 * body fields that are not `{{input.*}}` are Bland system variables that the
 * server fills in, so the model never chooses them:
 *
 *   {{to}}            the number that was dialed  -> which business line this is
 *   {{phone_number}}  the other party's number    -> the caller
 *   {{call_id}}       the call's id               -> idempotency and ownership
 *
 * This module only builds data. It sends nothing to Bland and holds no secret:
 * the Authorization value is a parameter, and what the script prints is a
 * placeholder to replace with Bland's Secrets (or the line token).
 */

export type BlandToolOptions = {
  /** https origin of this deployment, no trailing slash. */
  baseUrl: string;
  /**
   * The Authorization header value. Use a reference to a Bland secret, never a
   * real token in a file you keep. Default is an obvious placeholder.
   */
  authorization?: string;
};

export type BlandToolDefinition = {
  name: string;
  description: string;
  speech?: string;
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Record<string, string>;
  input_schema: {
    type: "object";
    properties: Record<string, { type: "string"; description: string; enum?: string[] }>;
    required: string[];
    example: Record<string, string>;
  };
  timeout: number;
};

export const AUTH_PLACEHOLDER = "Bearer <LINE_TOKEN: reference your Bland Secret>";

/** Sent by every tool: which line, which call, which caller. All system variables. */
const SYSTEM_BODY = {
  number: "{{to}}",
  callId: "{{call_id}}",
  from: "{{phone_number}}",
} as const;

type Prop = { description: string; enum?: string[] };

function tool(
  options: BlandToolOptions,
  input: {
    name: string;
    path: string;
    description: string;
    speech: string;
    fixed?: Record<string, string>;
    properties: Record<string, Prop>;
    required: string[];
    example: Record<string, string>;
    timeout?: number;
  },
): BlandToolDefinition {
  const fromInput = Object.fromEntries(
    Object.keys(input.properties).map((key) => [key, `{{input.${key}}}`]),
  );
  return {
    name: input.name,
    description: input.description,
    ...(input.speech ? { speech: input.speech } : {}),
    url: `${options.baseUrl.replace(/\/+$/, "")}${input.path}`,
    method: "POST",
    headers: {
      Authorization: options.authorization ?? AUTH_PLACEHOLDER,
      "Content-Type": "application/json",
    },
    body: { ...SYSTEM_BODY, ...(input.fixed ?? {}), ...fromInput },
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(input.properties).map(([key, prop]) => [
          key,
          { type: "string" as const, ...prop },
        ]),
      ),
      required: input.required,
      example: input.example,
    },
    // Booking talks to the calendar provider: leave room for it.
    timeout: input.timeout ?? 10_000,
  };
}

const DETAIL_PROPS: Record<string, Prop> = {
  callerName: { description: "The caller's name, as they said it." },
  serviceAddress: {
    description:
      "The full service address: street number, street name, city. Only what the caller confirmed.",
  },
  issue: { description: "The problem or job, in the caller's words." },
  callbackE164: {
    description: "A callback number in international format, only if different from the number they called from.",
  },
  preferredTime: { description: "When the caller would like the visit." },
  message: { description: "A short message for the business owner." },
  email: { description: "The caller's email, only if they gave one." },
};

export function renderBlandTools(options: BlandToolOptions): BlandToolDefinition[] {
  const t = (input: Parameters<typeof tool>[1]) => tool(options, input);
  return [
    t({
      name: "check_availability",
      path: "/api/bland/availability",
      description:
        "Look up real open appointment times. Use before offering any time. Only offer times returned by this tool; if it returns ok false, offer to take a message instead. Never invent a time.",
      speech: "One moment while I check the calendar.",
      properties: {
        preferredTime: { description: "When the caller prefers, in their words (e.g. tomorrow morning)." },
        issue: { description: "What the visit is for, in the caller's words." },
        serviceAddress: { description: "The service address, if already given." },
      },
      required: ["preferredTime", "issue"],
      example: { preferredTime: "tomorrow morning", issue: "leaking kitchen tap", serviceAddress: "123 Rue Principale, Laval" },
    }),
    t({
      name: "book_appointment",
      path: "/api/bland/book",
      description:
        "Book one of the times returned by check_availability. Say the appointment is booked ONLY if the result has booking.status equal to confirmed. If status is taken, offer the times returned. If status is request, error or anything else, say the team will confirm by message, and never say it is booked.",
      speech: "Let me book that for you.",
      properties: {
        startAt: { description: "The chosen start time, exactly as returned by check_availability (ISO 8601)." },
        callerName: { description: "The caller's name." },
        serviceAddress: { description: "Full service address with street number." },
        serviceId: { description: "The service id returned by check_availability, if any." },
        callbackE164: { description: "Callback number in international format, only if different from the caller's own." },
      },
      required: ["startAt", "callerName", "serviceAddress"],
      example: {
        startAt: "2026-11-18T14:00:00.000Z",
        callerName: "Jean Tremblay",
        serviceAddress: "123 Rue Principale, Laval, QC H7N 1A1",
      },
      timeout: 15_000,
    }),
    t({
      name: "find_my_appointments",
      path: "/api/bland/appointments",
      description:
        "Find this caller's upcoming appointments. Needs the name the caller gives; the phone number is the one they are calling from.",
      speech: "Let me look that up.",
      fixed: { action: "find" },
      properties: { callerName: { description: "The name the appointment was booked under." } },
      required: ["callerName"],
      example: { callerName: "Jean Tremblay" },
    }),
    t({
      name: "move_appointment",
      path: "/api/bland/appointments",
      description:
        "Move one of the caller's appointments to a new time. Get new times from check_availability with the appointmentId first. Say it was moved only if result.status equals moved.",
      speech: "Let me move that.",
      fixed: { action: "move" },
      properties: {
        callerName: { description: "The name the appointment was booked under." },
        appointmentId: { description: "The id returned by find_my_appointments." },
        startAt: { description: "The new start time, exactly as returned by check_availability." },
      },
      required: ["callerName", "appointmentId", "startAt"],
      example: { callerName: "Jean Tremblay", appointmentId: "appt_abc123", startAt: "2026-11-19T15:00:00.000Z" },
      timeout: 15_000,
    }),
    t({
      name: "cancel_appointment",
      path: "/api/bland/appointments",
      description:
        "Cancel one of the caller's appointments. Ask the caller to confirm first. Say it was canceled only if result.status equals canceled.",
      speech: "Canceling that now.",
      fixed: { action: "cancel" },
      properties: {
        callerName: { description: "The name the appointment was booked under." },
        appointmentId: { description: "The id returned by find_my_appointments." },
      },
      required: ["callerName", "appointmentId"],
      example: { callerName: "Jean Tremblay", appointmentId: "appt_abc123" },
      timeout: 15_000,
    }),
    t({
      name: "text_me_details",
      path: "/api/bland/appointments",
      description:
        "Text the caller, on the number they are calling from, either the business details or their appointment. Say a text was sent only if result.status equals sent.",
      speech: "Sending that now.",
      fixed: { action: "text" },
      properties: {
        callerName: { description: "The caller's name (needed to text an appointment)." },
        kind: { description: "What to send.", enum: ["business_info", "appointment"] },
        appointmentId: { description: "Only for kind appointment." },
      },
      required: ["kind"],
      example: { kind: "business_info" },
    }),
    t({
      name: "save_caller_details",
      path: "/api/bland/details",
      description:
        "Save details the caller has confirmed so far. Call it whenever the caller confirms their name, address or problem, so nothing is lost if the call drops. Only send what was confirmed.",
      speech: "",
      properties: DETAIL_PROPS,
      required: [],
      example: { callerName: "Jean Tremblay", serviceAddress: "123 Rue Principale, Laval, QC H7N 1A1" },
    }),
    t({
      name: "report_call",
      path: "/api/bland/report",
      description:
        "Report the call. Always call this once, at the end of every call, with everything the caller confirmed. It tells the owner who called and what they need.",
      speech: "",
      properties: {
        ...DETAIL_PROPS,
        intent: {
          description: "What the call was.",
          enum: ["service_request", "appointment", "faq", "transfer", "message", "other"],
        },
        emergency: { description: "true if the caller described an emergency, otherwise false.", enum: ["true", "false"] },
        endReason: {
          description: "How the call ended.",
          enum: ["completed", "caller_hung_up", "silence", "error"],
        },
        transferCompleted: { description: "true if the call was handed to a person.", enum: ["true", "false"] },
        transferTarget: { description: "Who it was handed to (a department or name)." },
      },
      required: ["intent"],
      example: { intent: "service_request", callerName: "Jean Tremblay", issue: "no heat", emergency: "false", endReason: "completed" },
    }),
  ];
}

/** Where each value of the call-start config lands as a Bland variable. */
export const CONFIG_VARIABLES = [
  { name: "tc_answering", data: "$.answering", context: "false means this call must not be handled by the assistant" },
  { name: "tc_business_name", data: "$.config.business.name", context: "the business's name" },
  { name: "tc_receptionist_name", data: "$.config.business.receptionistName", context: "the assistant's own name" },
  { name: "tc_prompt", data: "$.config.prompt", context: "the owner's instructions and the approved facts to answer from" },
  { name: "tc_after_hours", data: "$.config.business.afterHours", context: "true when the office is closed right now" },
  { name: "tc_booking_enabled", data: "$.config.capabilities.booking", context: "true only when real appointment booking works on this call; otherwise never offer a time" },
  { name: "tc_texts_enabled", data: "$.config.capabilities.callerTexts", context: "true only when text_me_details may be used" },
  { name: "tc_transfer_normal", data: "$.config.transfer.normal", context: "number to transfer to for 'talk to a person'; empty means do not transfer" },
  { name: "tc_transfer_backup", data: "$.config.transfer.backup", context: "number to try if the first does not answer" },
  { name: "tc_transfer_emergency", data: "$.config.transfer.emergency", context: "number to transfer emergencies to, at any hour" },
  { name: "tc_policy_kind", data: "$.callerPolicy.kind", context: "set when this caller must not get the assistant" },
  { name: "tc_policy_message", data: "$.callerPolicy.messages[0].text", context: "what to say to that caller before ending the call" },
] as const;

export type BlandInboundSetup = {
  /** Body for POST https://api.bland.ai/v1/inbound/<the Bland number>. */
  dynamic_data: {
    url: string;
    method: "GET";
    headers: Record<string, string>;
    query: Record<string, string>;
    response_data: { name: string; data: string; context: string }[];
    timeout: number;
    cache: boolean;
  }[];
};

export function renderInboundSetup(options: BlandToolOptions): BlandInboundSetup {
  return {
    dynamic_data: [
      {
        url: `${options.baseUrl.replace(/\/+$/, "")}/api/bland/config`,
        method: "GET",
        headers: { Authorization: options.authorization ?? AUTH_PLACEHOLDER },
        query: { number: "{{to}}", from: "{{phone_number}}", callId: "{{call_id}}" },
        response_data: CONFIG_VARIABLES.map((v) => ({ ...v })),
        // Bland's documented default for dynamic data is 2 seconds.
        timeout: 2_000,
        cache: true,
      },
    ],
  };
}
