import type { Category } from '../../../data/products'
import type { ToolCall } from './tools'
import type { SessionState } from './types'
import { CATEGORY_ALIASES, CATEGORIES, KNOWN_RETAILERS, KNOWN_STYLES, STYLE_SYNONYMS } from './vocabulary'

// Deterministic keyword interpreter, used when no LLM is configured (or the
// LLM call fails). It turns a message into the same validated tool calls the
// LLM path uses, so both share one execution pipeline.

export type Interpretation = { calls: ToolCall[]; clarification?: string }

type Mention = { category: Category; start: number; end: number }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NUMBER_WORDS: Record<string, number> = { one: 1, a: 1, an: 1, single: 1, two: 2, pair: 2, couple: 2, three: 3, four: 4, five: 5, six: 6 }

function findMentions(lower: string): Mention[] {
  const aliases = CATEGORIES.flatMap((category) => CATEGORY_ALIASES[category].map((alias) => ({ category, alias }))).sort((a, b) => b.alias.length - a.alias.length)
  const claimed: Mention[] = []
  for (const { category, alias } of aliases) {
    const re = new RegExp(`\\b${escape(alias)}(?:e?s)?\\b`, 'g')
    for (const m of lower.matchAll(re)) {
      const start = m.index!
      const end = start + m[0].length
      if (claimed.some((c) => start < c.end && end > c.start)) continue
      claimed.push({ category, start, end })
    }
  }
  return claimed.sort((a, b) => a.start - b.start)
}

function quantityBefore(window: string): number {
  const m = window.match(/\b(\d{1,2}|one|two|three|four|five|six|single|a pair of|pair of|a couple of|couple of)\s+(?:[a-z-]+\s+){0,2}$/)
  if (!m) return 1
  const word = m[1].replace(/^a /, '').replace(/ of$/, '')
  const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word] ?? 1
  return Math.max(1, Math.min(10, n))
}

function parseAmount(raw: string, k?: string): number {
  const n = Number(raw.replace(/,/g, ''))
  return k ? n * 1000 : n
}

export function parseBudget(lower: string): number | null | undefined {
  if (/\b(no|without a|remove the|clear the) budget\b/.test(lower)) return null
  const patterns = [
    /\bbudget\b(?:\s+(?:is|of|to|at|around|about|be|now|=|:))*\s*(?:usd\s*)?\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b(?!\s*%)/,
    /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/,
    /\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:usd|dollars|bucks)\b/,
  ]
  for (const re of patterns) {
    const m = lower.match(re)
    if (m) {
      const amount = parseAmount(m[1], m[2])
      if (amount > 0) return amount
    }
  }
  return undefined
}

function parseTax(lower: string): number | undefined {
  const m = lower.match(/\btax(?:\s+rate)?(?:\s+is|\s+of|:)?\s*(\d{1,2}(?:\.\d+)?)\s*%/) ?? lower.match(/\b(\d{1,2}(?:\.\d+)?)\s*%\s*(?:sales\s+)?tax\b/)
  return m ? Number(m[1]) : undefined
}

function parseStyle(lower: string): string | null | undefined {
  if (/\b(any|no particular) style\b/.test(lower)) return null
  for (const [synonym, style] of Object.entries(STYLE_SYNONYMS)) if (new RegExp(`\\b${escape(synonym)}\\b`).test(lower)) return style
  return KNOWN_STYLES.find((s) => new RegExp(`\\b${escape(s)}\\b`).test(lower))
}

// Retailers are only recognised after a preposition ("from IKEA", "at West
// Elm") or before "only", so "my target budget" never selects Target.
function parseStore(lower: string): string | null | undefined {
  if (/\b(any|all|every) (store|retailer|shop)s?\b/.test(lower)) return null
  return KNOWN_RETAILERS.find((r) => {
    const name = escape(r.toLowerCase())
    return new RegExp(`\\b(?:from|at|on|via|only)\\s+(?:the\\s+)?${name}(?![\\w'])|\\b${name}\\s+only\\b`).test(lower)
  })
}

// A removal verb earlier in the same clause, or "no" directly before the item.
const REMOVE = /\b(remove|drop|delete|without|skip|no longer need|don't need|do not need|get rid of|take out)\b[^.,;]*$|\bno\s+(?:[a-z-]+\s+)?$/
const COMPARE = /\b(compare|comparison|alternatives?|other options|more options|options for|cheaper)\b/
// Choosing needs an explicit option reference, so "use 2 side tables" is an
// item request, not "choose option 2".
const CHOOSE = /(?:\boption|\bnumber|#)\s*#?\s*(\d{1,2})\b|\b(first|second|third|fourth|fifth) (?:one|option)\b/
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 }
const RETRY = /\b(retry|search again|re-?search|refresh|try again)\b/
const DEMO_ON = /\b(use|allow|include|show)\s+(?:the\s+)?(?:demo|sample|placeholder)(?:\s+catalog)?\s+prices?\b/
const DEMO_OFF = /\b(no|stop using|disallow|don't use|do not use|remove)\s+(?:the\s+)?(?:demo|sample|placeholder)(?:\s+catalog)?\s+prices?\b/
const CLEAR = /\b(unlock|clear (?:my )?(?:choice|pick)|undo (?:my )?(?:choice|pick))\b/
const FINANCE = /\b(finance|financial breakdown|per[- ](?:store|retailer)|by (?:store|retailer)|split (?:it |the plan |my plan |the order |my order )?(?:by|per|into)|order split|spending (?:limits?|caps?))\b/
const RESET = /\b(start over|start again|reset|clear everything|forget everything|new room)\b/
const PLAN = /\b(plan|optimi[sz]e|recalculate|show (?:me )?(?:the |my )?(?:plan|list|total)|shopping list)\b/
const ONLY = /\b(only|just|instead)\b/

export function interpret(message: string, state: SessionState): Interpretation {
  const lower = message.toLowerCase().replace(/[’']/g, "'")
  const calls: ToolCall[] = []
  if (RESET.test(lower)) calls.push({ name: 'reset_session', input: {} })
  const afterReset = calls.length > 0

  // Blank out style names first so "art deco" isn't read as wall art.
  const styleBlanked = KNOWN_STYLES.reduce((text, s) => text.replace(new RegExp(`\\b${escape(s)}\\b`, 'g'), ' '.repeat(s.length)), lower)
  const mentions = findMentions(styleBlanked)
  const segmentBefore = (i: number) => lower.slice(i > 0 ? mentions[i - 1].end : 0, mentions[i].start)
  const nearest = mentions[0]?.category

  const demoOn = DEMO_ON.test(lower)
  const demoOff = DEMO_OFF.test(lower)
  const choose = lower.match(CHOOSE)
  const compare = COMPARE.test(lower) && !choose
  const retry = RETRY.test(lower)

  const items: { category: Category; quantity: number }[] = []
  const removals: Category[] = []
  mentions.forEach((m, i) => {
    const before = segmentBefore(i)
    if (REMOVE.test(before)) removals.push(m.category)
    else items.push({ category: m.category, quantity: quantityBefore(lower.slice(Math.max(0, m.start - 30), m.start)) })
  })
  const mentioned = [...new Set(mentions.map((m) => m.category))]

  // Demo-price opt in/out applies to the named categories, or to every
  // requested category whose live search did not succeed.
  if (demoOn || demoOff) {
    const targets = mentioned.length ? mentioned : state.preferences.needs.map((n) => n.category).filter((c) => state.searches[c]?.status !== 'ok')
    if (!targets.length) return { calls, clarification: 'Which item should use demo prices? For example: "use demo prices for the rug".' }
    calls.push({ name: 'use_demo_prices', input: { categories: targets, enabled: demoOn && !demoOff } })
    calls.push({ name: 'build_plan', input: {} })
    return { calls }
  }

  if (choose) {
    const option = choose[1] ? Number(choose[1]) : ORDINALS[choose[2]]
    const target = nearest ?? onlyComparedCategory(state)
    if (!target) return { calls, clarification: `Which item is option ${option} for? For example: "choose option ${option} for the rug".` }
    calls.push({ name: 'choose_product', input: { category: target, option_number: option } }, { name: 'build_plan', input: {} })
    return { calls }
  }

  if (CLEAR.test(lower)) {
    if (!nearest) return { calls, clarification: 'Which item should I stop locking? For example: "clear my choice for the rug".' }
    calls.push({ name: 'clear_choice', input: { category: nearest } }, { name: 'build_plan', input: {} })
    return { calls }
  }

  if (retry && mentioned.length) {
    for (const c of mentioned) calls.push({ name: 'search_products', input: { category: c } })
    if (mentioned.some((c) => state.preferences.needs.some((n) => n.category === c))) calls.push({ name: 'build_plan', input: {} })
    return { calls }
  }

  const prefs: Record<string, unknown> = {}
  const budget = parseBudget(lower)
  if (budget !== undefined) prefs.budget_usd = budget
  const style = parseStyle(lower)
  if (style !== undefined) prefs.style = style
  const store = parseStore(lower)
  if (store !== undefined) prefs.store = store
  const tax = parseTax(lower)
  if (tax !== undefined) prefs.tax_rate_percent = tax

  if (FINANCE.test(lower)) {
    // "$600 per item" is a spending limit for the breakdown, not a new budget.
    const limits: Record<string, number> = {}
    const perItem = lower.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:per|each|a|for any)\s+(?:item|piece|thing)\b/)
    if (perItem) {
      limits.per_item_cap_usd = parseAmount(perItem[1], perItem[2])
      if (prefs.budget_usd === limits.per_item_cap_usd) delete prefs.budget_usd
    }
    if (Object.keys(prefs).length) calls.push({ name: 'update_preferences', input: prefs })
    calls.push({ name: 'build_plan', input: {} }, { name: 'finance_breakdown', input: limits })
    return { calls }
  }

  if (compare) {
    if (Object.keys(prefs).length) calls.push({ name: 'update_preferences', input: prefs })
    if (!mentioned.length) return { calls, clarification: 'Which item should I compare? For example: "compare rugs".' }
    for (const c of mentioned) calls.push({ name: 'compare_alternatives', input: { category: c } })
    return { calls }
  }

  if (removals.length) prefs.remove_items = [...new Set(removals)]
  if (items.length) {
    const hasNeeds = state.preferences.needs.length > 0 && !afterReset
    prefs[hasNeeds && !ONLY.test(lower) ? 'add_items' : 'set_items'] = items
  }
  if (Object.keys(prefs).length) calls.push({ name: 'update_preferences', input: prefs })
  if (calls.some((c) => c.name === 'update_preferences') || PLAN.test(lower)) calls.push({ name: 'build_plan', input: {} })
  return { calls }
}

function onlyComparedCategory(state: SessionState): Category | undefined {
  const shown = Object.keys(state.lastComparison) as Category[]
  return shown.length === 1 ? shown[0] : undefined
}
