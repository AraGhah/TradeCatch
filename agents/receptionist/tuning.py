"""Turn-taking and voice settings read from the environment (pure, no LiveKit imports).

Nothing here changes LiveKit's own defaults unless the operator sets a variable,
so a deployment behaves exactly as tested until someone deliberately tunes it.
Values are clamped to sane ranges: a typo must not make the line cut callers off
or wait half a minute before answering.

  AGENT_VOICE                       realtime voice name (default "marin")
  AGENT_REALTIME_MODEL              realtime model (default "openai/gpt-live-1")
  AGENT_ENDPOINTING_MODE            "fixed" or "dynamic"
  AGENT_MIN_ENDPOINTING_DELAY       seconds of quiet before the agent answers (0.1-3)
  AGENT_MAX_ENDPOINTING_DELAY       longest it waits for a caller still thinking (0.5-8)
  AGENT_INTERRUPTIONS               "true"/"false": may the caller cut the agent off
  AGENT_INTERRUPTION_MIN_DURATION   seconds of speech that count as an interruption (0.1-2)
  AGENT_INTERRUPTION_MIN_WORDS      words that count as an interruption (0-5)
  AGENT_PREEMPTIVE_GENERATION       "true"/"false": start replying before the turn ends
"""

from __future__ import annotations

from typing import Any, Mapping

DEFAULT_VOICE = "marin"
DEFAULT_MODEL = "openai/gpt-live-1"


def _number(env: Mapping[str, str], name: str, low: float, high: float) -> float | None:
    raw = (env.get(name) or "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return min(max(value, low), high)


def _flag(env: Mapping[str, str], name: str) -> bool | None:
    raw = (env.get(name) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return None


def voice_settings(env: Mapping[str, str]) -> tuple[str, str]:
    """(model, voice)."""
    return (
        (env.get("AGENT_REALTIME_MODEL") or "").strip() or DEFAULT_MODEL,
        (env.get("AGENT_VOICE") or "").strip() or DEFAULT_VOICE,
    )


def turn_handling_from_env(env: Mapping[str, str]) -> dict[str, Any]:
    """Options for AgentSession(turn_handling=...). Empty when nothing is set."""
    endpointing: dict[str, Any] = {}
    mode = (env.get("AGENT_ENDPOINTING_MODE") or "").strip().lower()
    if mode in ("fixed", "dynamic"):
        endpointing["mode"] = mode
    low = _number(env, "AGENT_MIN_ENDPOINTING_DELAY", 0.1, 3.0)
    high = _number(env, "AGENT_MAX_ENDPOINTING_DELAY", 0.5, 8.0)
    if low is not None:
        endpointing["min_delay"] = low
    if high is not None:
        endpointing["max_delay"] = high
    if low is not None and high is not None and high < low:
        endpointing["max_delay"] = low

    interruption: dict[str, Any] = {}
    allowed = _flag(env, "AGENT_INTERRUPTIONS")
    if allowed is not None:
        interruption["enabled"] = allowed
    duration = _number(env, "AGENT_INTERRUPTION_MIN_DURATION", 0.1, 2.0)
    if duration is not None:
        interruption["min_duration"] = duration
    words = _number(env, "AGENT_INTERRUPTION_MIN_WORDS", 0, 5)
    if words is not None:
        interruption["min_words"] = int(words)

    options: dict[str, Any] = {}
    if endpointing:
        options["endpointing"] = endpointing
    if interruption:
        options["interruption"] = interruption
    preemptive = _flag(env, "AGENT_PREEMPTIVE_GENERATION")
    if preemptive is not None:
        options["preemptive_generation"] = {"enabled": preemptive}
    return options
