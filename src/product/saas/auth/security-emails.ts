import { sendAuthEmail } from "./mailer";

/**
 * Security notices sent after an account change. They never contain a
 * password or a sign-in token: only what changed, when, and what to do if it
 * was not the account owner.
 */

type Locale = "en" | "fr";

export function siteOrigin(origin?: string): string {
  return (
    origin?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "https://tradecatch.ca"
  );
}

function when(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(at);
}

/** Sent after a password reset or change, to the account's email. */
export async function sendPasswordChangedEmail(input: {
  to: string;
  locale: Locale;
  at?: Date;
  origin?: string;
}) {
  const at = when(input.at ?? new Date(), input.locale);
  const forgot = `${siteOrigin(input.origin)}${input.locale === "fr" ? "/fr/mot-de-passe-oublie" : "/forgot-password"}`;
  return sendAuthEmail({
    to: input.to,
    subject:
      input.locale === "fr"
        ? "Votre mot de passe TradeCatch a été modifié"
        : "Your TradeCatch password was changed",
    text:
      input.locale === "fr"
        ? `Bonjour,

Le mot de passe de votre compte TradeCatch a été modifié le ${at} (heure de l’Est). Les autres appareils connectés à votre compte ont été déconnectés.

Si c’est vous, vous n’avez rien à faire.

Si ce n’est pas vous, choisissez immédiatement un nouveau mot de passe ici : ${forgot}
puis écrivez-nous à contact@tradecatch.ca.
`
        : `Hi,

The password for your TradeCatch account was changed on ${at} (Eastern time). Other devices signed in to your account were signed out.

If this was you, there is nothing to do.

If this was not you, choose a new password right away: ${forgot}
then email us at contact@tradecatch.ca.
`,
  });
}

/**
 * Sent to the PREVIOUS address when support moves an account to a new email,
 * so an owner who still reads it learns of the change at once.
 */
export async function sendEmailChangedNotice(input: {
  to: string;
  locale: Locale;
  at?: Date;
}) {
  const at = when(input.at ?? new Date(), input.locale);
  return sendAuthEmail({
    to: input.to,
    subject:
      input.locale === "fr"
        ? "L’adresse de connexion de votre compte TradeCatch a changé"
        : "The sign-in email for your TradeCatch account changed",
    text:
      input.locale === "fr"
        ? `Bonjour,

À la suite d’une demande de récupération de compte vérifiée par notre équipe, l’adresse de connexion de votre compte TradeCatch a été remplacée le ${at} (heure de l’Est). Cette adresse ne permet plus de se connecter.

Si vous n’avez pas fait cette demande, écrivez-nous immédiatement à contact@tradecatch.ca.
`
        : `Hi,

After an account recovery request verified by our team, the sign-in email for your TradeCatch account was replaced on ${at} (Eastern time). This address can no longer be used to sign in.

If you did not make this request, email us right away at contact@tradecatch.ca.
`,
  });
}
