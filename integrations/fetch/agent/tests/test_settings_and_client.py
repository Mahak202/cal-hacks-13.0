"""Team configuration and the planner HTTP client (local aiohttp test server)."""

from __future__ import annotations

import asyncio
import socket

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from conftest import PLANNER_KEY, team_env

from roomwise_agent import TIMED_OUT, UNAVAILABLE, ConfigError, PlannerClient, PlannerError, TeamSettings


def test_requires_seven_unique_private_seeds():
    with pytest.raises(ConfigError) as err:
        TeamSettings.from_env({})
    for var in ("AGENT_SEED", "DESIGN_AGENT_SEED", "FINANCE_AGENT_SEED", "ROOMWISE_PLANNER_API_KEY"):
        assert var in str(err.value)
    env = team_env()
    env["PRODUCT_AGENT_SEED"] = env["BUDGET_AGENT_SEED"]
    with pytest.raises(ConfigError, match="must be unique"):
        TeamSettings.from_env(env)


def test_parses_team_settings():
    s = TeamSettings.from_env(team_env(AGENT_NAME="roomwise-shopping-planner", ASI1_API_KEY="sk-asi"))
    assert s.names["orchestrator"] == "roomwise-shopping-planner"
    assert s.names["finance"] == "roomwise-finance-agent"
    assert (s.port, s.mailbox, s.planner_url) == (8001, False, "http://127.0.0.1:8787")
    assert s.use_asi1 and s.asi1_model == "asi1" and s.asi1_base_url == "https://api.asi1.ai/v1"
    assert TeamSettings.from_env(team_env(ASI1_API_KEY="sk", ROOMWISE_LLM_PROVIDER="keyword")).use_asi1 is False
    with pytest.raises(ConfigError, match="needs ASI1_API_KEY"):
        TeamSettings.from_env(team_env(ROOMWISE_LLM_PROVIDER="asi1"))
    with pytest.raises(ConfigError, match="AGENT_MAILBOX"):
        TeamSettings.from_env(team_env(AGENT_MAILBOX="maybe"))


@pytest.fixture
async def planner_server():
    seen: list[dict] = []

    async def execute(request: web.Request) -> web.Response:
        body = await request.json()
        seen.append({"auth": request.headers.get("Authorization"), **body})
        if body["agent"] == "design" and body["tool"] == "get_quote":
            return web.json_response({"error": "The Design agent is not allowed to run get_quote."}, status=403)
        if body["tool"] == "slow":
            await asyncio.sleep(1)
        if body["tool"] == "boom":
            return web.json_response({"error": "Internal error."}, status=500)
        return web.json_response({"agent": body["agent"], "tool": body["tool"], "ok": True, "result": {}, "sections": ["S"]})

    async def tools(request: web.Request) -> web.Response:
        seen.append({"auth": request.headers.get("Authorization"), "tools": True})
        return web.json_response({"tools": [{"name": "get_quote", "description": "q", "input_schema": {}, "agent": "quotation"}]})

    async def role_chat(request: web.Request) -> web.Response:
        body = await request.json()
        return web.json_response({"reply": f"{body['agent']}: {body['message']}"})

    app = web.Application()
    app.router.add_post("/v1/agent/execute", execute)
    app.router.add_get("/v1/agent/tools", tools)
    app.router.add_post("/v1/agent/chat", role_chat)
    server = TestServer(app)
    await server.start_server()
    yield str(server.make_url("")).rstrip("/"), seen
    await server.close()


async def test_client_sends_identity_role_and_bearer_key(planner_server):
    url, seen = planner_server
    client = PlannerClient(url, PLANNER_KEY, timeout_s=5)
    data = await client.execute("agent1qu", "s-1", "quotation", "get_quote", {})
    assert data["sections"] == ["S"]
    assert seen[0] == {"auth": f"Bearer {PLANNER_KEY}", "sender": "agent1qu", "session_id": "s-1", "agent": "quotation", "tool": "get_quote", "arguments": {}}
    assert await client.role_chat("agent1qu", "s-1", "product", "a rug") == "product: a rug"
    assert (await client.tools())[0]["agent"] == "quotation"
    await client.tools()
    assert sum(1 for s in seen if s.get("tools")) == 1, "tool schemas are cached"


async def test_client_maps_errors_to_honest_messages(planner_server):
    url, _ = planner_server
    client = PlannerClient(url, PLANNER_KEY, timeout_s=5)
    with pytest.raises(PlannerError) as forbidden:
        await client.execute("u", "s", "design", "get_quote", {})
    assert forbidden.value.user_message == "I couldn't do that: The Design agent is not allowed to run get_quote."
    with pytest.raises(PlannerError) as boom:
        await client.execute("u", "s", "budget", "boom", {})
    assert boom.value.user_message == UNAVAILABLE
    with pytest.raises(PlannerError) as slow:
        await PlannerClient(url, PLANNER_KEY, timeout_s=0.2).execute("u", "s", "budget", "slow", {})
    assert slow.value.user_message == TIMED_OUT


async def test_client_reports_an_unreachable_planner():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    with pytest.raises(PlannerError) as err:
        await PlannerClient(f"http://127.0.0.1:{port}", PLANNER_KEY, timeout_s=15).state("u", "s")
    assert err.value.user_message == UNAVAILABLE
