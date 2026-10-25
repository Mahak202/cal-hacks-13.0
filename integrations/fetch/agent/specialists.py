"""The six Roomwise specialist agents: Design, Product, Budget, Comparison,
Quotation and Finance.

Each one runs only its own operations on the planner service:
- for the orchestrator, over the RoomwiseDelegation protocol (tasks from any
  other sender are refused), acting on the end user's conversation;
- for anyone chatting with it directly in ASI:One, over the Agent Chat
  Protocol, limited to its own job.
"""

from __future__ import annotations

import json
import logging

from uagents import Context, Protocol
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, EndSessionContent, chat_protocol_spec

from delegation import AgentTask, AgentTaskResult, new_protocol
from roomwise_agent import PlannerClient, PlannerError, acknowledge, message_text, parse_json_object, reply_text, too_long

NOT_ORCHESTRATOR = "Only the Roomwise orchestrator can delegate tasks to this agent."


async def run_task(role: str, planner: PlannerClient, orchestrator_address: str, sender: str, task: AgentTask, logger: logging.Logger) -> AgentTaskResult:
    base = {"task_id": task.task_id, "agent": role, "tool": task.tool}
    if sender != orchestrator_address:
        logger.warning(f"Refused {task.tool} task from {sender}: not the orchestrator")
        return AgentTaskResult(**base, ok=False, error=NOT_ORCHESTRATOR)
    args = parse_json_object(task.arguments_json)
    if args is None:
        return AgentTaskResult(**base, ok=False, error="Task arguments must be a JSON object.")
    try:
        data = await planner.execute(task.user_sender, task.user_session, role, task.tool, args)
    except PlannerError as err:
        logger.warning(f"{task.tool} failed: {err.detail}")
        return AgentTaskResult(**base, ok=False, error=err.user_message)
    return AgentTaskResult(
        **base,
        ok=bool(data.get("ok")),
        result_json=json.dumps(data.get("result")),
        error=data.get("error"),
        sections=[s for s in data.get("sections") or [] if isinstance(s, str)],
    )


def build_specialist_protocols(role: str, planner: PlannerClient, orchestrator_address: str) -> tuple[Protocol, Protocol]:
    chat = Protocol(spec=chat_protocol_spec)

    @chat.on_message(ChatMessage)
    async def handle_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
        await acknowledge(ctx, sender, msg)
        session_id = str(ctx.session)
        text = message_text(msg)
        if text:
            reply = too_long(text)
            if reply is None:
                try:
                    reply = await planner.role_chat(sender, session_id, role, text)
                except PlannerError as err:
                    ctx.logger.warning(f"Planner call failed for session {session_id}: {err.detail}")
                    reply = err.user_message
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

    @delegation.on_message(AgentTask, replies={AgentTaskResult})
    async def handle_task(ctx: Context, sender: str, task: AgentTask) -> None:
        await ctx.send(sender, await run_task(role, planner, orchestrator_address, sender, task, ctx.logger))

    return chat, delegation
