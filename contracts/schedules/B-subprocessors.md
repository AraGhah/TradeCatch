# Schedule B — Subprocessor disclosure

**DRAFT — FOR QUÉBEC LAWYER REVIEW. NOT LEGAL ADVICE.**  
Update this list whenever vendors change. Email Clients when material changes occur (DPA §5).

**Last updated:** `[YYYY-MM-DD]`

TradeCatch may use the following categories of subprocessors / service providers to deliver the services. Exact vendors depend on the Client’s SOW and stack.

| # | Name | Role / personal information involved | Region (typical) |
| --- | --- | --- | --- |
| 1 | `[Hosting provider — e.g. Vercel]` | Hosts website/app; may process form submissions, logs, IPs | `[US/EU — confirm]` |
| 2 | `[Email delivery — e.g. Resend]` | Sends Client confirmation and internal lead notifications; audit-form fields | `[US — confirm]` |
| 3 | `[SMS / telephony — e.g. Twilio or Client’s carrier bridge]` | Sends/receives SMS; phone numbers; message bodies | `[confirm]` |
| 4 | `[Automation / CRM webhook destination if used]` | Receives lead payloads Client directed TradeCatch to forward | `[confirm]` |
| 5 | `[Bot protection — e.g. Cloudflare Turnstile]` | Fraud/bot signals on forms; may set security cookies | `[confirm]` |
| 6 | `[Analytics — e.g. Google Analytics 4]` | Site usage only **after** visitor consent; not used to send customer SMS | `[confirm]` |
| 7 | `[Error / uptime monitoring — if configured]` | Technical error metadata; minimize personal data | `[confirm]` |
| 8 | `[Calendar provider — Cal.com / Calendly / Google]` | Booking details if Client enables calendar scheduling | `[confirm]` |

### Notes for counsel / ops

- Prefer Canadian or contractually protected processing where feasible under Law 25.  
- Do not list vendors you do not actually use.  
- Client-owned Google/Microsoft/CRM tenants remain Client’s processors; TradeCatch accesses them only under Schedule C.  
- Keep a change log below.

### Change log

| Date | Change |
| --- | --- |
| `[YYYY-MM-DD]` | Initial draft list |
