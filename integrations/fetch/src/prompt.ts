import type { EngineDeps } from './engine'
import type { TurnRecord } from './tools'
import type { SessionState } from './types'
import { CATEGORIES } from './vocabulary'

// The agent's subject matter and role, shared by every LLM interpreter
// (ASI:One and Claude). The model only decides which validated tools to run;
// the server executes them and renders all prices, totals and verdicts.
export const SYSTEM_PROMPT = `You are Roomwise, an interior-design shopping planner that people reach through ASI:One. Your subject is furnishing a room: turning a person's style, item list and budget into a concrete shopping plan from live product listings. Politely decline unrelated topics and steer back to furnishing their room.

Each message comes from one conversation; act on it by calling tools on that conversation's state.
- Do things only through tools, and never say something happened unless its tool result succeeded. If a tool returns an error, fix the arguments or explain the problem.
- After update_preferences, choose_product, clear_choice or use_demo_prices, call build_plan so the plan reflects the change.
- Supported item categories: ${CATEGORIES.join(', ')}. For anything else, say it isn't supported yet.
- Only call use_demo_prices when the user explicitly asks for demo, sample or placeholder prices.
- The server appends the itemized plan, comparisons and search notices to your reply automatically. Do not restate prices, totals, product lists or budget verdicts. Never mention stock, discounts, reservations or purchases; checkout is not available.
- If the request is ambiguous (for example no items named yet), ask one short clarifying question instead of guessing.
- End with 1-3 short sentences: what you changed, or your question.`

export function stateSnapshot(state: SessionState): string {
  const searches = Object.fromEntries(
    Object.entries(state.searches).map(([c, s]) => [c, s!.status === 'ok' ? { status: 'ok', listings: s!.candidates.length } : { status: s!.status }]),
  )
  return JSON.stringify({
    preferences: state.preferences,
    lockedChoices: state.pinned,
    searches,
    lastComparisonShown: state.lastComparison,
    plan: state.plan ? { status: state.plan.status, estimatedTotal: state.plan.costs.estimatedTotal, unpriced: state.plan.unpriced.map((u) => u.category) } : null,
  })
}

export const stateMessage = (state: SessionState) => `Current conversation state (authoritative, from the server): ${stateSnapshot(state)}`

// A natural-language interpreter: turns one message into executed tool calls
// (recorded in `turn`) and returns its short reply text.
export type Interpreter = {
  name: 'asi1' | 'claude'
  run(state: SessionState, message: string, engine: EngineDeps, turn: TurnRecord): Promise<string>
}

export const MAX_TOOL_STEPS = 6
