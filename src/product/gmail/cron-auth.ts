import { authorizeOpsRequest } from "@/lib/ops-auth";
import { safeEqual } from "@/lib/safe-compare";

export function authorizeGmailCron(request: Request): boolean {
  const secret = process.env.GMAIL_SYNC_SECRET?.trim();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return (
    Boolean(secret && token && safeEqual(token, secret)) ||
    authorizeOpsRequest(request)
  );
}
