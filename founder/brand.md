# Brand: TradeCatch

Written 2026-11-15. TradeCatch is already named, live at tradecatch.ca and built in production, so this brief **documents the brand that exists, tightens it around the positioning in `marketing.md`, and lists the gaps**. It does not invent ten new names; if the founder wants a rename, say so and the naming step can be run. Facts about the existing look come from the repo (`src/app/globals.css`, `src/fonts/index.ts`, `public/brand-mark.svg`, `src/messages/en.json`).

## 1. The name, and the checks the founder must finish

**TradeCatch.** "Trade" is who it is for (the trades); "catch" is the job (catch the call, catch the request). It sounds the same in French and English, reads on a sign and fits beside the check-mark logo. Risks: it is an English name for a market where French is the default (the bilingual site and a French tagline carry it), and "Trade" next to "Catch" can read as a trading product to someone who has not heard it.

What I could check on 2026-11-15 with public lookups:

| Check | Result |
| --- | --- |
| **tradecatch.ca** | Resolves and serves the site (HTTP 200). The product's own domain. |
| **tradecatch.com** | **Not free.** It resolves and redirects (HTTP 302) to a `www.atom.com/name/TradeCatch` page on a domain-name marketplace, so someone owns it and it appears to be for sale. I could not read the page (it returned 403), so the price is unknown. |
| Other domains | `tradecatch.app` and `tradecatch.io` returned no address in a DNS lookup. That is not proof they are unregistered; check at a registrar. |
| Existing businesses | Two web searches for "TradeCatch" or "Trade Catch" found no company, product, app or trademark under that name. Search results are thin for small businesses, so this is not clearance. |
| Confusion with the competitors in `competitors.md` | None sounds close (Voxify, Cedri, AlmaTalk, AutoScale AI, JGSolutions, Polaris Voice, Dialbox, 1n1.ai, AutoRev, The Voice Agent, Smith.ai, Ruby, Rosie, Goodcall, Podium, Jobber). The nearest "Trade-" names seen are TradeTapp (Autodesk, prequalification software), Trade Connect (an app for hiring tradespeople) and Tradesly (a trades answering service listed on Capterra Canada). Tradesly is the one to look at, because it is also a receptionist for trades. |
| Social handles | **Not checked.** Instagram, TikTok, X and YouTube block automated lookups. Check by hand for `tradecatch` and `tradecatch.ca`. |

**To finish yourself, with a trademark agent:** search the Canadian Trademarks Database (CIPO, https://ised-isde.canada.ca/cipo/trademark-search/srch) for "TradeCatch" and close variants ("Trade Catch", "TradeCatcher"), and the USPTO register (https://tmsearch.uspto.gov/) if you will sell in the US. Classes to check in the Nice system: 9 (software), 35 (business support), 38 (telecommunications), 42 (software as a service); an agent confirms which apply. Nothing is registered until the founder registers it. I can only run public searches; this is not legal advice on trademarks.

**A competitor `competitors.md` does not list:** the second search returned a listing for **FetchLine**, described as a done-for-you AI receptionist for owner-operated trade businesses in Canada (a third-party listing, not read in full, so unverified). If true, it narrows the gap in `competitors.md` section 5 ("done-for-you at a mid-market monthly"). Re-run `/founder-competitors` on it before the campaign leans on that gap.

## 2. Voice and promise

**The promise, one line:** *When you can't pick up, the call is still answered in your name, written down, and put in front of you right away.* Every word is deliverable today; it avoids "every call" and "24/7" as absolutes, because the board flagged the gap between the 24/7 headline and the fine print about emergencies and allowances.

**Tagline, three options** (the site's live line is option 1):

1. **"You're on the job. We'll handle the calls."** FR: *« Vous êtes sur le chantier. On s'occupe des appels. »* Already live on the home page. Keep it.
2. **"Calls caught. Jobs kept."** FR: *« Appels captés. Contrats gardés. »* Plays on the name and the check-mark logo.
3. **"Answered in your name. Approved by you."** FR: *« Répond en votre nom. Approuvé par vous. »* Names what no competitor states: owner approval of every message.

**Recommendation:** keep option 1 on the site, and use option 3 as the support line in the founder's outreach, because it carries the trust gap the panel kept raising.

**Voice, three adjectives:**

| Adjective | Do | Don't |
| --- | --- | --- |
| **Plain** | Short sentences and the words of the trade: job, quote, no-heat call. | "Solutions", "leverage", "AI-powered" as a selling word. |
| **Straight** | Say what it does not do and give the number: no CRM sync, no diagnosing, never transfers to 911, 10 captured requests in 60 days. | Absolutes without the fine print ("every call", "24/7 guaranteed"), or a fine print that contradicts the headline. |
| **On your side** | Talk to one owner ("you"), keep them in control ("nothing sends until you approve"). | Fake urgency, countdowns, fear of losing jobs as a threat. |

**Before and after, two lines from `pitch.md`:**

- Before: *"Each plan includes a monthly allowance of call minutes and text messages; extra usage is billed only if you confirm it."*
  After: *"Your plan covers a set number of call minutes and texts each month. If you go over, we ask you first. Nothing is charged until you say yes."*
- Before: *"It does not book into CRM tools such as Jobber; it books into Google Calendar."*
  After: *"It doesn't connect to Jobber or other CRM tools. It books straight into your Google Calendar, and every caught call reaches you as a text you can copy into your own system."*

## 3. The look, as a brief

**Colour** (all from `globals.css`; contrast computed for each pair, WCAG AA needs 4.5:1 for text and 3:1 for large text and icons):

| Colour | Hex | Its job | Text on it, contrast |
| --- | --- | --- | --- |
| **Navy** | `#0c141e` | Headings, dark panels, the logo tile | White on navy 18.51:1; orange on navy 6.10:1; 64%-white mono labels on navy 7.96:1. All pass |
| **Paper** | `#f4f1ec` | Page background | Navy on paper 16.43:1; body text `#1a2430` 13.92:1; muted `#566276` 5.48:1; secondary `#3d4855` 8.26:1. All pass |
| **Orange** | `#e4762b` | The "catch" accent: the check mark, primary buttons, highlights on navy | Navy label on orange 6.10:1 passes. **White on orange 3.03:1 fails for body text.** **Orange as text on paper 2.69:1 fails.** |
| **Ember** | `#96460f` | Orange when it must be text on paper | 5.86:1 on paper, passes |
| **Signal green** | `#2f9e68`, text `#1e6b47` | "Live" and success states | The text version is 5.74:1 on paper and passes; `#2f9e68` as text is 3.00:1, so use it only for icons or large shapes |

The rules that come out of the numbers: buttons are orange with a **navy** label, never white; orange text goes on navy only, and on paper uses Ember; green text on paper uses the darker `#1e6b47`.

**Type** (self-hosted in `src/fonts/`): **Archivo** 700 and 800 for display, **IBM Plex Sans** 400 to 700 for text, **IBM Plex Mono** 400 to 600 for numbers and labels. Both families are, to my knowledge, published under the SIL Open Font License and are free to use commercially (sources: https://github.com/IBM/plex for Plex and Google Fonts for Archivo). **The repo ships the font files with no licence text**; add the OFL notices and confirm at the source before shipping a printed asset.

**Logo brief.** The mark today is a navy rounded square with a thick orange check (`public/brand-mark.svg`, 64 by 64): it says "caught, done, confirmed", it reads at 32 px and on a dark app icon. What is missing, and what to brief:

- **A wordmark and a lockup.** `public/` holds only the mark and an open-graph image; I found no wordmark or reversed or one-colour version. A truck decal, an invoice, a stamp and an email signature need them.
- **Must work:** a sign or truck door at distance, a 32 px favicon and app icon, a one-colour print, and on both navy and paper.
- **Avoid:** a phone handset or a headset (the obvious choice for the category, though I did not check what competitors use), stock tool icons, a speech bubble, and any blue-and-white "tech" look (the existing navy and orange already separates it).
- **Competitors' looks were not reviewed in this run**, so check their logos and colours by eye before printing anything.
- I can generate concept sketches with an image tool if the founder has one. They would be marked as concepts, not a finished logo.

## 4. The first five touchpoints

| Touchpoint | What it does | The one line or move |
| --- | --- | --- |
| **1. The home page** | First look. Live today with *"You're on the job. We'll handle the calls."*, *Book a Free Demo* and *Hear the Receptionist*. | Add the missed-call count and the 60-day refund line once the founder has approved them. |
| **2. The demo line** | The first time anyone hears the brand. Today it answers, so it is the proof the panel keeps asking for. | Publish two recorded test calls (French night call, English day call) next to the number, with the caller's consent. |
| **3. The install pack** | In place of packaging: the test-call recordings, the list of messages for the owner to approve, and a one-page "what happens next". | State the days to go-live and the owner's hours (both open, `offer.md`). |
| **4. The confirmation** | The checkout confirmation and the first message after payment. | Say what the owner has paid, what comes next, who to call (the founder, by name), and how the 60-day guarantee works. |
| **5. The first complaint** | A reply within one hour, from the founder, in the customer's language. | *"You're right to be upset. I've pulled the call and I'm reading it now. Here is what I'll fix, and when you'll hear from me."* Offer the guarantee remedy if it applies; no excuses, no template apology. |

## Rules kept

No competitor's name, logo, colours or tagline was copied. No font, image or icon outside what the repo already uses. Not legal advice on trademarks.
