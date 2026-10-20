export const loginConfirmationHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

/** A script-free document: no analytics, prefetches, or third-party resources see the link. */
export function loginConfirmationHtml(input: {
  token: string;
  nonce: string;
  locale: "en" | "fr";
}) {
  const fr = input.locale === "fr";
  const title = fr ? "Confirmez votre connexion" : "Confirm your sign-in";
  // Tokens and nonces are validated base64url before rendering. Escape anyway
  // so this template remains safe if the caller's validation changes.
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  return `<!doctype html>
<html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title} | TradeCatch</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#172536;font:17px/1.6 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:480px;padding:36px;background:white;border:1px solid #dce3eb;border-radius:16px}h1{font-size:28px;line-height:1.2;margin:20px 0}p{margin:18px 0}.brand{font-weight:750;color:#173c53}button{width:100%;border:0;border-radius:8px;background:#173c53;color:white;padding:14px 20px;font:inherit;font-weight:650;cursor:pointer}button:hover{background:#245774}button:focus-visible,a:focus-visible{outline:3px solid #176fa6;outline-offset:4px}a{color:#173c53}.hint{font-size:14px;color:#475569}
</style></head><body><main><div class="brand">TradeCatch</div><h1>${title}</h1>
<p>${fr ? "Appuyez sur le bouton pour ouvrir votre espace de travail en toute sécurité." : "Select the button to securely open your workspace."}</p>
<form method="post" action="/api/auth/callback">
<input type="hidden" name="token" value="${escape(input.token)}">
<input type="hidden" name="confirmation" value="${escape(input.nonce)}">
<input type="hidden" name="locale" value="${input.locale}">
<button type="submit" name="confirm" value="1">${fr ? "Confirmer et me connecter" : "Confirm and sign in"}</button>
</form>
<p class="hint">${fr ? "Votre lien reste inutilisé jusqu’à votre confirmation. Il expire 20 minutes après sa création." : "Your link stays unused until you confirm. It expires 20 minutes after it was created."}</p>
<a href="${fr ? "/fr/connexion" : "/login"}">${fr ? "Retour à la connexion" : "Back to sign in"}</a>
</main></body></html>`;
}
