import { launchFlagEnabled, type LaunchFlag } from "@/lib/launch-flags";
import { HELP_GUIDES } from "./help-guides";

export type HelpArticle = {
  id: string;
  category: string;
  title: { en: string; fr: string };
  body: { en: string; fr: string };
  /** Hidden while this launch switch is off (the feature is not offered). */
  flag?: LaunchFlag;
};

const ALL_HELP_ARTICLES: HelpArticle[] = [
  {
    id: "getting-started",
    category: "getting_started",
    title: { en: "Sign in to your account", fr: "Se connecter à votre compte" },
    body: {
      en: "TradeCatch creates your account and emails you a secure sign-in link. Open it, confirm your business, and finish setup before turning on the receptionist.",
      fr: "TradeCatch crée votre compte et vous envoie un lien de connexion sécurisé. Ouvrez-le, confirmez votre entreprise, puis terminez la configuration avant d’activer la réceptionniste.",
    },
  },
  {
    id: "receptionist",
    category: "receptionist",
    title: {
      en: "How to test your receptionist",
      fr: "Comment tester la réceptionniste",
    },
    body: {
      en: "Open Receptionist, review the configuration, then check the available workflow simulations in the Test Center. A simulation does not prove that live calls work.",
      fr: "Ouvrez Réceptionniste, vérifiez la configuration, puis consultez les simulations de parcours disponibles dans le Centre de test. Une simulation ne prouve pas que les appels réels fonctionnent.",
    },
  },
  {
    id: "phone",
    category: "phone",
    title: { en: "Connect a phone number", fr: "Connecter un numéro" },
    body: {
      en: "Assign the business number, then place an authorized test call before changing customer routing. Keep a fallback path to the contractor.",
      fr: "Assignez le numéro, puis faites un appel de test autorisé avant de changer le routage des clients. Conservez un repli vers l’entrepreneur.",
    },
  },
  {
    id: "transfers",
    flag: "callTransfer",
    category: "phone",
    title: {
      en: "Set up a human transfer",
      fr: "Configurer un transfert humain",
    },
    body: {
      en: "Add the contractor number in fallback settings. If nobody answers, the call should go to voicemail instead of ending silently.",
      fr: "Ajoutez le numéro de l’entrepreneur dans les paramètres de repli. Sans réponse, l’appel doit aller vers la messagerie.",
    },
  },
  {
    id: "calendar",
    category: "appointments",
    title: {
      en: "How to connect Google Calendar",
      fr: "Comment connecter Google Agenda",
    },
    body: {
      en: "Google Calendar comes with the Professional plan. We switch it on for your business once it has been tested with your own calendar, so you cannot connect it yourself before then. Outlook is not available. Open Calendar settings to see where your business stands.",
      fr: "Google Agenda est inclus avec le forfait Professional. Nous l’activons pour votre entreprise une fois qu’il a été testé avec votre propre calendrier; vous ne pouvez donc pas le connecter vous-même avant. Outlook n’est pas offert. Ouvrez les paramètres du calendrier pour voir où en est votre entreprise.",
    },
  },
  {
    id: "leads",
    category: "leads",
    title: { en: "Manage customer requests", fr: "Gérer les demandes clients" },
    body: {
      en: "New requests appear in Leads. Employees see assigned work. Another business cannot open these records.",
      fr: "Les nouvelles demandes apparaissent dans Prospects. Un employé voit le travail qui lui est assigné. Une autre entreprise ne peut pas ouvrir ces dossiers.",
    },
  },
  {
    id: "automations",
    category: "automations",
    title: { en: "Missed-call recovery", fr: "Récupération d’appel manqué" },
    body: {
      en: "Enable missed-call recovery only after messaging is verified. STOP from a customer cancels further messages.",
      fr: "Activez la récupération seulement après avoir vérifié la messagerie. STOP annule les messages suivants.",
    },
  },
  {
    id: "sms",
    category: "sms",
    title: { en: "Troubleshoot SMS", fr: "Dépanner les SMS" },
    body: {
      en: "Check that the business number can send, the customer has not opted out, and the automation is enabled. A configuration check is not a delivered message.",
      fr: "Vérifiez le numéro, l’absence de désabonnement et l’automatisation activée. Une vérification de configuration n’est pas un message livré.",
    },
  },
  {
    id: "billing",
    category: "billing",
    title: { en: "Manage your plan", fr: "Gérer le forfait" },
    body: {
      en: "Subscription changes are handled in Stripe. The dashboard shows the current plan and does not store card numbers.",
      fr: "Les changements d’abonnement passent par Stripe. Le tableau de bord montre le forfait et ne conserve pas les numéros de carte.",
    },
  },
  {
    id: "account",
    category: "account",
    title: {
      en: "Update the business and close the account",
      fr: "Mettre à jour l’entreprise et fermer le compte",
    },
    body: {
      en: "Owners can update the business name. A deletion request is reviewed first. The phone number stays routed until a transition is confirmed.",
      fr: "Le propriétaire peut mettre à jour le nom. Une demande de suppression est examinée d’abord. Le numéro reste routé jusqu’à une transition confirmée.",
    },
  },
  {
    id: "troubleshooting",
    category: "troubleshooting",
    title: { en: "Common problems", fr: "Problèmes courants" },
    body: {
      en: "Run diagnostics from Support. Read the result, then open the matching help article. Ask support if a live test is still failing.",
      fr: "Lancez le diagnostic depuis Support. Lisez le résultat, puis ouvrez l’article correspondant. Contactez le support si un essai réel échoue encore.",
    },
  },
];

/** The articles a customer can read: those whose feature is part of the launch offering. */
export const HELP_ARTICLES: HelpArticle[] = ALL_HELP_ARTICLES.filter(
  (article) => !article.flag || launchFlagEnabled(article.flag),
);

export function searchHelp(query: string, locale: "en" | "fr") {
  const needle = query.trim().toLowerCase();
  return HELP_ARTICLES.filter((article) => {
    const guide = HELP_GUIDES[article.id];
    const haystack =
      `${article.title.en} ${article.title.fr} ${article.body.en} ${article.body.fr} ${guide ? [...guide.steps.en, ...guide.steps.fr, guide.expected.en, guide.expected.fr, ...guide.troubleshooting.en, ...guide.troubleshooting.fr].join(" ") : ""}`.toLowerCase();
    return !needle || haystack.includes(needle);
  }).map((article) => ({
    id: article.id,
    category: article.category,
    title: article.title[locale],
    excerpt: article.body[locale].slice(0, 180),
  }));
}

export function getHelpArticle(id: string, locale: "en" | "fr") {
  const article = HELP_ARTICLES.find((item) => item.id === id);
  if (!article) return null;
  const guide = HELP_GUIDES[id];
  return {
    id: article.id,
    category: article.category,
    title: article.title[locale],
    body: article.body[locale],
    locale,
    steps: guide.steps[locale],
    expected: guide.expected[locale],
    troubleshooting: guide.troubleshooting[locale],
    screenshot: {
      src: `/help/${id}-${locale}.png`,
      caption: guide.screenshot[locale],
    },
  };
}
