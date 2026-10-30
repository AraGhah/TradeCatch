# TradeCatch receptionist — LiveKit voice agent

Answers calls that arrive from the Twilio SIP trunk, using each business's own
instructions from TradeCatch, and can **really transfer** the call.

```
caller → Twilio number → SIP trunk → LiveKit → this agent
                                          │
        GET /api/receptionist/agent-config?number=<dialed number>   (ops bearer)
                                          │
        TradeCatch returns: rendered prompt + the only numbers it may transfer to
```

Companies, prompts, hours and transfer numbers are edited in TradeCatch
(`/app/receptionist`, or `/admin/businesses/<id>`), not in this folder.

## Why transfers used to do nothing

The first version of this agent had **no tools**, so "I'll transfer you" was only
words. Now `transfer_call` calls LiveKit's `transfer_sip_participant`, which sends a
SIP REFER to Twilio. Two things must be true for it to work:

1. The agent calls the tool (the prompt requires it).
2. The Twilio trunk allows transfers: **Elastic SIP Trunking → the trunk → General →
   Call Transfer (SIP REFER) = "Enabled for all calls"** (API: `TransferMode=enable-all`).
   With the default `disable-all`, Twilio rejects the transfer and the caller is left
   waiting in silence.

## Safety

- The model never provides a phone number. `routing.pick_transfer` chooses one of the
  lines configured for that business (validated server-side as Canadian geographic
  numbers).
- Normal transfers are refused when the office is closed; emergencies still go through.
- If TradeCatch cannot be reached, the agent uses a minimal instruction set with **no**
  transfer and no promises.

## Deploy (LiveKit Cloud)

```bash
cd agents/receptionist
lk agent update-secrets --secrets "TRADECATCH_BASE_URL=https://tradecatch.ca,TRADECATCH_OPS_SECRET=<MISSED_CALL_OPS_SECRET value>"
lk agent deploy
```

Roll back with `lk agent rollback` if a new version misbehaves.

## Test

```bash
python -m unittest test_routing        # pure decision logic, no LiveKit needed
```

Then call the number and say "transfer me to a person": the phone at the configured
transfer line should ring.
