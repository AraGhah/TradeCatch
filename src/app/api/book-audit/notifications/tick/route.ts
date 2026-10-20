import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processBookAuditNotifications } from "@/lib/book-audit-notifications";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { BodyTooLargeError, readBodyText } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const schema = z.object({
  leadId: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export async function POST(request: NextRequest) {
  const retrySecret = process.env.BOOK_AUDIT_RETRY_SECRET?.trim();
  const retryAuthorized =
    Boolean(retrySecret) &&
    authorizeOpsRequest(request, {
      ...process.env,
      MISSED_CALL_OPS_SECRET: undefined,
      CRON_SECRET: retrySecret,
    });
  if (!retryAuthorized && !authorizeOpsRequest(request))
    return unauthorizedOpsResponse();
  if (logOpsAccess(request, "book-audit.notifications.tick").missingActor)
    return missingOpsActorResponse();
  let data: unknown;
  try {
    // OpenNext can represent a bodyless scheduled POST as an empty stream.
    // Treat both forms as default options, while still bounding nonempty input.
    const body = await readBodyText(request, 2048);
    data = body.trim() ? JSON.parse(body) : {};
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof BodyTooLargeError
            ? "Payload too large"
            : "Invalid JSON",
      },
      { status: error instanceof BodyTooLargeError ? 413 : 400 },
    );
  }
  const input = schema.safeParse(data);
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid retry options" },
      { status: 400 },
    );
  try {
    const result = await processBookAuditNotifications(input.data);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    console.error("[book-audit] notification worker unavailable");
    return NextResponse.json(
      { error: "Notification queue is unavailable" },
      { status: 503 },
    );
  }
}

export const GET = POST;
