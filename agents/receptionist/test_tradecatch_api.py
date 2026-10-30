import unittest

from aiohttp import web
from aiohttp.test_utils import TestServer

from tradecatch_api import TradeCatchClient, _seconds

BODY = {"number": "+14382314700", "callId": "call-abc123", "language": "fr"}


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests: list[dict] = []
        # Status codes to answer with, in order; 200 once the list is used up.
        self.statuses: list[int] = []
        self.payload: dict = {"ok": True}

        async def handle(request: web.Request) -> web.Response:
            self.requests.append(
                {
                    "path": request.path,
                    "auth": request.headers.get("Authorization"),
                    "actor": request.headers.get("X-Ops-Actor"),
                    "query": dict(request.query),
                    "body": await request.json() if request.method == "POST" else None,
                }
            )
            status = self.statuses.pop(0) if self.statuses else 200
            if status != 200:
                return web.json_response({"error": "nope"}, status=status)
            return web.json_response(self.payload)

        app = web.Application()
        for path in ("availability", "book", "report"):
            app.router.add_post(f"/api/receptionist/agent/{path}", handle)
        app.router.add_get("/api/receptionist/agent-config", handle)
        self.server = TestServer(app)
        await self.server.start_server()
        self.client = TradeCatchClient(
            str(self.server.make_url("/")), "s3cret", retry_pause=0
        )

    async def asyncTearDown(self):
        await self.server.close()

    async def test_requests_carry_the_ops_credentials(self):
        self.payload = {"ok": True, "recorded": True}
        self.assertTrue(await self.client.report(BODY))
        sent = self.requests[0]
        self.assertEqual(sent["auth"], "Bearer s3cret")
        self.assertEqual(sent["actor"], "livekit-agent")
        self.assertEqual(sent["body"], BODY)

    async def test_report_retries_a_server_error_then_succeeds(self):
        self.statuses = [500, 502]
        self.payload = {"ok": True, "recorded": True}
        self.assertTrue(await self.client.report(BODY))
        self.assertEqual(len(self.requests), 3)

    async def test_report_gives_up_after_three_attempts(self):
        self.statuses = [500, 500, 500, 500]
        self.assertFalse(await self.client.report(BODY))
        self.assertEqual(len(self.requests), 3)

    async def test_a_rejected_request_is_not_retried(self):
        self.statuses = [401]
        self.assertFalse(await self.client.report(BODY))
        self.assertEqual(len(self.requests), 1)

    async def test_an_unrecorded_report_is_not_success(self):
        self.payload = {"ok": True, "recorded": False}
        self.assertFalse(await self.client.report(BODY))

    async def test_availability_returns_the_result_object(self):
        self.payload = {"ok": True, "availability": {"ok": True, "offers": []}}
        self.assertEqual(await self.client.availability(BODY), {"ok": True, "offers": []})
        # Live call: one attempt only, the model must not wait through retries.
        self.statuses = [500]
        self.assertIsNone(await self.client.availability(BODY))
        self.assertEqual(len(self.requests), 2)

    async def test_book_retries_once_because_the_server_is_idempotent(self):
        self.statuses = [503]
        self.payload = {"ok": True, "booking": {"status": "confirmed", "label": "x"}}
        result = await self.client.book(BODY)
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(len(self.requests), 2)

    async def test_book_without_a_booking_object_is_a_failure(self):
        self.payload = {"ok": True}
        self.assertIsNone(await self.client.book(BODY))

    async def test_config_is_fetched_by_dialed_number(self):
        self.payload = {"config": {"instructions": "hi"}}
        self.assertEqual(
            await self.client.fetch_business_config("+14382314700"),
            {"instructions": "hi"},
        )
        self.assertEqual(self.requests[0]["query"], {"number": "+14382314700"})

    async def test_config_for_an_unknown_number_is_none(self):
        self.statuses = [404]
        self.assertIsNone(await self.client.fetch_business_config("+19995550000"))

    async def test_an_unreachable_server_returns_none_instead_of_raising(self):
        client = TradeCatchClient("http://127.0.0.1:1", "s3cret", retry_pause=0)
        self.assertIsNone(await client.fetch_business_config("+14382314700"))
        self.assertIsNone(await client.availability(BODY))
        self.assertIsNone(await client.book(BODY))
        self.assertFalse(await client.report(BODY))


class EnvTests(unittest.TestCase):
    def test_seconds_clamps_nonsense_to_the_default(self):
        import os

        os.environ["TEST_SECONDS"] = "abc"
        self.assertEqual(_seconds("TEST_SECONDS", 4.0), 4.0)
        os.environ["TEST_SECONDS"] = "0.1"
        self.assertEqual(_seconds("TEST_SECONDS", 4.0), 4.0)
        os.environ["TEST_SECONDS"] = "12"
        self.assertEqual(_seconds("TEST_SECONDS", 4.0), 12.0)
        del os.environ["TEST_SECONDS"]

    def test_from_env_needs_both_values(self):
        import os

        saved = {k: os.environ.pop(k, None) for k in ("TRADECATCH_BASE_URL", "TRADECATCH_OPS_SECRET")}
        try:
            self.assertIsNone(TradeCatchClient.from_env())
            os.environ["TRADECATCH_BASE_URL"] = "https://example.test/"
            self.assertIsNone(TradeCatchClient.from_env())
            os.environ["TRADECATCH_OPS_SECRET"] = "x"
            self.assertIsNotNone(TradeCatchClient.from_env())
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
