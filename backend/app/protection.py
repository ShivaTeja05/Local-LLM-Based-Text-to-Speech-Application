"""Abuse protection for a public demo: per-client rate limits, a cap on simultaneous replies, and
security headers. Everything is in memory, which suits one instance (Cloud Run max-instances=1).

Client identity: behind Google's front end (Cloud Run) the real client address is the LAST entry
of X-Forwarded-For, appended by Google. Earlier entries can be set by the client, so they are
never trusted. Without that header (local runs) the socket address is used.
"""

import asyncio
import logging
import math
import time
from collections import defaultdict, deque

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

log = logging.getLogger(__name__)

# (method, path) -> [(max requests, window seconds), ...]
LIMITS: dict[tuple[str, str], list[tuple[int, int]]] = {
    ("POST", "/api/chat/stream"): [(15, 60), (200, 3600)],
    ("POST", "/api/chat"): [(15, 60), (200, 3600)],
    ("POST", "/api/tts"): [(120, 60)],
    ("POST", "/api/stt"): [(10, 60), (100, 3600)],
    ("POST", "/api/memory"): [(10, 60)],
    ("POST", "/api/my-voice"): [(5, 60), (20, 3600)],
    ("GET", "/api/health"): [(120, 60)],  # the app polls every 15 s; several tabs must fit
    ("GET", "/api/voices"): [(30, 60)],
}
# Ceilings across ALL clients together: a hard bound on compute however requests are spread
# across addresses (the per-client limits alone can be dodged by using many addresses).
GLOBAL_LIMITS: dict[tuple[str, str], list[tuple[int, int]]] = {
    ("POST", "/api/chat/stream"): [(600, 3600), (3000, 86400)],
    ("POST", "/api/chat"): [(600, 3600), (3000, 86400)],
    ("POST", "/api/tts"): [(4000, 3600), (20000, 86400)],
    ("POST", "/api/stt"): [(300, 3600), (1500, 86400)],
    ("POST", "/api/my-voice"): [(200, 3600), (1000, 86400)],
    ("POST", "/api/memory"): [(300, 3600), (1500, 86400)],
}
GENERATION_ROUTES = {"/api/chat/stream", "/api/chat", "/api/memory"}

# The page loads only its own scripts; Angular injects component styles inline; speech is played
# from fetched bytes through Web Audio, so no media URLs are needed.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; "
       "form-action 'self'; frame-ancestors 'none'")
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self, limits: dict[tuple[str, str], list[tuple[int, int]]] = LIMITS):
        self.limits = limits
        self.hits: dict[tuple[str, str, str], deque[float]] = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def check(self, method: str, path: str, client: str) -> float | None:
        """None if allowed, else seconds until the client may retry."""
        rules = self.limits.get((method, path))
        if not rules:
            return None
        now = time.monotonic()
        longest = max(window for _, window in rules)
        async with self.lock:
            q = self.hits[(client, method, path)]
            while q and now - q[0] > longest:
                q.popleft()
            for limit, window in rules:
                recent = [t for t in q if now - t <= window]
                if len(recent) >= limit:
                    return window - (now - recent[0])
            q.append(now)
            if len(self.hits) > 50_000:  # forget idle clients rather than grow without bound
                for k in [k for k, v in self.hits.items() if not v or now - v[-1] > 3600]:
                    del self.hits[k]
        return None


class ProtectionMiddleware:
    """Rate limits, a cap on simultaneous LLM work, and security headers on every response."""

    def __init__(self, app: ASGIApp, enabled: bool = True, max_generations: int = 2, queue_seconds: float = 30.0,
                 csp: bool = True):
        self.app = app
        self.enabled = enabled
        self.limiter = RateLimiter()
        self.global_limiter = RateLimiter(GLOBAL_LIMITS)
        self.generations = asyncio.Semaphore(max_generations)
        self.queue_seconds = queue_seconds
        self.headers = [(k.lower().encode(), v.encode()) for k, v in SECURITY_HEADERS.items()]
        self.csp = (b"content-security-policy", CSP.encode()) if csp else None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        # The interactive API docs load Swagger UI from a CDN, so they get no CSP.
        extra = self.headers + ([self.csp] if self.csp and not scope["path"].startswith(("/docs", "/redoc")) else [])

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [h for h in extra if h[0] not in existing]
            await send(message)

        if not self.enabled:
            return await self.app(scope, receive, send_with_headers)

        request = Request(scope)
        path, method = scope["path"], scope["method"]
        client = client_key(request)
        retry = await self.limiter.check(method, path, client)
        if retry is None:
            busy_day = await self.global_limiter.check(method, path, "*everyone*")
            if busy_day is not None:
                log.warning("global limit reached for %s %s", method, path)
                response = JSONResponse(
                    {"detail": "Ellie has had a very busy day. Please try again a little later."}, status_code=429,
                    headers={"Retry-After": str(max(1, math.ceil(busy_day)))})
                return await response(scope, receive, send_with_headers)
        if retry is not None:
            log.warning("rate limited %s %s (client %s)", method, path, client)
            response: Response = JSONResponse(
                {"detail": "Too many requests: please wait a moment and try again."}, status_code=429,
                headers={"Retry-After": str(max(1, math.ceil(retry)))})
            return await response(scope, receive, send_with_headers)

        if path in GENERATION_ROUTES and method == "POST":
            try:
                await asyncio.wait_for(self.generations.acquire(), timeout=self.queue_seconds)
            except TimeoutError:
                response = JSONResponse({"detail": "Ellie is busy with other people just now. Please try again in a moment."},
                                        status_code=503, headers={"Retry-After": "10"})
                return await response(scope, receive, send_with_headers)
            try:
                return await self.app(scope, receive, send_with_headers)
            finally:
                self.generations.release()
        return await self.app(scope, receive, send_with_headers)
