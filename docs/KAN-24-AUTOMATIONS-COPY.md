# KAN-24: Automatic Follow-Ups page copy

Rewrite of the customer dashboard's Automations area (overview, missed-call, quote, template, history and test screens) in plain English and natural Canadian French. No automation service, database logic or API behaviour was changed.

**Status: built and verified as listed under "Verification". Not committed, not deployed.** Deployment needs approval.

## What changed

- **Words.** The page is now "Automatic Follow-Ups" / "Suivis automatiques" with the intro, names and descriptions from the ticket. Every automation says what it does, when it runs, and how to turn it on or off. Developer words (backend, trigger, execution, SMS, variable, segment, handset, provider, raw result codes) are gone from what the owner sees.
- **Cards instead of a table.** The overview is a card per automation, so long French sentences wrap on a phone instead of forcing a sideways scroll. The existing design tokens and button styles are reused.
- **Status from real state.** Each automation shows Active, Paused, Scheduled or Needs Attention, worked out from what the system actually holds (see "How the status is decided").
- **Buttons.** Enable, Pause, Save Changes, View History (plus Edit Settings and Run a Test).
- **Failures in plain words.** A failed save or toggle is explained in the person's own language. The server's English error text is never shown.
- **Settings pages** only show controls that do something for that automation, and explain timing in sentences ("That is 1 day and 1 hour.").

## How the status is decided

Computed by `deriveAutomationState` in `src/product/sms-automation/status.ts`. The server reads the inputs and the browser derives the state, so the label changes the moment the switch is toggled.

| Status | When |
| --- | --- |
| Paused | The switch is off. Wins over everything else. |
| Needs Attention | The switch is on, but texts cannot go out: TradeCatch has paused missed-call texts (operator kill switch), the business has no number to text from, or the most recent real text (in the last 14 days) failed or could not be confirmed. A later successful text clears it. |
| Scheduled | The switch is on and real texts are waiting to go out. |
| Active | The switch is on and nothing is waiting or wrong. |

Test texts and other automations' texts are never counted. A bad phone number, an opt-out, a customer reply or a carrier refusal does not mark the automation as needing attention, because none of those is something the owner can fix in the automation. If the sender number cannot be looked up, the screen does not claim a problem.

Appointment reminders, past-customer check-ins and urgent-request alerts: only appointment reminders can be turned on. The other two show "Coming soon" with no switch, and say nothing is sent for now.

## What the copy says about timing and consent, and where that comes from

| Claim on screen | Source of truth |
| --- | --- |
| Missed call: one text about N minutes after the call | `initialDelayMinutes` (default 2); `defaultConfig("missed_call_recovery")` |
| Quiet hours off by default: the caller gets the text at any hour | `respectQuietHours: false` default; the send-time window check in `window.ts` applies only when it is on |
| Quote: reminders 1 day and 5 days after the quote | `initialDelayMinutes` 1440 and `secondDelayMinutes` 7200 defaults; falls back to first + 2 days when no second delay is stored |
| Texts only 8 AM to 8 PM, not on weekends; a text due outside waits | `windowStartHour` / `windowEndHour` / `weekendSending` for quotes |
| Reminders always stop once the quote is accepted, declined or canceled | `quote_accepted`, `quote_rejected`, `quote_stopped` checks in `run()`, not a setting |
| Up to 2 reminders per quote | The scheduler builds at most two reminder jobs (first and second delay) |
| Anyone who replies STOP is not texted again | Opt-out check at send time |
| Only people who called, received a quote or booked | The consent category on every job (`legal_basis` check) |
| Each text is re-checked just before sending; a paused follow-up sends nothing | `run()` re-checks business active, switch on, opt-out, consent, quote/lead state, quiet hours, template, sender |
| Pausing cancels waiting texts | `deactivate` cancels pending jobs; the toast reports the count |

The copy never promises a text while the automation is paused, while TradeCatch has switched the feature off, while no business number exists, or for the two automations that are not available yet.

## Files

**Modified**

- `src/messages/en.json`, `src/messages/fr.json`: `app.automations` replaced (41 top-level groups). Same keys in both languages, same placeholders.
- `src/components/app/AutomationBoard.tsx`: card layout, status, schedule sentences, "how it works" box.
- `src/components/app/AutomationSettingsForm.tsx`: sectioned form, plain labels, live "That is …" hints, controls shown only when they apply.
- `src/components/app/AutomationTestPanel.tsx`, `TemplateManager.tsx`: plain wording; friendly detail chips; test-result statuses in words.
- `src/components/app/automation-client.ts`: failure mapping (409 / 400 / 422 / other) to localized messages.
- `src/app/[locale]/app/automations/{page,missed-call/page,quotes/page,history/page,templates/page}.tsx`: headings, intros, status inputs, History in the business timezone.
- `src/product/sms-automation/runtime.ts`: `lookupSmsFrom` extracted (same behaviour) and `hasSmsSender` added.
- `tests/automations.spec.ts`: existing tests updated to the new copy and markup; 9 KAN-24 tests added.

**Created**

- `src/product/sms-automation/status.ts`: pure status logic.
- `src/product/sms-automation/status-input.ts`: loads the inputs. Sends the browser only status, type and times, never customer details.
- `src/components/app/AutomationStatus.tsx`: status pill and help text.
- `src/components/app/automation-copy.ts`: duration, hour and schedule sentences (no browser-locale formatting, so no hydration mismatch).
- `tests/unit/automations-copy.test.ts`: 33 unit tests.
- `docs/KAN-24-AUTOMATIONS-COPY.md`: this file.

## Before / after text

Generated from `git show HEAD:src/messages/{en,fr}.json` against the working tree, so nothing is retyped by hand. Rows whose text did not change are omitted. "(none)" means the screen had no text there before; "(new)" means the new copy has no counterpart in the old one. `{…}` are values filled in at display time.

### English

| Where | Before | After |
| --- | --- | --- |
| Page heading | Automations | Automatic Follow-Ups |
| Page introduction | Configure recovery texts and quote reminders. Messages are sent by the backend even when you are not signed in, and only after the current customer, consent and schedule are checked again. | Never miss an opportunity. Automatically follow up with customers, send quote reminders, and stay connected without lifting a finger. TradeCatch handles everything for you, even when you're offline. |
| Navigation: missed calls | Missed-call recovery | Missed-Call Follow-Up |
| Navigation: quotes | Quote follow-ups | Quote Reminders |
| Navigation: templates | Message templates | Message Templates |
| Name: missed_call_recovery | Missed-call recovery | Missed-Call Follow-Up |
| Name: quote_followup | Quote follow-up | Quote Reminders |
| Name: appointment_reminder | Appointment reminder | Appointment Reminders |
| Name: customer_reengagement | Customer re-engagement | Past-Customer Check-Ins |
| Name: urgent_lead_notification | Urgent lead notification | Urgent Request Alerts |
| Description: missed call | _(none)_ | Missed a call? TradeCatch can automatically send a message so you don't lose a potential customer. |
| Description: quotes | _(none)_ | Automatically remind customers about unanswered quotes and turn more opportunities into jobs. |
| Description: appointments | _(none)_ | Confirm each appointment and send a reminder the day before, so fewer visits are missed. |
| Description: past customers | _(none)_ | Reach out to customers you haven't heard from in a while. |
| Description: urgent requests | _(none)_ | Get alerted right away when a customer sends an urgent request. |
| Not available yet: past customers | Available after the two primary workflows | Coming soon. Only customers who agreed to receive promotions will be texted. Nothing is sent for now. |
| Not available yet: urgent requests | Available after the two primary workflows | Coming soon. Nothing is sent for now. |
| Missed-call page intro | When a call is missed and the rules allow it, TradeCatch schedules one recovery text in your business name. An answered call does not start this workflow. | Missed a call? TradeCatch can automatically send a message so you don't lose a potential customer. An answered call never starts this follow-up. |
| Quote page intro | Reminders go out only while an estimate is still unanswered. A reply, an acceptance or a rejection cancels what has not been submitted yet. | Automatically remind customers about unanswered quotes and turn more opportunities into jobs. Reminders stop as soon as the customer replies or the quote is accepted, declined or canceled. |
| Status: off | Inactive | Paused |
| Status: waiting texts | _(none)_ | Scheduled |
| Status: problem | _(none)_ | Needs Attention |
| Status text: off | _(none)_ | Turned off. No texts will be sent. |
| Status text: on | _(none)_ | Turned on and ready. Nothing is waiting to go out right now. |
| Status text: waiting | _(none)_ | {count, plural, one {# text is waiting to go out.} other {# texts are waiting to go out.}} |
| Status text: no business number | _(none)_ | Your business number is not set up for texting yet, so no texts can be sent. Contact support to finish setup. |
| Status text: paused by TradeCatch | _(none)_ | TradeCatch has paused missed-call texts for now, so none are being sent. Contact support if you did not expect this. |
| Status text: last text failed | _(none)_ | The last text could not be sent. Open History to see which one. |
| Status text: last text unconfirmed | _(none)_ | We could not confirm that the last text was sent, so it was not sent again. Open History to check. |
| Column: trigger → When it runs | Trigger | When it runs |
| Trigger text: missed call | Customer call missed | When a call goes unanswered, one text is sent about {delay} later. |
| Trigger text: quote | Quote remains unanswered | {kind, select, now {A reminder is sent as soon as you send a quote, and another {second} after you send it.} other {If a quote is still unanswered, reminders are sent {first} and {second} after you send it.}} |
| Trigger text: appointment | Appointment approaching | A confirmation is sent when an appointment is booked. A reminder follows about 24 hours before the visit. |
| Column: action | Action | _(removed)_ |
| Action text: missed call | Send SMS | _(removed)_ |
| Action text: quote | Send reminder | _(removed)_ |
| Action text: urgent lead | Notify contractor | _(removed)_ |
| Quiet hours: on | _(none)_ | Quiet hours are on. A call missed outside {start} to {end}{weekends, select, yes {} other {, or on a weekend,}} gets no text. |
| Quiet hours: off | _(none)_ | Quiet hours are off, so the caller gets the text at any hour. |
| Sending hours explained | _(none)_ | Texts only go out between {start} and {end}{weekends, select, yes {} other {, not on weekends}}. A text due outside those hours waits until they open. |
| How it works: title | _(none)_ | How automatic follow-ups work |
| How it works: on/off | _(none)_ | Use Enable to start a follow-up and Pause to stop it. You can change this at any time. |
| How it works: consent | _(none)_ | We only text people who called you, received your quote or booked an appointment. Anyone who replies STOP is not texted again. |
| How it works: re-check | _(none)_ | Each text is checked again just before it is sent. A paused follow-up sends nothing, even if a text was waiting. |
| How it works: timing | _(none)_ | Choose when texts go out, and set quiet hours, in each follow-up's settings. |
| Button: turn off | Disable | Pause |
| Button while turning off | Turning off… | Pausing… |
| Button: settings | Edit configuration | Edit Settings |
| Button: test | Test automation | Run a Test |
| Button: history | History | View History |
| Button: save | Save | Save Changes |
| Message: saved | Saved. | Changes saved. |
| Marker: unsaved | Not saved | Unsaved changes |
| Message: turned on | Turned on and saved. It runs on its own from now on. | Turned on. |
| Message: turned off | {count, plural, =0 {Turned off and saved.} one {Turned off and saved. 1 pending text was canceled.} other {Turned off and saved. # pending texts were canceled.}} | {count, plural, =0 {Paused.} one {Paused. 1 waiting text was canceled.} other {Paused. # waiting texts were canceled.}} |
| Generic error | Something went wrong. | Something went wrong. Please try again. |
| Label: texts sent | Successful | Texts sent |
| Label: replies | Responses | Replies |
| Label: could not send | Failures | Could not send |
| Label: last activity | Last execution | Last activity |
| No activity yet | None yet | No activity yet |
| Error: could not save | This could not be saved. The page shows what is stored. | We couldn't save that. The page shows what is currently saved. Please try again. |
| Error: too many changes | Too many changes in a short time. Try again in {seconds, plural, one {# second} other {# seconds}}. | You've made a lot of changes in a short time. Try again in {seconds, plural, one {# second} other {# seconds}}. |
| Error: no connection | The server could not be reached, so the change is not confirmed. The page shows what is stored. | We couldn't reach TradeCatch, so the change was not confirmed. Check your connection and try again. The page shows what is currently saved. |
| Error: briefly unavailable | The service is briefly unavailable. Try again in a moment. | TradeCatch is briefly unavailable. Please try again in a moment. |
| Error: no permission | You do not have permission to change automations. | You don't have permission to change these settings. Ask the account owner. |
| Error: signed out | Your session ended. Sign in again, then retry. | Your session has ended. Sign in again, then try again. |
| Error: not confirmed | The server did not confirm the change. The page shows what is stored. | We couldn't confirm the change. The page shows what is currently saved. |
| Error: refused information | _(none)_ | Some of the information couldn't be accepted. Check what you entered and try again. |
| Error: turn it on first | _(none)_ | Turn this follow-up on first, then try again. |
| Error: not available yet | _(none)_ | This follow-up isn't available yet. |
| Error: could not change | _(none)_ | That change couldn't be made right now. Reload the page and try again. |
| Validation: not a whole number | Use whole numbers only. | Enter whole numbers only. |
| Validation: first delay | The first delay must be a number of minutes from 0 to 43,200. | The first delay must be between 0 and 43,200 minutes (30 days). |
| Validation: second delay | The second delay must be at least as long as the first, and at most 86,400 minutes. | The second reminder can't come before the first, and must be within 86,400 minutes (60 days). |
| Validation: attempts / reminders | Maximum attempts must be between 1 and 5. | Enter a number of reminders from 1 to 5. |
| Validation: sending hours | The sending window must start before it ends, between 0 and 24. | Sending hours must start before they end, using hours from 0 to 24. |
| Validation: locked setting | This setting cannot be changed. | This setting can't be changed. |
| Settings section title | _(none)_ | Follow-Up Scheduling |
| Settings section help | _(none)_ | Choose when customers receive reminders. TradeCatch takes care of the rest. |
| Settings section: language and stop rules | _(none)_ | Language and Stop Rules |
| Field: first delay (missed call) | Initial delay | Send the text after (minutes) |
| Field: first delay (quote) | Initial delay | Send the first reminder after (minutes) |
| Field: second delay | Second reminder delay | Send the second reminder after (minutes) |
| Option: customer language | Customer preference | Match the customer's language |
| Field: attempts → reminders | Maximum attempts | Number of reminders |
| Help: reminders | _(none)_ | Up to 2 reminders are sent for each quote. Enter 1 to send only the first. |
| Field: window start | Sending window starts (hour) | Start sending at (hour, 0 to 24) |
| Field: window end | Sending window ends (hour) | Stop sending at (hour, 0 to 24) |
| Checkbox: weekends | Weekend sending | Also send on weekends |
| Checkbox: duplicates | Duplicate protection | Don't text the same caller twice within 24 hours |
| Checkbox: stop when a person takes over | Stop when a person takes over | Stop when someone on your team reaches out |
| Checkbox: quiet hours | No recovery text during quiet hours | Don't text during quiet hours |
| Help: quiet hours | Off: the caller gets the text right away, at any hour. On: a call missed outside the sending window below gets no text, rather than one that arrives hours later. | Off: the caller gets the text right away, at any hour. On: you choose your sending hours, and a call missed outside them gets no text, rather than one that arrives hours later. |
| Note: quotes always stop | Reminders always stop when the quote is accepted, rejected or canceled. | Reminders always stop once the quote is accepted, declined or canceled. |
| Hint under a timing box | _(none)_ | That is {duration}. |
| Quote list title | Scheduled reminders | Recent Quote Reminders |
| Quote list empty | No quote reminders are scheduled. | No quote reminders yet. They will appear here after you send a quote. |
| Templates title | Message templates | Message Templates |
| Templates intro | French and English texts. The business name and the STOP line stay required, so a customization cannot drop them. | Edit the texts your customers receive, in French and English. Every message must keep your business name and the “Reply STOP to opt out” line, so customers know who is texting them and can opt out. |
| Template: missed call | Missed-call recovery | Missed-call text |
| Template: quote 1 | Quote follow-up 1 | First quote reminder |
| Template: quote 2 | Quote follow-up 2 | Second quote reminder |
| Template: human assistance | Human assistance | Teammate follow-up |
| Template: after hours | After-hours response | After-hours missed-call text |
| Editor: insert | Insert a variable | Insert a detail |
| Editor: hint | _(none)_ | Details in double braces, like {example}, are filled in for each customer. |
| Editor: reset | Reset | Restore Default |
| Editor: parts of a text | SMS segments | Text parts |
| Editor: long message | This message may use more than one SMS segment and can cost more to deliver. | This message is long, so it may be sent as more than one text and cost a bit more. |
| Editor: missing | Missing values | Missing details |
| Editor error: business name | Keep the business name variable in the message, so customers know who is texting them. | Keep the business name (written {example}) in the message, so customers know who is texting them. |
| Editor error: unknown detail | The message uses a variable that does not exist. Use only the variables listed above the message. | The message uses a detail that doesn't exist. Use only the details listed above the message. |
| History title | Message history | Message History |
| History intro | Sent is not the same as delivered. Canceled rows never reached the telephone provider. | Every automatic text and what happened to it. “Sent” means it left TradeCatch. “Delivered” means it reached the customer's phone. Canceled and skipped texts were never sent. |
| History empty | No automated messages yet. | No automatic texts yet. They will appear here once a follow-up is turned on and sends its first text. |
| History column: result | Result | What happened |
| History column: sent | Submitted | Sent |
| History column: scheduled | Scheduled | Planned for |
| Job status: pending | _(none)_ | Scheduled |
| Job status: submitted | _(none)_ | Sent |
| Job status: failed | _(none)_ | Not sent |
| Job status: uncertain | _(none)_ | Not confirmed |
| Result: opted out | _(none)_ | Not sent: the customer asked not to receive texts |
| Result: missing consent | _(none)_ | Not sent: required customer consent was missing |
| Result: quiet hours | _(none)_ | Not sent: it was during quiet hours |
| Result: no business number | _(none)_ | Not sent: no business number is set up for texting |
| Test panel title | Test Center: simulated workflows | Try It Out With a Test Customer |
| Test panel intro | These actions use fictional numbers and never contact a real handset. Run the next action to execute a due simulated job immediately. | These tests use made-up phone numbers, so no real customer is ever texted. Turn the follow-up on first, then run a test to see what would happen. |
| Test button: missed call | Simulate missed call | Test a Missed Call |
| Test button: run next | Run next scheduled action | Send the Next Waiting Test Text |
| Test button: reply | Simulate customer reply | Test a Customer Reply |
| Test button: quote | Simulate quote | Test a Sent Quote |
| Test button: accept | Mark quote accepted | Test an Accepted Quote |
| Test result: nothing waiting | Nothing was due, so nothing was scheduled or sent. | Nothing was waiting, so no test text was sent. |

### French (Canadian)

| Where | Before | After |
| --- | --- | --- |
| Page heading | Automatisations | Suivis automatiques |
| Page introduction | Configurez les textos de récupération et les rappels de soumission. L'envoi se fait dans le serveur même si vous n'êtes pas connecté, et seulement après une nouvelle vérification du client, du consentement et de l'horaire. | Ne manquez plus aucune occasion. Relancez automatiquement vos clients, envoyez des rappels de soumission et gardez le contact sans effort. TradeCatch s'occupe des suivis, même lorsque vous n'êtes pas disponible. |
| Navigation: missed calls | Récupération d'appel manqué | Suivi des appels manqués |
| Navigation: quotes | Relances de soumission | Rappels de soumission |
| Name: missed_call_recovery | Récupération d'appel manqué | Suivi des appels manqués |
| Name: quote_followup | Relance de soumission | Rappels de soumission |
| Name: appointment_reminder | Rappel de rendez-vous | Rappels de rendez-vous |
| Name: customer_reengagement | Relance client inactif | Relance des anciens clients |
| Name: urgent_lead_notification | Avis de lead urgent | Alertes de demandes urgentes |
| Description: missed call | _(none)_ | Vous avez manqué un appel? TradeCatch peut envoyer automatiquement un message pour que vous ne perdiez pas un client potentiel. |
| Description: quotes | _(none)_ | Rappelez automatiquement à vos clients leurs soumissions sans réponse et transformez plus d'occasions en contrats. |
| Description: appointments | _(none)_ | Confirmez chaque rendez-vous et envoyez un rappel la veille, pour réduire les visites manquées. |
| Description: past customers | _(none)_ | Contactez les clients dont vous n'avez pas eu de nouvelles depuis un moment. |
| Description: urgent requests | _(none)_ | Soyez alerté tout de suite quand un client envoie une demande urgente. |
| Not available yet: past customers | Disponible après les deux flux principaux | Bientôt offert. Seuls les clients qui ont accepté de recevoir des promotions recevront un texto. Rien n'est envoyé pour le moment. |
| Not available yet: urgent requests | Disponible après les deux flux principaux | Bientôt offert. Rien n'est envoyé pour le moment. |
| Missed-call page intro | Lorsqu'un appel est manqué et que les règles le permettent, TradeCatch planifie un texto de récupération au nom de votre entreprise. Un appel répondu ne lance pas ce flux. | Vous avez manqué un appel? TradeCatch peut envoyer automatiquement un message pour que vous ne perdiez pas un client potentiel. Un appel auquel on a répondu ne déclenche jamais ce suivi. |
| Quote page intro | Les rappels partent seulement tant que la soumission reste sans réponse. Une réponse, une acceptation ou un refus annule ce qui n'a pas encore été remis au fournisseur. | Rappelez automatiquement à vos clients leurs soumissions sans réponse et transformez plus d'occasions en contrats. Les rappels s'arrêtent dès que le client répond ou que la soumission est acceptée, refusée ou annulée. |
| Status: on | Active | Actif |
| Status: off | Inactive | En pause |
| Status: waiting texts | _(none)_ | Planifié |
| Status: problem | _(none)_ | Attention requise |
| Status text: off | _(none)_ | Désactivé. Aucun texto ne sera envoyé. |
| Status text: on | _(none)_ | Activé et prêt. Aucun texto n'attend d'être envoyé pour le moment. |
| Status text: waiting | _(none)_ | {count, plural, one {# texto attend d'être envoyé.} other {# textos attendent d'être envoyés.}} |
| Status text: no business number | _(none)_ | Votre numéro d'entreprise n'est pas encore configuré pour les textos, donc aucun texto ne peut être envoyé. Communiquez avec le soutien pour terminer la configuration. |
| Status text: paused by TradeCatch | _(none)_ | TradeCatch a mis en pause les textos d'appel manqué pour le moment, donc aucun n'est envoyé. Communiquez avec le soutien si ce n'est pas ce que vous attendiez. |
| Status text: last text failed | _(none)_ | Le dernier texto n'a pas pu être envoyé. Ouvrez l'historique pour voir lequel. |
| Status text: last text unconfirmed | _(none)_ | Nous n'avons pas pu confirmer l'envoi du dernier texto, et il n'a pas été renvoyé. Ouvrez l'historique pour vérifier. |
| Column: trigger → When it runs | Déclencheur | Moment d'envoi |
| Trigger text: missed call | Appel client manqué | Lorsqu'un appel reste sans réponse, un texto est envoyé environ {delay} plus tard. |
| Trigger text: quote | Soumission sans réponse | {kind, select, now {Un rappel est envoyé dès que vous envoyez une soumission, puis un autre {second} après son envoi.} other {Si une soumission reste sans réponse, des rappels sont envoyés {first} et {second} après son envoi.}} |
| Trigger text: appointment | Rendez-vous qui approche | Une confirmation est envoyée lorsqu'un rendez-vous est pris. Un rappel suit environ 24 heures avant la visite. |
| Column: action | Action | _(removed)_ |
| Action text: missed call | Envoyer un texto | _(removed)_ |
| Action text: quote | Envoyer un rappel | _(removed)_ |
| Action text: urgent lead | Aviser l'entrepreneur | _(removed)_ |
| Quiet hours: on | _(none)_ | Les heures de silence sont activées. Un appel manqué en dehors de {start} à {end}{weekends, select, yes {} other {, ou la fin de semaine,}} ne reçoit aucun texto. |
| Quiet hours: off | _(none)_ | Les heures de silence sont désactivées : l'appelant reçoit le texto à toute heure. |
| Sending hours explained | _(none)_ | Les textos sont envoyés seulement entre {start} et {end}{weekends, select, yes {} other {, sauf la fin de semaine}}. Un texto prévu en dehors de ces heures attend leur reprise. |
| How it works: title | _(none)_ | Comment fonctionnent les suivis automatiques |
| How it works: on/off | _(none)_ | Utilisez Activer pour démarrer un suivi et Mettre en pause pour l'arrêter. Vous pouvez changer d'avis en tout temps. |
| How it works: consent | _(none)_ | Nous écrivons seulement aux personnes qui vous ont appelé, qui ont reçu votre soumission ou qui ont pris un rendez-vous. Quiconque répond STOP ne reçoit plus de textos. |
| How it works: re-check | _(none)_ | Chaque texto est vérifié de nouveau juste avant son envoi. Un suivi en pause n'envoie rien, même si un texto était en attente. |
| How it works: timing | _(none)_ | Choisissez le moment des envois et les heures de silence dans les réglages de chaque suivi. |
| Button: turn off | Désactiver | Mettre en pause |
| Button while turning off | Désactivation… | Mise en pause… |
| Button: settings | Modifier la configuration | Modifier les réglages |
| Button: test | Tester l'automatisation | Faire un essai |
| Button: history | Historique | Voir l'historique |
| Button: save | Enregistrer | Enregistrer les modifications |
| Message: saved | Enregistré. | Modifications enregistrées. |
| Marker: unsaved | Non enregistré | Modifications non enregistrées |
| Message: turned on | Activé et enregistré. Il fonctionne désormais seul. | Activé. |
| Message: turned off | {count, plural, =0 {Désactivé et enregistré.} one {Désactivé et enregistré. 1 texto en attente a été annulé.} other {Désactivé et enregistré. # textos en attente ont été annulés.}} | {count, plural, =0 {En pause.} one {En pause. 1 texto en attente a été annulé.} other {En pause. # textos en attente ont été annulés.}} |
| Generic error | Une erreur s'est produite. | Une erreur s'est produite. Veuillez réessayer. |
| Label: texts sent | Réussites | Textos envoyés |
| Label: could not send | Échecs | Envois impossibles |
| Label: last activity | Dernière exécution | Dernière activité |
| No activity yet | Aucun pour le moment | Aucune activité pour le moment |
| Error: could not save | L'enregistrement a échoué. La page affiche ce qui est enregistré. | Nous n'avons pas pu enregistrer ce changement. La page affiche ce qui est actuellement enregistré. Veuillez réessayer. |
| Error: too many changes | Trop de changements en peu de temps. Réessayez dans {seconds, plural, one {# seconde} other {# secondes}}. | Vous avez fait beaucoup de changements en peu de temps. Réessayez dans {seconds, plural, one {# seconde} other {# secondes}}. |
| Error: no connection | Le serveur n'a pas pu être joint, le changement n'est donc pas confirmé. La page affiche ce qui est enregistré. | Nous n'avons pas pu joindre TradeCatch, donc le changement n'est pas confirmé. Vérifiez votre connexion et réessayez. La page affiche ce qui est actuellement enregistré. |
| Error: briefly unavailable | Le service est brièvement indisponible. Réessayez dans un instant. | TradeCatch est brièvement indisponible. Réessayez dans un instant. |
| Error: no permission | Vous n'avez pas la permission de modifier les automatisations. | Vous n'avez pas la permission de modifier ces réglages. Adressez-vous au propriétaire du compte. |
| Error: signed out | Votre session a pris fin. Reconnectez-vous, puis réessayez. | Votre session est terminée. Reconnectez-vous, puis réessayez. |
| Error: not confirmed | Le serveur n'a pas confirmé le changement. La page affiche ce qui est enregistré. | Nous n'avons pas pu confirmer le changement. La page affiche ce qui est actuellement enregistré. |
| Error: refused information | _(none)_ | Certains renseignements n'ont pas pu être acceptés. Vérifiez ce que vous avez saisi et réessayez. |
| Error: turn it on first | _(none)_ | Activez d'abord ce suivi, puis réessayez. |
| Error: not available yet | _(none)_ | Ce suivi n'est pas encore offert. |
| Error: could not change | _(none)_ | Ce changement n'a pas pu être fait pour le moment. Rechargez la page et réessayez. |
| Validation: not a whole number | Utilisez uniquement des nombres entiers. | Entrez des nombres entiers seulement. |
| Validation: first delay | Le premier délai doit être un nombre de minutes entre 0 et 43 200. | Le premier délai doit être entre 0 et 43 200 minutes (30 jours). |
| Validation: second delay | Le deuxième délai doit être au moins égal au premier, et d'au plus 86 400 minutes. | Le deuxième rappel ne peut pas venir avant le premier, et doit se situer dans les 86 400 minutes (60 jours). |
| Validation: attempts / reminders | Le nombre maximal de tentatives doit être entre 1 et 5. | Entrez un nombre de rappels de 1 à 5. |
| Validation: sending hours | La plage d'envoi doit commencer avant de se terminer, entre 0 et 24. | Les heures d'envoi doivent commencer avant de se terminer, avec des heures de 0 à 24. |
| Settings section title | _(none)_ | Planification des suivis |
| Settings section help | _(none)_ | Choisissez quand vos clients reçoivent les rappels. TradeCatch s'occupe du reste. |
| Settings section: language and stop rules | _(none)_ | Langue et règles d'arrêt |
| Field: first delay (missed call) | Délai initial | Envoyer le texto après (minutes) |
| Field: first delay (quote) | Délai initial | Envoyer le premier rappel après (minutes) |
| Field: second delay | Délai du second rappel | Envoyer le deuxième rappel après (minutes) |
| Option: customer language | Préférence du client | Selon la langue du client |
| Field: attempts → reminders | Nombre maximal de tentatives | Nombre de rappels |
| Help: reminders | _(none)_ | Jusqu'à 2 rappels sont envoyés pour chaque soumission. Entrez 1 pour envoyer seulement le premier. |
| Field: window start | Début de la plage d'envoi (heure) | Commencer l'envoi à (heure, de 0 à 24) |
| Field: window end | Fin de la plage d'envoi (heure) | Arrêter l'envoi à (heure, de 0 à 24) |
| Checkbox: weekends | Envoi la fin de semaine | Envoyer aussi la fin de semaine |
| Checkbox: duplicates | Protection contre les doublons | Ne pas envoyer deux textos au même appelant en 24 heures |
| Checkbox: stop when a person takes over | Arrêter quand une personne prend le relais | Arrêter quand quelqu'un de votre équipe communique avec le client |
| Checkbox: quiet hours | Aucun texto de rappel pendant les heures de silence | Ne pas envoyer de texto pendant les heures de silence |
| Help: quiet hours | Désactivé : l'appelant reçoit le texto tout de suite, à toute heure. Activé : un appel manqué en dehors de la plage d'envoi ci-dessous ne reçoit aucun texto, plutôt qu'un texto qui arrive des heures plus tard. | Désactivé : l'appelant reçoit le texto tout de suite, à toute heure. Activé : vous choisissez vos heures d'envoi, et un appel manqué en dehors de ces heures ne reçoit aucun texto, plutôt qu'un texto qui arrive des heures plus tard. |
| Note: quotes always stop | Les rappels s'arrêtent toujours quand la soumission est acceptée, refusée ou annulée. | Les rappels s'arrêtent toujours dès que la soumission est acceptée, refusée ou annulée. |
| Hint under a timing box | _(none)_ | Soit {duration}. |
| Quote list title | Rappels planifiés | Rappels de soumission récents |
| Quote list empty | Aucun rappel de soumission n'est planifié. | Aucun rappel de soumission pour le moment. Ils apparaîtront ici après l'envoi d'une soumission. |
| Templates intro | Textes en français et en anglais. Le nom de l'entreprise et la mention STOP restent obligatoires : une personnalisation ne peut pas les retirer. | Modifiez les textos que reçoivent vos clients, en français et en anglais. Chaque message doit garder le nom de votre entreprise et la mention « Répondez STOP pour vous désabonner », pour que les clients sachent qui leur écrit et puissent se désabonner. |
| Template: missed call | Récupération d'appel manqué | Texto d'appel manqué |
| Template: quote 1 | Relance de soumission 1 | Premier rappel de soumission |
| Template: quote 2 | Relance de soumission 2 | Deuxième rappel de soumission |
| Template: human assistance | Aide humaine | Suivi par un membre de l'équipe |
| Template: after hours | Réponse hors heures | Texto d'appel manqué (hors des heures d'ouverture) |
| Editor: insert | Insérer une variable | Insérer un renseignement |
| Editor: hint | _(none)_ | Les renseignements entre doubles accolades, comme {example}, sont remplis pour chaque client. |
| Editor: reset | Réinitialiser | Rétablir par défaut |
| Editor: parts of a text | Segments SMS | Parties du texto |
| Editor: long message | Ce message peut utiliser plus d'un segment SMS et coûter plus cher à livrer. | Ce message est long : il peut être envoyé en plus d'un texto et coûter un peu plus cher. |
| Editor: missing | Valeurs manquantes | Renseignements manquants |
| Editor error: business name | Gardez la variable du nom de l’entreprise dans le message, pour que les clients sachent qui leur écrit. | Gardez le nom de l'entreprise (écrit {example}) dans le message, pour que les clients sachent qui leur écrit. |
| Editor error: unknown detail | Le message utilise une variable qui n’existe pas. Utilisez seulement les variables indiquées au-dessus du message. | Le message utilise un renseignement qui n'existe pas. Utilisez seulement ceux qui sont indiqués au-dessus du message. |
| History intro | Envoyé n'est pas la même chose que livré. Une ligne annulée n'a jamais été remise au fournisseur téléphonique. | Chaque texto automatique et ce qui lui est arrivé. « Envoyé » veut dire qu'il a quitté TradeCatch. « Livré » veut dire qu'il est arrivé sur le téléphone du client. Un texto annulé ou ignoré n'a jamais été envoyé. |
| History empty | Aucun message automatisé pour le moment. | Aucun texto automatique pour le moment. Ils apparaîtront ici dès qu'un suivi activé en aura envoyé un. |
| History column: result | Résultat | Ce qui s'est passé |
| History column: sent | Remis | Envoyé |
| History column: scheduled | Planifié | Prévu pour |
| Job status: pending | _(none)_ | Planifié |
| Job status: submitted | _(none)_ | Envoyé |
| Job status: failed | _(none)_ | Non envoyé |
| Job status: uncertain | _(none)_ | Non confirmé |
| Result: opted out | _(none)_ | Non envoyé : le client a demandé de ne plus recevoir de textos |
| Result: missing consent | _(none)_ | Non envoyé : le consentement requis du client manquait |
| Result: quiet hours | _(none)_ | Non envoyé : c'était pendant les heures de silence |
| Result: no business number | _(none)_ | Non envoyé : aucun numéro d'entreprise n'est configuré pour les textos |
| Test panel title | Centre de test : flux simulés | Faire un essai avec un client fictif |
| Test panel intro | Ces actions utilisent des numéros fictifs et ne contactent jamais un vrai téléphone. Exécutez la prochaine action pour lancer immédiatement un travail simulé dû. | Ces essais utilisent de faux numéros de téléphone : aucun vrai client ne reçoit de texto. Activez d'abord le suivi, puis lancez un essai pour voir ce qui se passerait. |
| Test button: missed call | Simuler un appel manqué | Essayer un appel manqué |
| Test button: run next | Exécuter la prochaine action planifiée | Envoyer le prochain texto d'essai en attente |
| Test button: reply | Simuler une réponse client | Essayer une réponse de client |
| Test button: quote | Simuler une soumission | Essayer l'envoi d'une soumission |
| Test button: accept | Marquer la soumission acceptée | Essayer une soumission acceptée |
| Test result: nothing waiting | Rien n’était prévu : aucun message n’a été planifié ni envoyé. | Rien n'était en attente : aucun texto d'essai n'a été envoyé. |

## Verification

Run on 2026-11-19 in `.worktrees/kan-24-automations-copy` against the e2e harness (in-memory stores, never the production `.env.local`).

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean |
| `npm run lint` (`--max-warnings=0`) | Clean |
| `npm run check:i18n` | OK, 3169 keys, same keys in EN and FR |
| `npm run format:check` | Clean (the repo gate only covers `missed-call`, `lib`, `api`) |
| `npm run test:unit` | 3199 tests: 3195 pass, 3 skipped, **1 fail** (see below) |
| `tests/unit/automations-copy.test.ts` | 33 of 33 pass |
| Playwright `tests/automations.spec.ts`, webpack production build, system Chrome | 24 of 24 pass (15 existing, updated to the new copy, plus 9 new KAN-24 tests) |
| Visual pass, EN and FR, 1280px and 390px | Overview, missed-call, quotes, templates and history reviewed from screenshots. Cards wrap cleanly, no clipped buttons, no sideways scroll |

The one unit failure is `call-activity.test.ts` "shows the stored UTC time in the business's own zone" (expects 7:05, gets 6:05 a.m.). It is a time-zone data difference on this Node, in a file this work does not touch, and it failed before this work.

A defect found and fixed during verification: the quiet-hours help said "you choose your sending hours **below**", but the hour fields render above that checkbox. The word is removed in both languages and the e2e assertion updated. The built app was rebuilt and the full spec re-run after the fix.

### Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Every automation has a clear, accurate description | Names and descriptions for all 5 in both languages; the 3 ticket texts are asserted word for word in a unit test and in e2e. Wording was checked against the code paths listed under "What the copy says about timing and consent". |
| No unexplained jargon remains | A unit test bans backend, webhook, API, trigger, execution, pipeline, SMS, workflow, provider, handset, segment, variable, AI / virtual assistant (and French equivalents) across every `app.automations` string. E2e re-checks the rendered text of the overview, settings, templates and history pages. A second test fails if any internal code (snake_case) shows in a sentence. |
| Both languages display correctly | EN/FR key and placeholder parity is tested. The French overview, failure messages and settings were driven in a browser and reviewed in screenshots. No English label leaks onto the French screen (e2e). |
| No overflow on buttons, cards or mobile | E2e at 360px: ten pages (5 EN, 5 FR) with every automation turned on. It fails on page-level horizontal scroll, any element past the viewport, or text overflowing its own button, link, label or status pill. Passed. Screenshots at 390px agree. |
| Existing controls still work | All 15 existing automation tests pass: enable and pause, 50 rapid clicks, failed or lost responses, rate limiting, save and unsaved state, tenant isolation, sign-out and back, templates. |
| Copy reflects real scheduling, eligibility and consent | Schedule sentences are generated from the stored settings, and unit tests compare them with `defaultConfig`. The status logic has 11 unit cases. Copy never promises a text while paused, switched off by TradeCatch, without a number, or for the two unavailable automations. |
| Switching language does not affect saved settings | E2e saves a switch, a delay and a checkbox in English, reads them in French, changes one in French, and reads it back in English. |
| Existing design system kept | Existing color tokens and button and input classes reused; no stylesheet changes. |

### Not run, or not possible here

- **Native French review.** The French copy follows Canadian usage (soumission, texto, la fin de semaine, "Vous avez manqué un appel?") but has not been read by a native speaker. Recommend one pass before release.
- **Other browsers and real devices.** Only Chrome (desktop, with a 360px and a 390px viewport) was run. Firefox, Safari and a real phone were not.
- **Live behaviour.** Nothing was sent to a real phone and nothing was run against production or the production database. The harness has no business number, so the "Active" and "Scheduled" states are covered by unit tests of the status function and not by e2e. In e2e an enabled follow-up correctly shows Needs Attention.
- **Postgres path.** Only the in-memory stores were exercised; the status inputs were not run against a real database.
- **Help center.** Help articles and the screenshots `public/help/automations-en.png` and `automations-fr.png` still show the old screen.

## Decisions for the owner

1. **Hidden controls.** Missed-call "Maximum attempts" and quote "Duplicate protection" are no longer shown. They have no effect for those automations (missed call sends once; quote reminders use their own rules). Saving sends only the fields you changed, so values already stored are left as they are.
2. **Number of reminders.** The quote box still accepts 1 to 5, as the server does, but the scheduler only ever sends 2. The help text says "Up to 2 reminders". The server limit is outside this ticket's scope.
3. **Needs Attention is broader than "an error".** It also shows when the business has no number to text from, and when TradeCatch has paused missed-call texts. Both are real reasons no text will go out.
4. **Navigation labels.** The sidebar and account links (`app.nav.automations`, `groupAutomations`, `app.account.setupAutomations`, settings "followUps") still say "Automations". The ticket scoped the page, not the navigation. Renaming them is a small follow-up.
5. **Counts include test texts.** The card says so in a footnote.
6. **Template language.** The template editor can open on a template in a different language than the screen (a French template under the English screen, in the harness). That is existing behaviour and unchanged.
7. **Deploy.** Not deployed, and not committed. Per the ticket, KAN-24 should not be marked complete until the owner has reviewed the French and the open items above, and deployment needs approval.
