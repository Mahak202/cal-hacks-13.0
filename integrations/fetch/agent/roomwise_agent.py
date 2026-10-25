"""Shared pieces of the Roomwise agent team: configuration, the planner
service client, and Agent Chat Protocol helpers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import aiohttp
from uagents import Context
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, TextContent

AGENT_DIR = Path(__file__).resolve().parent
MAX_MESSAGE_CHARS = 4000

SPECIALISTS = ("design", "product", "budget", "comparison", "quotation", "finance")
ROLES = ("orchestrator", *SPECIALISTS)
ROLE_LABELS = {
    "orchestrator": "Roomwise orchestrator",
    "design": "Design agent",
    "product": "Product agent",
    "budget": "Budget agent",
    "comparison": "Comparison agent",
    "quotation": "Quotation agent",
    "finance": "Finance agent",
}
SEED_ENV = {
    "orchestrator": "AGENT_SEED",
    "design": "DESIGN_AGENT_SEED",
    "product": "PRODUCT_AGENT_SEED",
    "budget": "BUDGET_AGENT_SEED",
    "comparison": "COMPARISON_AGENT_SEED",
    "quotation": "QUOTATION_AGENT_SEED",
    "finance": "FINANCE_AGENT_SEED",
}

UNAVAILABLE = (
    "The Roomwise planner service is unavailable right now, so nothing was searched or planned. "
    "Please try again in a few minutes."
)
TIMED_OUT = (
    "The Roomwise planner didn't answer in time. Live searches may still be finishing; "
    'send "show my plan" in a minute to see the result.'
)


class ConfigError(ValueError):
    """Raised when the team's environment configuration is invalid."""


def _parse_bool(raw: str, name: str, problems: list[str]) -> bool:
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    problems.append(f"{name} must be true or false.")
    return False


@dataclass(frozen=True)
class TeamSettings:
    seeds: dict[str, str]
    names: dict[str, str]
    port: int
    mailbox: bool
    planner_url: str
    planner_api_key: str
    planner_timeout_s: float
    asi1_api_key: str | None = None
    asi1_model: str = "asi1"
    asi1_base_url: str = "https://api.asi1.ai/v1"
    llm_provider: str = "auto"
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def use_asi1(self) -> bool:
        return self.llm_provider in ("auto", "asi1") and bool(self.asi1_api_key)

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> TeamSettings:
        problems: list[str] = []
        seeds: dict[str, str] = {}
        for role, var in SEED_ENV.items():
            seed = env.get(var, "").strip()
            if len(seed) < 32:
                problems.append(f"{var} must be a private random seed of at least 32 characters (one per agent; keep it out of version control).")
            seeds[role] = seed
        if len({s for s in seeds.values() if s}) < len([s for s in seeds.values() if s]):
            problems.append("Every agent seed must be unique: two agents share a seed.")
        api_key = env.get("ROOMWISE_PLANNER_API_KEY", "")
        if len(api_key) < 24:
            problems.append("ROOMWISE_PLANNER_API_KEY must match the planner service's key (at least 24 characters).")
        planner_url = env.get("ROOMWISE_PLANNER_URL", "http://127.0.0.1:8787").rstrip("/")
        if not planner_url.startswith(("http://", "https://")):
            problems.append("ROOMWISE_PLANNER_URL must start with http:// or https://.")
        try:
            port = int(env.get("AGENT_PORT", "8001"))
            if not 0 < port < 65536:
                raise ValueError
        except ValueError:
            problems.append("AGENT_PORT must be a port number.")
            port = 0
        try:
            timeout = float(env.get("ROOMWISE_PLANNER_TIMEOUT_SECONDS", "240"))
            if timeout <= 0:
                raise ValueError
        except ValueError:
            problems.append("ROOMWISE_PLANNER_TIMEOUT_SECONDS must be a positive number.")
            timeout = 0.0
        mailbox = _parse_bool(env.get("AGENT_MAILBOX", "true"), "AGENT_MAILBOX", problems)
        provider = env.get("ROOMWISE_LLM_PROVIDER", "auto").strip().lower() or "auto"
        if provider not in ("auto", "asi1", "claude", "keyword"):
            problems.append("ROOMWISE_LLM_PROVIDER must be auto, asi1, claude or keyword.")
        asi1_key = env.get("ASI1_API_KEY", "").strip() or None
        if provider == "asi1" and not asi1_key:
            problems.append("ROOMWISE_LLM_PROVIDER=asi1 needs ASI1_API_KEY.")
        if problems:
            raise ConfigError("Invalid agent configuration:\n- " + "\n- ".join(problems))
        names = {role: f"roomwise-{role}-agent" for role in SPECIALISTS}
        names["orchestrator"] = env.get("AGENT_NAME", "").strip() or "roomwise-orchestrator"
        return cls(
            seeds=seeds,
            names=names,
            port=port,
            mailbox=mailbox,
            planner_url=planner_url,
            planner_api_key=api_key,
            planner_timeout_s=timeout,
            asi1_api_key=asi1_key,
            asi1_model=env.get("ASI1_MODEL", "asi1").strip() or "asi1",
            asi1_base_url=env.get("ASI1_BASE_URL", "https://api.asi1.ai/v1").strip() or "https://api.asi1.ai/v1",
            llm_provider=provider,
        )


class PlannerError(Exception):
    """A planner call failed. user_message is safe to show; detail is for logs."""

    def __init__(self, user_message: str, detail: str):
        super().__init__(detail)
        self.user_message = user_message
        self.detail = detail


class PlannerClient:
    """HTTP client for the Roomwise planner service (integrations/fetch/src/server.ts)."""

    def __init__(self, base_url: str, api_key: str, timeout_s: float):
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.timeout_s = timeout_s
        self._tools: list[dict[str, Any]] | None = None

    @staticmethod
    def _who(sender: str, session_id: str) -> dict[str, str]:
        return {"sender": sender, "session_id": session_id}

    async def execute(self, sender: str, session_id: str, agent: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/v1/agent/execute", {**self._who(sender, session_id), "agent": agent, "tool": tool, "arguments": arguments})

    async def interpret(self, sender: str, session_id: str, message: str) -> dict[str, Any]:
        return await self._request("POST", "/v1/agent/interpret", {**self._who(sender, session_id), "message": message})

    async def state(self, sender: str, session_id: str) -> dict[str, Any]:
        return await self._request("POST", "/v1/agent/state", self._who(sender, session_id))

    async def append_history(self, sender: str, session_id: str, user: str, assistant: str) -> None:
        await self._request("POST", "/v1/agent/history", {**self._who(sender, session_id), "user": user, "assistant": assistant})

    async def role_chat(self, sender: str, session_id: str, agent: str, message: str) -> str:
        data = await self._request("POST", "/v1/agent/chat", {**self._who(sender, session_id), "agent": agent, "message": message})
        reply = data.get("reply")
        if not isinstance(reply, str) or not reply.strip():
            raise PlannerError(UNAVAILABLE, "planner returned no reply text")
        return reply

    async def end_session(self, sender: str, session_id: str) -> bool:
        data = await self._request("POST", "/v1/sessions/end", self._who(sender, session_id))
        return bool(data.get("ended"))

    async def tools(self) -> list[dict[str, Any]]:
        """Tool schemas for the orchestrator's LLM, from the planner (single source of truth)."""
        if self._tools is None:
            data = await self._request("GET", "/v1/agent/tools", None)
            self._tools = list(data.get("tools", []))
        return self._tools

    async def _request(self, method: str, path: str, payload: dict[str, Any] | None) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        # Connecting gets its own short limit so "planner is down" is never
        # reported as "planner is still working".
        timeout = aiohttp.ClientTimeout(total=self.timeout_s, sock_connect=min(10.0, self.timeout_s))
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.request(method, self.base_url + path, json=payload, headers=headers) as resp:
                    try:
                        body = await resp.json(content_type=None)
                    except ValueError:
                        body = None
                    if not isinstance(body, dict):
                        raise PlannerError(UNAVAILABLE, f"planner returned HTTP {resp.status} with a non-JSON body")
                    if resp.status == 200:
                        return body
                    error = str(body.get("error", ""))[:300]
                    if resp.status in (400, 403):
                        raise PlannerError(f"I couldn't do that: {error}", f"planner rejected request ({resp.status}): {error}")
                    if resp.status == 401:
                        raise PlannerError(UNAVAILABLE, "planner rejected the agent's API key (check ROOMWISE_PLANNER_API_KEY)")
                    raise PlannerError(UNAVAILABLE, f"planner returned HTTP {resp.status}: {error}")
        except aiohttp.ConnectionTimeoutError as err:
            raise PlannerError(UNAVAILABLE, f"could not connect to planner at {self.base_url}") from err
        except asyncio.TimeoutError as err:
            raise PlannerError(TIMED_OUT, f"planner timed out after {self.timeout_s}s") from err
        except aiohttp.ClientError as err:
            raise PlannerError(UNAVAILABLE, f"planner unreachable: {err!r}") from err


# ------------------------------------------------------------------ chat helpers


async def acknowledge(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))


async def reply_text(ctx: Context, recipient: str, text: str) -> None:
    # No EndSessionContent: conversation state is kept for follow-ups.
    await ctx.send(recipient, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type="text", text=text)]))


def message_text(msg: ChatMessage) -> str:
    return "\n".join(c.text.strip() for c in msg.content if isinstance(c, TextContent) and c.text.strip())


def too_long(text: str) -> str | None:
    if len(text) > MAX_MESSAGE_CHARS:
        return f"That message is too long ({len(text)} characters). Please keep it under {MAX_MESSAGE_CHARS} characters."
    return None


def parse_json_object(raw: str) -> dict[str, Any] | None:
    try:
        value = json.loads(raw or "{}")
    except ValueError:
        return None
    return value if isinstance(value, dict) else None
