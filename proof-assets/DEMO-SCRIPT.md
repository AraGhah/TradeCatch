# TradeCatch — product demo scripts

There are two demo videos, both rendered from the interactive `/demo-video` experience with a fictional business (NorthStar Plumbing). They follow `docs/CAPABILITY_MATRIX.md`; do not strengthen any status claim when editing or recording.

| Cut | `?cut=` | Length (EN / FR) | Used on |
| --- | --- | --- | --- |
| Video 1 — Receptionist & complete platform | `platform` (default) | ~94 s / ~104 s | Homepage hero ("Watch the 90-second demo"), AI Receptionist hero |
| Video 2 — Missed-call recovery & follow-ups | `missed-call` | ~46 s / ~50 s | Homepage proof-examples section ("Watch the missed-call demo") |

**The spoken and captioned script lives in `src/components/demo-video/cuts.ts`.** Narration audio, scene timing, burned-in captions, the VTT tracks and the modal transcripts are all generated from it, so edit the script there, not here.

## Video 1 — scene order

| Scene | Visual | Audio |
| --- | --- | --- |
| Problem | Contractor on a job; Daniel Roy's call rings out | Narrator |
| Introducing TradeCatch | Logo; the same call is answered by the receptionist; "Your business answers. Even when you can't." | Narrator |
| Live call | Receptionist ↔ caller transcript, line by line, with service / area / urgency / preferred time / next step filling in | Receptionist + caller voices |
| Call transfer | Second caller (Luc Gagnon) reports basement flooding; emergency detected; bridged to the on-call technician | Caller + receptionist voices, then narrator |
| Workspace | Lead, call summary and appointment **request**; a team member clicks "Confirm visit" (Growth in-app booking) | Narrator |
| Follow-ups | Missed-call text-back and day-3 quote follow-up side by side | Narrator |
| Closing | Logo, "Every call counts.", tradecatch.ca, free-audit CTA, pilot disclaimer | Narrator + caption-only disclaimer |

## Video 2 — scene order

| Scene | Visual | Audio |
| --- | --- | --- |
| Missed opportunity | Contractor on a job; Sarah Martin's call goes unanswered | Narrator |
| Automatic recovery | Missed call → automatic SMS → customer reply | Narrator |
| Lead captured | Lead card with conversation, owner notified | Narrator |
| Quote follow-up | Awaiting-response quote is followed up and reactivated; a reply stops the sequence | Narrator |
| Closing | "Less chasing. More opportunities.", tradecatch.ca, free-audit CTA, controlled-pilot disclaimer | Narrator + caption-only disclaimer |

## Capability boundaries that must remain explicit

- The receptionist captures an appointment **request**; it never books a slot or checks availability on the call. The team confirms. (Phone booking is **planned** in the capability matrix.)
- AI call answering, transfer, emergency routing and call summaries are a founder-configured **pilot**, not yet validated on live traffic. The platform closing card says so; keep it.
- Missed-call text-back is a **controlled pilot**; the missed-call closing card says so.
- Quote follow-up is a Starter pilot feature and stops on reply, opt-out, won/lost status or human takeover.
- In-app booking ("Confirm visit") is a Growth pilot module for entitled organizations — no Google/Outlook sync.
- The business, people, numbers and conversations are fictional and labelled "Illustrative demo · fictional business" on every frame.
- The CTA is the free audit, never "Buy now".

## Regenerating the media

1. Edit `src/components/demo-video/cuts.ts`.
2. `npx tsx scripts/demo-media.ts script | python scripts/generate-demo-narration.py` — synthesizes each line with edge-tts (needs `edge-tts` ≥ 7.3), mixes one MP3 per scene and writes `narration-timing.json`.
3. `npx tsx scripts/demo-media.ts captions` — writes the four VTT files.
4. Regenerate the `demoVideo.platform.transcript` / `demoVideo.missedCall.transcript` strings in `src/messages/{en,fr}.json` from the captions if any line changed.
5. `npm run build && npx next start --port 3003`, then for each cut and locale: `node scripts/record-demo-video.mjs <platform|missed-call> <en|fr> http://localhost:3003 --publish`.
6. `npm run check:media` — verifies durations, captions, narration windows, honesty markers and the media budget.

Spot-check layouts without a full recording: `node scripts/preview-demo-frames.mjs <cut> <locale> 3,20,45`.

## Published filenames

- `public/demo-video/TradeCatch-Platform-EN.mp4`, `TradeCatch-Platform-FR.mp4`
- `public/demo-video/TradeCatch-MissedCall-EN.mp4`, `TradeCatch-MissedCall-FR.mp4`
- `public/demo-video/captions/{platform,missed-call}-{en,fr}.vtt`
- `public/demo-video/narration/{platform,missed-call}/{en,fr}/scene-N.mp3`
