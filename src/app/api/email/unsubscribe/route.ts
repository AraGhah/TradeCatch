import { NextRequest, NextResponse } from "next/server";
import { getEmailAutomationServices } from "@/product/email-automation/runtime";
import { verifyUnsubscribeToken } from "@/product/email-automation/unsubscribe";
import { getAuthSecret } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

/**
 * Public unsubscribe endpoint for automated emails.
 * GET  → confirmation page (link in the email footer)
 * POST → RFC 8058 one-click unsubscribe (List-Unsubscribe-Post)
 */
function page(title: string, message: string, status = 200) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#F4F1EC;font-family:Helvetica,Arial,sans-serif;color:#1A2430;">
<div style="max-width:520px;margin:48px auto;background:#fff;border:1px solid rgba(12,20,30,.1);padding:32px;">
<h1 style="margin:0 0 12px;font-size:22px;">${title}</h1><p style="margin:0;line-height:1.6;">${message}</p></div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handle(request: NextRequest, oneClick: boolean) {
  const token = request.nextUrl.searchParams.get("t")?.trim() ?? "";
  const secret = getAuthSecret();
  const claims = token && secret ? verifyUnsubscribeToken(token, secret) : null;
  if (!claims) {
    if (oneClick)
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    return page(
      "Lien invalide / Invalid link",
      "Ce lien de désabonnement est invalide ou expiré. Répondez simplement au courriel pour être retiré de la liste.<br/><br/>This unsubscribe link is invalid. Reply to the email and we will remove you.",
      400,
    );
  }

  await getEmailAutomationServices().unsubscribe(
    claims.organizationId,
    claims.email,
  );
  if (oneClick) return NextResponse.json({ ok: true });
  return page(
    "Désabonnement confirmé / Unsubscribed",
    "Vous ne recevrez plus de courriels automatisés de cette entreprise.<br/><br/>You will no longer receive automated emails from this business.",
  );
}

export async function GET(request: NextRequest) {
  return handle(request, false);
}

export async function POST(request: NextRequest) {
  return handle(request, true);
}
