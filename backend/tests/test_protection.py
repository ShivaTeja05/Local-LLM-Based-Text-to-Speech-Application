"""Rate limits, the cap on simultaneous replies, and security headers (app/protection.py)."""

import asyncio

import pytest
from fastapi.testclient import TestClient

import app.main as main_mod
from app.config import Settings
from app.protection import CSP, RateLimiter
from tests.test_api import USER_HI, FakeLLM, FakeTTS


@pytest.fixture
def client(monkeypatch):
    settings = Settings(_env_file=None, cors_origin_regex=r"https://ellie[a-z0-9-]*\.vercel\.app")
    monkeypatch.setattr(main_mod, "get_settings", lambda: settings)
    app = main_mod.create_app()
    app.state.llm, app.state.tts = FakeLLM(), FakeTTS()
    return TestClient(app)


def chat(client, ip="203.0.113.5", **headers):
    return client.post("/api/chat/stream", json=USER_HI, headers={"X-Forwarded-For": ip, **headers})


def test_chat_is_limited_per_client_with_retry_after(client):
    codes = [chat(client).status_code for _ in range(16)]
    assert codes[:15] == [200] * 15 and codes[15] == 429
    r = chat(client)
    assert int(r.headers["retry-after"]) > 0 and "Too many requests" in r.json()["detail"]
    assert chat(client, ip="198.51.100.7").status_code == 200  # someone else is unaffected


def test_a_faked_forwarded_address_does_not_dodge_the_limit(client):
    # Google appends the real address last; anything before it can be invented by the client.
    for i in range(15):
        assert chat(client, ip=f"10.0.0.{i}, 203.0.113.5").status_code == 200
    assert chat(client, ip="10.9.9.9, 203.0.113.5").status_code == 429


def test_limit_reply_is_readable_by_the_allowed_frontend(client):
    origin = "https://ellie-git-main-me.vercel.app"
    for _ in range(15):
        chat(client, Origin=origin)
    r = chat(client, Origin=origin)
    assert r.status_code == 429 and r.headers["access-control-allow-origin"] == origin


def test_security_headers_on_api_and_app_but_no_csp_on_docs(client):
    r = client.get("/api/voices")
    for header in ("x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy",
                   "strict-transport-security"):
        assert header in r.headers
    assert r.headers["content-security-policy"] == CSP and "frame-ancestors 'none'" in CSP
    assert "content-security-policy" not in client.get("/docs").headers


def test_no_internal_details_in_health_errors(client):
    from app.llm.ollama_adapter import OllamaAdapter

    adapter = OllamaAdapter(Settings(_env_file=None, ollama_url="http://127.0.0.1:1"))
    health = asyncio.run(adapter.health())
    assert health["ok"] is False and "127.0.0.1" not in health["error"]


def test_simultaneous_replies_are_capped():
    async def scenario():
        from app.protection import ProtectionMiddleware

        started = asyncio.Event()
        release = asyncio.Event()
        running = 0

        async def slow_app(scope, receive, send):
            nonlocal running
            running += 1
            started.set()
            await release.wait()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        mw = ProtectionMiddleware(slow_app, max_generations=1, queue_seconds=0.2)
        sent = []

        async def send(msg):
            sent.append(msg)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        def scope(ip):
            return {"type": "http", "method": "POST", "path": "/api/chat/stream", "headers": [
                (b"x-forwarded-for", ip.encode())], "client": ("127.0.0.1", 1), "query_string": b""}

        first = asyncio.create_task(mw(scope("1.1.1.1"), receive, send))
        await started.wait()
        await mw(scope("2.2.2.2"), receive, send)  # waits 0.2 s for a slot, then gives up
        busy = [m for m in sent if m["type"] == "http.response.start"]
        release.set()
        await first
        return busy, running

    busy, running = asyncio.run(scenario())
    assert busy[0]["status"] == 503 and running == 1


def test_limiter_windows():
    limiter = RateLimiter({("GET", "/x"): [(2, 60)]})

    async def run():
        return [await limiter.check("GET", "/x", "a") for _ in range(3)] + [await limiter.check("GET", "/x", "b")]

    a1, a2, a3, b1 = asyncio.run(run())
    assert a1 is None and a2 is None and a3 > 0 and b1 is None
