"""Which voice answers the call (pure: no LiveKit imports, so it is unit-tested anywhere).

TradeCatch tells the agent, per call, which voice to use (`cfg["voice"]`):

  {"mode": "standard"}                                   the default realtime voice
  {"mode": "custom", "provider": "elevenlabs",
   "voiceId": "...", "model": "eleven_flash_v2_5"}       the owner's cloned voice

The server only ever sends "custom" to a Receptionist Plus business whose owner
consented, verified and activated it. This module is the agent's own second
check: anything it does not recognise is the standard voice, because a problem
with a cloned voice must never stop a call being answered.

Environment (all optional except the key for custom voices):

  ELEVENLABS_API_KEY        needed to speak with a cloned voice; without it every
                            call uses the standard voice
  AGENT_CUSTOM_VOICE        "false" is a kill switch: standard voice for everyone
  AGENT_CUSTOM_VOICE_STT    speech-to-text for cloned-voice calls (default deepgram/nova-3)
  AGENT_CUSTOM_VOICE_LLM    language model for cloned-voice calls (default openai/gpt-4.1-mini)
  AGENT_FALLBACK_TTS        voice used mid-call if the cloned voice fails to
                            synthesize (default cartesia/sonic-3; "provider/model"
                            or "provider/model:voice")
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

PROVIDER = "elevenlabs"
VOICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9]{10,40}$")
ALLOWED_MODELS = ("eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_turbo_v2_5")
DEFAULT_MODEL = "eleven_flash_v2_5"

DEFAULT_STT = "deepgram/nova-3"
# "multi" lets the speech-to-text follow a caller who switches between French and English.
STT_LANGUAGE = "multi"
DEFAULT_LLM = "openai/gpt-4.1-mini"
DEFAULT_FALLBACK_TTS = "cartesia/sonic-3"

# A LiveKit Inference descriptor: "provider/model" with an optional ":voice".
_DESCRIPTOR = re.compile(r"^[a-z0-9][a-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9._-]+)?$")


@dataclass(frozen=True)
class CustomVoice:
    voice_id: str
    model: str

    def __repr__(self) -> str:  # never put the voice id in a log line
        return f"CustomVoice(model={self.model!r})"


@dataclass(frozen=True)
class CascadeSettings:
    stt: str
    stt_language: str
    llm: str
    fallback_tts: str


def _flag_off(env: Mapping[str, str], name: str) -> bool:
    return (env.get(name) or "").strip().lower() in ("0", "false", "no", "off")


def _descriptor(env: Mapping[str, str], name: str, default: str) -> str:
    raw = (env.get(name) or "").strip()
    return raw if raw and _DESCRIPTOR.fullmatch(raw) else default


def parse_custom_voice(
    cfg: Mapping[str, Any] | None, env: Mapping[str, str]
) -> CustomVoice | None:
    """The cloned voice to use for this call, or None for the standard voice."""
    if not cfg or _flag_off(env, "AGENT_CUSTOM_VOICE"):
        return None
    if not (env.get("ELEVENLABS_API_KEY") or "").strip():
        return None
    voice = cfg.get("voice")
    if not isinstance(voice, Mapping) or voice.get("mode") != "custom":
        return None
    if voice.get("provider") != PROVIDER:
        return None
    voice_id = voice.get("voiceId")
    if not isinstance(voice_id, str) or not VOICE_ID_PATTERN.fullmatch(voice_id):
        return None
    model = voice.get("model", DEFAULT_MODEL)
    if model not in ALLOWED_MODELS:
        return None
    return CustomVoice(voice_id=voice_id, model=model)


def cascade_settings(env: Mapping[str, str]) -> CascadeSettings:
    return CascadeSettings(
        stt=_descriptor(env, "AGENT_CUSTOM_VOICE_STT", DEFAULT_STT),
        stt_language=STT_LANGUAGE,
        llm=_descriptor(env, "AGENT_CUSTOM_VOICE_LLM", DEFAULT_LLM),
        fallback_tts=_descriptor(env, "AGENT_FALLBACK_TTS", DEFAULT_FALLBACK_TTS),
    )
