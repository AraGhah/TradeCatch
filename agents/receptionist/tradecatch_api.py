"""HTTP client for TradeCatch's receptionist endpoints (aiohttp, no LiveKit imports).

Same trust model as before: bearer `TRADECATCH_OPS_SECRET` plus
`X-Ops-Actor: livekit-agent`, and the dialed number picks the business on the
server. Request and response bodies can contain caller speech, so they are never
logged here; only the endpoint, status and call id are.

Every method returns None on failure instead of raising, because a live call
must always get an answer it can speak.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Mapping

import aiohttp

logger = logging.getLogger("tradecatch-api")

CONFIG_TIMEOUT_SECONDS = 4.0
AVAILABILITY_TIMEOUT_SECONDS = 9.0
BOOK_TIMEOUT_SECONDS = 9.0
REPORT_TIMEOUT_SECONDS = 10.0

REPORT_ATTEMPTS = 3
BOOK_ATTEMPTS = 2
RETRY_PAUSE_SECONDS = 1.0


def _seconds(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if 1.0 <= value <= 60.0 else default


class TradeCatchClient:
    def __init__(
        self,
        base_url: str,
        secret: str,
        *,
        session: aiohttp.ClientSession | None = None,
        retry_pause: float = RETRY_PAUSE_SECONDS,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {secret}",
            "X-Ops-Actor": "livekit-agent",
        }
        self._session = session
        self._retry_pause = retry_pause

    @classmethod
    def from_env(cls) -> "TradeCatchClient | None":
        base = os.environ.get("TRADECATCH_BASE_URL", "").strip()
        secret = os.environ.get("TRADECATCH_OPS_SECRET", "").strip()
        if not base or not secret:
            logger.error("TRADECATCH_BASE_URL / TRADECATCH_OPS_SECRET are not set")
            return None
        return cls(base, secret)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        timeout: float,
        params: Mapping[str, str] | None = None,
        json: Mapping[str, Any] | None = None,
    ) -> tuple[int, dict[str, Any]] | None:
        """One attempt. (status, body) or None when nothing usable came back."""
        owned = self._session is None
        session = self._session or aiohttp.ClientSession()
        try:
            async with session.request(
                method,
                f"{self._base}{path}",
                params=params,
                json=json,
                headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as res:
                try:
                    body = await res.json(content_type=None)
                except Exception:
                    body = {}
                return res.status, body if isinstance(body, dict) else {}
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning("%s %s failed: %s", method, path, type(err).__name__)
            return None
        finally:
            if owned:
                await session.close()

    async def _post(
        self,
        path: str,
        body: Mapping[str, Any],
        *,
        timeout: float,
        attempts: int,
    ) -> dict[str, Any] | None:
        """POST with retries on network errors and 5xx. A 4xx is final."""
        call_id = body.get("callId")
        for attempt in range(1, attempts + 1):
            answer = await self._request("POST", path, timeout=timeout, json=body)
            if answer is not None:
                status, data = answer
                if status == 200 and data.get("ok") is True:
                    return data
                if status < 500:
                    logger.error("%s returned %s (call %s)", path, status, call_id)
                    return None
                logger.warning("%s returned %s (call %s)", path, status, call_id)
            if attempt < attempts:
                await asyncio.sleep(self._retry_pause * attempt)
        return None

    # -- endpoints ------------------------------------------------------

    async def fetch_business_config(self, number: str) -> dict[str, Any] | None:
        answer = await self._request(
            "GET",
            "/api/receptionist/agent-config",
            timeout=_seconds("AGENT_CONFIG_TIMEOUT_SECONDS", CONFIG_TIMEOUT_SECONDS),
            params={"number": number},
        )
        if answer is None:
            return None
        status, data = answer
        if status != 200:
            logger.error("agent-config returned %s for %s", status, number)
            return None
        config = data.get("config")
        return config if isinstance(config, dict) else None

    async def availability(self, body: Mapping[str, Any]) -> dict[str, Any] | None:
        data = await self._post(
            "/api/receptionist/agent/availability",
            body,
            timeout=_seconds("AGENT_AVAILABILITY_TIMEOUT_SECONDS", AVAILABILITY_TIMEOUT_SECONDS),
            attempts=1,
        )
        result = data.get("availability") if data else None
        return result if isinstance(result, dict) else None

    async def book(self, body: Mapping[str, Any]) -> dict[str, Any] | None:
        # The server books with an idempotency key, so retrying cannot double-book.
        data = await self._post(
            "/api/receptionist/agent/book",
            body,
            timeout=_seconds("AGENT_BOOK_TIMEOUT_SECONDS", BOOK_TIMEOUT_SECONDS),
            attempts=BOOK_ATTEMPTS,
        )
        result = data.get("booking") if data else None
        return result if isinstance(result, dict) else None

    async def report(self, body: Mapping[str, Any]) -> bool:
        # Repeating a report is harmless: the server finalizes each call once.
        data = await self._post(
            "/api/receptionist/agent/report",
            body,
            timeout=REPORT_TIMEOUT_SECONDS,
            attempts=REPORT_ATTEMPTS,
        )
        return bool(data and data.get("recorded"))
