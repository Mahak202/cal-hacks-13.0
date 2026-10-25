"""Messages the orchestrator uses to delegate work to specialist agents.

The orchestrator sends an AgentTask on behalf of an end user (identified by
the sender address and ACP session id of *their* verified chat envelope).
Specialists accept tasks only from the orchestrator's address.
"""

from __future__ import annotations

from uagents import Model, Protocol

PROTOCOL_NAME = "RoomwiseDelegation"
PROTOCOL_VERSION = "0.1.0"


class AgentTask(Model):
    task_id: str
    user_sender: str
    user_session: str
    tool: str
    arguments_json: str = "{}"


class AgentTaskResult(Model):
    task_id: str
    agent: str
    tool: str
    ok: bool
    result_json: str = "null"
    error: str | None = None
    sections: list[str] = []


def new_protocol() -> Protocol:
    return Protocol(name=PROTOCOL_NAME, version=PROTOCOL_VERSION)
