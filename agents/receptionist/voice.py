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
  AGENT_CUSTOM_VOICE_LLM    language model for cloned-voice calls (default openai/gpt-6-luna)
  AGENT_FALLBACK_TTS        voice used mid-call if the cloned voice fails to
                            synthesize (default cartesia/sonic-3; "provider/model"
                            or "provider/model:voice")

Standard ElevenLabs voice (optional): every business without its own cloned voice
answers with one ElevenLabs voice, through the same speech-to-text -> LLM ->
ElevenLabs pipeline, instead of the realtime model's built-in voices. One voice
speaks both French and English, so the receptionist keeps one identity when the
caller presses 1.

  AGENT_STANDARD_VOICE      "elevenlabs" to turn it on (default: the realtime voice)
  AGENT_ELEVENLABS_VOICE_ID the ElevenLabs voice id (must match the receptionist's
                            name and persona, e.g. a female voice for "Sophia")
  AGENT_ELEVENLABS_MODEL    one of ALLOWED_MODELS (default eleven_flash_v2_5)

Delivery, for every ElevenLabs voice (unset: ElevenLabs' own voice settings):

  AGENT_ELEVENLABS_SPEED       0.7 - 1.2
  AGENT_ELEVENLABS_STABILITY   0 - 1 (lower = more expressive, higher = steadier)
  AGENT_ELEVENLABS_SIMILARITY  0 - 1
  AGENT_ELEVENLABS_STYLE       0 - 1 (0 avoids exaggerated delivery)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

PROVIDER = "elevenlabs"
VOICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9]{10,40}$")
ALLOWED_MODELS = (
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
    "eleven_turbo_v2_5",
    "eleven_v3_conversational",
    "eleven_v4_turbo",
)
DEFAULT_MODEL = "eleven_flash_v2_5"

DEFAULT_STT = "deepgram/nova-3"
# "multi" lets the speech-to-text follow a caller who switches between French and English.
STT_LANGUAGE = "multi"
DEFAULT_LLM = "openai/gpt-6-luna"
DEFAULT_FALLBACK_TTS = "cartesia/sonic-3"

# A LiveKit Inference descriptor: "provider/model" with an optional ":voice".
_DESCRIPTOR = re.compile(r"^[a-z0-9][a-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9._-]+)?$")


@dataclass(frozen=True)
class CustomVoice:
    voice_id: str
    model: str
    # "cloned" for a business's own voice, "standard" for AGENT_ELEVENLABS_VOICE_ID.
    source: str = "cloned"

    def __repr__(self) -> str:  # never put the voice id in a log line
        return f"CustomVoice(model={self.model!r}, source={self.source!r})"

    def describe(self) -> str:
        """For the per-call log. A cloned voice's id belongs to the owner and stays out."""
        if self.source == "standard":
            return f"ElevenLabs standard voice {self.voice_id} ({self.model})"
        return f"business's cloned ElevenLabs voice ({self.model})"


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


def standard_voice(env: Mapping[str, str]) -> CustomVoice | None:
    """The ElevenLabs voice every call uses when the operator turned it on, else None."""
    if (env.get("AGENT_STANDARD_VOICE") or "").strip().lower() != PROVIDER:
        return None
    if _flag_off(env, "AGENT_CUSTOM_VOICE") or not (env.get("ELEVENLABS_API_KEY") or "").strip():
        return None
    voice_id = (env.get("AGENT_ELEVENLABS_VOICE_ID") or "").strip()
    if not VOICE_ID_PATTERN.fullmatch(voice_id):
        return None
    model = (env.get("AGENT_ELEVENLABS_MODEL") or "").strip() or DEFAULT_MODEL
    if model not in ALLOWED_MODELS:
        model = DEFAULT_MODEL
    return CustomVoice(voice_id=voice_id, model=model, source="standard")


def call_voice(cfg: Mapping[str, Any] | None, env: Mapping[str, str]) -> CustomVoice | None:
    """The ElevenLabs voice for this call: the business's own, else the standard one."""
    return parse_custom_voice(cfg, env) or standard_voice(env)


def _unit(env: Mapping[str, str], name: str, low: float, high: float) -> float | None:
    try:
        value = float((env.get(name) or "").strip())
    except ValueError:
        return None
    return min(max(value, low), high)


def delivery_settings(env: Mapping[str, str]) -> dict[str, float] | None:
    """ElevenLabs VoiceSettings fields, or None to keep the voice's own settings.

    ElevenLabs needs stability and similarity together, so a missing one gets its
    documented default.
    """
    values = {
        "speed": _unit(env, "AGENT_ELEVENLABS_SPEED", 0.7, 1.2),
        "stability": _unit(env, "AGENT_ELEVENLABS_STABILITY", 0.0, 1.0),
        "similarity_boost": _unit(env, "AGENT_ELEVENLABS_SIMILARITY", 0.0, 1.0),
        "style": _unit(env, "AGENT_ELEVENLABS_STYLE", 0.0, 1.0),
    }
    chosen = {k: v for k, v in values.items() if v is not None}
    if not chosen:
        return None
    chosen.setdefault("stability", 0.5)
    chosen.setdefault("similarity_boost", 0.75)
    return chosen


def cascade_settings(env: Mapping[str, str]) -> CascadeSettings:
    return CascadeSettings(
        stt=_descriptor(env, "AGENT_CUSTOM_VOICE_STT", DEFAULT_STT),
        stt_language=STT_LANGUAGE,
        llm=_descriptor(env, "AGENT_CUSTOM_VOICE_LLM", DEFAULT_LLM),
        fallback_tts=_descriptor(env, "AGENT_FALLBACK_TTS", DEFAULT_FALLBACK_TTS),
    )
