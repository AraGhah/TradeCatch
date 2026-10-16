# Contractor onboarding (Task 11)

Guided setup wizard that orchestrates existing TradeCatch services (business, billing, AI receptionist, phone, calendar, automations). **Does not** duplicate those databases.

## Flow

`Account → Business → AI Receptionist → Phone → Calendar → Automations → Test & Activate`

Plan-aware requirements: Starter can skip AI/calendar; AI plan requires receptionist config + verified phone (+ live call confirmation for AI answering).

## Key rule

A step is **Verified** only after a backend check succeeds. UI checkboxes never unlock call routing or automations alone.

## Schema

Migration `015_onboarding` — `tc_onboarding_sessions`, `tc_onboarding_steps`, `tc_integration_verifications`, `tc_activation_checks`, `tc_onboarding_events`.
