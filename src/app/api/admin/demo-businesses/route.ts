import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import {
  createDemoBusiness,
  createDemoBusinessSchema,
  listDemoBusinesses,
} from "@/product/demo/business-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const businesses = await listDemoBusinesses();
  return NextResponse.json({ ok: true, businesses });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idempotencyHeader = request.headers.get("idempotency-key")?.trim();
  const parsed = createDemoBusinessSchema.safeParse({
    ...(typeof json === "object" && json ? json : {}),
    idempotencyKey:
      (typeof json === "object" &&
      json &&
      "idempotencyKey" in json &&
      typeof (json as { idempotencyKey?: unknown }).idempotencyKey === "string"
        ? (json as { idempotencyKey: string }).idempotencyKey
        : undefined) || idempotencyHeader,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid form data.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await createDemoBusiness(parsed.data);
    return NextResponse.json(
      {
        ok: true,
        created: result.created,
        business: result.profile,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    console.error("[admin/demo-businesses]", error);
    return NextResponse.json(
      { error: "Failed to create demo business." },
      { status: 500 },
    );
  }
}
