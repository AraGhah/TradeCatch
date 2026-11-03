# TradeCatch ads v2 - production notes

Three video ads (24 fps, H.264 + AAC, about -14 LUFS / -1.5 dBTP), each in English and Québec French, each in two shapes: 9:16 (1080x1920) for Reels/Stories/TikTok/Shorts and a native 4:5 re-layout (1080x1350) for the Instagram and Facebook feeds. They are **dramatizations with a fictional business** (NorthStar Plumbing / NorthStar Electric, Laval). No real customer, testimonial, statistic or result appears. The originals in `Videos/` were not touched.

## Deliverables

| Ad | Concept | EN | FR |
|---|---|---|---|
| A | **Under the Sink** - plumber, daytime. AI receptionist answers, answers questions, takes an appointment request | 44.0s | 49.1s |
| B | **The Ladder** - electrician. A missed call gets an instant text back (SMS receptionist) | 30.3s | 31.5s |
| C | **After Hours** - night. Emergency call is transferred to the on-call line; the rest waits as a morning summary | 31.2s | 33.4s |

- `TradeCatch_<ad>_<name>_<LANG>_9x16.mp4` - masters (Instagram Reels, Facebook Reels/Stories, TikTok, YouTube Shorts)
- `TradeCatch_<ad>_<name>_<LANG>_4x5.mp4` - 1080x1350 feed versions (Instagram feed, Facebook feed). Same cuts, same audio stream (copied bit-for-bit from the 9:16 master, so identical mix and loudness); the picture is re-laid out, not letterboxed - see "4:5 feed versions" below
- `web/*_web.mp4` - 720x1280, smaller files made from the 9:16 masters (not used by the site any more, see "Website" below)
- `captions/TradeCatch_<ad>_<LANG>.srt` / `.vtt` - sidecar captions (SRT for LinkedIn / Meta / YouTube uploads, WebVTT for the website). Generated from the real voice timings, same for 9:16 and 4:5. The ads carry no burned-in subtitles
- `LINKEDIN.md` - which file goes where on LinkedIn, caption upload notes and ready-to-edit EN/FR post copy
- `posters/*.jpg` - still frame from the opening hook (video poster / thumbnail)
- `_source/` - the whole pipeline (scripts, UI renderer, mixer, generated voice/SFX/music assets); `python build_ads.py <A|B|C> <en|fr>` rebuilds a 9:16 master, then `python build_ads.py <A|B|C> <en|fr> --format 4x5` builds its feed version (it needs the 9:16 master first, because the audio is taken from it). Set `ADS_WORK` to choose the scratch folder for intermediates. `python captions.py` rewrites the caption files (it only plans the timeline, nothing is rendered) and `python lint_captions.py` checks them.

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
- Extra audio checks (measured, not heard): loudness range 2.5-4.8 LU; no silence of 0.7 s or longer (room tone and music fill every gap); no clipping (peaks -1.3 to -1.5 dBFS); the mono fold-down measures exactly 3.0 LU below stereo on all six, i.e. the mix is fully centred and phase-coherent, so nothing cancels on a single phone speaker.

## 4:5 feed versions

Cropping a 9:16 master to 4:5 would cut off the phone screens, so the feed versions are a real re-layout of the same timeline:

- **Phone-UI scenes** are laid out again for 1350 px of height (call screens, SMS thread, summary cards, transfer screen, end card). Text stays large; the full SMS conversation and the whole request summary stay visible in both languages. In 9:16 mode every value is unchanged (checked: the still frames of every UI scene render byte-identical to the originals).
- **Footage** is scaled exactly as in 9:16 (same push-in, handheld drift, grade and grain) and a 1080x1350 window is cropped out of it. The window is chosen per shot: face and hands (and the phone, where it matters) stay in frame; on the ladder shots the electrician's arms, face and the light fixture stay in, and the foot of the ladder is cropped.
- **Audio** is the 9:16 master's AAC stream copied unchanged (verified: identical stream checksum).
- 1:1 was not produced: Instagram and Facebook recommend 4:5 for feed video, and a square would need a third layout.

## Captions

- `_source/captions.py` records every voice line where the mixer placed it (`Ad.cues`), turns each line into one or two on-screen cues (one per sentence, short pieces joined, two lines of at most 42 characters), holds a cue on screen into the pause after the line when it needs reading time, and never lets cues overlap (the caller's sigh is layered over the tail of the narration on purpose).
- Display text differs from spoken text in only three places: TradeCatch instead of the French "Tréïd Catch", `tradecatch.ca` instead of "trade catch dot C A", and in-call speakers are labelled "Receptionist:" / "Caller:" ("Réceptionniste :" / "Client :"). The product is never called an "AI receptionist" in customer-facing copy (`tests/unit/receptionist-naming.test.ts` enforces it for the site messages).
- `python lint_captions.py`: no overlaps, no cue over two lines or 42 characters, no cue past the end of the video. Reading speed is a **measured limit, not a pass**: the 2 fastest in-call cues (each starts with a speaker label) are above 27 and at most 29 characters/second (the voices speak at about 3 words/second and the label counts as reading load); most are at 20 or under.
- Timing source: a cue that begins a line starts at the mixer's placement time; a later cue inside a long line starts at its first word, from `assets/voice/words.json` (`python gen_words.py`, speech-to-text on each isolated line, 42 lines, cached). Without that file it falls back to splitting the line by character count (up to about 0.6 s off).
- Measured against word timings from speech-to-text on the finished 4:5 audio: 63 of 69 cues within 0.35 s of the spoken words (median 0.09 s, slightly early on average). The other six are the two "[sighs]" cues (the caption starts at the sound on purpose) and four the check could not match by word (numbers). Nobody has watched them with the picture.

## Website

The same ads play on the site as three short "on the job" stories (home page after the system section, mobile and desktop compositions; the Receptionist page shows the two receptionist stories). Code: `src/components/StoryDemos.tsx` (cards), `src/components/demo-video/stories.ts` (media map), `src/components/WatchDemoButton.tsx` (the shared dialog, now with a portrait 4:5 mode), copy in `demoStories` / `demoVideo.{underTheSink,theLadder,afterHours}` in both message files.

- Media: `public/demo-video/stories/<story>-<lang>.mp4` (720x900, H.264 CRF 24 + AAC 128 kbps, 2-4 MB each, made from the 4:5 masters), `<story>-poster.jpg`, `captions/<story>-<lang>.vtt` (copied from `captions/`). These are re-encodes: if an ad changes, rebuild the 4:5 master, re-run `captions.py` and re-export with `ffmpeg -i <4x5.mp4> -vf scale=720:900 -c:v libx264 -preset slow -crf 24 -maxrate 2800k -bufsize 5600k -c:a aac -b:a 128k -movflags +faststart <out>`, then copy the `.vtt` files across.
- Honesty: the dialog always shows the label under the video ("Dramatization with a fictional business, not a customer story. The Receptionist is a founder-configured pilot; ..." / the text-back pilot line for The Ladder) and repeats it in the transcript; the section also shows it next to the cards. The receptionist is never described as booking on its own: the request is sent to the team.
- Accessibility: captions track on the video, transcript in a `<details>`, the dialog keeps the existing focus trap, Escape and focus return. The video never exceeds 68% of the viewport height.
- Tests: `tests/demo-and-pilot.spec.ts` (EN and FR dialogs, label, 4:5 box fits the viewport, receptionist page, assets served).

## Limitations - read before publishing

1. **No generative video model was available** (no video-generation API key in the environment). I could not create new photoreal footage. The people shown are the existing AI-generated clips from `Videos/`, re-edited and upscaled from 720p to 1080p. I designed every shot so nobody on camera needs lip-sync, and avoided the clips' worst frames (morphing hands, odd reaches), but it is still AI footage. For truly cinematic shots, supply a video-generation key (Sora/Veo/Kling/Runway) or real footage and re-run the pipeline.
2. **I could not listen to the audio.** Quality was checked by measurement and by transcribing the final mixes. Do a listening pass for voice warmth, music taste and the French brand pronunciation.
3. **Feed formats.** 4:5 (1080x1350) versions exist for the Instagram, Facebook and LinkedIn feeds and for the website player. There is no 1:1 version. Reels, Stories, TikTok and Shorts use the 9:16 masters.
4. **Pilot status.** The receptionist and transfer behaviour shown is the pilot configuration; do not run these as paid ads before the matrix items are validated or the end-card line is reviewed.
5. **ElevenLabs usage** (voices, sound effects, music, transcription checks) was billed to the account whose key is in `.env.local`.
