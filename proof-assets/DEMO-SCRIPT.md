# TradeCatch — controlled-pilot product demo script

Use this approved script for the interactive demo and replacement EN/FR video exports. It follows `docs/CAPABILITY_MATRIX.md`; do not strengthen any status claim during recording.

The current text sources are synchronized. Narration MP3s and MP4 exports must be regenerated after script changes before the new wording can be published.

## English — 77 seconds

| Time      | Visual                                                  | Approved voiceover                                                                                                                                                  |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:07 | Contractor working; incoming call becomes a missed call | “You already paid to make the phone ring. But when you are working, you cannot always answer.”                                                                      |
| 0:07–0:16 | Automatic bilingual SMS                                 | “In a controlled pilot, TradeCatch texts back within seconds, under your company's name. The customer stays engaged instead of calling your competitor.”            |
| 0:16–0:28 | Customer qualification by text and photo                | “It collects the customer's name, problem, urgency, address, and a photo while you stay on the job. When you check your phone, the lead is already qualified.”      |
| 0:28–0:38 | Technician job summary and response actions             | “The right technician receives one clear job summary. They can accept, decline, or call; a backup can be alerted if no one responds.”                               |
| 0:38–0:46 | Customer notification and in-app booking                | “Acceptance notifies the customer. Entitled, linked Growth pilot organizations book in-app—without native Google or Outlook sync.”                                  |
| 0:46–0:58 | Scheduled quote follow-up and pipeline example          | “Starter pilots can follow up on quotes on days 1, 3, 7, and 14. A reply stops the sequence; the pipeline is only for entitled, linked Growth pilot organizations.” |
| 0:58–1:07 | Illustrative weekly dashboard                           | “Figures are illustrative, not promised results. Workspaces show linked-organization data only—not self-serve SaaS or native two-way CRM.”                          |
| 1:07–1:17 | TradeCatch audit CTA                                    | “Stop losing jobs when you cannot answer. Get your free missed-opportunity audit with TradeCatch.”                                                                  |

Optional on-screen lower-third: `Controlled pilot walkthrough · Illustrative data · No results guarantee`

## Français — 89 secondes

| Temps     | Visuel                                                           | Voix approuvée                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:09 | Entrepreneur au travail; l'appel entrant devient un appel manqué | « Vous avez déjà payé pour faire sonner le téléphone. Mais quand vous travaillez, vous ne pouvez pas toujours répondre. »                                                                             |
| 0:09–0:19 | Texto bilingue automatique                                       | « Dans un pilote contrôlé, TradeCatch renvoie un texto en quelques secondes, au nom de votre entreprise. Le client reste engagé au lieu d'appeler votre concurrent. »                                 |
| 0:19–0:32 | Qualification du client par texto et photo                       | « Le système recueille le nom du client, le problème, l'urgence, l'adresse et une photo pendant que vous poursuivez le travail. Quand vous regardez votre téléphone, la demande est déjà qualifiée. » |
| 0:32–0:43 | Fiche d'intervention et actions du technicien                    | « Le bon technicien reçoit une fiche d'intervention claire. Il peut accepter, refuser ou appeler. Un remplaçant peut être alerté si personne ne répond. »                                             |
| 0:43–0:53 | Avis au client et réservation dans l'espace                      | « L'acceptation avise le client. Les organisations pilotes Growth admissibles et liées réservent dans l'espace; Google et Outlook ne sont pas synchronisés nativement. »                              |
| 0:53–1:06 | Relance planifiée et exemple de pipeline                         | « Les pilotes Starter relancent les soumissions aux jours 1, 3, 7 et 14. Une réponse met fin à la séquence; le pipeline est réservé aux organisations pilotes Growth admissibles et liées. »          |
| 1:06–1:17 | Tableau de bord hebdomadaire illustratif                         | « Les chiffres sont illustratifs, sans promesse de résultats. L'espace montre seulement les données de l'organisation liée, sans SaaS en libre-service ni CRM bidirectionnel natif. »                 |
| 1:17–1:29 | Appel à l'action pour l'audit TradeCatch                         | « Ne perdez plus de contrats parce que vous ne pouvez pas répondre. Obtenez votre audit gratuit des opportunités manquées avec TradeCatch. »                                                          |

Bandeau facultatif : `Parcours pilote contrôlé · Données illustratives · Aucune garantie de résultats`

## Capability boundaries that must remain explicit

- Missed-call text-back, customer qualification, technician actions, and escalation are a controlled pilot path—not a production-ready claim.
- Scheduled quote follow-up is a Starter pilot feature and stops on reply, opt-out, won/lost status, or human takeover.
- In-app booking, pipeline, revenue attribution, Google review requests, and the activity timeline are Growth pilot modules only for entitled organizations linked to the workspace.
- The dashboard scene, company, customers, job values, and weekly figures are illustrative. They are not customer results or a performance promise.
- TradeCatch is a founder-led pilot, not a self-serve SaaS launch.
- There is no native Google or Outlook calendar synchronization and no native two-way CRM synchronization. The pilot can use a separately configured outbound CRM/automation webhook.

## Recording checklist

- [ ] Use a configured pilot or local demo environment; never show real personal information.
- [ ] Keep the pilot labels visible in the booking, quote/pipeline, and dashboard scenes.
- [ ] Do not show unapproved contractor logos, testimonials, star ratings, or outcome claims.
- [ ] Do not call the workflow “live” or “production-ready” unless the deployed health checks and acceptance test are green.
- [ ] Regenerate all 16 narration MP3s from `scripts/generate-demo-narration.py`.
- [ ] Measure the regenerated narration and confirm no sentence is clipped by a scene boundary.
- [ ] Export 1080p MP4s and verify audio, visuals, and captions from beginning to end.
- [ ] Confirm the English caption track ends at 1:17 and the French track ends at 1:29, with no gaps.

## Published filenames

- `public/demo-video/TradeCatch-Demo-EN.mp4`
- `public/demo-video/TradeCatch-Demo-FR.mp4`
- `public/demo-video/captions/en.vtt`
- `public/demo-video/captions/fr.vtt`
