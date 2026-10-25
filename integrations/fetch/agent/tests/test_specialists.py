"""Specialist task handling and direct chats (no network)."""

from __future__ import annotations

import json
import logging

from conftest import FakeContext, FakePlanner

from delegation import AgentTask, AgentTaskResult
from roomwise_agent import UNAVAILABLE, PlannerError
from specialists import NOT_ORCHESTRATOR, build_specialist_protocols, run_task
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, EndSessionContent, TextContent
from uagents_core.models import Model

ORCH = "agent1qorchestrator"
LOG = logging.getLogger("test")


def task(tool: str, args: dict | str = "{}") -> AgentTask:
    return AgentTask(task_id="t-1", user_sender="agent1qenduser", user_session="sess-1", tool=tool, arguments_json=args if isinstance(args, str) else json.dumps(args))


async def test_runs_tasks_from_the_orchestrator_for_the_end_user():
    planner = FakePlanner()
    result = await run_task("quotation", planner, ORCH, ORCH, task("get_quote"), LOG)
    assert result.ok and result.agent == "quotation" and result.task_id == "t-1"
    assert result.sections[0].startswith("**Roomwise shopping plan**")
    # Acts on the end user's conversation, as this agent's role.
    assert planner.executed == [("agent1qenduser", "sess-1", "quotation", "get_quote", {})]


async def test_refuses_tasks_from_anyone_but_the_orchestrator():
    planner = FakePlanner()
    result = await run_task("finance", planner, ORCH, "agent1qmallory", task("finance_breakdown"), LOG)
    assert result.ok is False and result.error == NOT_ORCHESTRATOR
    assert planner.executed == []


async def test_reports_bad_arguments_and_planner_errors():
    planner = FakePlanner()
    bad = await run_task("design", planner, ORCH, ORCH, task("set_room_brief", "[1, 2]"), LOG)
    assert bad.ok is False and "JSON object" in bad.error

    planner.error = PlannerError("I couldn't do that: The Design agent is not allowed to run get_quote.", "403")
    refused = await run_task("design", planner, ORCH, ORCH, task("get_quote"), LOG)
    assert refused.ok is False and "not allowed" in refused.error

    failed = await run_task("budget", FakePlanner(fail={"optimize_plan": "No furniture items have been requested yet."}), ORCH, ORCH, task("optimize_plan"), LOG)
    assert failed.ok is False and failed.error == "No furniture items have been requested yet."


def _handler(protocol, model):
    return protocol.signed_message_handlers[Model.build_schema_digest(model)]


async def test_delegation_handler_replies_to_the_sender():
    planner = FakePlanner()
    _, delegation = build_specialist_protocols("comparison", planner, ORCH)
    ctx = FakeContext()
    await _handler(delegation, AgentTask)(ctx, ORCH, task("compare_alternatives", {"category": "rug"}))
    dest, result = ctx.sent[0]
    assert dest == ORCH and isinstance(result, AgentTaskResult) and result.ok


async def test_direct_chat_acknowledges_and_answers_within_its_role():
    planner = FakePlanner()
    chat, _ = build_specialist_protocols("product", planner, ORCH)
    ctx = FakeContext()
    msg = ChatMessage(content=[TextContent(text="find a jute rug"), EndSessionContent()])
    await _handler(chat, ChatMessage)(ctx, "agent1qasioneuser", msg)
    assert isinstance(ctx.sent[0][1], ChatAcknowledgement) and ctx.sent[0][1].acknowledged_msg_id == msg.msg_id
    assert ctx.sent[1][1].content[0].text == "**Roomwise product reply**"
    assert planner.role_chats == [("agent1qasioneuser", str(ctx.session), "product", "find a jute rug")]
    assert planner.ended == [("agent1qasioneuser", str(ctx.session))]


async def test_direct_chat_reports_outages_honestly():
    planner = FakePlanner()
    planner.error = PlannerError(UNAVAILABLE, "down")
    chat, _ = build_specialist_protocols("budget", planner, ORCH)
    ctx = FakeContext()
    await _handler(chat, ChatMessage)(ctx, "agent1qasioneuser", ChatMessage(content=[TextContent(text="a bed for $500")]))
    assert ctx.sent[1][1].content[0].text == UNAVAILABLE
