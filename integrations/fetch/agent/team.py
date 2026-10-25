"""Builds the Roomwise agent team: one orchestrator and six specialists, each
with its own seed, mailbox, Agentverse profile and local port, all running in
one process.

Each agent gets its own port (AGENT_PORT + 0..6) rather than sharing one
Bureau server: the Agentverse inspector (and its Connect -> Mailbox step)
expects one agent per local port. Messages between the agents stay in-process.
"""

from __future__ import annotations

import asyncio
from typing import Any

from uagents import Agent

from orchestrator import Orchestrator, build_orchestrator_protocols
from roomwise_agent import AGENT_DIR, ROLES, SPECIALISTS, PlannerClient, TeamSettings
from specialists import build_specialist_protocols

PROFILE_DIR = AGENT_DIR / "profiles"

DESCRIPTIONS = {
    "orchestrator": "Roomwise orchestrator: plan a room's furniture from live listings within your budget (estimated tax and delivery included). Coordinates the Design, Product, Budget, Comparison, Quotation and Finance agents. Planning only, no checkout.",
    "design": "Roomwise Design agent: turns a style and item list into a room brief and the live search terms the Roomwise team uses.",
    "product": "Roomwise Product agent: searches live Google Shopping listings (via Apify) for furniture and decor, with prices, ratings and links.",
    "budget": "Roomwise Budget agent: picks the best-rated combination of live listings that fits a budget, including estimated tax and delivery.",
    "comparison": "Roomwise Comparison agent: compares live furniture options for one item against the one in your plan.",
    "quotation": "Roomwise Quotation agent: produces an itemized furniture quote with links, subtotal, estimated tax and delivery, and budget feasibility.",
    "finance": "Roomwise Finance agent (planning only): splits a furniture plan into per-retailer orders and checks spending limits. Nothing is charged or ordered.",
}


def asi1_completions(settings: TeamSettings) -> Any:
    """ASI:One LLM through its OpenAI-compatible API (pip install openai)."""
    from openai import AsyncOpenAI

    return AsyncOpenAI(api_key=settings.asi1_api_key, base_url=settings.asi1_base_url).chat.completions


def create_team(
    settings: TeamSettings,
    planner: PlannerClient | None = None,
    llm: Any = None,
    loop: asyncio.AbstractEventLoop | None = None,
) -> dict[str, Agent]:
    planner = planner or PlannerClient(settings.planner_url, settings.planner_api_key, settings.planner_timeout_s)
    if llm is None and settings.use_asi1:
        llm = asi1_completions(settings)
    extra = {"loop": loop} if loop is not None else {}
    agents = {
        role: Agent(
            name=settings.names[role],
            seed=settings.seeds[role],
            port=agent_port(settings, role),
            mailbox=settings.mailbox,
            publish_agent_details=True,
            readme_path=str(PROFILE_DIR / f"{role}.md"),
            description=DESCRIPTIONS[role],
            # One user's slow live search must not block other conversations.
            handle_messages_concurrently=True,
            **extra,
        )
        for role in ROLES
    }
    addresses = {role: agent.address for role, agent in agents.items()}

    chat, delegation = build_orchestrator_protocols(Orchestrator(planner, llm, settings.asi1_model), addresses, planner)
    agents["orchestrator"].include(chat, publish_manifest=True)
    agents["orchestrator"].include(delegation)
    for role in SPECIALISTS:
        chat, delegation = build_specialist_protocols(role, planner, addresses["orchestrator"])
        agents[role].include(chat, publish_manifest=True)
        agents[role].include(delegation, publish_manifest=True)
    return agents


def agent_port(settings: TeamSettings, role: str) -> int:
    return settings.port + ROLES.index(role)


def inspector_url(settings: TeamSettings, role: str, address: str) -> str:
    return f"https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A{agent_port(settings, role)}&address={address}"


async def run_team(agents: dict[str, Agent]) -> None:
    """Run every agent (server, mailbox, mainnet registration) in this event loop."""
    await asyncio.gather(*(agent.run_async() for agent in agents.values()))
