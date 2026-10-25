"""Orchestrator turn logic with a fake planner and fake delegation (no network)."""

from __future__ import annotations

import json
from typing import Any

from conftest import FakeAsi1, FakePlanner

from orchestrator import HELP_TEXT, Orchestrator, Outcome
from roomwise_agent import PlannerError, UNAVAILABLE

USER, SESSION = "agent1qasioneuser", "session-uuid-1"


class Recorder:
    """Fake delegate: records which agent ran which tool, answers via the fake planner."""

    def __init__(self, planner: FakePlanner, unresponsive: set[str] | None = None):
        self.planner = planner
        self.unresponsive = unresponsive or set()
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    async def __call__(self, agent: str, tool: str, args: dict[str, Any]) -> Outcome:
        self.calls.append((agent, tool, args))
        if agent in self.unresponsive:
            return Outcome(agent, tool, False, error=f"The {agent} agent didn't respond in time, so {tool} was not done.")
        data = await self.planner.execute(USER, SESSION, agent, tool, args)
        return Outcome(agent, tool, data["ok"], data.get("result"), data.get("error"), data.get("sections", []))

    @property
    def steps(self) -> list[str]:
        return [f"{a}.{t}" for a, t, _ in self.calls]


BRIEF_AND_BUDGET = {
    "calls": [
        {"agent": "design", "name": "set_room_brief", "input": {"style": "japandi", "set_items": [{"category": "bed"}]}},
        {"agent": "budget", "name": "set_budget", "input": {"budget_usd": 1500}},
        {"agent": "budget", "name": "optimize_plan", "input": {}},
    ]
}


async def test_routes_a_request_through_design_budget_and_quotation():
    planner = FakePlanner(interpret=BRIEF_AND_BUDGET)
    delegate = Recorder(planner)
    reply = await Orchestrator(planner).run_turn(USER, SESSION, "japandi bed, budget $1500", delegate)

    assert delegate.steps == ["design.set_room_brief", "budget.set_budget", "budget.optimize_plan", "quotation.get_quote"]
    assert "_From the Quotation agent:_\n**Roomwise shopping plan**" in reply
    assert reply.endswith("_Agents involved: Design agent → Budget agent → Quotation agent_")
    assert planner.history and "design.set_room_brief=ok" in planner.history[0][1]


async def test_reoptimizes_and_requotes_after_any_plan_change():
    planner = FakePlanner(interpret={"calls": [{"agent": "product", "name": "choose_product", "input": {"category": "rug", "option_number": 2}}]}, has_plan=True, items=2)
    delegate = Recorder(planner)
    await Orchestrator(planner).run_turn(USER, SESSION, "choose option 2 for the rug", delegate)
    assert delegate.steps == ["product.choose_product", "budget.optimize_plan", "quotation.get_quote"]


async def test_quotes_and_breakdowns_never_use_a_stale_plan():
    planner = FakePlanner(has_plan=True, items=1)
    delegate = Recorder(planner)
    llm = FakeAsi1([
        {"tool_calls": [
            {"id": "a", "name": "set_budget", "arguments": json.dumps({"budget_usd": 900})},
            {"id": "b", "name": "finance_breakdown", "arguments": "{}"},
        ]},
        {"content": "Updated the budget and split the plan by store."},
    ])
    reply = await Orchestrator(planner, llm).run_turn(USER, SESSION, "budget 900, split by store", delegate)
    # optimize_plan is inserted before the breakdown; no extra quote afterwards.
    assert delegate.steps == ["budget.set_budget", "budget.optimize_plan", "finance.finance_breakdown"]
    assert reply.startswith("Updated the budget and split the plan by store.")
    assert "_From the Finance agent:_" in reply


async def test_comparisons_do_not_trigger_replanning():
    planner = FakePlanner(interpret={"calls": [{"agent": "comparison", "name": "compare_alternatives", "input": {"category": "rug"}}]}, has_plan=True, items=2)
    delegate = Recorder(planner)
    reply = await Orchestrator(planner).run_turn(USER, SESSION, "compare rugs", delegate)
    assert delegate.steps == ["comparison.compare_alternatives"]
    assert "_From the Comparison agent:_\n**Rug alternatives**" in reply


async def test_a_failed_optimization_is_reported_once_and_never_quoted():
    planner = FakePlanner(interpret=BRIEF_AND_BUDGET, fail={"optimize_plan": "Live search failed: Apify 502."})
    delegate = Recorder(planner)
    reply = await Orchestrator(planner).run_turn(USER, SESSION, "japandi bed, budget $1500", delegate)
    assert delegate.steps == ["design.set_room_brief", "budget.set_budget", "budget.optimize_plan"], "no retry, no stale quote"
    assert reply.count("Not done (Budget agent): Live search failed: Apify 502.") == 1
    assert "Roomwise shopping plan" not in reply


async def test_reports_an_unresponsive_agent():
    planner = FakePlanner(interpret=BRIEF_AND_BUDGET)
    delegate = Recorder(planner, unresponsive={"quotation"})
    reply = await Orchestrator(planner).run_turn(USER, SESSION, "japandi bed, budget $1500", delegate)
    assert "Not done (Quotation agent): The quotation agent didn't respond in time, so get_quote was not done." in reply


async def test_llm_tool_calls_are_validated_before_delegation():
    planner = FakePlanner()
    delegate = Recorder(planner)
    llm = FakeAsi1([
        {"tool_calls": [
            {"id": "bad", "name": "set_room_brief", "arguments": "{not json"},
            {"id": "nope", "name": "delete_everything", "arguments": "{}"},
        ]},
        {"tool_calls": [{"id": "ok", "name": "set_room_brief", "arguments": json.dumps({"set_items": [{"category": "rug"}]})}]},
        {"content": "Planned your rug."},
    ])
    reply = await Orchestrator(planner, llm, model="asi1").run_turn(USER, SESSION, "a rug", delegate)

    tool_msgs = [m for m in llm.requests[1]["messages"] if m["role"] == "tool"]
    assert [json.loads(m["content"])["error"] for m in tool_msgs] == ["Arguments were not valid JSON.", "Unknown tool delete_everything."]
    assert delegate.steps == ["design.set_room_brief", "budget.optimize_plan", "quotation.get_quote"]
    assert reply.startswith("Planned your rug.")

    first = llm.requests[0]
    assert first["model"] == "asi1" and first["tool_choice"] == "auto"
    assert first["messages"][0]["role"] == "system" and "Roomwise orchestrator" in first["messages"][0]["content"]
    assert first["tools"][0]["function"]["description"].startswith("[Design agent]")


async def test_llm_receives_actual_results_from_agents():
    planner = FakePlanner()
    delegate = Recorder(planner)
    llm = FakeAsi1([
        {"tool_calls": [{"id": "t1", "name": "set_room_brief", "arguments": json.dumps({"set_items": [{"category": "bench"}]})}]},
        {"content": "Done."},
    ])
    await Orchestrator(planner, llm).run_turn(USER, SESSION, "a bench", delegate)
    tool_msg = next(m for m in llm.requests[1]["messages"] if m["role"] == "tool")
    assert tool_msg["tool_call_id"] == "t1"
    assert json.loads(tool_msg["content"]) == {"changed": ["items"], "preferences": {"needs": [{"category": "bench"}]}}


async def test_falls_back_to_keyword_routing_when_asi1_fails():
    planner = FakePlanner(interpret=BRIEF_AND_BUDGET)
    delegate = Recorder(planner)
    llm = FakeAsi1([RuntimeError("401 invalid ASI1 key")])
    reply = await Orchestrator(planner, llm).run_turn(USER, SESSION, "japandi bed, budget $1500", delegate)
    assert delegate.steps[-1] == "quotation.get_quote"
    assert "Roomwise shopping plan" in reply


async def test_help_clarification_and_planner_outage():
    planner = FakePlanner()
    assert await Orchestrator(planner).run_turn(USER, SESSION, "hello", Recorder(planner)) == HELP_TEXT

    planner = FakePlanner(interpret={"calls": [], "clarification": "Which item should I compare?"})
    assert await Orchestrator(planner).run_turn(USER, SESSION, "compare", Recorder(planner)) == "Which item should I compare?"

    planner = FakePlanner()
    planner.error = PlannerError(UNAVAILABLE, "down")
    delegate = Recorder(planner)
    assert await Orchestrator(planner).run_turn(USER, SESSION, "a bed", delegate) == UNAVAILABLE
    assert delegate.calls == []
