import type { Category } from '../../../data/products'
import {
  buildPlan,
  chooseProduct,
  clearChoice,
  compareCategory,
  isError,
  resetSession,
  runSearch,
  setDemoOptIn,
  updatePreferences,
  type Comparison,
  type EngineDeps,
  type PreferenceUpdate,
} from './engine'
import { financeBreakdown, type FinanceBreakdown } from './finance'
import type { CategorySearch, Need, Plan, SessionState } from './types'
import { CATEGORIES, isCategory, KNOWN_RETAILERS, KNOWN_STYLES, STYLE_SYNONYMS } from './vocabulary'

export type ToolCall = { name: string; input: unknown }

// Everything a turn actually did, in order. Replies are rendered from this,
// never from a model's description of what it intended to do.
export type TurnRecord = {
  calls: { name: string; ok: boolean; error?: string }[]
  plan?: Plan
  planError?: string
  comparisons: Comparison[]
  searches: { category: Category; search: CategorySearch }[]
  quote?: Plan
  finance?: FinanceBreakdown
  preferencesChanged: boolean
  reset: boolean
}

export const newTurnRecord = (): TurnRecord => ({ calls: [], comparisons: [], searches: [], preferencesChanged: false, reset: false })

export class ValidationError extends Error {}

// ---------------------------------------------------------------- validators

type Obj = Record<string, unknown>

function object(value: unknown, allowed: string[]): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ValidationError('Arguments must be a JSON object.')
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k))
  if (unknown.length) throw new ValidationError(`Unknown argument(s): ${unknown.join(', ')}.`)
  return value as Obj
}

function category(value: unknown, field = 'category'): Category {
  if (!isCategory(value)) throw new ValidationError(`${field} must be one of: ${CATEGORIES.join(', ')}.`)
  return value
}

function categories(value: unknown, field: string): Category[] {
  if (!Array.isArray(value) || !value.length || value.length > CATEGORIES.length) throw new ValidationError(`${field} must be a non-empty list of categories.`)
  return [...new Set(value.map((v) => category(v, field)))]
}

function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new ValidationError(`${field} must be a whole number from ${min} to ${max}.`)
  return value
}

function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new ValidationError(`${field} must be a number from ${min} to ${max}.`)
  return value
}

const SAFE_TEXT = /^[\p{L}\p{N} &'.,/-]+$/u

function text(value: unknown, field: string, max = 60): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`)
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed || trimmed.length > max) throw new ValidationError(`${field} must be 1-${max} characters.`)
  if (!SAFE_TEXT.test(trimmed)) throw new ValidationError(`${field} may only contain letters, numbers, spaces and & ' . , / -`)
  return trimmed
}

function nullableText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return text(value, field)
}

function items(value: unknown, field: string): Need[] {
  if (!Array.isArray(value) || value.length > CATEGORIES.length) throw new ValidationError(`${field} must be a list of at most ${CATEGORIES.length} items.`)
  return value.map((entry, i) => {
    const o = object(entry, ['category', 'quantity', 'keywords'])
    const need: Need = { category: category(o.category, `${field}[${i}].category`), quantity: o.quantity === undefined ? 1 : int(o.quantity, `${field}[${i}].quantity`, 1, 10) }
    if (o.keywords !== undefined && o.keywords !== null) need.keywords = text(o.keywords, `${field}[${i}].keywords`)
    return need
  })
}

export function canonicalStyle(value: string): string {
  const lower = value.toLowerCase()
  return STYLE_SYNONYMS[lower] ?? KNOWN_STYLES.find((s) => s === lower) ?? lower
}

export function canonicalStore(value: string): string {
  return KNOWN_RETAILERS.find((r) => r.toLowerCase() === value.toLowerCase()) ?? value
}

// ---------------------------------------------------------------- tool specs

const CATEGORY_SCHEMA = { type: 'string', enum: CATEGORIES }
const ITEMS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      category: CATEGORY_SCHEMA,
      quantity: { type: 'integer', minimum: 1, maximum: 10 },
      keywords: { type: 'string', description: "Search words for this item only, e.g. 'jute' for a rug or 'oak' for a bed." },
    },
    required: ['category'],
    additionalProperties: false,
  },
}

export type ToolSpec = { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false } }

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'update_preferences',
    description:
      "Record the user's furnishing preferences for this conversation. Only include fields the user actually stated or changed. Use set_items when the user lists what they want, add_items for 'also add…', remove_items for 'drop/remove…'. null clears a field (e.g. store: null for 'any store'). Does not search or plan by itself.",
    input_schema: {
      type: 'object',
      properties: {
        style: { type: ['string', 'null'], description: "Design style keyword, e.g. 'japandi', 'mid-century', 'coastal'." },
        budget_usd: { type: ['number', 'null'], description: 'Total budget in USD including estimated tax and delivery.' },
        set_items: ITEMS_SCHEMA,
        add_items: ITEMS_SCHEMA,
        remove_items: { type: 'array', items: CATEGORY_SCHEMA },
        store: { type: ['string', 'null'], description: 'Only use listings from this retailer.' },
        keywords: { type: ['string', 'null'], description: "Search words applied to EVERY item (e.g. 'natural wood'). For one item only, use that item's keywords instead." },
        tax_rate_percent: { type: ['number', 'null'], description: "The user's sales tax rate, only if they state it." },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'build_plan',
    description:
      'Search live listings for any requested category not yet searched, then choose one product per item to maximize quality within the budget (estimated tax and delivery included). Call after preferences change. The itemized plan is shown to the user automatically.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_products',
    description: 'Run a fresh live product search for one category (e.g. to retry a failed search, or try a different store or keywords for this one search).',
    input_schema: {
      type: 'object',
      properties: { category: CATEGORY_SCHEMA, store: { type: 'string' }, keywords: { type: 'string' } },
      required: ['category'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_alternatives',
    description: 'Compare the available options for one category against the item currently in the plan. The comparison is shown to the user automatically with numbered options.',
    input_schema: {
      type: 'object',
      properties: {
        category: CATEGORY_SCHEMA,
        max_results: { type: 'integer', minimum: 1, maximum: 10 },
        include_demo_reference: { type: 'boolean', description: 'Also list Roomwise demo catalog reference prices (illustrative only).' },
      },
      required: ['category'],
      additionalProperties: false,
    },
  },
  {
    name: 'choose_product',
    description: 'Lock a specific product into the plan for a category, by option_number from the last comparison shown or by product_id. Call build_plan afterwards to re-optimize the rest.',
    input_schema: {
      type: 'object',
      properties: { category: CATEGORY_SCHEMA, option_number: { type: 'integer', minimum: 1, maximum: 10 }, product_id: { type: 'string' } },
      required: ['category'],
      additionalProperties: false,
    },
  },
  {
    name: 'clear_choice',
    description: 'Remove a locked product choice for a category so the optimizer can pick again.',
    input_schema: { type: 'object', properties: { category: CATEGORY_SCHEMA }, required: ['category'], additionalProperties: false },
  },
  {
    name: 'use_demo_prices',
    description:
      'ONLY when the user explicitly asks: allow (enabled=true) or disallow Roomwise demo catalog prices for categories whose live search failed or found nothing. Demo prices are illustrative, not real listings.',
    input_schema: {
      type: 'object',
      properties: { categories: { type: 'array', items: CATEGORY_SCHEMA }, enabled: { type: 'boolean' } },
      required: ['categories', 'enabled'],
      additionalProperties: false,
    },
  },
  {
    name: 'reset_session',
    description: 'Forget all preferences, searches, choices and the plan for this conversation (when the user says start over / reset).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

// Tools used by the multi-agent team (see roles.ts): each belongs to one
// specialist. They reuse the validation and engine operations above.
const BRIEF_KEYS = ['style', 'keywords', 'store', 'set_items', 'add_items', 'remove_items']
const BUDGET_KEYS = ['budget_usd', 'tax_rate_percent']
const prefProps = TOOL_SPECS[0].input_schema.properties

export const ROLE_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'set_room_brief',
    description:
      "Design agent: record the room brief: style, extra search keywords, preferred retailer, and the items wanted (set_items replaces the list, add_items/remove_items adjust it). Only include what the user stated or changed; null clears style/store/keywords.",
    input_schema: { type: 'object', properties: Object.fromEntries(BRIEF_KEYS.map((k) => [k, prefProps[k]])), additionalProperties: false },
  },
  {
    name: 'set_budget',
    description: "Budget agent: record the total budget in USD (all-in, including estimated tax and delivery) and, only if the user states it, their sales-tax rate.",
    input_schema: { type: 'object', properties: Object.fromEntries(BUDGET_KEYS.map((k) => [k, prefProps[k]])), additionalProperties: false },
  },
  {
    name: 'optimize_plan',
    description: 'Budget agent: search live listings for any item not yet searched, then pick one product per item to maximize quality within the budget (estimated tax and delivery included).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  TOOL_SPECS.find((t) => t.name === 'search_products')!,
  TOOL_SPECS.find((t) => t.name === 'choose_product')!,
  TOOL_SPECS.find((t) => t.name === 'clear_choice')!,
  TOOL_SPECS.find((t) => t.name === 'use_demo_prices')!,
  TOOL_SPECS.find((t) => t.name === 'compare_alternatives')!,
  {
    name: 'get_quote',
    description: 'Quotation agent: produce the itemized quote for the current optimized plan: items, links, subtotal, estimated tax and delivery, and budget feasibility. Shown to the user automatically.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'finance_breakdown',
    description:
      'Finance agent (planning only; nothing is charged or ordered): split the current plan into one order per retailer with estimated totals, and check optional spending limits the user gave.',
    input_schema: {
      type: 'object',
      properties: {
        total_cap_usd: { type: 'number', description: 'Maximum total spend the user allows.' },
        per_item_cap_usd: { type: 'number', description: 'Maximum price for any single item.' },
        allowed_stores: { type: 'array', items: { type: 'string' }, description: 'Only these retailers are allowed.' },
      },
      additionalProperties: false,
    },
  },
  TOOL_SPECS.find((t) => t.name === 'reset_session')!,
]

// ---------------------------------------------------------------- execution

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string }

function validatePreferences(input: unknown): PreferenceUpdate {
  const o = object(input, ['style', 'budget_usd', 'set_items', 'add_items', 'remove_items', 'store', 'keywords', 'tax_rate_percent'])
  const update: PreferenceUpdate = {}
  const style = nullableText(o.style, 'style')
  if (style !== undefined) update.style = style === null ? null : canonicalStyle(style)
  if (o.budget_usd !== undefined) update.budget = o.budget_usd === null ? null : number(o.budget_usd, 'budget_usd', 1, 1_000_000)
  if (o.set_items !== undefined) update.setItems = items(o.set_items, 'set_items')
  if (o.add_items !== undefined) update.addItems = items(o.add_items, 'add_items')
  if (o.remove_items !== undefined) update.removeItems = categories(o.remove_items, 'remove_items')
  const store = nullableText(o.store, 'store')
  if (store !== undefined) update.store = store === null ? null : canonicalStore(store)
  update.keywords = nullableText(o.keywords, 'keywords')
  if (update.keywords === undefined) delete update.keywords
  if (o.tax_rate_percent !== undefined) update.taxRatePercent = o.tax_rate_percent === null ? null : number(o.tax_rate_percent, 'tax_rate_percent', 0, 20)
  if (!Object.keys(update).length) throw new ValidationError('No preference fields were provided.')
  return update
}

function storeList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 10) throw new ValidationError('allowed_stores must be a list of 1-10 retailer names.')
  return value.map((v, i) => canonicalStore(text(v, `allowed_stores[${i}]`)))
}

export async function executeTool(state: SessionState, call: ToolCall, deps: EngineDeps, turn: TurnRecord): Promise<ToolOutcome> {
  let outcome: ToolOutcome
  try {
    outcome = await dispatch(state, call, deps, turn)
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err
    outcome = { ok: false, error: `Invalid arguments for ${call.name}: ${err.message}` }
  }
  turn.calls.push({ name: call.name, ok: outcome.ok, error: outcome.ok ? undefined : outcome.error })
  return outcome
}

async function dispatch(state: SessionState, { name, input }: ToolCall, deps: EngineDeps, turn: TurnRecord): Promise<ToolOutcome> {
  switch (name) {
    case 'update_preferences': {
      const { changed } = updatePreferences(state, validatePreferences(input))
      if (changed.length) turn.preferencesChanged = true
      return { ok: true, result: { changed, preferences: state.preferences } }
    }
    case 'set_room_brief':
    case 'set_budget': {
      object(input, name === 'set_room_brief' ? BRIEF_KEYS : BUDGET_KEYS)
      const { changed } = updatePreferences(state, validatePreferences(input))
      if (changed.length) turn.preferencesChanged = true
      return { ok: true, result: { changed, preferences: state.preferences } }
    }
    case 'get_quote': {
      object(input ?? {}, [])
      if (!state.plan) return { ok: false, error: 'No plan has been optimized in this conversation yet, so there is nothing to quote.' }
      turn.quote = state.plan
      return { ok: true, result: summarizePlan(state.plan) }
    }
    case 'finance_breakdown': {
      const o = object(input ?? {}, ['total_cap_usd', 'per_item_cap_usd', 'allowed_stores'])
      const limits = {
        totalCap: o.total_cap_usd === undefined ? undefined : number(o.total_cap_usd, 'total_cap_usd', 1, 1_000_000),
        perItemCap: o.per_item_cap_usd === undefined ? undefined : number(o.per_item_cap_usd, 'per_item_cap_usd', 1, 1_000_000),
        allowedStores: o.allowed_stores === undefined ? undefined : storeList(o.allowed_stores),
      }
      if (!state.plan) return { ok: false, error: 'No plan has been optimized in this conversation yet, so there is nothing to break down.' }
      const breakdown = financeBreakdown(state.plan, limits)
      turn.finance = breakdown
      return { ok: true, result: breakdown }
    }
    case 'optimize_plan':
    case 'build_plan': {
      object(input ?? {}, [])
      const plan = await buildPlan(state, deps)
      if (isError(plan)) {
        turn.planError = plan.error
        return { ok: false, error: plan.error }
      }
      turn.plan = plan
      return { ok: true, result: summarizePlan(plan) }
    }
    case 'search_products': {
      const o = object(input, ['category', 'store', 'keywords'])
      const c = category(o.category)
      const store = o.store === undefined ? undefined : canonicalStore(text(o.store, 'store'))
      const keywords = o.keywords === undefined ? undefined : text(o.keywords, 'keywords')
      const search = await runSearch(state, c, deps, { store, keywords })
      turn.searches.push({ category: c, search })
      return { ok: true, result: summarizeSearch(search) }
    }
    case 'compare_alternatives': {
      const o = object(input, ['category', 'max_results', 'include_demo_reference'])
      const c = category(o.category)
      const max = o.max_results === undefined ? 5 : int(o.max_results, 'max_results', 1, 10)
      if (o.include_demo_reference !== undefined && typeof o.include_demo_reference !== 'boolean') throw new ValidationError('include_demo_reference must be true or false.')
      const comparison = await compareCategory(state, c, deps, max, o.include_demo_reference === true)
      turn.comparisons.push(comparison)
      return { ok: true, result: comparison }
    }
    case 'choose_product': {
      const o = object(input, ['category', 'option_number', 'product_id'])
      const c = category(o.category)
      if ((o.option_number === undefined) === (o.product_id === undefined)) throw new ValidationError('Provide exactly one of option_number or product_id.')
      const chosen = chooseProduct(state, c, {
        optionNumber: o.option_number === undefined ? undefined : int(o.option_number, 'option_number', 1, 10),
        productId: o.product_id === undefined ? undefined : text(o.product_id, 'product_id', 80),
      })
      if (isError(chosen)) return { ok: false, error: chosen.error }
      turn.preferencesChanged = true
      return { ok: true, result: { locked: { category: c, id: chosen.id, name: chosen.name, store: chosen.store, price: chosen.price, source: chosen.source } } }
    }
    case 'clear_choice': {
      const c = category(object(input, ['category']).category)
      const cleared = clearChoice(state, c)
      if (cleared) turn.preferencesChanged = true
      return { ok: true, result: { category: c, cleared } }
    }
    case 'use_demo_prices': {
      const o = object(input, ['categories', 'enabled'])
      const cats = categories(o.categories, 'categories')
      if (typeof o.enabled !== 'boolean') throw new ValidationError('enabled must be true or false.')
      const optIn = setDemoOptIn(state, cats, o.enabled)
      turn.preferencesChanged = true
      return { ok: true, result: { demoPricesAllowedFor: optIn } }
    }
    case 'reset_session': {
      object(input ?? {}, [])
      resetSession(state)
      turn.reset = true
      return { ok: true, result: { reset: true } }
    }
    default:
      return { ok: false, error: `Unknown tool "${name}".` }
  }
}

export function summarizeSearch(search: CategorySearch) {
  if (search.status === 'failed') return { status: 'failed', searchTerm: search.searchTerm, error: search.error }
  if (search.status === 'empty') return { status: 'empty', searchTerm: search.searchTerm, excluded: search.excluded }
  return {
    status: 'ok',
    searchTerm: search.searchTerm,
    retrievedAt: search.retrievedAt,
    listings: search.candidates.map((c) => ({ id: c.id, name: c.name, store: c.store, price: c.price, currency: c.currency, rating: c.rating, reviewsCount: c.reviewsCount })),
  }
}

export function summarizePlan(plan: Plan) {
  return {
    status: plan.status,
    budget: plan.budget,
    difference: plan.difference,
    costs: plan.costs,
    lines: plan.lines.map((l) => ({ category: l.category, quantity: l.quantity, id: l.item.id, name: l.item.name, store: l.item.store, price: l.item.price, source: l.item.source, pinned: l.pinned })),
    unpriced: plan.unpriced,
    tradeoffs: plan.tradeoffs.map((t) => ({ category: t.category, preferred: t.preferred.name, chosen: t.chosen.name, saving: t.saving })),
    searchMode: plan.searchMode,
  }
}
