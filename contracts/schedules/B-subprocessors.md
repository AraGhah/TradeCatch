# Schedule B — Subprocessor disclosure

**DRAFT — FOR QUÉBEC LAWYER REVIEW. NOT LEGAL ADVICE.**  
Update this list whenever vendors change. Email Clients when material changes occur (DPA §5).

**Last updated:** `2026-08-02`

TradeCatch may use the following categories of subprocessors / service providers to deliver the services. Exact vendors depend on the Client’s SOW and stack.

| # | Name | Role / personal information involved | Region (typical) |
| --- | --- | --- | --- |
| 1 | Vercel | Hosts website/app; may process form submissions, logs, IPs | United States (edge + core) |
| 2 | Resend | Sends Client confirmation and internal lead notifications; audit-form fields | United States |
| 3 | Twilio | Sends/receives SMS and voice status webhooks; phone numbers; message bodies | United States (with Client-number routing) |
| 4 | Client CRM / webhook destination (when configured via `LEADS_WEBHOOK_URL`) | Receives lead payloads Client directed TradeCatch to forward | Per Client SOW |
| 5 | Cloudflare Turnstile | Fraud/bot signals on forms; may set security cookies | Global / United States |
| 6 | Google Analytics 4 | Site usage only **after** visitor consent; not used to send customer SMS | United States |
| 7 | Error / uptime webhook (when `ERROR_WEBHOOK_URL` configured) | Technical error metadata; minimize personal data | Per configured endpoint |
| 8 | Calendar provider (Cal.com / Calendly / Google — when `NEXT_PUBLIC_CALENDAR_URL` set) | Booking details if Client enables calendar scheduling | Per provider |

### Notes for counsel / ops

- Prefer Canadian or contractually protected processing where feasible under Law 25.  
- Do not list vendors you do not actually use.  
- Client-owned Google/Microsoft/CRM tenants remain Client’s processors; TradeCatch accesses them only under Schedule C.  
- Keep a change log below.

### Change log

| Date | Change |
| --- | --- |
| 2026-08-02 | Replaced placeholders with current production-intended vendors (Vercel, Resend, Twilio, Cloudflare Turnstile, GA4) |
