![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Roomwise × Fetch.ai: a team of agents that plans your room

Plan a room's furniture from **ASI:One** chat. Describe the items, style and budget; a team of seven uAgents searches live product listings, compares alternatives, fits a combination to the budget **including estimated tax and delivery**, and replies with an itemized quote. Follow-ups in the same chat revise it ("compare rugs", "choose option 3 for the rug", "set my budget to $1,300", "split my plan by store, max $600 per item", "start over").

Planning only: checkout and payments are deliberately out of scope.

## The agents

| Agent | Role | Address |
|---|---|---|
| **Roomwise Orchestrator** | The agent users chat with. Decides which specialists act (ASI:One LLM), delegates, and replies with their actual output. | `agent1qttdww3mm6hmlz5x8zefhwr4532c52f8dpj8lw4dlk5g37xgjfap55ntf79` |
| Design agent | Room brief: style, items, quantities, item keywords, search terms | `agent1qdkksys0cstwjvzgukfree7z62p0qmd8tjrq2wzgq9hmt36w59u8wzujdhf` |
| Product agent | Live Google Shopping search (Apify); choosing a specific product | `agent1q09tg7uzqxeqepvy97fq4x8c8hurdknm2kxztf3a6trm67ltqwscspv6vuk` |
| Budget agent | Best-rated combination within budget, tax and delivery included | `agent1qflg73xwltghuzrsg3j8dny6sxcfugamc9m374wrdypkfq6h4jmlxl4tgsy` |
| Comparison agent | Numbered alternatives for an item vs. the one in the plan | `agent1q2xk8sjjph0a7wdr3amykuxxq56p236rz0hzh6jpvmu8wpa2w7n4jg9627k` |
| Quotation agent | Itemized quote: links, subtotal, estimated tax and delivery, feasibility | `agent1qdlpvc7t2alhhhvgrq3slv7pwrul6nzsrmf2ydl303vnzeuuaerl5ef68cm` |
| Finance agent | Per-retailer order split and spending-limit checks (no payments) | `agent1qvwa4sfeadlwy8j5dl3muwlxpctqucrwe9nznas6pempgwsgmw09csgejxn` |

All seven implement the official Agent Chat Protocol (with acknowledgements), use Agentverse mailboxes, and publish their manifests and profiles (`agent/profiles/`). Each specialist can also be chatted with directly for its own job.

## Architecture

```
ASI:One ──Agent Chat Protocol──► Orchestrator uAgent ── ASI:One LLM (OpenAI SDK) picks the steps
                                     │
                                     │ RoomwiseDelegation protocol (AgentTask / AgentTaskResult,
                                     │ send_and_receive; specialists accept tasks only from the orchestrator)
                                     ▼
            Design · Product · Budget · Comparison · Quotation · Finance uAgents
                                     │
                                     │ HTTP + bearer key, on behalf of the end user's conversation
                                     ▼
                         Planner service (Node, src/)
                         sessions · validated tools · optimizer · rendering
                           ├── ../../server/apifyClient.ts   existing Apify client, imported unchanged
                           ├── ../../data/products.ts        demo catalog, read-only (opt-in only)
                           ├── ../../agents/mockAgents.ts    styleMatch(), read-only
                           └── ../../services/pricing.ts     tax rate and delivery fee, read-only
```

- The seven agents run in one process (`agent/agent.py`), each on its own local port (8001–8007) so each has its own Agentverse inspector link. Messages between them stay in-process.
- Every operation is a validated tool owned by exactly one role (`src/roles.ts`); the planner refuses a tool run by the wrong agent (HTTP 403).
- The orchestrator keeps the plan consistent: after any plan-affecting change it has the Budget agent re-optimize and the Quotation agent re-quote; a quote or finance breakdown never uses a stale plan; a failed step is reported, never retried silently or papered over.
- Everything lives under `integrations/fetch/` with its own dependencies and `.env`. **No existing Roomwise file is modified**, and the shared catalog is never mutated.

| Path | Purpose |
|---|---|
| `agent/agent.py` | Entry point: `python agent.py` starts all seven agents |
| `agent/orchestrator.py` | Orchestrator: system prompt (role and subject), ASI:One tool loop, routing, reply composition |
| `agent/specialists.py` | The six specialists: delegated tasks and direct chats |
| `agent/delegation.py` | Agent-to-agent message models |
| `agent/team.py` | Builds the agents (seeds, ports, mailboxes, profiles) |
| `agent/roomwise_agent.py` | Settings, planner client, chat helpers |
| `agent/profiles/*.md` | README published to each agent's Agentverse profile |
| `src/server.ts` | Planner HTTP API |
| `src/team.ts`, `src/roles.ts` | Role-scoped execution, keyword routing to roles, direct specialist chats |
| `src/tools.ts`, `src/engine.ts` | Tool schemas, validation, operations |
| `src/optimizer.ts` | Budget optimizer (exact branch and bound; labelled heuristic fallback) |
| `src/finance.ts` | Per-retailer orders and spending checks |
| `src/liveSearch.ts`, `src/candidates.ts` | Live search (timeout, cache, redaction) and ranking |
| `src/render.ts` | All user-facing text: prices, links, estimates, feasibility |
| `src/sessions.ts` | Per-conversation state, expiry, eviction, locking |
| `src/interpret.ts`, `src/asi1.ts`, `src/claude.ts` | Keyword fallback and LLM interpreters for direct planner chats |

## Setup

Prerequisites: Node 22+, pnpm (via Corepack), Python 3.10+ (tested with 3.12).

```bash
cd integrations/fetch
corepack pnpm@10.34.3 install                        # planner service

python -m venv agent/.venv                           # agents
agent/.venv/Scripts/python -m pip install -r agent/requirements-dev.txt   # Windows
# agent/.venv/bin/python -m pip install -r agent/requirements-dev.txt     # macOS/Linux

cp .env.example .env                                 # gitignored; never commit it
```

Fill in `integrations/fetch/.env` (read by both the planner and the agents):

| Variable | Notes |
|---|---|
| `ROOMWISE_PLANNER_API_KEY` | Shared secret between agents and planner: `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `AGENT_SEED`, `DESIGN_AGENT_SEED`, `PRODUCT_AGENT_SEED`, `BUDGET_AGENT_SEED`, `COMPARISON_AGENT_SEED`, `QUOTATION_AGENT_SEED`, `FINANCE_AGENT_SEED` | **Private**, one unique seed per agent (each determines that agent's address): `python -c "import secrets; print(secrets.token_urlsafe(48))"`. The agents refuse to start if two are equal. |
| `APIFY_TOKEN` | Live product search. Without it every search is reported as failed; nothing is substituted. |
| `ASI1_API_KEY` | ASI:One LLM for the orchestrator (key from [asi1.ai/developer](https://asi1.ai/developer); `ASI1_MODEL`, default `asi1`). Without it the orchestrator uses the planner's keyword interpreter. |
| `ANTHROPIC_API_KEY` | Optional alternative for direct planner chats (`ROOMWISE_LLM_PROVIDER=auto` prefers ASI:One). |
| `AGENT_PORT` | First agent port (default 8001; the team uses 8001–8007). |
| `AGENT_MAILBOX` | `true` to receive ASI:One messages through Agentverse mailboxes. |

## Running

```bash
# Terminal 1: planner service (127.0.0.1:8787)
cd integrations/fetch
corepack pnpm@10.34.3 start

# Terminal 2: the seven agents. This registers them on the Fetch.ai network.
cd integrations/fetch/agent
.venv/Scripts/python agent.py
```

`agent.py` prints each agent's address and Agentverse inspector link. For each one, open the link signed in to Agentverse, allow the page to reach localhost if the browser asks, and choose **Connect → Mailbox** (once per agent).

### Try it in ASI:One

Open **Chat with Agent** on the orchestrator's Agentverse page and send, in one chat:

1. `Japandi bedroom with a bed and a jute rug, budget $1,500`
2. `compare rugs`
3. `choose option 3 for the rug`
4. `split my plan by store, max $600 per item`

Each reply ends with the agents that actually did the work, e.g. `Agents involved: Design agent → Budget agent → Quotation agent`.

## Accuracy rules (enforced in code, covered by tests)

- **Live vs demo.** Every line is either a `Live listing` (USD price, rating, link, retrieval time) or a clearly labelled `DEMO CATALOG PRICE` that is used only when the user explicitly asks.
- **No silent substitution.** A failed or empty search leaves the item out with the reason, and the plan is marked incomplete.
- **Explicit estimates.** Subtotal, then *estimated* tax (9.375% unless the user gives a rate) and *estimated* delivery (USD 49 per retailer), the same assumptions as the web app's quote screen.
- **Honest feasibility.** "Feasible" only when every item is priced and the estimated total fits; otherwise the cheapest combination found and the shortfall, or "can't confirm".
- **Never claimed:** stock, discounts, reservations, purchases.
- **Actions really run.** LLM and keyword requests become validated tool calls executed by the owning agent before the reply is written; a failed step is shown as `Not done (<agent>): …` even if the model's text claims otherwise.
- **Ranking.** Live listings rank by Google Shopping rating weighted by review count (few reviews count for less).

**Conversation identity.** State is keyed by the end user's verified sender address and ACP session id from the message envelope, never from message text. Different users, and one user's different chats, never share state. Idle conversations expire after `ROOMWISE_SESSION_TTL_MINUTES` (default 120); "start over" or an ACP end-session clears one. State is in memory only.

## Tests

All automated tests use mocked external services: no Apify, ASI:One, Anthropic, Agentverse or network calls.

```bash
cd integrations/fetch
corepack pnpm@10.34.3 test        # 65 tests: planner service (runs one file at a time)
corepack pnpm@10.34.3 typecheck

cd agent
.venv/Scripts/python -m pytest    # 24 tests: the agent team
```

Highlights:

- Real uAgents messaging in-process: a test user sends a chat message to the orchestrator, which delegates to the real specialist agents and replies (`agent/tests/test_team_messaging.py`).
- Specialists refuse tasks from anyone but the orchestrator; the planner refuses tools run by the wrong role.
- Orchestration guarantees: re-optimize and re-quote after changes, no stale quotes, no retry after a failed optimization, honest reporting of failed or unresponsive agents.
- ASI:One tool loop: malformed JSON and unknown tools rejected, real results returned to the model, keyword fallback when the LLM fails.
- Planner: complete workflow and follow-ups, insufficient budgets (including tax and delivery), failed, timed-out and empty searches, invalid inputs, isolation between senders and sessions, item-specific search keywords.

## Status

Verified:

- Automated tests above.
- A live pre-flight turn through the orchestrator logic with the real ASI:One LLM, the real planner and live Apify search: real listings, a correct quote and a comparison.
- All seven agents started, registered with the Almanac API (mainnet), published their manifests, and serve their inspector endpoints.

Not yet verified (manual, see below): mailbox connection for every agent, a full chat from ASI:One, and discovery by ASI:One or Athena without naming the agent.

## Live verification checklist

1. Each agent's inspector shows it connected via **Mailbox**, and its Agentverse profile shows the README and badges. Add search keywords under **Search Visibility**.
2. In ASI:One (**Chat with Agent** on the orchestrator), run the four messages above; keep the chat's share URL.
3. Chat with one specialist directly (e.g. Product: `find a japandi jute rug`).
4. In a fresh ASI:One chat (optionally with Athena), ask for what the team does without naming it, and record whether the orchestrator is selected. Ranking is not guaranteed; only describe the agents as discoverable after this succeeds.

## Remaining deployment steps

- Host the planner and the agents on an always-on machine: mailboxes only deliver while the agent process runs. Use a process supervisor.
- Keep the planner on localhost next to the agents, or put it behind TLS. Keep seeds and keys in a secret manager.
- Add per-user rate limits and an Apify spend cap (each new item search is a paid actor run).
- Move session state to a shared store (e.g. Redis) to survive restarts or run several instances.

## Known limitations

- Fourteen categories (the Roomwise catalog's); other furniture types are refused, not guessed.
- Style fit comes from the search terms; it is not verified against the listing.
- Tax and delivery are flat estimates; shipping, promotions and stock are never checked.
- When some items can't be priced, the optimizer may use most of the budget on the priced ones; the reply says how much is left.
- A first request with several items can take one to two minutes while live searches run.
