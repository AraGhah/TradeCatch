import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { EmailAutomationError } from "@/product/email-automation/services";
import {
  getEmailAutomationServices,
  getEmailAutomationStore,
} from "@/product/email-automation/runtime";

export const dynamic = "force-dynamic";

const varsSchema = z
  .record(z.string().max(40), z.string().max(500))
  .default({});

const schemas = {
  "save-template": z.object({
    action: z.literal("save-template"),
    id: z.string().optional(),
    name: z.string().min(1).max(120),
    locale: z.enum(["fr", "en"]),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20_000),
  }),
  "save-sequence": z.object({
    action: z.literal("save-sequence"),
    id: z.string().optional(),
    name: z.string().min(1).max(120),
    steps: z
      .array(
        z.object({
          templateId: z.string().min(1),
          delayHours: z.number().min(0).max(2160),
        }),
      )
      .min(1)
      .max(10),
    stopOnReply: z.boolean().default(true),
    active: z.boolean().default(true),
  }),
  enroll: z.object({
    action: z.literal("enroll"),
    sequenceId: z.string().min(1),
    email: z.string().email(),
    name: z.string().max(120).optional(),
    vars: varsSchema,
    source: z.string().max(40).optional(),
    sourceRefId: z.string().max(120).optional(),
  }),
  stop: z.object({
    action: z.literal("stop"),
    enrollmentId: z.string().min(1),
  }),
  "set-auto-enroll": z.object({
    action: z.literal("set-auto-enroll"),
    sequenceId: z.string().min(1).nullable(),
  }),
  "mark-replied": z.object({
    action: z.literal("mark-replied"),
    email: z.string().email(),
  }),
  unsubscribe: z.object({
    action: z.literal("unsubscribe"),
    email: z.string().email(),
  }),
  preview: z.object({
    action: z.literal("preview"),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20_000),
    name: z.string().max(120).optional(),
    email: z.string().email().optional(),
    vars: varsSchema,
  }),
} as const;

type Action = keyof typeof schemas;

const ERROR_STATUS: Record<EmailAutomationError["code"], number> = {
  invalid_template: 400,
  invalid_steps: 400,
  unknown_template: 404,
  unknown_sequence: 404,
  sequence_inactive: 409,
  suppressed: 409,
  already_enrolled: 409,
};

async function auth() {
  const result = await requireTenantContext();
  if (!result.ok) return { error: unauthorizedTenantResponse(result.error) };
  if (!tenantHasFeature(result.ctx, "EMAIL_AUTOMATION")) {
    return { error: forbiddenFeatureResponse("EMAIL_AUTOMATION") };
  }
  return { orgId: result.ctx.organization.id };
}

export async function GET() {
  const a = await auth();
  if ("error" in a) return a.error;

  const services = getEmailAutomationServices();
  await services.ensureDefaults(a.orgId);
  const store = getEmailAutomationStore();
  const [templates, sequences, enrollments, settings] = await Promise.all([
    store.listTemplates(a.orgId),
    store.listSequences(a.orgId),
    store.listEnrollments(a.orgId, 200),
    store.getOrgSettings(a.orgId),
  ]);
  return NextResponse.json({
    ok: true,
    templates,
    sequences,
    enrollments,
    settings,
  });
}

export async function POST(request: NextRequest) {
  const a = await auth();
  if ("error" in a) return a.error;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const action = (
    typeof json === "object" && json && "action" in json
      ? String((json as { action?: unknown }).action)
      : ""
  ) as Action;
  const schema = schemas[action];
  if (!schema) {
    return NextResponse.json(
      { error: `action must be one of: ${Object.keys(schemas).join(", ")}` },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const services = getEmailAutomationServices();
  const orgId = a.orgId;
  const data = parsed.data;

  try {
    switch (data.action) {
      case "save-template":
        return NextResponse.json({
          ok: true,
          template: await services.saveTemplate({
            organizationId: orgId,
            ...data,
          }),
        });
      case "save-sequence":
        return NextResponse.json({
          ok: true,
          sequence: await services.saveSequence({
            organizationId: orgId,
            ...data,
          }),
        });
      case "enroll":
        return NextResponse.json({
          ok: true,
          enrollment: await services.enroll({ organizationId: orgId, ...data }),
        });
      case "set-auto-enroll":
        return NextResponse.json({
          ok: true,
          settings: await services.setAutoEnroll(orgId, data.sequenceId),
        });
      case "stop":
        return NextResponse.json({
          ok: true,
          enrollment: await services.stop(orgId, data.enrollmentId),
        });
      case "mark-replied":
        return NextResponse.json({
          ok: true,
          stopped: await services.markReplied(orgId, data.email),
        });
      case "unsubscribe":
        return NextResponse.json({
          ok: true,
          stopped: await services.unsubscribe(orgId, data.email),
        });
      case "preview":
        return NextResponse.json({
          ok: true,
          preview: await services.preview({ organizationId: orgId, ...data }),
        });
    }
  } catch (err) {
    if (err instanceof EmailAutomationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: ERROR_STATUS[err.code] },
      );
    }
    throw err;
  }
}
