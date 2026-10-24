import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import { getClientIp } from "@/lib/rate-limit";
import { originSchema } from "@/product/installations/model";
import { installationRegistry } from "@/product/installations/registry";

export const dynamic = "force-dynamic";
const schema = z
  .object({ installationId: z.uuid(), origin: originSchema })
  .strict();
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
export async function POST(request: Request) {
  const secret = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!secret)
    return NextResponse.json(
      { error: "Installation credential required." },
      { status: 401, headers },
    );
  const limited = await enforceRateLimit({
    scope: "installation-verify",
    subject: getClientIp(request),
    limit: 600,
    windowMs: 60000,
  });
  if (limited) return limited;
  const body = await readJsonBody(request, 1024);
  if (!body.ok)
    return NextResponse.json(
      { error: body.error },
      { status: body.status, headers },
    );
  const parsed = schema.safeParse(body.data);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid installation verification." },
      { status: 400, headers },
    );
  try {
    const approved = await installationRegistry().verify(
      parsed.data.installationId,
      secret,
      parsed.data.origin,
    );
    return NextResponse.json({ approved }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Installation registry unavailable." },
      { status: 503, headers },
    );
  }
}
