"""The Roomwise orchestrator: the agent people talk to in ASI:One.

It acknowledges each chat message, decides which specialist agents should act
(with the ASI:One LLM when ASI1_API_KEY is set, otherwise the planner's
keyword interpreter), delegates each step to the owning agent over the
RoomwiseDelegation protocol, and replies with what those agents actually
produced.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from uagents import Context, Protocol
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, EndSessionContent, chat_protocol_spec

from delegation import AgentTask, AgentTaskResult, new_protocol
from roomwise_agent import ROLE_LABELS, PlannerClient, PlannerError, acknowledge, message_text, parse_json_object, reply_text, too_long

# The orchestrator's subject matter and role.
SYSTEM_PROMPT = """You are the Roomwise orchestrator, reached through ASI:One. Your subject is furnishing a room: turning a person's style, item list and budget into a concrete shopping plan built from live product listings. Politely decline unrelated topics and steer back to their room.

You lead a team of six specialist agents. Every tool runs on the agent named at the start of its description:
- Design agent: set_room_brief (style, extra keywords, retailer, which items and how many)
- Budget agent: set_budget, optimize_plan
- Product agent: search_products, choose_product, clear_choice, use_demo_prices
- Comparison agent: compare_alternatives
- Quotation agent: get_quote
- Finance agent (planning only, no payments): finance_breakdown

For a new request, call exactly: set_room_brief, then set_budget (only if a budget was given), then optimize_plan, then get_quote. Optimizing already runs the live searches, so do NOT also call search_products, compare_alternatives or choose_product unless the user asked to search again, compare options, or pick a specific option.
Put item-specific details in that item's keywords inside set_room_brief (e.g. {"category": "rug", "keywords": "jute"}); use the shared keywords only for words that apply to every item. The style goes in style, never repeated in keywords.
Follow-ups usually need one agent plus a re-quote: compare_alternatives alone; choose_product (by option_number from the last comparison) then optimize_plan and get_quote; set_budget then optimize_plan and get_quote.
Rules:
- Act only through tools, and never say something happened unless its tool result succeeded. If a tool returns an error, fix the arguments or explain the problem.
- Only call use_demo_prices when the user explicitly asks for demo, sample or placeholder prices.
- The agents' outputs (plans, quotes, comparisons, finance breakdowns) are appended to your reply automatically. Do not restate prices, totals, product lists or budget verdicts. Never mention stock, discounts, reservations or purchases; checkout is not available.
- If the request is ambiguous (for example no items named yet), ask one short clarifying question instead of guessing.
- End with 1-3 short sentences: what the team did, or your question."""

HELP_TEXT = (
    "I'm the Roomwise orchestrator. Tell me the room you're furnishing and my team of agents "
    "(Design, Product, Budget, Comparison, Quotation and Finance) will search live listings, "
    "compare options and fit them to your budget with estimated tax and delivery.\n"
    'Example: "Japandi bedroom with a bed, a rug and 2 side tables, budget $2,000."'
)

PLAN_AFFECTING = {"set_room_brief", "set_budget", "choose_product", "clear_choice", "use_demo_prices", "search_products"}
PRESENTING = {"get_quote", "finance_breakdown"}
MAX_LLM_STEPS = 6
# Seconds to wait for each specialist; live searches can take a while.
TASK_TIMEOUTS = {"design": 60, "product": 150, "budget": 240, "comparison": 150, "quotation": 60, "finance": 60}

log = logging.getLogger(__name__)


@dataclass
class Outcome:
    agent: str
    tool: str
    ok: bool
    result: Any = None
    error: str | None = None
    sections: list[str] = field(default_factory=list)


# (agent, tool, arguments) -> what that agent actually did.
Delegate = Callable[[str, str, dict[str, Any]], Awaitable[Outcome]]


@dataclass
class TurnLog:
    has_plan: bool
    has_items: bool
    outcomes: list[Outcome] = field(default_factory=list)
    dirty: bool = False  # plan-affecting change since the last optimization
    optimized: bool = False  # optimize_plan succeeded this turn
    optimize_failed: bool = False  # ...or failed (never retried in the same turn)
    presented: bool = False  # a quote or breakdown was shown since then


def unresolved_failures(outcomes: list[Outcome]) -> list[Outcome]:
    return [o for i, o in enumerate(outcomes) if not o.ok and not any(later.tool == o.tool and later.ok for later in outcomes[i + 1 :])]


def compose(intro: str, turn: TurnLog) -> str:
    parts = [intro.strip()] if intro.strip() else []
    for outcome in turn.outcomes:
        for section in outcome.sections:
            parts.append(f"_From the {ROLE_LABELS.get(outcome.agent, outcome.agent)}:_\n{section}")
    failures = dict.fromkeys(f"Not done ({ROLE_LABELS.get(o.agent, o.agent)}): {o.error}" for o in unresolved_failures(turn.outcomes))
    if failures:
        parts.append("\n".join(failures))
    involved = list(dict.fromkeys(ROLE_LABELS[o.agent] for o in turn.outcomes if o.agent in ROLE_LABELS and o.agent != "orchestrator"))
    if involved:
        parts.append("_Agents involved: " + " → ".join(involved) + "_")
    return "\n\n".join(parts) or HELP_TEXT


def history_note(intro: str, turn: TurnLog) -> str:
    steps = ", ".join(f"{o.agent}.{o.tool}={'ok' if o.ok else 'failed'}" for o in turn.outcomes)
    return " ".join(p for p in (intro.strip(), f"[steps: {steps}]" if steps else "") if p) or "(replied with help text)"


class Orchestrator:
    def __init__(self, planner: PlannerClient, llm: Any = None, model: str = "asi1"):
        self.planner = planner
        self.llm = llm  # an OpenAI-compatible `chat.completions` object (ASI:One)
        self.model = model

    async def run_turn(self, user_sender: str, user_session: str, text: str, delegate: Delegate) -> str:
        try:
            state = await self.planner.state(user_sender, user_session)
        except PlannerError as err:
            log.warning("planner state failed: %s", err.detail)
            return err.user_message
        turn = TurnLog(has_plan=bool(state.get("hasPlan")), has_items=bool(state.get("itemCount")))

        async def call(agent: str, tool: str, args: dict[str, Any]) -> Outcome:
            return await self._call(turn, delegate, agent, tool, args)

        intro = ""
        if self.llm is not None:
            try:
                intro = await self._llm_turn(state, text, call)
            except Exception as err:  # noqa: BLE001 - any LLM failure falls back
                log.warning("ASI:One interpreter failed; using keyword interpreter: %r", err)
                intro = await self._keyword_turn(user_sender, user_session, text, call)
        else:
            intro = await self._keyword_turn(user_sender, user_session, text, call)

        # Keep the plan and quote in step with whatever changed this turn.
        if turn.dirty and turn.has_items and not turn.optimize_failed:
            await call("budget", "optimize_plan", {})
        if turn.optimized and not turn.presented:
            await call("quotation", "get_quote", {})

        reply = compose(intro, turn)
        try:
            await self.planner.append_history(user_sender, user_session, text, history_note(intro, turn))
        except PlannerError as err:
            log.warning("could not save history: %s", err.detail)
        return reply

    async def _call(self, turn: TurnLog, delegate: Delegate, agent: str, tool: str, args: dict[str, Any]) -> Outcome:
        # A quote or breakdown must reflect the latest changes.
        if tool in PRESENTING and turn.has_items and (turn.dirty or not turn.has_plan):
            if not turn.optimize_failed:
                await self._call(turn, delegate, "budget", "optimize_plan", {})
            if turn.optimize_failed:
                outcome = Outcome(agent, tool, False, error="Skipped because the plan could not be re-optimized after your changes, so it would be out of date.")
                turn.outcomes.append(outcome)
                return outcome
        outcome = await delegate(agent, tool, args)
        turn.outcomes.append(outcome)
        if not outcome.ok and tool == "optimize_plan":
            turn.optimize_failed = True
        if outcome.ok:
            if tool == "set_room_brief" and isinstance(outcome.result, dict):
                turn.has_items = bool(outcome.result.get("preferences", {}).get("needs"))
            if tool in PLAN_AFFECTING:
                turn.dirty = True
            if tool == "optimize_plan":
                turn.dirty, turn.has_plan, turn.optimized, turn.presented, turn.optimize_failed = False, True, True, False, False
            if tool in PRESENTING:
                turn.presented = True
            if tool == "reset_session":
                turn.has_plan = turn.has_items = turn.dirty = turn.optimized = False
        return outcome

    async def _keyword_turn(self, user_sender: str, user_session: str, text: str, call: Callable[..., Awaitable[Outcome]]) -> str:
        try:
            data = await self.planner.interpret(user_sender, user_session, text)
        except PlannerError as err:
            return err.user_message
        calls = data.get("calls") or []
        for c in calls:
            await call(c["agent"], c["name"], c.get("input") or {})
        if data.get("clarification"):
            return data["clarification"]
        if not calls:
            return HELP_TEXT
        if all(c["name"] == "reset_session" for c in calls):
            return "Started over: preferences, searches and the plan for this conversation are cleared.\n\n" + HELP_TEXT
        return ""

    async def _llm_turn(self, state: dict[str, Any], text: str, call: Callable[..., Awaitable[Outcome]]) -> str:
        tools = await self.planner.tools()
        owner = {t["name"]: t["agent"] for t in tools}
        fn_tools = [
            {"type": "function", "function": {"name": t["name"], "description": f"[{ROLE_LABELS.get(t['agent'], t['agent'])}] {t['description']}", "parameters": t["input_schema"]}}
            for t in tools
        ]
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            *({"role": h["role"], "content": h["content"]} for h in state.get("history", [])),
            {"role": "user", "content": f"{state.get('state', '')}\n\n{text}"},
        ]
        for _ in range(MAX_LLM_STEPS):
            response = await self.llm.create(model=self.model, messages=messages, tools=fn_tools, tool_choice="auto")
            message = response.choices[0].message
            tool_calls = [tc for tc in (message.tool_calls or []) if getattr(tc, "type", "function") == "function"]
            if not tool_calls:
                return (message.content or "").strip()
            messages.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [{"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in tool_calls],
            })
            # In order: later steps (optimize, quote) depend on earlier ones.
            for tc in tool_calls:
                name = tc.function.name
                args = parse_json_object(tc.function.arguments or "{}")
                if args is None:
                    content: Any = {"error": "Arguments were not valid JSON."}
                elif name not in owner:
                    content = {"error": f"Unknown tool {name}."}
                else:
                    outcome = await call(owner[name], name, args)
                    content = outcome.result if outcome.ok else {"error": outcome.error}
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(content)})
        return ""


def make_delegate(ctx: Context, addresses: dict[str, str], planner: PlannerClient, user_sender: str, user_session: str) -> Delegate:
    """Delegates over uAgents messaging; reset_session runs on the orchestrator itself."""

    async def delegate(agent: str, tool: str, args: dict[str, Any]) -> Outcome:
        if agent == "orchestrator":
            try:
                data = await planner.execute(user_sender, user_session, "orchestrator", tool, args)
            except PlannerError as err:
                return Outcome(agent, tool, False, error=err.user_message)
            return Outcome(agent, tool, bool(data.get("ok")), data.get("result"), data.get("error"), list(data.get("sections") or []))
        label = ROLE_LABELS.get(agent, agent)
        address = addresses.get(agent)
        if not address:
            return Outcome(agent, tool, False, error=f"No {label} is configured.")
        task = AgentTask(task_id=str(uuid4()), user_sender=user_sender, user_session=user_session, tool=tool, arguments_json=json.dumps(args))
        response, status = await ctx.send_and_receive(address, task, response_type=AgentTaskResult, timeout=TASK_TIMEOUTS.get(agent, 60))
        if not isinstance(response, AgentTaskResult) or response.task_id != task.task_id:
            detail = getattr(status, "detail", "") or "no response"
            ctx.logger.warning(f"{label} did not complete {tool}: {detail}")
            return Outcome(agent, tool, False, error=f"The {label} didn't respond in time, so {tool} was not done.")
        return Outcome(agent, tool, response.ok, json.loads(response.result_json or "null"), response.error, list(response.sections))

    return delegate


def build_orchestrator_protocols(orchestrator: Orchestrator, addresses: dict[str, str], planner: PlannerClient) -> tuple[Protocol, Protocol]:
    chat = Protocol(spec=chat_protocol_spec)
    locks: dict[tuple[str, str], asyncio.Lock] = {}

    @chat.on_message(ChatMessage)
    async def handle_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
        await acknowledge(ctx, sender, msg)
        session_id = str(ctx.session)
        text = message_text(msg)
        if text:
            reply = too_long(text)
            if reply is None:
                # One turn at a time per conversation; others run concurrently.
                async with locks.setdefault((sender, session_id), asyncio.Lock()):
                    try:
                        reply = await orchestrator.run_turn(sender, session_id, text, make_delegate(ctx, addresses, planner, sender, session_id))
                    except Exception:  # noqa: BLE001 - always answer the user
                        ctx.logger.exception("orchestrator turn failed")
                        reply = "Something went wrong while coordinating the agents; the request may be incomplete. Please try again."
            await reply_text(ctx, sender, reply)
        if any(isinstance(c, EndSessionContent) for c in msg.content):
            try:
                await planner.end_session(sender, session_id)
            except PlannerError as err:
                ctx.logger.warning(f"Could not clear state for session {session_id}: {err.detail}")

    @chat.on_message(ChatAcknowledgement)
    async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
        ctx.logger.debug(f"{sender} acknowledged {msg.acknowledged_msg_id}")

    delegation = new_protocol()

    @delegation.on_message(AgentTaskResult)
    async def handle_late_result(ctx: Context, sender: str, result: AgentTaskResult) -> None:
        # Results normally resolve send_and_receive; this only sees late ones.
        ctx.logger.info(f"Late result from {result.agent} for {result.tool} (task {result.task_id}); ignored.")

    return chat, delegation
