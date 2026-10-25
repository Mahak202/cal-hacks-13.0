"""Start the Roomwise agent team (orchestrator + six specialists) in one process.

Reads integrations/fetch/.env (or ROOMWISE_FETCH_ENV_FILE). Running this
registers all seven agents on the Fetch.ai network and, with
AGENT_MAILBOX=true, connects them to Agentverse mailboxes; see ../README.md.
Agents listen on AGENT_PORT .. AGENT_PORT+6 (one inspector link each).
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from roomwise_agent import ROLE_LABELS, ConfigError, TeamSettings
from team import agent_port, create_team, inspector_url, run_team

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def main() -> int:
    load_dotenv(os.environ.get("ROOMWISE_FETCH_ENV_FILE", ENV_FILE))
    try:
        settings = TeamSettings.from_env(os.environ)
    except ConfigError as err:
        print(err, file=sys.stderr)
        return 1
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    agents = create_team(settings, loop=loop)
    print(f"Planner service: {settings.planner_url}  mailbox: {settings.mailbox}  LLM: {'ASI:One (' + settings.asi1_model + ')' if settings.use_asi1 else 'keyword interpreter'}")
    for role, agent in agents.items():
        print(f"{ROLE_LABELS[role]:<22} port {agent_port(settings, role)}  {agent.address}\n{'':<22} inspector: {inspector_url(settings, role, agent.address)}")
    try:
        loop.run_until_complete(run_team(agents))
    except KeyboardInterrupt:
        pass
    finally:
        loop.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
