"""The real team, wired together with real uAgents messaging, in one process.

A test user agent sends an Agent Chat Protocol message to the orchestrator; the
orchestrator delegates to the specialist agents with send_and_receive; the
user gets an acknowledgement and the composed reply. Agents are never started
(no server, no registration, no mailbox) and the manifest publisher is
patched, so nothing leaves the process. The planner is faked.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from conftest import FakePlanner, team_env
from uagents import Agent, Protocol
from uagents.dispatch import dispatcher
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, TextContent, chat_protocol_spec
from uagents_core.models import Model

from roomwise_agent import ROLES, TeamSettings
from team import agent_port, create_team, inspector_url


@pytest.fixture
def published(monkeypatch):
    manifests: list[tuple[str, str]] = []

    def record(self, manifest):
        manifests.append((self.name, manifest["metadata"]["name"]))

        async def done():
            return None

        return done()

    monkeypatch.setattr(Agent, "publish_manifest", record)
    return manifests


@pytest.fixture
async def team(published):
    loop = asyncio.get_running_loop()
    planner = FakePlanner(
        interpret={
            "calls": [
                {"agent": "design", "name": "set_room_brief", "input": {"style": "japandi", "set_items": [{"category": "bed"}]}},
                {"agent": "budget", "name": "set_budget", "input": {"budget_usd": 1500}},
                {"agent": "budget", "name": "optimize_plan", "input": {}},
            ]
        }
    )
    agents = create_team(TeamSettings.from_env(team_env()), planner=planner, loop=loop)
    user = Agent(name="test-user", seed=f"test-user-{uuid.uuid4()}-seed-padding-0123456789", loop=loop)
    inbox: list[object] = []
    proto = Protocol(spec=chat_protocol_spec)

    @proto.on_message(ChatMessage)
    async def got_reply(ctx, sender, msg):
        inbox.append(msg)

    @proto.on_message(ChatAcknowledgement)
    async def got_ack(ctx, sender, msg):
        inbox.append(msg)

    user.include(proto)
    everyone = [*agents.values(), user]
    for agent in everyone:
        agent.start_message_receivers()
    yield agents, user, inbox, planner
    for agent in everyone:
        agent._message_queue_task.cancel()
        dispatcher.unregister(agent.address, agent)


async def test_orchestrator_delegates_to_specialist_agents_over_uagents(team):
    agents, user, inbox, planner = team
    session = uuid.uuid4()
    msg = ChatMessage(content=[TextContent(text="Japandi bed, budget $1,500")])
    await dispatcher.dispatch_msg(user.address, agents["orchestrator"].address, Model.build_schema_digest(ChatMessage), msg.model_dump_json(), session)

    async def reply_arrived():
        while not any(isinstance(m, ChatMessage) for m in inbox):
            await asyncio.sleep(0.02)

    await asyncio.wait_for(reply_arrived(), timeout=15)
    ack = next(m for m in inbox if isinstance(m, ChatAcknowledgement))
    assert ack.acknowledged_msg_id == msg.msg_id
    reply = next(m for m in inbox if isinstance(m, ChatMessage)).content[0].text

    # Each step ran on the owning specialist, for the end user's conversation.
    assert [(e[2], e[3]) for e in planner.executed] == [("design", "set_room_brief"), ("budget", "set_budget"), ("budget", "optimize_plan"), ("quotation", "get_quote")]
    assert {(e[0], e[1]) for e in planner.executed} == {(user.address, str(session))}
    assert "_From the Quotation agent:_\n**Roomwise shopping plan**" in reply
    assert "_Agents involved: Design agent → Budget agent → Quotation agent_" in reply


async def test_specialists_ignore_tasks_from_other_agents(team):
    agents, user, inbox, planner = team
    from delegation import AgentTask, AgentTaskResult

    task = AgentTask(task_id="x", user_sender=user.address, user_session="s", tool="get_quote")
    await dispatcher.dispatch_msg(user.address, agents["quotation"].address, Model.build_schema_digest(AgentTask), task.model_dump_json(), uuid.uuid4())
    await asyncio.sleep(0.3)
    assert planner.executed == []


def test_team_has_one_port_per_agent_publishes_manifests_on_mainnet(published):
    loop = asyncio.new_event_loop()
    try:
        settings = TeamSettings.from_env(team_env(AGENT_MAILBOX="true"))
        agents = create_team(settings, planner=FakePlanner(), loop=loop)
        assert set(agents) == set(ROLES)
        assert len({a.address for a in agents.values()}) == 7
        # One inspector-reachable port per agent: 8001 (orchestrator) .. 8007.
        assert [agent_port(settings, r) for r in ROLES] == list(range(8001, 8008))
        assert [a._port for a in agents.values()] == list(range(8001, 8008))
        assert inspector_url(settings, "design", agents["design"].address).startswith("https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A8002&address=agent1q")
        chat_digest = chat_protocol_spec.digest
        for agent in agents.values():
            assert agent._network == "mainnet"
            assert chat_digest in agent.protocols
            assert agent._readme and agent._handle_messages_concurrently
        # Chat protocol manifests for all seven; delegation manifests for the six specialists.
        assert sorted(n for n, p in published if p == "AgentChatProtocol") == sorted(a.name for a in agents.values())
        assert len([1 for _, p in published if p == "RoomwiseDelegation"]) == 6
        for agent in agents.values():
            dispatcher.unregister(agent.address, agent)
    finally:
        for task in asyncio.all_tasks(loop):
            task.cancel()
        loop.run_until_complete(asyncio.sleep(0))
        loop.close()
