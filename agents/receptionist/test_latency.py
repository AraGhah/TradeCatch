import io
import re
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace

import latency
from latency import CallLatency, TurnTimer, gaps_in, percentile, summarize


def llm(ttft=0.4, duration=0.9):
    return SimpleNamespace(type="llm_metrics", ttft=ttft, duration=duration)


class PercentileTests(unittest.TestCase):
    def test_one_value_is_every_percentile(self):
        self.assertEqual(percentile([2.5], 50), 2.5)
        self.assertEqual(percentile([2.5], 95), 2.5)

    def test_interpolates_between_the_two_nearest(self):
        self.assertAlmostEqual(percentile([1, 2, 3, 4], 50), 2.5)
        self.assertAlmostEqual(percentile([1, 2, 3, 4], 0), 1)
        self.assertAlmostEqual(percentile([1, 2, 3, 4], 100), 4)
        self.assertAlmostEqual(percentile([0, 10], 95), 9.5)

    def test_order_of_the_input_does_not_matter(self):
        self.assertEqual(percentile([4, 1, 3, 2], 50), percentile([1, 2, 3, 4], 50))

    def test_no_values_is_an_error_not_a_made_up_number(self):
        with self.assertRaises(ValueError):
            percentile([], 50)


class SummaryTests(unittest.TestCase):
    def test_no_turns_no_summary(self):
        self.assertIsNone(summarize([]))
        self.assertIsNone(CallLatency().summary())

    def test_summary_line(self):
        summary = summarize([1.0, 2.0, 3.0, 4.0, 10.0])
        self.assertEqual(summary.turns, 5)
        self.assertAlmostEqual(summary.average, 4.0)
        self.assertAlmostEqual(summary.p50, 3.0)
        self.assertAlmostEqual(summary.maximum, 10.0)
        self.assertEqual(
            summary.line(),
            "reply latency summary: 5 turns, avg 4.00s, p50 3.00s, p95 8.80s, max 10.00s",
        )

    def test_negative_gaps_are_not_counted(self):
        self.assertEqual(summarize([-1.0, 2.0]).turns, 1)


class TurnTimerTests(unittest.TestCase):
    def test_gap_runs_from_the_caller_stopping_to_the_first_sound(self):
        timer = TurnTimer()
        timer.caller_stopped(10.0)
        record = timer.agent_spoke(11.5)
        self.assertAlmostEqual(record.gap, 1.5)
        self.assertEqual(record.backend_runs, 0)
        self.assertRegex(record.line(), r"^reply gap 1\.50s \(0 backend runs\)$")

    def test_a_turn_is_measured_once(self):
        timer = TurnTimer()
        timer.caller_stopped(1.0)
        self.assertIsNotNone(timer.agent_spoke(2.0))
        self.assertIsNone(timer.agent_spoke(3.0))

    def test_agent_speech_with_no_caller_turn_is_not_a_gap(self):
        self.assertIsNone(TurnTimer().agent_spoke(5.0))

    def test_the_caller_starting_again_cancels_the_pending_turn(self):
        timer = TurnTimer()
        timer.caller_stopped(1.0)
        self.assertTrue(timer.waiting)
        timer.caller_spoke()
        self.assertFalse(timer.waiting)
        self.assertIsNone(timer.agent_spoke(2.0))

    def test_backend_runs_are_counted_and_the_model_stages_logged(self):
        timer = TurnTimer()
        timer.caller_stopped(0.0)
        self.assertEqual(timer.add(llm(ttft=0.4, duration=0.9)), 1)
        self.assertEqual(timer.add(llm(ttft=0.6, duration=1.1)), 2)
        record = timer.agent_spoke(3.0)
        self.assertEqual(record.backend_runs, 2)
        self.assertAlmostEqual(record.stages["model first token"], 0.4)
        self.assertAlmostEqual(record.stages["model total"], 2.0)
        self.assertIn("(2 backend runs) [model first token 0.40s, model total 2.00s]", record.line())

    def test_other_pipeline_stages_are_reported_in_a_fixed_order(self):
        timer = TurnTimer()
        timer.caller_stopped(0.0)
        timer.add(SimpleNamespace(type="tts_metrics", ttfb=0.21))
        timer.add(SimpleNamespace(type="eou_metrics", end_of_utterance_delay=0.5))
        timer.add(SimpleNamespace(type="realtime_model_metrics", ttft=0.7))
        line = timer.agent_spoke(1.5).line()
        self.assertLess(line.index("end of turn 0.50s"), line.index("voice first audio 0.21s"))
        self.assertIn("voice model first audio 0.70s", line)

    def test_unknown_or_unreported_stages_are_left_out_not_guessed(self):
        timer = TurnTimer()
        timer.caller_stopped(0.0)
        self.assertIsNone(timer.add(SimpleNamespace(type="vad_metrics")))
        self.assertIsNone(timer.add(SimpleNamespace(type="tts_metrics", ttfb=-1)))
        self.assertIsNone(timer.add(None))
        record = timer.agent_spoke(1.0)
        self.assertEqual(record.stages, {})
        self.assertNotIn("[", record.line())

    def test_a_new_turn_starts_from_zero(self):
        timer = TurnTimer()
        timer.caller_stopped(0.0)
        timer.add(llm())
        timer.agent_spoke(1.0)
        timer.caller_stopped(5.0)
        record = timer.agent_spoke(5.5)
        self.assertEqual(record.backend_runs, 0)
        self.assertEqual(record.stages, {})

    def test_the_gap_is_never_negative(self):
        timer = TurnTimer()
        timer.caller_stopped(5.0)
        self.assertEqual(timer.agent_spoke(4.0).gap, 0.0)


class LogAnalysisTests(unittest.TestCase):
    LINES = [
        "2026-11-10 agent: reply gap 1.20s (1 backend runs) [model total 0.80s]",
        "2026-11-10 agent: backend run: 40 reasoning tokens, 12 output tokens",
        "2026-11-10 agent: reply gap 3.00s (0 backend runs)",
        "2026-11-10 agent: reply latency summary: 2 turns, avg 2.10s, p50 2.10s, p95 2.91s, max 3.00s",
    ]

    def test_gaps_are_found_in_any_log_line_and_the_summary_is_not_counted_twice(self):
        self.assertEqual(gaps_in(self.LINES), [1.2, 3.0])

    def test_the_line_written_by_the_agent_is_the_line_read_back(self):
        timer = TurnTimer()
        timer.caller_stopped(0.0)
        timer.add(llm())
        line = timer.agent_spoke(2.34).line()
        self.assertEqual(gaps_in([line]), [2.34])
        self.assertRegex(line, r"reply gap \d+\.\d\ds \(1 backend runs\)")

    def test_report_has_a_row_per_file_and_marks_an_empty_one(self):
        text = latency.report([("before.log", self.LINES), ("after.log", ["nothing here"])])
        rows = text.splitlines()
        self.assertEqual(len(rows), 3)
        self.assertRegex(rows[1], r"before\.log\s+2\s+2\.10s\s+2\.10s\s+2\.91s\s+3\.00s")
        self.assertRegex(rows[2], r"after\.log\s+0\s+-\s+-\s+-\s+-")

    def test_main_reads_files_given_on_the_command_line(self):
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "calls.log")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("\n".join(self.LINES))
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(latency.main(["latency.py", path]), 0)
        self.assertTrue(re.search(r"calls\.log\s+2\s+2\.10s", out.getvalue()))


if __name__ == "__main__":
    unittest.main()
