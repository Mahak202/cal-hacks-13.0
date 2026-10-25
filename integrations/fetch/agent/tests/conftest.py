"""Shared fakes for the Roomwise agent tests. Nothing here touches the network."""

from __future__ import annotations

import copy
import logging
import secrets
import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from roomwise_agent import SEED_ENV, PlannerError

PLANNER_KEY = "k" * 32


def team_env(**overrides: str) -> dict[str, str]:
    env = {var: secrets.token_urlsafe(40) for var in SEED_ENV.values()}
    env.update({"ROOMWISE_PLANNER_API_KEY": PLANNER_KEY, "AGENT_MAILBOX": "false"})
    env.update(overrides)
    return env


class FakeContext:
    def __init__(self, session: uuid.UUID | None = None):
        self.session = session or uuid.uuid4()
        self.logger = logging.getLogger("test-agent")
        self.sent: list[tuple[str, object]] = []

    async def send(self, destination: str, message: object) -> None:
        self.sent.append((destination, message))


# Canned sections the fake planner returns, keyed by tool.
SECTIONS = {
    "get_quote": ["**Roomwise shopping plan**\n1. **Bed**: Oak Bed (Article) USD 899.00"],
    "finance_breakdown": ["**Finance breakdown** (planning only: nothing is charged, reserved or ordered)"],
    "compare_alternatives": ["**Rug alternatives**: top 2 of 2"],
}


class FakePlanner:
    """In-memory stand-in for PlannerClient."""

    def __init__(self, *, interpret: dict[str, Any] | None = None, fail: dict[str, str] | None = None, has_plan: bool = False, items: int = 0):
        self.interpretation = interpret or {"calls": []}
        self.fail = fail or {}
        self.has_plan = has_plan
        self.items = items
        self.executed: list[tuple[str, str, str, str, dict[str, Any]]] = []
        self.history: list[tuple[str, str]] = []
        self.role_chats: list[tuple[str, str, str, str]] = []
        self.ended: list[tuple[str, str]] = []
        self.error: PlannerError | None = None

    async def state(self, sender: str, session_id: str) -> dict[str, Any]:
        if self.error:
            raise self.error
        return {"state": "Current conversation state (authoritative, from the server): {}", "history": [], "hasPlan": self.has_plan, "itemCount": self.items}

    async def interpret(self, sender: str, session_id: str, message: str) -> dict[str, Any]:
        return self.interpretation

    async def append_history(self, sender: str, session_id: str, user: str, assistant: str) -> None:
        self.history.append((user, assistant))

    async def execute(self, sender: str, session_id: str, agent: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.executed.append((sender, session_id, agent, tool, arguments))
        if self.error:
            raise self.error
        if tool in self.fail:
            return {"agent": agent, "tool": tool, "ok": False, "error": self.fail[tool], "sections": []}
        result: Any = {"ok": True}
        if tool == "set_room_brief":
            result = {"changed": ["items"], "preferences": {"needs": arguments.get("set_items", [{"category": "bed"}])}}
        return {"agent": agent, "tool": tool, "ok": True, "result": result, "sections": SECTIONS.get(tool, [])}

    async def role_chat(self, sender: str, session_id: str, agent: str, message: str) -> str:
        self.role_chats.append((sender, session_id, agent, message))
        if self.error:
            raise self.error
        return f"**Roomwise {agent} reply**"

    async def end_session(self, sender: str, session_id: str) -> bool:
        self.ended.append((sender, session_id))
        return True

    async def tools(self) -> list[dict[str, Any]]:
        owners = {
            "set_room_brief": "design", "set_budget": "budget", "optimize_plan": "budget", "search_products": "product",
            "choose_product": "product", "compare_alternatives": "comparison", "get_quote": "quotation",
            "finance_breakdown": "finance", "reset_session": "orchestrator",
        }
        return [{"name": n, "description": f"{n} tool", "input_schema": {"type": "object", "properties": {}}, "agent": a} for n, a in owners.items()]


class FakeAsi1:
    """Scripted stand-in for openai's `chat.completions` (ASI:One)."""

    def __init__(self, script: list[dict[str, Any]]):
        self.script = list(script)
        self.requests: list[dict[str, Any]] = []

    async def create(self, **params: Any) -> Any:
        self.requests.append(copy.deepcopy(params))
        if not self.script:
            raise RuntimeError("fake ASI:One script exhausted")
        turn = self.script.pop(0)
        if isinstance(turn, Exception):
            raise turn
        calls = [
            SimpleNamespace(id=c["id"], type="function", function=SimpleNamespace(name=c["name"], arguments=c["arguments"]))
            for c in turn.get("tool_calls", [])
        ]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=turn.get("content"), tool_calls=calls or None))])


@pytest.fixture
def ctx() -> FakeContext:
    return FakeContext()
