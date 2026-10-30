# Plan demonstration production briefs

Until live-action film exists under `/public/demo-video/plans/`, the site shows
the interactive **illustrative walkthrough** driven by `PLAN_CATALOG.demo`
(`src/product/saas/plan-catalog.ts`). Drop MP4 + poster + WebVTT per language
and fill `demo.media` on each plan to switch the player on.

Each film must only show capabilities that plan actually has. Do not film
Receptionist Plus transfer or on-call booking in the Growth cut.

| Plan | Identity | Must show | Must not show |
|---|---|---|---|
| **Starter** | SMS receptionist | Missed call → bilingual text-back → qualification → tech alert | Phone answering, transfer, on-call booking |
| **Growth** | Limited receptionist | Call answered in FR/EN, caller details, answers from approved info, appointment request summarised, call summary to team | Live transfer, emergency bridge, calendar booking on the call, full transcripts as a sold feature |
| **Receptionist Plus** | Complete receptionist | Answer + qualify + book on the call + live transfer + customer record + (optional) emergency bridge | Nothing exclusive beyond Plus; may include everything Growth has |

Label every cut **Illustrative** until real customer footage (with permission) exists.
Suggested length: 45–90 seconds per plan, bilingual VO or burned-in captions.
