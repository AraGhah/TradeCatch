"""Which kind of session a call gets, using the real LiveKit classes (built offline).

Nothing here talks to ElevenLabs or LiveKit: constructing a session only wires
objects together (it needs a running event loop, hence the async test case).
What it cannot show is how the cloned voice *sounds* or how fast it answers:
that needs a live call.
"""

import os
import unittest
from unittest import mock

try:
    import agent as A
    from livekit.agents import tts as lk_tts
except ImportError as err:  # livekit-agents is not installed here
    raise unittest.SkipTest(f"livekit-agents unavailable: {err}")

try:
    from livekit.plugins import elevenlabs, silero  # noqa: F401

    HAVE_PLUGINS = True
except ImportError:
    HAVE_PLUGINS = False

CUSTOM_CFG = {
    "instructions": "x",
    "voice": {
        "mode": "custom",
        "provider": "elevenlabs",
        "voiceId": "abcDEF1234567890",
        "model": "eleven_flash_v2_5",
    },
}
ENV = {
    "LIVEKIT_URL": "wss://example.livekit.cloud",
    "LIVEKIT_API_KEY": "devkey",
    "LIVEKIT_API_SECRET": "devsecret-devsecret-devsecret-devsecret",
    "ELEVENLABS_API_KEY": "xi-test",
}


class BuildSessionTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, ENV, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("AGENT_CUSTOM_VOICE", None)

    def standard(self, session):
        # The realtime speech-to-speech model does its own listening and speaking.
        self.assertIsNone(session.tts)
        self.assertIsNone(session.stt)

    async def test_no_voice_field_keeps_the_standard_realtime_voice(self):
        self.standard(A.build_session({"instructions": "x"}, object(), {}))
        self.standard(A.build_session(None, None, {}))

    async def test_standard_mode_keeps_the_standard_voice(self):
        cfg = {"instructions": "x", "voice": {"mode": "standard"}}
        self.standard(A.build_session(cfg, object(), {}))

    async def test_a_custom_voice_without_the_api_key_is_standard(self):
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}):
            self.standard(A.build_session(CUSTOM_CFG, object(), {}))

    async def test_the_kill_switch_forces_the_standard_voice(self):
        with mock.patch.dict(os.environ, {"AGENT_CUSTOM_VOICE": "false"}):
            self.standard(A.build_session(CUSTOM_CFG, object(), {}))

    async def test_a_missing_voice_activity_model_is_standard(self):
        self.standard(A.build_session(CUSTOM_CFG, None, {}))

    async def test_a_failure_building_the_custom_session_is_standard(self):
        with mock.patch.object(A, "build_custom_voice_session", side_effect=RuntimeError("boom")):
            self.standard(A.build_session(CUSTOM_CFG, object(), {}))

    @unittest.skipUnless(HAVE_PLUGINS, "livekit ElevenLabs/Silero plugins not installed")
    async def test_a_valid_custom_voice_builds_the_cascade_with_a_fallback_voice(self):
        vad = silero.VAD.load()
        session = A.build_session(CUSTOM_CFG, vad, {"user_away_timeout": 8.0})
        self.assertIsNotNone(session.stt)
        self.assertIsInstance(session.tts, lk_tts.FallbackAdapter)
        # The cloned voice first, then a standard one.
        self.assertEqual(len(session.tts._tts_instances), 2)
        self.assertIsInstance(session.tts._tts_instances[0], elevenlabs.TTS)

    @unittest.skipUnless(HAVE_PLUGINS, "livekit ElevenLabs/Silero plugins not installed")
    async def test_turn_handling_options_are_accepted_by_the_cascade(self):
        vad = silero.VAD.load()
        options = {
            "user_away_timeout": 8.0,
            "turn_handling": {
                "endpointing": {"mode": "fixed", "min_delay": 0.4, "max_delay": 2.0},
                "interruption": {"enabled": True, "min_duration": 0.3},
            },
        }
        session = A.build_session(CUSTOM_CFG, vad, options)
        self.assertIsInstance(session.tts, lk_tts.FallbackAdapter)
        self.assertIsNotNone(session.stt)


if __name__ == "__main__":
    unittest.main()
