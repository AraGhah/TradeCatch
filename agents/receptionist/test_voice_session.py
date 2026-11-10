"""Which kind of session a call gets, using the real LiveKit classes (built offline).

Nothing here talks to ElevenLabs or LiveKit: constructing a session only wires
objects together (it needs a running event loop, hence the async test case).
What it cannot show is how the cloned voice *sounds* or how fast it answers:
that needs a live call.
"""

import os
import sys
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

    async def test_backend_speed_settings_reach_the_standard_voice_model(self):
        env = {"AGENT_DELEGATION_REASONING": "low", "AGENT_DELEGATION_VERBOSITY": "low"}
        with mock.patch.dict(os.environ, env):
            session = A.build_session({"instructions": "x"}, object(), {})
        self.standard(session)
        responses = session.llm.duplex_model._opts.responses
        self.assertEqual(responses["reasoning"], {"effort": "low"})
        self.assertEqual(responses["text"], {"verbosity": "low"})

    async def test_without_settings_the_backend_answers_quickly_by_default(self):
        for name in ("AGENT_DELEGATION_REASONING", "AGENT_DELEGATION_VERBOSITY"):
            os.environ.pop(name, None)
        session = A.build_session({"instructions": "x"}, object(), {})
        responses = session.llm.duplex_model._opts.responses
        self.assertEqual(responses["reasoning"], {"effort": "low"})
        self.assertEqual(responses["text"], {"verbosity": "low"})

    async def test_default_hands_the_backend_settings_back_to_the_service(self):
        env = {"AGENT_DELEGATION_REASONING": "default", "AGENT_DELEGATION_VERBOSITY": "default"}
        with mock.patch.dict(os.environ, env):
            session = A.build_session({"instructions": "x"}, object(), {})
        responses = session.llm.duplex_model._opts.responses
        self.assertNotIn("reasoning", responses)
        self.assertNotIn("text", responses)

    async def test_prewarm_loads_the_standard_voice_model_before_any_call(self):
        real_import = __import__
        names = []

        def recording_import(name, *args, **kwargs):
            names.append(name)
            return real_import(name, *args, **kwargs)

        with mock.patch("builtins.__import__", side_effect=recording_import):
            A.prewarm(type("Proc", (), {"userdata": {}})())
        self.assertIn("livekit.agents.inference.realtime", names)
        self.assertIn("livekit.agents.inference.realtime", sys.modules)

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
    async def test_the_standard_elevenlabs_voice_answers_businesses_without_a_clone(self):
        env = {
            "AGENT_STANDARD_VOICE": "elevenlabs",
            "AGENT_ELEVENLABS_VOICE_ID": "j9RedbMRSNQ74PyikQwD",
            "AGENT_ELEVENLABS_SPEED": "1.05",
            "AGENT_ELEVENLABS_STYLE": "0",
        }
        vad = silero.VAD.load()
        with mock.patch.dict(os.environ, env), self.assertLogs("agent-tradecatch-receptionist", "INFO") as logs:
            session = A.build_session({"instructions": "x"}, vad, {})
        eleven = session.tts._tts_instances[0]
        self.assertIsInstance(eleven, elevenlabs.TTS)
        self.assertEqual(eleven._opts.voice_id, "j9RedbMRSNQ74PyikQwD")
        self.assertEqual(eleven._opts.model, "eleven_flash_v2_5")
        self.assertEqual(eleven._opts.voice_settings.speed, 1.05)
        self.assertEqual(eleven._opts.voice_settings.style, 0.0)
        self.assertIn("voice for this call: ElevenLabs standard voice j9RedbMRSNQ74PyikQwD", logs.output[-1])

    async def test_the_realtime_voice_is_logged_by_name(self):
        with mock.patch.dict(os.environ, {"AGENT_VOICE": "marin"}), self.assertLogs("agent-tradecatch-receptionist", "INFO") as logs:
            self.standard(A.build_session({"instructions": "x"}, object(), {}))
        self.assertIn("voice marin", logs.output[-1])

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
