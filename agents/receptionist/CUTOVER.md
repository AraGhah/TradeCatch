# Replace the Builder agent with the Python receptionist

Owner-operated maintenance window for the existing TradeCatch project. The reported one-agent limit means inbound calls can go unanswered between deletion and registration. Schedule quiet time, drain active calls and arrange an approved alternate contact with the business first.

## Prepare while Builder still serves calls

1. In LiveKit Cloud, open project **tradecatch**, subdomain **tradecatch-jaaxum49**, and its Agent Builder. Match ID **CA_cQst2nJSn9ZJ**. Use **Download code** and keep the ZIP privately outside the repository. Record the flow, prompt, voice/model, tools, dispatch name, deployment region, and names of secret bindings. Confirm you can reconstruct or run the export and have the required credentials in your own secure store. The tracked file `../livekit.builder.backup.toml` records only two identifiers. It cannot restore an agent. [Builder documentation](https://docs.livekit.io/agents/start/builder/)
2. Use a clean checkout of the tested revision. Release the matching TradeCatch backend through the normal approved Worker release process before acceptance testing. In Cloudflare → Workers & Pages → **tradecatch** → Settings → Variables and Secrets, verify the production binding **MISSED_CALL_OPS_SECRET**. In TradeCatch, verify the pilot organization's active assigned number, local hours, default language, services, transfer entitlement, authorized destinations, calendar availability and notification recipients.
3. In an owner-controlled PowerShell session, use the following read-only checks. Match the existing dispatch rule **SDR_PikdfX5ovdTB**, its inbound trunk **ST_SRLKTaYtdLkd**, target **tradecatch-receptionist** and per-call room configuration. If they differ, investigate before deletion. Check that Twilio origination delivers the called number as the SIP trunk phone number. Keep the existing SIP configuration.

    ```powershell
    Set-Location C:\Dev\TradeCatch\agents\receptionist
    lk --version
    lk --project tradecatch agent list
    lk --project tradecatch sip dispatch list --json
    lk --project tradecatch sip outbound list
    Select-String -LiteralPath agent.py -SimpleMatch '@server.rtc_session(agent_name="tradecatch-receptionist")'
    if (Test-Path livekit.toml) { throw 'Inspect the existing deployment binding before proceeding.' }
    ```

4. Verify the Linux build before freeing the slot. Check that the **Python receptionist image** CI job passed for the same worker source and Dockerfile you will deploy. To repeat the check locally, run the commands below with Docker Desktop in Linux container mode, using a clean checkout without local settings. Stop on any unsuccessful command. The model load must succeed as the runtime user with networking disabled.

    ```powershell
    docker build --platform linux/amd64 -t tradecatch-receptionist:cutover .
    if ($LASTEXITCODE) { throw 'Image build failed' }
    docker run --rm --network none tradecatch-receptionist:cutover python agent.py start --help
    if ($LASTEXITCODE) { throw 'Worker import failed' }
    docker run --rm --network none tradecatch-receptionist:cutover python -c "import os, agent; from livekit.plugins import silero; assert os.getuid() != 0; silero.VAD.load()"
    if ($LASTEXITCODE) { throw 'Offline model load failed' }
    ```

    The PR image job also runs the Python suite in that container with loopback-only fixtures. To repeat on a workstation with the declared dependencies installed, run `python -m unittest discover -p "test_*.py"` in this directory. An SDK import skip leaves call-flow coverage incomplete. Watch actual CPU, memory, cold start and concurrent-call capacity in the pilot, especially with audio enhancement and cloned voices.

## Prepare runtime settings privately

Use a private file accessible only to the operator, **outside the repository and build context**, for the initial create. Each line is a literal `NAME=value` pair. Set `$settingsFile` to its path. Only the path appears in shell history. Enter or update values privately and remove the temporary file after verifying the deployment. For later edits, use the new agent's Secrets settings or `lk --project tradecatch agent update-secrets --id $newId --secrets-file $settingsFile` (restarts that agent).

| LiveKit runtime setting | Value / purpose |
|---|---|
| TRADECATCH_BASE_URL | Required. `https://tradecatch.ca` |
| TRADECATCH_OPS_SECRET | Required. Enter the **existing exact value** of the production Worker secret MISSED_CALL_OPS_SECRET privately. |
| LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET | Provided to the hosted worker by LiveKit. |
| AGENT_TRANSFER_MODE | `warm`, `blind`, `auto` or `off`. Auto prefers a configured outbound trunk, otherwise REFER. |
| LIVEKIT_SIP_OUTBOUND_TRUNK, LIVEKIT_SIP_NUMBER | Warm mode requires an authorized **outbound** ST_ ID. Optional caller ID is an account-authorized E.164 number, otherwise the business line is used. |
| ELEVENLABS_API_KEY, AGENT_CUSTOM_VOICE | Key needed for enabled, entitled cloned voices. Set the switch to `false` to use the standard voice. Standard realtime calls use LiveKit Inference. |
| AGENT_REALTIME_MODEL, AGENT_VOICE | Supported LiveKit Inference duplex model ID and compatible voice. Verify access in this project. |
| AGENT_CUSTOM_VOICE_STT, AGENT_CUSTOM_VOICE_LLM, AGENT_FALLBACK_TTS | Supported Inference provider/model IDs for the optional cascade. |

The remaining optional numeric limits and units for transfer ringing, consultation, total hold time, HTTP timeouts, endpointing, interruptions and preemptive generation are listed in [.env.example](.env.example). Twilio termination credentials belong on the outbound trunk, managed by its owner. The Python worker uses its LiveKit trunk ID.

**Blind transfers.** In Twilio Console → Elastic SIP Trunking → Trunks → select the actual inbound trunk → General, verify Call Transfer (SIP REFER) and **PSTN transfers** for telephone destinations. Verify caller ID and permitted destinations. The code requests a tel URI and counts the final successful REFER response. Voicemail can answer. [Twilio transfer documentation](https://www.twilio.com/docs/sip-trunking/call-transfer)

**Screened warm transfers.** In LiveKit Cloud → Telephony → SIP trunks, verify an outbound trunk connected to the correct Twilio trunk's Termination SIP URI. In Twilio verify Termination authentication, permitted countries, and an authorized caller ID. A contractor must accept or press 1 before the rooms merge. A busy line, timeout or refusal returns control to the receptionist for another authorized line or a message. On model failure the recovery bridge can establish an answered leg without screening. Check the business's hours and plan before diagnosing a carrier fault.

## Owner cutover

1. Proceed only after preflight, backup and the alternate contact are ready. In the verified LiveKit project, open the Builder agent, check its ID again, then use the Builder's **Delete agent** action and confirmation. Do this yourself. If the UI lacks that action, stop and use LiveKit support. Leave the trunk and dispatch rule in place. Refresh `lk --project tradecatch agent list` until the Builder is gone.
2. From the verified receptionist directory, create the Python agent once. LiveKit Cloud builds from the Dockerfile in this directory. Allow time for that build during the maintenance window. The worker decorator supplies the dispatch name. Uploading a prebuilt image requires Enterprise. [LiveKit build documentation](https://docs.livekit.io/deploy/agents/builds/)

    ```powershell
    $settingsFile = Read-Host 'Path to your private settings file'
    if (!(Test-Path -LiteralPath $settingsFile -PathType Leaf)) { throw 'Private settings file missing' }
    lk --project tradecatch agent create --region us-east --secrets-file $settingsFile .
    lk --project tradecatch agent list
    ```

3. Record the **new CA_ ID**. Inspect the generated `livekit.toml` locally. If it is missing after successful creation, run `lk --project tradecatch agent config --id $newId .` after setting `$newId` below. Never reuse the Builder TOML. If creation times out, inspect the list before retrying. If the quota still reads 1/1, identify the occupant before proceeding.

    ```powershell
    $newId = Read-Host 'New Python agent CA_ ID'
    lk --project tradecatch agent versions --id $newId
    lk --project tradecatch agent status --id $newId
    lk --project tradecatch agent secrets --id $newId
    lk --project tradecatch sip dispatch list --json
    lk --project tradecatch agent logs --id $newId --log-type deploy
    ```

    Check secret **names**, version, region, running/ready replicas and the worker registration under the canonical name. Keep logs private. Ctrl+C exits log tailing. Use `--log-type build` for source-build failures. A ready replica alone does not verify a call.

## Accept or recover

Use a designated test number, consenting contractor and test appointment. Correlate the call time in Twilio Monitor → Logs → Calls, LiveKit sessions/worker logs and Cloudflare **tradecatch** → Observability. Keep caller details out of tickets.

1. Call the assigned Twilio number. Verify the SIP participant, dispatched worker **ID and version**, the actual business greeting, services, hours and area. Try a second configured business and an unknown number. Unknowns must never get another business's settings.
2. Answer once in French and once in English, on English-default and French-default profiles. Confirm the bilingual greeting ("Bonjour, ici <business>. How can I help you?"), that there is no keypad menu, that the call continues in the language you spoke, the `language decision` log line, callback details and a later switch ("in English please"). Say something unclear twice and confirm "Français ou anglais? French or English?" is asked once.
3. Request availability, book one offered opening, then verify the appointment in the correct calendar. Try a taken slot and a calendar failure. Only a backend-confirmed reservation merits a confirmation.
4. Request a person. Verify the destination and caller ID with the contractor. Test acceptance, busy, no answer, decline, backup number, caller hang-up and after-hours handling. Check the original caller returns to the agent after a failed attempt. For blind mode, distinguish carrier answer from human acceptance.
5. End normally and by hanging up. Check one correctly attributed report, transfer outcome, callback details and notification. Test concurrent pilot calls before relying on capacity.

**Diagnose by boundary.** No room → inspect Twilio origination and inbound trunk. Room but no job → inspect dispatch name and worker readiness. Neutral greeting → verify SIP destination, backend binding and exact enabled number. 401 → owner checks bearer equality. Missing actor / 400 → verify X-Ops-Actor and payload. 404 → active business mapping or Worker release. 500/502/503 → inspect Worker/database availability. Config retries once, booking retries once with an idempotency key, reporting retries up to three attempts, availability fails the current lookup. An exhausted report needs operator investigation. For transfer failures inspect mode, authorized business lines, hours, trunk permissions and the carrier outcome.

**Recovery.** Stop acceptance testing and use the prearranged alternate contact. If the new agent exists, diagnose that ID, repair settings or use `lk --project tradecatch agent deploy --id $newId .` for a corrected code version. For a later bad revision, `lk --project tradecatch agent rollback --id $newId --version <known-good-version>` applies only to versions of this same agent. On the first cutover there is no previous Python version. Recover using the privately saved Builder code/configuration, either as a separately validated code build on the new deployment or by manually reconstructing the Builder after freeing its slot. Any further deletion or routing change is a separate owner decision. Verify the real call path again before ending the incident.
