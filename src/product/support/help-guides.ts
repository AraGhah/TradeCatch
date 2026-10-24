type Localized<T> = { en: T; fr: T };
export type HelpGuide = {
  steps: Localized<string[]>;
  expected: Localized<string>;
  troubleshooting: Localized<string[]>;
  screenshot: Localized<string>;
};

/** Instructions verified against workspace pages; screenshots use synthetic data. */
export const HELP_GUIDES: Record<string, HelpGuide> = {
  "getting-started": {
    steps: {
      en: [
        "Sign in with the one-time link sent to your work email. Confirm the sign-in and check that the dashboard shows your business.",
        "Open Account management. Enter the business name, Canadian phone number in +1 international format, city, service area and trade; select Save.",
        "Use the setup checklist to review Hours and availability, Receptionist, Phone settings and Calendar. Ask support to link your phone client if the receptionist shows ‘not linked yet’.",
        "Open the Test Center before enabling automations. Use a simulation to check the workflow, then arrange an authorized live phone test before routing customer calls.",
      ],
      fr: [
        "Connectez-vous avec le lien à usage unique envoyé à votre adresse professionnelle. Confirmez la connexion et vérifiez que le tableau de bord affiche votre entreprise.",
        "Ouvrez Gestion du compte. Saisissez le nom, le téléphone canadien au format international +1, la ville, le secteur et le métier; sélectionnez Enregistrer.",
        "Suivez la liste de démarrage : Heures et disponibilités, Réceptionniste, Paramètres téléphone et Calendrier. Demandez au soutien de lier le client téléphonique si la réceptionniste n’est pas encore liée.",
        "Ouvrez le Centre de test avant d’activer les automatisations. Vérifiez le parcours par simulation, puis organisez un appel réel autorisé avant de router les appels clients.",
      ],
    },
    expected: {
      en: "The saved profile remains after reloading. Completing the checklist alone does not activate a phone line or prove live delivery.",
      fr: "Le profil enregistré reste visible après rechargement. La liste de démarrage ne suffit pas à activer une ligne ni à prouver une livraison réelle.",
    },
    troubleshooting: {
      en: [
        "No sign-in email: check spam and request a fresh link; old or used links cannot be reused. Never share the link.",
        "Wrong business or missing settings: stop before saving and ask the owner to check your membership and plan.",
      ],
      fr: [
        "Courriel de connexion absent : vérifiez les indésirables et demandez un nouveau lien; un lien utilisé ou expiré n’est pas réutilisable. Ne le partagez jamais.",
        "Mauvaise entreprise ou paramètres absents : arrêtez avant d’enregistrer et demandez au propriétaire de vérifier votre accès et votre forfait.",
      ],
    },
    screenshot: {
      en: "Account setup checklist in a synthetic business. Follow these links in order; no live phone is connected in this example.",
      fr: "Liste de démarrage d’une entreprise fictive. Suivez ces liens dans l’ordre; aucun téléphone réel n’est connecté dans cet exemple.",
    },
  },
  receptionist: {
    steps: {
      en: [
        "Open Receptionist in your business workspace. If the phone client is not linked, contact support; there is no configuration form until linking is complete.",
        "Once linked, review the business details, greeting, language, business hours and call-handling settings. Save the configuration before activation.",
        "Open the Test Center and inspect the available simulations. Simulations use test data and do not place a real call; demo data reset tools are restricted to authorized demo administrators.",
        "Arrange an authorized live test from the live-phone test page. Check the greeting, request capture and human fallback before sending customer traffic to the line.",
      ],
      fr: [
        "Ouvrez Réceptionniste dans l’espace de votre entreprise. Si le client téléphonique n’est pas lié, contactez le soutien; le formulaire apparaît seulement après la liaison.",
        "Après la liaison, vérifiez les coordonnées, l’accueil, la langue, les heures et le traitement des appels. Enregistrez avant d’activer.",
        "Ouvrez le Centre de test et consultez les simulations disponibles. Elles utilisent des données de test sans appel réel; la réinitialisation des démos est réservée aux administrateurs autorisés.",
        "Organisez un essai autorisé depuis la page de test téléphonique réel. Vérifiez l’accueil, la collecte de la demande et le repli humain avant d’acheminer les appels clients.",
      ],
    },
    expected: {
      en: "A simulation validates its workflow only. Live readiness requires a real test with a linked line and confirmed call routing.",
      fr: "Une simulation valide seulement son parcours. Un essai réel avec une ligne liée et un routage confirmé reste nécessaire.",
    },
    troubleshooting: {
      en: [
        "‘Not linked yet’: give support your business name, not provider passwords or API keys.",
        "Simulation works but a live call fails: review Phone settings and report the test time, timezone and call reference through Support.",
      ],
      fr: [
        "Client non lié : donnez au soutien le nom de votre entreprise, jamais les mots de passe ni les clés de fournisseur.",
        "Simulation réussie mais appel réel en échec : vérifiez Paramètres téléphone et transmettez l’heure, le fuseau et la référence d’appel via Soutien.",
      ],
    },
    screenshot: {
      en: "Test Center in a synthetic, non-demo workspace. Demo-only controls are unavailable; this is not evidence of a successful live call.",
      fr: "Centre de test d’un espace fictif non démo. Les commandes réservées aux démos sont indisponibles; cette image ne prouve pas la réussite d’un appel réel.",
    },
  },
  phone: {
    steps: {
      en: [
        "Open Calls, then Phone settings. Confirm you are editing the correct business and have permission to change settings.",
        "Enter the business number and the TradeCatch number assigned by support in international format, for example +15145550101. Do not substitute an unassigned number.",
        "Choose the inbound strategy, human transfer number, backup number and ring timeout. Keep a reachable human fallback.",
        "Read the forwarding instructions and acknowledge them only after your carrier setup is complete. Save and check the displayed connection state.",
        "Place an authorized test call and verify answering and fallback before changing public customer routing.",
      ],
      fr: [
        "Ouvrez Appels, puis Paramètres téléphone. Vérifiez l’entreprise et votre droit de modifier les paramètres.",
        "Saisissez le numéro de l’entreprise et le numéro TradeCatch attribué par le soutien au format international, par exemple +15145550101. N’utilisez pas un numéro non attribué.",
        "Choisissez la stratégie d’appel, le transfert humain, le secours et le délai de sonnerie. Conservez un repli humain joignable.",
        "Lisez les instructions de renvoi et confirmez-les seulement après la configuration chez votre opérateur. Enregistrez et vérifiez l’état de connexion.",
        "Faites un appel de test autorisé et vérifiez la réponse et le repli avant de modifier le routage public.",
      ],
    },
    expected: {
      en: "Saved numbers and routing settings remain after reload. A ‘connected’ configuration label alone does not verify carrier forwarding or a live call.",
      fr: "Les numéros et le routage enregistrés restent après rechargement. L’état de configuration « connecté » ne vérifie pas à lui seul le renvoi de l’opérateur ni un appel réel.",
    },
    troubleshooting: {
      en: [
        "Save rejected: use + followed by country code and digits; confirm the number was assigned to your business.",
        "No ring or a loop: stop forwarding changes, confirm both destination numbers with support, and keep your existing working route until the test passes.",
      ],
      fr: [
        "Enregistrement refusé : utilisez +, l’indicatif et les chiffres; confirmez que le numéro est attribué à votre entreprise.",
        "Aucune sonnerie ou boucle : cessez les changements de renvoi, confirmez les destinations avec le soutien et conservez le routage fonctionnel jusqu’à la réussite du test.",
      ],
    },
    screenshot: {
      en: "Phone settings before connecting a line. Example numbers and placeholders are not assigned production numbers.",
      fr: "Paramètres téléphone avant la connexion d’une ligne. Les exemples et espaces réservés ne sont pas des numéros de production attribués.",
    },
  },
  transfers: {
    steps: {
      en: [
        "Open Calls → Phone settings and find Human transfer settings.",
        "Enter an authorized, reachable human transfer number and a different backup destination if needed. Avoid forwarding either number back to the TradeCatch line.",
        "Choose the ring timeout between 10 and 60 seconds and save. Review fallback settings with support so an unanswered transfer has a voicemail or approved backup path.",
        "Arrange a live test with the recipient: verify the answered case, then the no-answer case. Confirm that the caller reaches the agreed fallback.",
      ],
      fr: [
        "Ouvrez Appels → Paramètres téléphone et repérez les paramètres de transfert humain.",
        "Saisissez un numéro humain autorisé et joignable, puis un secours différent si nécessaire. Ne renvoyez pas ces numéros vers la ligne TradeCatch.",
        "Choisissez un délai de sonnerie entre 10 et 60 secondes, puis enregistrez. Vérifiez le repli avec le soutien pour qu’un transfert sans réponse utilise la messagerie ou le secours approuvé.",
        "Organisez un essai réel avec le destinataire : testez une réponse, puis une absence de réponse. Confirmez que l’appelant atteint le repli prévu.",
      ],
    },
    expected: {
      en: "The human can answer within the configured timeout. When unavailable, the tested fallback receives the caller rather than ending the call silently.",
      fr: "Le destinataire peut répondre dans le délai configuré. En cas d’absence, le repli testé reçoit l’appelant au lieu d’une fin silencieuse.",
    },
    troubleshooting: {
      en: [
        "Transfer never answers: confirm the recipient number, availability and carrier blocking before extending the timeout.",
        "Backup loops or disconnects: stop using that route and contact support with the call reference. Do not test emergency-service numbers.",
      ],
      fr: [
        "Aucune réponse au transfert : vérifiez le numéro, la disponibilité et les blocages de l’opérateur avant d’allonger le délai.",
        "Boucle ou coupure du secours : cessez d’utiliser ce routage et contactez le soutien avec la référence d’appel. Ne testez pas de numéros d’urgence.",
      ],
    },
    screenshot: {
      en: "Human transfer and backup fields in Phone settings. The displayed values are configuration examples, not a live transfer result.",
      fr: "Champs de transfert humain et de secours dans Paramètres téléphone. Ces valeurs illustrent la configuration, pas un transfert réel réussi.",
    },
  },
  calendar: {
    steps: {
      en: [
        "Open Settings → Calendar and check the connection status. A simulated connection is not a live Google Calendar connection.",
        "Select Connect Google Calendar. If connection is not configured or not included in your access, ask support; do not enter Google credentials into a support ticket.",
        "When redirected to Google, select the authorized business account and review the requested permissions. Return to TradeCatch after granting access.",
        "Choose the business calendar using its calendar ID and summary, then save the selection. Review Hours and availability separately.",
        "Check that the status is Connected and run an authorized appointment test. Verify the resulting event in the selected business calendar.",
      ],
      fr: [
        "Ouvrez Paramètres → Calendrier et vérifiez l’état. Une connexion simulée n’est pas une connexion réelle à Google Agenda.",
        "Sélectionnez Connecter Google Calendar (Google Agenda). Si la connexion n’est pas configurée ou permise, contactez le soutien; ne mettez pas vos identifiants Google dans un billet.",
        "Après redirection vers Google, choisissez le compte professionnel autorisé et vérifiez les autorisations demandées. Revenez à TradeCatch après avoir accordé l’accès.",
        "Choisissez le calendrier professionnel avec son identifiant et son nom, puis enregistrez. Vérifiez séparément Heures et disponibilités.",
        "Vérifiez l’état Connecté et faites un essai de rendez-vous autorisé. Contrôlez l’événement dans le calendrier professionnel choisi.",
      ],
    },
    expected: {
      en: "The selected calendar and connected status are visible. If the calendar is unavailable, collect the preferred time as a request; do not promise a confirmed appointment.",
      fr: "Le calendrier choisi et l’état connecté sont visibles. Si le calendrier est indisponible, recueillez l’heure souhaitée comme demande sans promettre de rendez-vous confirmé.",
    },
    troubleshooting: {
      en: [
        "Disconnected or expired: reconnect with an account allowed to edit the business calendar, then recheck the selected calendar.",
        "Wrong or missing events: verify the calendar ID, business hours and timezone. Escalate with the appointment reference, not an OAuth token.",
      ],
      fr: [
        "Déconnecté ou expiré : reconnectez un compte autorisé à modifier le calendrier professionnel, puis vérifiez la sélection.",
        "Événements absents ou incorrects : vérifiez l’identifiant, les heures et le fuseau. Transmettez la référence du rendez-vous, jamais un jeton OAuth.",
      ],
    },
    screenshot: {
      en: "Simulated Calendar settings in a synthetic business, not a live Google connection. Connection and calendar selection are separate steps.",
      fr: "Paramètres Calendrier simulés d’une entreprise fictive, sans connexion Google réelle. La connexion et le choix du calendrier sont deux étapes distinctes.",
    },
  },
  leads: {
    steps: {
      en: [
        "Open Leads in the correct business workspace. Clear the search, status, source and priority filters if you cannot find a request.",
        "Open a lead to review contact details, service requested, notes and history before contacting the customer.",
        "Use New lead to enter an authorized customer phone number in international format and the request details, then save. Avoid creating a duplicate when an existing request is already present.",
        "For work in the human takeover inbox, select Claim or Take over and wait for success. Select Resolve only when the item is handled; a failed action must be retried or reported.",
      ],
      fr: [
        "Ouvrez Prospects dans l’espace de la bonne entreprise. Effacez les filtres de recherche, statut, source et priorité si une demande est introuvable.",
        "Ouvrez un prospect et lisez les coordonnées, le service, les notes et l’historique avant de contacter le client.",
        "Avec Nouveau prospect, saisissez le numéro autorisé au format international et les détails, puis enregistrez. Évitez un doublon si la demande existe déjà.",
        "Dans la boîte de prise en charge, sélectionnez Prendre ou Reprendre et attendez la réussite. Résolvez seulement après traitement; réessayez ou signalez toute action échouée.",
      ],
    },
    expected: {
      en: "The customer request is visible only to permitted members of its business. A failed action leaves the item available and displays an error.",
      fr: "La demande est visible uniquement aux membres autorisés de son entreprise. Une action échouée laisse le dossier accessible et affiche une erreur.",
    },
    troubleshooting: {
      en: [
        "Missing request: remove filters and confirm the business and your assignment with the owner; do not try another tenant’s URL.",
        "Action error: retry once after checking your connection. If it persists, report the item reference and action to support without sending customer conversation contents.",
      ],
      fr: [
        "Demande absente : effacez les filtres et vérifiez l’entreprise et votre assignation avec le propriétaire; n’essayez pas l’URL d’une autre entreprise.",
        "Erreur d’action : vérifiez la connexion et réessayez une fois. Si elle persiste, envoyez la référence et l’action au soutien, sans le contenu des conversations clients.",
      ],
    },
    screenshot: {
      en: "Leads search and filters in a synthetic workspace with no customer records. An empty list does not prove that another business has no leads.",
      fr: "Recherche et filtres des prospects dans un espace fictif sans dossiers clients. Une liste vide ne renseigne pas sur les prospects d’une autre entreprise.",
    },
  },
  automations: {
    steps: {
      en: [
        "Open Automations and find Missed-call recovery. Check that your plan, business phone and messaging provider have been configured.",
        "Select Edit to review the missed-call settings, message template and timing. Use an approved message and respect the customer’s consent and opt-out status.",
        "Run the provided simulation with synthetic data before enabling live recovery. A simulation must not be treated as SMS delivery proof.",
        "Enable the operational automation and check that it shows Active. After an authorized live missed-call test, review Automation history and provider delivery status.",
      ],
      fr: [
        "Ouvrez Automatisations et repérez la récupération d’appel manqué. Vérifiez le forfait, le téléphone professionnel et la configuration de la messagerie.",
        "Sélectionnez Modifier pour vérifier les paramètres, le modèle et les délais. Utilisez un message approuvé et respectez le consentement et le désabonnement.",
        "Lancez la simulation avec des données fictives avant l’activation réelle. Une simulation ne constitue pas une preuve de livraison SMS.",
        "Activez l’automatisation opérationnelle et vérifiez l’état Actif. Après un appel manqué de test autorisé, consultez l’historique et l’état de livraison du fournisseur.",
      ],
    },
    expected: {
      en: "An enabled, configured recovery workflow handles eligible missed calls. STOP cancels further messaging; never bypass an opt-out to make a test pass.",
      fr: "Le parcours activé et configuré traite les appels manqués admissibles. STOP annule les messages suivants; ne contournez jamais un désabonnement pour réussir un test.",
    },
    troubleshooting: {
      en: [
        "Enable fails: read the error and check the plan and phone setup with the owner; do not assume a failed toggle activated the workflow.",
        "Active but no SMS: inspect history, consent, opt-out and provider configuration using the SMS troubleshooting article.",
      ],
      fr: [
        "Activation échouée : lisez l’erreur et vérifiez le forfait et le téléphone avec le propriétaire; un bouton en échec n’active pas le parcours.",
        "Actif sans SMS : vérifiez l’historique, le consentement, le désabonnement et le fournisseur avec l’article de dépannage SMS.",
      ],
    },
    screenshot: {
      en: "Automation overview with status, edit, test and history controls. Rows marked for later availability cannot be enabled.",
      fr: "Vue des automatisations avec état, modification, test et historique. Les fonctions annoncées pour plus tard ne peuvent pas être activées.",
    },
  },
  sms: {
    steps: {
      en: [
        "Open Automations → History and locate the failed execution by time and workflow. Keep the reference for support.",
        "Check Phone settings for the assigned sending number and ask the owner or support to verify messaging-provider configuration.",
        "Verify that the relevant automation is enabled and that the recipient has given the required consent and has not opted out. Never remove STOP to force a retry.",
        "Run a simulation to check the workflow. For delivery verification, arrange a single authorized live test and inspect its provider status before retrying to avoid duplicate messages.",
      ],
      fr: [
        "Ouvrez Automatisations → Historique et trouvez l’exécution en échec par heure et parcours. Gardez la référence pour le soutien.",
        "Vérifiez le numéro d’envoi attribué dans Paramètres téléphone et demandez au propriétaire ou au soutien de contrôler le fournisseur de messagerie.",
        "Vérifiez l’activation, le consentement requis et l’absence de désabonnement. Ne supprimez jamais STOP pour forcer un nouvel essai.",
        "Simulez le parcours. Pour vérifier la livraison, organisez un seul essai réel autorisé et consultez son état fournisseur avant toute relance afin d’éviter les doublons.",
      ],
    },
    expected: {
      en: "History identifies the workflow outcome. Only a live provider delivery result verifies delivery; a queued or simulated message is not a delivered SMS.",
      fr: "L’historique indique le résultat du parcours. Seul un état réel de livraison du fournisseur vérifie la livraison; un message en file ou simulé n’est pas un SMS livré.",
    },
    troubleshooting: {
      en: [
        "History is empty: confirm the filters, business and event time. No history is not proof that a message reached the recipient.",
        "Provider failure persists: send support the execution reference, timestamp and timezone. Do not post provider credentials or full customer message contents.",
      ],
      fr: [
        "Historique vide : vérifiez les filtres, l’entreprise et l’heure de l’événement. L’absence d’historique ne prouve pas la réception.",
        "Échec fournisseur persistant : envoyez la référence d’exécution, l’heure et le fuseau au soutien. Ne publiez pas les identifiants ni le contenu intégral des messages clients.",
      ],
    },
    screenshot: {
      en: "Automation history before any executions in a synthetic business. This empty state is not a delivery confirmation.",
      fr: "Historique avant toute exécution dans une entreprise fictive. Cet état vide n’est pas une confirmation de livraison.",
    },
  },
  billing: {
    steps: {
      en: [
        "Sign in as the business owner or administrator and open Billing. If workspace access is inactive, use the separate Billing page to manage the subscription.",
        "Select Open billing. For a linked account, TradeCatch opens Stripe’s secure portal; do not enter card details into a support ticket.",
        "Review the available subscription, invoice and payment-method options in Stripe. Confirm the amount, renewal date and any effective date before accepting a change.",
        "Return to TradeCatch and reload the workspace after Stripe confirms the update. Subscription access changes follow the confirmed billing state, not just clicking the button.",
      ],
      fr: [
        "Connectez-vous comme propriétaire ou administrateur et ouvrez Facturation. Si l’espace est inactif, utilisez la page Facturation distincte pour gérer l’abonnement.",
        "Sélectionnez Ouvrir la facturation. Pour un compte lié, TradeCatch ouvre le portail sécurisé Stripe; ne saisissez pas de données de carte dans un billet.",
        "Consultez les options d’abonnement, de facture et de paiement offertes par Stripe. Vérifiez le montant, le renouvellement et la date d’effet avant de confirmer.",
        "Revenez à TradeCatch et rechargez après confirmation par Stripe. L’accès dépend de l’état de facturation confirmé, pas d’un simple clic.",
      ],
    },
    expected: {
      en: "The authorized user reaches Stripe or sees a clear unavailable/not-linked message. TradeCatch does not store card numbers.",
      fr: "La personne autorisée atteint Stripe ou voit un message clair d’indisponibilité ou de liaison absente. TradeCatch ne conserve pas les numéros de carte.",
    },
    troubleshooting: {
      en: [
        "Not linked: contact support to link billing; clicking repeatedly does not create a subscription.",
        "Portal unavailable or access unchanged: retry later, then ask support with the business name and invoice reference. Never send card numbers or sign-in links.",
      ],
      fr: [
        "Compte non lié : contactez le soutien; cliquer plusieurs fois ne crée pas d’abonnement.",
        "Portail indisponible ou accès inchangé : réessayez plus tard, puis contactez le soutien avec l’entreprise et la référence de facture. N’envoyez jamais de numéro de carte ni de lien de connexion.",
      ],
    },
    screenshot: {
      en: "Separate Billing page for an authenticated synthetic account. The button opens a portal only when billing is linked; no Stripe payment screen is shown.",
      fr: "Page Facturation distincte d’un compte fictif connecté. Le bouton ouvre le portail seulement si la facturation est liée; aucun écran de paiement Stripe n’est montré.",
    },
  },
  account: {
    steps: {
      en: [
        "Open Account management and confirm the business. Update permitted profile fields, select Save and reload to check the result.",
        "Before requesting closure, select Export data and keep the downloaded ZIP securely. Read README.txt and manifest.json for missing or limited sections; export permissions still apply.",
        "As the owner, select Request Suspension, Request Reactivation or Request deletion. Read the confirmation; cancel if you did not intend to send a request.",
        "After confirming, check Account change requests for the reference and review status. Awaiting review is not a service-status change.",
        "Wait for support to confirm the transition and effective date. Keep working phone routing until the transition is agreed; a deletion request does not erase records immediately.",
      ],
      fr: [
        "Ouvrez Gestion du compte et vérifiez l’entreprise. Modifiez les champs autorisés, enregistrez et rechargez pour vérifier.",
        "Avant une fermeture, sélectionnez Exporter les données et conservez le ZIP en sécurité. Lisez README.txt et manifest.json pour les limites; les droits d’accès s’appliquent toujours.",
        "Comme propriétaire, sélectionnez Demander une suspension, Demander une réactivation ou Demander la suppression. Lisez la confirmation et annulez si l’envoi n’était pas voulu.",
        "Après confirmation, consultez la référence et le statut dans Demandes de modification du compte. En attente d’examen n’est pas un changement de statut du service.",
        "Attendez que le soutien confirme la transition et sa date d’effet. Conservez le routage fonctionnel jusqu’à l’accord; une demande de suppression n’efface pas immédiatement les dossiers.",
      ],
    },
    expected: {
      en: "A confirmed request has a reference and status that remain after reload. Until support schedules the transition, the effective date is not scheduled and service stays unchanged.",
      fr: "La demande confirmée a une référence et un statut conservés après rechargement. Tant que le soutien ne planifie pas la transition, la date d’effet n’est pas fixée et le service reste inchangé.",
    },
    troubleshooting: {
      en: [
        "Request error: reload and check history before resubmitting, because a lost response can follow a saved request. Contact support with any existing reference.",
        "Buttons disabled or export fails: check owner permissions; for an export retry later and report incomplete sections without attaching the full customer archive to a public ticket.",
      ],
      fr: [
        "Erreur de demande : rechargez et vérifiez l’historique avant de renvoyer, car une réponse perdue peut suivre un enregistrement réussi. Communiquez toute référence existante au soutien.",
        "Boutons désactivés ou export échoué : vérifiez les droits du propriétaire; réessayez l’export plus tard et signalez les sections incomplètes sans joindre l’archive client à un billet public.",
      ],
    },
    screenshot: {
      en: "Account change request history in an isolated example. Awaiting review and an unscheduled effective date do not mean service is suspended.",
      fr: "Historique de demandes dans un exemple isolé. Un examen en attente et une date non planifiée ne signifient pas que le service est suspendu.",
    },
  },
  troubleshooting: {
    steps: {
      en: [
        "Open Support → Troubleshooting in the affected business. Note which workflow failed and its timestamp and timezone.",
        "Select the relevant configuration check: receptionist, phone, calendar, notifications, SMS, automations or subscription. Read each finding and its matching help article.",
        "Correct only settings you are authorized to change, then rerun that check. Passing configuration checks does not prove a live call or message succeeded.",
        "Arrange a controlled live test when needed. If it still fails, open a Support ticket with the expected result, actual result, steps and relevant reference.",
      ],
      fr: [
        "Ouvrez Soutien → Dépannage dans l’entreprise concernée. Notez le parcours en échec, l’heure et le fuseau.",
        "Choisissez la vérification de configuration : réceptionniste, téléphone, calendrier, notifications, SMS, automatisations ou abonnement. Lisez chaque résultat et l’article correspondant.",
        "Corrigez seulement les paramètres autorisés et relancez la vérification. Des contrôles de configuration réussis ne prouvent pas la réussite d’un appel ou message réel.",
        "Organisez un essai réel contrôlé si nécessaire. Si l’échec persiste, ouvrez un billet avec les résultats attendu et réel, les étapes et la référence pertinente.",
      ],
    },
    expected: {
      en: "The report identifies configuration gaps and follow-up articles without exposing provider credentials. Use live verification separately.",
      fr: "Le rapport indique les lacunes de configuration et les articles à consulter sans exposer d’identifiants fournisseur. Vérifiez séparément le fonctionnement réel.",
    },
    troubleshooting: {
      en: [
        "Check fails to load: retry after checking your connection; do not interpret a missing report as ‘all clear’.",
        "Before attaching a screenshot: remove customer names, phone numbers, message text, sign-in links and credentials. Send sensitive references only through authenticated Support.",
      ],
      fr: [
        "Rapport impossible à charger : vérifiez votre connexion et réessayez; un rapport absent ne signifie pas que tout fonctionne.",
        "Avant de joindre une capture : masquez noms, téléphones, messages clients, liens de connexion et identifiants. Envoyez les références sensibles seulement via le soutien authentifié.",
      ],
    },
    screenshot: {
      en: "Troubleshooting configuration checks in a synthetic business. These controls inspect configuration; they do not place live calls.",
      fr: "Contrôles de configuration de dépannage dans une entreprise fictive. Ces commandes n’effectuent pas d’appels réels.",
    },
  },
};
