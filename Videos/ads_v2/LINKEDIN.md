# TradeCatch ads v2 - LinkedIn package

Everything here uses the three finished ads (A Under the Sink, B The Ladder, C After Hours, each EN and Québec FR). Nothing new was filmed or recorded for LinkedIn: the right shape and the captions were the missing pieces, and both now exist.

> **Gate before paid use.** The ads show a founder-configured pilot (receptionist, transfer, text-back). `PRODUCTION_NOTES.md` limitation 4 still applies: do not run them as *paid* LinkedIn ads until the pilot items in `docs/CAPABILITY_MATRIX.md` are validated, or you have decided the end-card line ("Dramatization with a fictional business. Receptionist is a founder-configured pilot.") is enough. Organic posts are fine as they are.

## Which file where

| LinkedIn use | Video | Captions |
|---|---|---|
| Company-page or personal post, Single Video ad (mobile feed first) | `TradeCatch_<ad>_<LANG>_4x5.mp4` (1080x1350) | `captions/TradeCatch_<ad>_<LANG>.srt` |
| Full-screen vertical placements | `TradeCatch_<ad>_<LANG>_9x16.mp4` (1080x1920) | same `.srt` |

Why 4:5 is the main one: it takes up the most space in the mobile feed, and it is a real re-layout (the phone screens, SMS thread and call summary are drawn for 1350 px, not cropped). The audio is the 9:16 master's stream, copied bit for bit, so the loudness (-14 LUFS, -1.5 dBTP) is identical.

Length: LinkedIn viewers drop off fast. **B (30 s) and C (31 s) are the ones to lead with.** A (44 s EN / 49 s FR) is better as a follow-up or a retargeting asset.

Encoding is what LinkedIn accepts: MP4, H.264 High, AAC 256 kbps, 24 fps, 20-37 MB per file. Check the current size and ratio limits in Campaign Manager before you launch, since LinkedIn changes them.

## Captions (uploaded separately, not burned in)

LinkedIn plays feed video muted until someone taps it, and these ads are narration-led, so a viewer who never unmutes would see only phone screens. You asked for no on-screen subtitles, so the words ship as sidecar files and the picture stays clean:

- Upload the `.srt` with the video (organic post: edit the video and add captions; Campaign Manager: the video ad's caption setting. Menu names move around, the file is a standard SRT).
- Timing: each cue starts when its words are spoken (line starts come from where the mixer placed the recording; the second and third cue inside a long line come from word timings of the isolated recording). Measured against the finished audio: 63 of the 69 cues are within 0.35 s of the spoken words, median 0.09 s, slightly early on average. The other six are the two "[sighs]" cues (they start at the sound on purpose) and four the check could not match by word. The same file works for the 4:5 and the 9:16 version.
- On the phone call, speakers are labelled ("Receptionist:", "Caller:" / "Réceptionniste :", "Client :") so a muted viewer can follow who is talking.
- Formatting: at most two lines of 42 characters, no overlapping cues. Reading speed is up to about 29 characters per second on 2 in-call cues that start with a speaker label (the voices speak at normal conversational pace, about 3 words per second, and the label counts as reading); most cues are at 20 or under. `python lint_captions.py` re-checks this.
- The brand is written TradeCatch and the URL tradecatch.ca (the voice says "Tréïd Catch" / "trade catch dot C A").

## Copy

The ads make no statistic and no testimonial claim; keep it that way. "Dramatization" belongs in the post text as well as the end card.

**Link:** `https://tradecatch.ca/book-audit` (add your own UTM tags, for example `?utm_source=linkedin&utm_medium=paid_social&utm_campaign=ads_v2_B`; FR: `https://tradecatch.ca/fr/book-audit`). Button: *Learn more* (EN) / *En savoir plus* (FR).

### B - The Ladder (lead with this one)

EN
- Intro: `You're an electrician, not a receptionist. When you miss a call, TradeCatch texts the caller back under your company's name. (Dramatization, fictional business.)`
- Headline: `A missed call gets a text back`
- Longer post text: `Plenty of callers won't leave a voicemail. They'll call someone else.` / `TradeCatch texts back a missed call under your company's name, so the request is waiting when you finish the job.` / `Dramatization with a fictional business. Missed-call text-back runs as a controlled pilot. Free 20-minute audit: tradecatch.ca`

FR
- Intro: `Tu es électricien, pas réceptionniste. Quand tu manques un appel, TradeCatch répond par texto au nom de ton entreprise. (Mise en scène, entreprise fictive.)`
- Headline: `Un appel manqué reçoit un texto`
- Texte du message : `Bien des gens ne laissent pas de message. Ils appellent quelqu'un d'autre.` / `TradeCatch répond par texto à un appel manqué, au nom de ton entreprise : la demande est déjà là quand tu termines ta job.` / `Mise en scène avec une entreprise fictive. La réponse par texto aux appels manqués fonctionne en pilote contrôlé. Audit gratuit de 20 minutes : tradecatch.ca`

### C - After Hours

EN
- Intro: `Your customers don't stop calling at five. A real emergency goes to your on-call line; everything else waits as a morning summary. (Dramatization, fictional business.)`
- Headline: `Emergencies reach you. The rest can wait.`
- Longer post text: `After hours, the receptionist answers as your business, transfers a real emergency to your on-call line, and leaves the rest as a summary for the morning.` / `Dramatization with a fictional business. The Receptionist is a founder-configured pilot. Free 20-minute audit: tradecatch.ca`

FR
- Intro: `Tes clients n'appellent pas seulement de neuf à cinq. Une vraie urgence va à ta ligne de garde; le reste t'attend le matin, dans un résumé. (Mise en scène, entreprise fictive.)`
- Headline: `Les urgences te rejoignent. Le reste attend.`
- Texte du message : `Après les heures, la réceptionniste répond au nom de ton entreprise, transfère une vraie urgence à ta ligne de garde et laisse le reste dans un résumé pour le matin.` / `Mise en scène avec une entreprise fictive. La réceptionniste est un pilote configuré par le fondateur. Audit gratuit de 20 minutes : tradecatch.ca`

### A - Under the Sink

EN
- Intro: `You're under a sink and the phone rings. The TradeCatch Receptionist answers, takes the caller's details and sends your team the request. (Dramatization, fictional business.)`
- Headline: `Keep working. TradeCatch picks up.`
- Longer post text: `The receptionist answers as your business, answers the caller's basic question and takes an appointment request. Your team confirms it; nothing is booked behind your back.` / `Dramatization with a fictional business. The Receptionist is a founder-configured pilot. Free 20-minute audit: tradecatch.ca`

FR
- Intro: `Tu as les mains sous l'évier et le téléphone sonne. La réceptionniste TradeCatch répond, note les détails et transmet la demande à ton équipe. (Mise en scène, entreprise fictive.)`
- Headline: `Continue ton travail. TradeCatch répond.`
- Texte du message : `La réceptionniste répond au nom de ton entreprise, répond à la question de base de l'appelant et prend une demande de rendez-vous. Ton équipe la confirme; rien n'est réservé dans ton dos.` / `Mise en scène avec une entreprise fictive. La réceptionniste est un pilote configuré par le fondateur. Audit gratuit de 20 minutes : tradecatch.ca`

## Before you post

1. **Listen once, with sound on.** Nobody has heard these mixes yet; they were checked by measurement and by transcription only. Voice warmth, music taste and the French brand pronunciation ("Tréïd Catch") are yours to judge.
2. Upload the **4:5** file first and the matching **.srt**; confirm the captions show and line up in LinkedIn's preview.
3. Keep "Dramatization / Mise en scène" and the pilot sentence in the post text.
4. Pick the thumbnail from the opening seconds (the hook frame is the strongest still); `posters/` has the 9:16 stills.
5. For FR audiences use the FR file *and* the FR link.
6. The same ads also play on the website (home page "See it on the job" section and the Receptionist page), so the post and the page tell the same story.
