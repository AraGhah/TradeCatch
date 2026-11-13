# Board brief: TradeCatch

You are reading this cold. Everything you need is here; you cannot see the conversation that produced it.

## The idea

- What it is: a bilingual (Québec French and English) phone receptionist service for small contractor businesses that answers every call under the contractor's business name, captures the caller's name, number, address, service needed and urgency, alerts the contractor right away, follows up by text, and on the higher plan books appointments into the contractor's Google Calendar.
- Who it is for: owner-operated trade businesses in Montréal, Laval, Mirabel and Vaudreuil-Dorion (plumbing, HVAC, electrical, roofing and renovation, landscaping) whose owner and crew are on job sites and cannot answer the phone, and who lose jobs to the next company on Google when a call rings out.
- What it sells, at what price (all CAD):
  - Essential: $1,999.99 one-time setup, then $249 a month. Answers calls 24/7 in French and English, captures requests, flags urgent ones, texts follow-ups, dashboard with call history and captured requests.
  - Professional: $1,999.99 one-time setup, then $349 a month. Everything in Essential plus automatic appointment scheduling with Google Calendar (availability checked before booking, rescheduling, text confirmations and reminders).
  - Optional website service: $699.99, paid once, only if chosen.
  - Billing is month to month after setup, cancel with notice. The setup fee is paid at checkout; the first monthly charge comes one month later. Each plan has a monthly allowance of call minutes and text segments; usage past it is billed only if the customer confirms it. Call transfer, voice cloning, bulk messaging and CRM integrations are not offered.
- Where and how: Montréal and surrounding area, sold directly by the founder through a free demo ("you talk with the founder"), a live receptionist demo on the website, and a referral program. Delivery is high-touch: the founder audits how calls and quotes move through the business, configures the system, writes every message with the customer, tests every scenario with the customer's team, then monitors after launch. No call centre, no outsourced support. The software runs on the founder's own platform (Next.js on Cloudflare, Twilio for voice and SMS, Stripe for billing, an AI voice provider for the receptionist).
- Budget and constraints: one person, the founder (a software developer), builds, sells, installs and supports everything. The product is built and in production as of November 2026; it is at or just before launch to paying customers, and the number of paying customers is not stated. Cash budget, marketing budget and target customer count are not stated. The per-plan allowance figures (minutes and text segments) and the per-minute cost of the AI voice provider are not published in the product copy and are open questions for the CFO.

## What the public site says the problem is

The site names three places jobs slip away for a contractor: the call nobody answers (the crew is up a ladder, the homeowner calls the next company on Google twenty seconds later); the details that get lost (a voicemail with half an address, a sticky note that goes missing); and the quote that goes quiet (a $9,000 estimate sent and never chased, signed three weeks later with the contractor who sent one polite text). The headline is "You're on the job. We'll handle the calls."

## How the site positions the business

- "You're not buying software. You're hiring the person who builds it." The founder is named on the home page and personally runs setup, testing and monitoring.
- Built for Québec trades, in Canadian French and English. The receptionist answers in the caller's language.
- "Nothing sends or speaks until you approve the wording." Messages are approved by the contractor before going live.
- The system does not diagnose technical or safety conditions; emergency handling stays with the contractor.
- The dashboard shows call activity, captured requests, appointments (Professional), basic statistics, billing and usage.

## What is already built

A working product: public bilingual website with a live receptionist demo, customer dashboard, missed-call text-back, voice receptionist, request capture, text follow-ups, appointment scheduling with Google Calendar, notifications, usage tracking with confirm-before-billing overages, Stripe checkout and subscription, a referral program, help centre and support tickets. A recent full browser test of the dashboard found it functional with a list of medium and high severity bugs still open (missing translations, validation gaps, a support-ticket list that needs a manual refresh).

## What is not known

- Number of paying customers, revenue to date, cash on hand, marketing budget.
- The monthly minute and text allowance per plan, and the cost per answered minute from the AI voice and telephony providers.
- Competitor prices in the Montréal market.
- How many contractors in the service area fit the target, and how many are reachable.
