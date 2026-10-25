import type { EngineDeps } from './engine'
import { interpret } from './interpret'
import { formatMoney } from './pricing'
import type { Interpreter } from './prompt'
import { HELP_TEXT, renderComparison, renderFinance, renderPlan, renderSearch } from './render'
import type { SessionStore } from './sessions'
import { executeTool, newTurnRecord, type TurnRecord } from './tools'
import type { PlanStatus, SessionState } from './types'

export type ChatDeps = {
  engine: EngineDeps
  sessions: SessionStore
  interpreter?: Interpreter
  log?: (message: string, err?: unknown) => void
}

export type ChatRequest = { sender: string; sessionId: string; message: string }

export type ChatResult = {
  reply: string
  interpreter: Interpreter['name'] | 'keyword'
  actions: TurnRecord['calls']
  planStatus?: PlanStatus
}

const HISTORY_LIMIT = 12

async function runKeywordTurn(state: SessionState, message: string, engine: EngineDeps, turn: TurnRecord): Promise<string> {
  const { calls, clarification } = interpret(message, state)
  for (const call of calls) await executeTool(state, call, engine, turn)
  if (clarification) return clarification
  if (!calls.length) return HELP_TEXT
  if (turn.reset && calls.length === 1) return `Started over: preferences, searches and the plan for this conversation are cleared.\n\n${HELP_TEXT}`
  return ''
}

// Failed calls with no later success of the same tool, so a reply can never
// imply that a failed operation happened.
function unresolvedFailures(turn: TurnRecord): string[] {
  return turn.calls.flatMap((call, i) => (!call.ok && !turn.calls.slice(i + 1).some((later) => later.name === call.name && later.ok) ? [call.error!] : []))
}

function compose(intro: string, turn: TurnRecord, state: SessionState): string {
  const sections: string[] = []
  if (intro.trim()) sections.push(intro.trim())
  for (const { category, search } of turn.searches) {
    const coveredByPlan = turn.plan?.lines.some((l) => l.category === category) && search.status === 'ok'
    if (!coveredByPlan) sections.push(renderSearch(category, search))
  }
  for (const comparison of turn.comparisons) sections.push(renderComparison(comparison))
  if (turn.plan) sections.push(renderPlan(turn.plan, state.preferences))
  else if (turn.quote) sections.push(renderPlan(turn.quote, state.preferences))
  if (turn.finance) sections.push(renderFinance(turn.finance))
  const failures = unresolvedFailures(turn).filter((e) => e !== turn.planError || !intro.includes(e))
  if (failures.length) sections.push(failures.map((e) => `Not done: ${e}`).join('\n'))
  return sections.join('\n\n') || HELP_TEXT
}

function historyNote(turn: TurnRecord): string {
  const notes: string[] = []
  if (turn.plan) notes.push(`[plan shown: ${turn.plan.status}, estimated total ${formatMoney(turn.plan.costs.estimatedTotal)}]`)
  for (const c of turn.comparisons) notes.push(`[comparison shown for ${c.category}: ${c.options.length} options]`)
  return notes.join(' ')
}

export async function handleChat(deps: ChatDeps, request: ChatRequest): Promise<ChatResult> {
  return deps.sessions.withSession(request.sender, request.sessionId, async (state) => {
    let turn = newTurnRecord()
    let interpreter: ChatResult['interpreter'] = 'keyword'
    let intro: string
    if (deps.interpreter) {
      try {
        intro = await deps.interpreter.run(state, request.message, deps.engine, turn)
        interpreter = deps.interpreter.name
      } catch (err) {
        deps.log?.(`${deps.interpreter.name} interpreter failed; using keyword interpreter`, err)
        turn = newTurnRecord()
        intro = await runKeywordTurn(state, request.message, deps.engine, turn)
      }
    } else {
      intro = await runKeywordTurn(state, request.message, deps.engine, turn)
    }

    // Keep the plan in step with any change made this turn.
    if (turn.preferencesChanged && !turn.plan && !turn.planError && state.preferences.needs.length) {
      await executeTool(state, { name: 'build_plan', input: {} }, deps.engine, turn)
    }

    const reply = compose(intro, turn, state)
    const remembered = [intro.trim(), historyNote(turn)].filter(Boolean).join(' ') || '(replied with help text)'
    state.history = [...state.history, { role: 'user' as const, content: request.message }, { role: 'assistant' as const, content: remembered }].slice(-HISTORY_LIMIT)
    return { reply, interpreter, actions: turn.calls, planStatus: turn.plan?.status }
  })
}
