import { NextRequest } from "next/server";
import { buildBlandConfig } from "@/product/bland/config";
import { configQuerySchema, handleBlandRequest } from "@/product/bland/api";

export const dynamic = "force-dynamic";

/**
 * Bland tool: the business configuration at the start of a call (name,
 * language, hours, booking and text availability, approved facts) and the only
 * numbers a pathway may transfer to. Read-only: nothing is created.
 */
export async function GET(request: NextRequest) {
  return handleBlandRequest(
    request,
    "config",
    configQuerySchema,
    async ({ tenant, runtime, now }) => ({
      config: buildBlandConfig(tenant, runtime.configs, now),
    }),
    { method: "GET" },
  );
}
