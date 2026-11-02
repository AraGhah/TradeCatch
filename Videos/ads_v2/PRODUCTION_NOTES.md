# TradeCatch ads v2 - production notes

Three 9:16 video ads (1080x1920, 24 fps, H.264 + AAC, about -14 LUFS / -1.5 dBTP), each in English and Québec French. They are **dramatizations with a fictional business** (NorthStar Plumbing / NorthStar Electric, Laval). No real customer, testimonial, statistic or result appears. The originals in `Videos/` were not touched.

## Deliverables

| Ad | Concept | EN | FR |
|---|---|---|---|
| A | **Under the Sink** - plumber, daytime. AI receptionist answers, answers questions, takes an appointment request | 44.0s | 49.1s |
| B | **The Ladder** - electrician. A missed call gets an instant text back (SMS receptionist) | 30.3s | 31.5s |
| C | **After Hours** - night. Emergency call is transferred to the on-call line; the rest waits as a morning summary | 31.2s | 33.4s |

- `TradeCatch_<ad>_<name>_<LANG>_9x16.mp4` - masters (Instagram Reels, Facebook Reels/Stories, TikTok, YouTube Shorts)
- `web/*_web.mp4` - 720x1280, smaller files for the website
- `posters/*.jpg` - still frame from the opening hook (video poster / thumbnail)
- `_source/` - the whole pipeline (scripts, UI renderer, mixer, generated voice/SFX/music assets); `python build_ads.py <A|B|C> <en|fr>` rebuilds a master

## Why these ads work (marketing psychology, kept honest)

| Model | Where it shows up | Guardrail |
|---|---|---|
| **Identification / pattern interrupt** | Opens mid-job, hands full, phone ringing: the contractor sees their own day in the first second | No exaggeration, no staged panic |
| **Loss aversion** | "That caller isn't leaving a voicemail. They're calling the next plumber." The missed call is framed as a lost job | No invented statistic; the line says "plenty of callers" / "bien des gens" |
| **Before / after contrast** | A: same job, this time TradeCatch picks up. B: the text-back thread. C: the overnight summary | The "after" shows only what the product does (see compliance) |
| **Specificity** | A real-looking address, a real task (kitchen sink, outlet, flooded basement), a visible call summary | All names, numbers and addresses are fictional; the summary is labelled "Sample summary - not a real customer" |
| **Low-friction CTA / risk reversal** | One action: book a free audit. Brand line, then action line, then the button | No fake urgency or scarcity. Prices are deliberately not in 30-45 s ads |

## Scripts (as recorded)

### Ad A - Under the Sink

**English**

| Voice | Line |
|---|---|
| Narrator | You're under a sink. Your phone's ringing. And you can't answer. |
| Narrator | That caller isn't leaving a voicemail. They're calling the next plumber. |
| Caller | [sighs] Come on... |
| Narrator | Same job. This time, TradeCatch picks up. |
| AI receptionist | Thanks for calling NorthStar Plumbing. How can I help? |
| Caller | Hi - my kitchen sink is leaking. Do you cover Laval? |
| AI receptionist | We do. What's your address, and when works best? |
| Caller | 45 Laurier, in Laval. Tomorrow morning, around ten? |
| AI receptionist | Perfect. I've sent your request to the team. They'll text you to confirm. |
| Narrator | You stay on the job. TradeCatch answers, and hands you the details. |
| Narrator | TradeCatch. Every call counts. |
| Narrator | Book your free audit at trade catch dot C A. |

**Français (Québec, tutoiement for the narrator)**

| Voice | Line |
|---|---|
| Narrator | Les mains sous l'évier. Le téléphone qui sonne. Et tu ne peux pas répondre. |
| Narrator | Ce client-là ne laissera pas de message. Il va appeler le prochain plombier. |
| Caller | [sighs] Ah, voyons donc... |
| Narrator | Même chantier. Cette fois, Tréïd Catch décroche. |
| AI receptionist | Merci d'avoir appelé Plomberie NorthStar. Comment puis-je vous aider? |
| Caller | Bonjour, l'évier de ma cuisine fuit. Vous desservez Laval? |
| AI receptionist | Oui, nous desservons Laval. Quelle est votre adresse, et quel moment vous conviendrait? |
| Caller | Au 45, avenue Laurier, à Laval. Demain matin, vers dix heures? |
| AI receptionist | Parfait. J'ai transmis votre demande à l'équipe. Elle vous écrira pour confirmer. |
| Narrator | Tu restes sur ton chantier. Tréïd Catch répond, et te remet les détails. |
| Narrator | Tréïd Catch. Chaque appel compte. |
| Narrator | Réserve ton audit gratuit sur tradecatch point C A. |

### Ad B - The Ladder

**English**

| Voice | Line |
|---|---|
| Narrator | You're an electrician. Not a receptionist. |
| Narrator | Plenty of callers won't leave a voicemail. They'll just call someone else. |
| Narrator | With TradeCatch, a missed call gets a text back right away, under your company's name. |
| Narrator | You wrap up the job. The request is already waiting. |
| Narrator | TradeCatch. Every call counts. |
| Narrator | Book your free audit at trade catch dot C A. |

**Français (Québec, tutoiement for the narrator)**

| Voice | Line |
|---|---|
| Narrator | Tu es électricien. Pas réceptionniste. |
| Narrator | Bien des gens ne laissent pas de message. Ils appellent quelqu'un d'autre. |
| Narrator | Avec Tréïd Catch, un appel manqué reçoit un texto tout de suite, au nom de ton entreprise. |
| Narrator | Tu termines ta job. La demande est déjà là. |
| Narrator | Tréïd Catch. Chaque appel compte. |
| Narrator | Réserve ton audit gratuit sur tradecatch point C A. |

### Ad C - After Hours

**English**

| Voice | Line |
|---|---|
| Narrator | Your customers don't stop calling at five. |
| AI receptionist | Thanks for calling NorthStar Plumbing. You've reached us after hours. How can I help? |
| Caller | My basement is flooding! I need someone right now! |
| AI receptionist | I understand, this is urgent. I'm connecting you to the on-call technician right now. |
| Narrator | Real emergencies reach your on-call line. Everything else is waiting in the morning, with a summary. |
| Narrator | TradeCatch. Every call counts. |
| Narrator | Book your free audit at trade catch dot C A. |

**Français (Québec, tutoiement for the narrator)**

| Voice | Line |
|---|---|
| Narrator | Tes clients n'appellent pas seulement de neuf à cinq. |
| AI receptionist | Merci d'avoir appelé Plomberie NorthStar. Nous sommes fermés pour la soirée. Comment puis-je vous aider? |
| Caller | Mon sous-sol est inondé! J'ai besoin de quelqu'un tout de suite! |
| AI receptionist | Je comprends, c'est urgent. Je vous transfère immédiatement au technicien de garde. |
| Narrator | Les vraies urgences rejoignent ta ligne de garde. Le reste est là le matin, avec un résumé. |
| Narrator | Tréïd Catch. Chaque appel compte. |
| Narrator | Réserve ton audit gratuit sur tradecatch point C A. |

On-screen text is limited to product UI (call screen, messages, call summary) and the end card. There are no subtitles or captions.

## Compliance with the product as it actually is

Checked against `docs/CAPABILITY_MATRIX.md` and `src/lib/plans.ts`:

- The AI receptionist, phone booking, transfers and summaries are a **founder-configured pilot** not yet validated on live Twilio traffic. The end card says so ("Dramatization with a fictional business. Receptionist is a founder-configured pilot.").
- The caller's appointment is an **appointment request the team confirms**, never "booked automatically". The receptionist says "I've sent your request to the team. They'll text you to confirm".
- No "24/7" claim (the old end card had one). Plan prices are not shown; current CAD pricing stays on the website.
- The CTA matches the website: "Book a free 20-minute audit" (EN button) / "Réserver un audit gratuit" (FR button).
- Phone numbers use the reserved 555-01xx style. The brand is spoken "Tréïd Catch" in French so the voice pronounces it correctly; it is written TradeCatch everywhere on screen.

## Technical specs and audio

- Picture: re-graded and re-timed footage (denoise, light sharpening, grade, vignette, film grain, slow push-in with handheld drift) + deterministic phone-UI scenes rendered at 1080x1920 + a branded end card (Archivo 800, orange `#e4762b` on navy `#0c141e`).
- Voices: ElevenLabs v3 (distinct casting per role and language). In-call voices are band-limited like a real phone line; narration is full-band. Call audio is muffled when we cut to the contractor's room.
- Sound design: generated Foley and phone sounds placed from measured timings, synthesized room tone, instrumental ElevenLabs Music beds that duck under speech, a short brand sting on the end card.
- Master: two-pass loudness normalisation to -14 LUFS, true peak -1.5 dBTP, H.264 High / yuv420p / AAC 256 kbps / faststart.
- QA performed: contact sheets of every master, loudness per 3-second window, speech-to-text of the final mix against the script (all lines intelligible, no dropped words).

## Limitations - read before publishing

1. **No generative video model was available** (no video-generation API key in the environment). I could not create new photoreal footage. The people shown are the existing AI-generated clips from `Videos/`, re-edited and upscaled from 720p to 1080p. I designed every shot so nobody on camera needs lip-sync, and avoided the clips' worst frames (morphing hands, odd reaches), but it is still AI footage. For truly cinematic shots, supply a video-generation key (Sora/Veo/Kling/Runway) or real footage and re-run the pipeline.
2. **I could not listen to the audio.** Quality was checked by measurement and by transcribing the final mixes. Do a listening pass for voice warmth, music taste and the French brand pronunciation.
3. **No 4:5 feed crops.** Cropping the 9:16 masters would cut off the phone screens, so they were not produced. Facebook Reels/Stories and the other platforms use 9:16.
4. **Pilot status.** The receptionist and transfer behaviour shown is the pilot configuration; do not run these as paid ads before the matrix items are validated or the end-card line is reviewed.
5. **ElevenLabs usage** (voices, sound effects, music, transcription checks) was billed to the account whose key is in `.env.local`.
