import type { Category } from '../../../data/products'
import type { ChatDeps } from './chat'
import { ensureSearches } from './engine'
import { interpret } from './interpret'
import { stateMessage } from './prompt'
import { renderBrief, renderComparison, renderFinance, renderListings, renderPlan, renderSearch } from './render'
import { isAgentRole, PLAN_AFFECTING, ROLE_LABELS, ROLE_TOOLS, TOOL_OWNER, type AgentRole, type Specialist } from './roles'
import { executeTool, newTurnRecord, type ToolCall, type TurnRecord } from './tools'
import type { SessionState } from './types'

// Planner operations used by the Roomwise agent team (agent/ in Python). The
// uAgents do the routing and messaging; every operation still runs here,
// inside the conversation's lock, through the same validated tools.

export type RoleCall = { agent: AgentRole; name: string; input: unknown }
export type Identity = { sender: string; sessionId: string }

export class RoleError extends Error {}

// What the user should see from one executed call.
function sections(turn: TurnRecord, state: SessionState): string[] {
  const out: string[] = []
  for (const { category, search } of turn.searches) out.push(renderListings(category, search))
  for (const comparison of turn.comparisons) out.push(renderComparison(comparison))
  if (turn.quote) out.push(renderPlan(turn.quote, state.preferences))
  if (turn.finance) out.push(renderFinance(turn.finance))
  return out
}

export async function executeAsAgent(deps: ChatDeps, who: Identity, agent: unknown, call: ToolCall) {
  if (!isAgentRole(agent)) throw new RoleError(`Unknown agent role "${String(agent)}".`)
  if (!ROLE_TOOLS[agent].includes(call.name)) throw new RoleError(`The ${ROLE_LABELS[agent]} is not allowed to run ${call.name}.`)
  return deps.sessions.withSession(who.sender, who.sessionId, async (state) => {
    const turn = newTurnRecord()
    const outcome = await executeTool(state, call, deps.engine, turn)
    return { agent, tool: call.name, ...outcome, sections: outcome.ok ? sections(turn, state) : [] }
  })
}

// Keyword interpretation, expressed as calls to the agents that own them.
export function toRoleCalls(calls: ToolCall[]): RoleCall[] {
  const out: RoleCall[] = []
  for (const call of calls) {
    if (call.name === 'update_preferences') {
      const input = call.input as Record<string, unknown>
      const pick = (keys: string[]) => Object.fromEntries(Object.entries(input).filter(([k]) => keys.includes(k)))
      const brief = pick(['style', 'keywords', 'store', 'set_items', 'add_items', 'remove_items'])
      const budget = pick(['budget_usd', 'tax_rate_percent'])
      if (Object.keys(brief).length) out.push({ agent: 'design', name: 'set_room_brief', input: brief })
      if (Object.keys(budget).length) out.push({ agent: 'budget', name: 'set_budget', input: budget })
    } else if (call.name === 'build_plan') {
      out.push({ agent: 'budget', name: 'optimize_plan', input: {} })
    } else if (TOOL_OWNER[call.name]) {
      out.push({ agent: TOOL_OWNER[call.name], name: call.name, input: call.input })
    }
  }
  return out
}

export async function interpretForTeam(deps: ChatDeps, who: Identity, message: string) {
  return deps.sessions.withSession(who.sender, who.sessionId, async (state) => {
    const { calls, clarification } = interpret(message, state)
    return { calls: toRoleCalls(calls), clarification }
  })
}

export async function conversationState(deps: ChatDeps, who: Identity) {
  return deps.sessions.withSession(who.sender, who.sessionId, async (state) => ({
    state: stateMessage(state),
    history: state.history,
    hasPlan: !!state.plan,
    itemCount: state.preferences.needs.length,
  }))
}

export async function appendHistory(deps: ChatDeps, who: Identity, user: string, assistant: string) {
  return deps.sessions.withSession(who.sender, who.sessionId, async (state) => {
    state.history = [...state.history, { role: 'user' as const, content: user }, { role: 'assistant' as const, content: assistant }].slice(-12)
    return { ok: true }
  })
}

// ------------------------------------------------- direct chat with one specialist

const ROLE_INTROS: Record<Specialist, string> = {
  design: 'I turn your style and item list into a room brief and the live search terms the team will use.',
  product: 'I search live product listings (Google Shopping via Apify) for the items in your brief.',
  budget: 'I pick the best-rated combination that fits your budget, including estimated tax and delivery.',
  comparison: 'I compare the available options for an item against the one in your plan.',
  quotation: 'I produce the itemized quote: items, links, subtotal, estimated tax and delivery, and budget feasibility.',
  finance: 'I split your plan into per-retailer orders and check spending limits. Planning only: nothing is charged or ordered.',
}

const CONTEXT_TOOLS = new Set(['set_room_brief', 'set_budget'])

// A specialist chatted with directly (not through the orchestrator) handles
// its own job, using the message only for context (brief and budget).
export async function handleRoleChat(deps: ChatDeps, who: Identity, role: Specialist, message: string) {
  return deps.sessions.withSession(who.sender, who.sessionId, async (state) => {
    const turn = newTurnRecord()
    const { calls, clarification } = interpret(message, state)
    const roleCalls = toRoleCalls(calls)
    const run = async (name: string, input: unknown = {}) => executeTool(state, { name, input }, deps.engine, turn)
    let changed = false
    for (const call of roleCalls) {
      if (!CONTEXT_TOOLS.has(call.name) && call.agent !== role) continue
      const outcome = await run(call.name, call.input)
      if (outcome.ok && PLAN_AFFECTING.has(call.name)) changed = true
    }

    const out: string[] = [`**Roomwise ${ROLE_LABELS[role]}.** ${ROLE_INTROS[role]}`]
    const needs = state.preferences.needs.map((n) => n.category)
    const freshPlan = async () => {
      if (!state.plan || changed || turn.calls.some((c) => c.name === 'choose_product' && c.ok)) await run('optimize_plan')
    }
    if (!needs.length && role !== 'comparison') {
      out.push(clarification ?? 'Tell me the items you want, e.g. "a Japandi bed and a rug, budget $1,500".')
    } else if (role === 'design') {
      out.push(renderBrief(state.preferences))
    } else if (role === 'product') {
      await ensureSearches(state, needs, deps.engine)
      for (const c of needs) out.push(renderListings(c, state.searches[c]!))
    } else if (role === 'comparison') {
      const targets: Category[] = turn.comparisons.length ? [] : needs.slice(0, 3)
      for (const c of targets) await run('compare_alternatives', { category: c })
      if (!turn.comparisons.length) out.push(clarification ?? 'Which item should I compare? For example: "compare japandi rugs".')
      for (const comparison of turn.comparisons) out.push(renderComparison(comparison))
    } else if (role === 'budget' || role === 'quotation') {
      await freshPlan()
      if (state.plan) out.push(renderPlan(state.plan, state.preferences))
    } else if (role === 'finance') {
      await freshPlan()
      if (!turn.finance) await run('finance_breakdown')
      if (turn.finance) out.push(renderFinance(turn.finance))
    }
    if (role !== 'product') for (const { category, search } of turn.searches) if (search.status !== 'ok') out.push(renderSearch(category, search))
    const failures = turn.calls.filter((c, i) => !c.ok && !turn.calls.slice(i + 1).some((l) => l.name === c.name && l.ok))
    if (failures.length) out.push(failures.map((f) => `Not done: ${f.error}`).join('\n'))
    out.push('_For a full guided plan from the whole team, chat with the Roomwise orchestrator agent._')
    return { reply: out.join('\n\n'), actions: turn.calls }
  })
}
