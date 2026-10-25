import type { Category } from '../../../data/products'
import { ESTIMATED_DELIVERY_PER_RETAILER, ESTIMATED_TAX_RATE, estimateCosts, roundCents } from './pricing'
import type { Candidate, Need, Plan, PlanLine, Tradeoff } from './types'

export type OptimizeInput = {
  needs: Need[]
  pools: Partial<Record<Category, Candidate[]>>
  unpricedReasons?: Partial<Record<Category, string>>
  pinned?: Partial<Record<Category, string>>
  budget?: number
  taxRate?: number
  maxOptionsPerCategory?: number
  nodeLimit?: number
  now?: Date
}

type Slot = { need: Need; options: Candidate[]; pinned: boolean; preferred: Candidate }
type SearchResult = { picks: Candidate[] | null; score: number; total: number; nodes: number; aborted: boolean }

const EPS = 1e-9
const byScoreThenPrice = (a: Candidate, b: Candidate) => b.score - a.score || a.price - b.price

// Keep the best-ranked options plus the cheapest few, so a tight budget can
// still reach the low end of the range without exploding the search.
function trimOptions(ranked: Candidate[], max: number): Candidate[] {
  if (ranked.length <= max) return ranked
  const cheapest = [...ranked].sort((a, b) => a.price - b.price).slice(0, 3)
  const kept = new Map<string, Candidate>()
  for (const c of ranked.slice(0, Math.max(1, max - cheapest.length))) kept.set(c.id, c)
  for (const c of cheapest) kept.set(c.id, c)
  return [...kept.values()].sort(byScoreThenPrice)
}

function totalOf(slots: Slot[], picks: Candidate[], taxRate: number): number {
  return estimateCosts(picks.map((c, i) => ({ price: c.price, quantity: slots[i].need.quantity, store: c.store })), taxRate).estimatedTotal
}

// Lower bound on the estimated total for any completion of a partial
// selection: remaining slots at their cheapest, delivery for the retailers
// already chosen (at least one), tax on the bound.
function lowerBound(partialSubtotal: number, remainingMin: number, picks: Candidate[], slotCount: number, taxRate: number): number {
  const retailers = Math.max(new Set(picks.map((p) => p.store.toLowerCase())).size, slotCount > 0 ? 1 : 0)
  return (partialSubtotal + remainingMin) * (1 + taxRate) + retailers * ESTIMATED_DELIVERY_PER_RETAILER - 0.01
}

function suffixMin(slots: Slot[]): number[] {
  const out = new Array(slots.length + 1).fill(0)
  for (let i = slots.length - 1; i >= 0; i--) out[i] = out[i + 1] + Math.min(...slots[i].options.map((o) => o.price)) * slots[i].need.quantity
  return out
}

// Exact branch and bound: highest total ranking score whose estimated total
// (subtotal + tax + delivery) fits the budget; ties go to the cheaper plan.
function bestWithinBudget(slots: Slot[], budget: number, taxRate: number, nodeLimit: number): SearchResult {
  const n = slots.length
  const minRest = suffixMin(slots)
  const maxRest = new Array(n + 1).fill(0)
  for (let i = n - 1; i >= 0; i--) maxRest[i] = maxRest[i + 1] + Math.max(...slots[i].options.map((o) => o.score))
  const result: SearchResult = { picks: null, score: -Infinity, total: Infinity, nodes: 0, aborted: false }
  const picks: Candidate[] = []
  const visit = (i: number, subtotal: number, score: number) => {
    if (result.aborted) return
    if (++result.nodes > nodeLimit) {
      result.aborted = true
      return
    }
    const lb = lowerBound(subtotal, minRest[i], picks, n, taxRate)
    if (lb > budget) return
    const bound = score + maxRest[i]
    if (bound < result.score - EPS || (bound <= result.score + EPS && lb >= result.total)) return
    if (i === n) {
      const total = totalOf(slots, picks, taxRate)
      if (total > budget + EPS) return
      if (score > result.score + EPS || (Math.abs(score - result.score) <= EPS && total < result.total)) {
        result.picks = [...picks]
        result.score = score
        result.total = total
      }
      return
    }
    for (const option of slots[i].options) {
      picks.push(option)
      visit(i + 1, subtotal + option.price * slots[i].need.quantity, score + option.score)
      picks.pop()
    }
  }
  visit(0, 0, 0)
  return result
}

function cheapestCombination(slots: Slot[], taxRate: number, nodeLimit: number): SearchResult {
  const n = slots.length
  const minRest = suffixMin(slots)
  const result: SearchResult = { picks: null, score: 0, total: Infinity, nodes: 0, aborted: false }
  const picks: Candidate[] = []
  const visit = (i: number, subtotal: number) => {
    if (result.aborted) return
    if (++result.nodes > nodeLimit) {
      result.aborted = true
      return
    }
    if (lowerBound(subtotal, minRest[i], picks, n, taxRate) >= result.total) return
    if (i === n) {
      const total = totalOf(slots, picks, taxRate)
      if (total < result.total) {
        result.picks = [...picks]
        result.total = total
      }
      return
    }
    for (const option of [...slots[i].options].sort((a, b) => a.price - b.price)) {
      picks.push(option)
      visit(i + 1, subtotal + option.price * slots[i].need.quantity)
      picks.pop()
    }
  }
  visit(0, 0)
  return result
}

// Used only if the exact search hits its node limit: start from the cheapest
// option everywhere, then repeatedly take the single upgrade that adds the
// most ranking score while staying within budget.
function greedy(slots: Slot[], budget: number, taxRate: number): Candidate[] {
  const picks = slots.map((s) => [...s.options].sort((a, b) => a.price - b.price)[0])
  if (totalOf(slots, picks, taxRate) > budget) return picks
  for (;;) {
    let best: { slot: number; option: Candidate; gain: number; total: number } | null = null
    for (let i = 0; i < slots.length; i++) {
      for (const option of slots[i].options) {
        const gain = option.score - picks[i].score
        if (gain <= EPS) continue
        const total = totalOf(slots, picks.map((p, j) => (j === i ? option : p)), taxRate)
        if (total > budget) continue
        if (!best || gain > best.gain + EPS || (Math.abs(gain - best.gain) <= EPS && total < best.total)) best = { slot: i, option, gain, total }
      }
    }
    if (!best) return picks
    picks[best.slot] = best.option
  }
}

export function optimizePlan(input: OptimizeInput): Plan {
  const taxRate = input.taxRate ?? ESTIMATED_TAX_RATE
  const maxOptions = input.maxOptionsPerCategory ?? 8
  const nodeLimit = input.nodeLimit ?? 400_000
  const unpriced: Plan['unpriced'] = []
  const slots: Slot[] = []
  for (const need of input.needs) {
    const pool = input.pools[need.category] ?? []
    if (!pool.length) {
      unpriced.push({ category: need.category, reason: input.unpricedReasons?.[need.category] ?? 'No priced options available.' })
      continue
    }
    const ranked = [...pool].sort(byScoreThenPrice)
    const pinId = input.pinned?.[need.category]
    const pinnedItem = pinId ? pool.find((c) => c.id === pinId) : undefined
    slots.push({ need, options: pinnedItem ? [pinnedItem] : trimOptions(ranked, maxOptions), pinned: !!pinnedItem, preferred: pinnedItem ?? ranked[0] })
  }
  const combinations = slots.reduce((product, s) => product * s.options.length, 1)

  const budget = input.budget
  let picks: Candidate[]
  let searchMode: Plan['searchMode'] = 'exhaustive'
  if (budget === undefined) {
    picks = slots.map((s) => s.preferred)
  } else {
    const best = bestWithinBudget(slots, budget, taxRate, nodeLimit)
    if (best.aborted) {
      searchMode = 'heuristic'
      const fallback = greedy(slots, budget, taxRate)
      const fallbackFits = totalOf(slots, fallback, taxRate) <= budget + EPS
      const fallbackScore = fallback.reduce((sum, c) => sum + c.score, 0)
      picks = best.picks && (!fallbackFits || best.score > fallbackScore + EPS) ? best.picks : fallback
    } else if (best.picks) {
      picks = best.picks
    } else {
      // Nothing fits: report the cheapest combination so the shortfall is real.
      const cheapest = cheapestCombination(slots, taxRate, nodeLimit)
      if (cheapest.aborted || !cheapest.picks) searchMode = 'heuristic'
      picks = cheapest.picks ?? greedy(slots, budget, taxRate)
    }
  }

  const lines: PlanLine[] = slots.map((slot, i) => ({
    category: slot.need.category,
    quantity: slot.need.quantity,
    item: picks[i],
    lineTotal: roundCents(picks[i].price * slot.need.quantity),
    pinned: slot.pinned,
    optionsConsidered: slot.options.length,
  }))
  const costs = estimateCosts(lines.map((l) => ({ price: l.item.price, quantity: l.quantity, store: l.item.store })), taxRate)

  let status: Plan['status']
  if (budget === undefined) status = 'no_budget'
  else if (costs.estimatedTotal > budget + EPS) status = 'over_budget'
  else status = unpriced.length ? 'incomplete' : 'within_budget'

  const tradeoffs: Tradeoff[] =
    budget === undefined
      ? []
      : slots.flatMap((slot, i) =>
          picks[i].id === slot.preferred.id
            ? []
            : [{ category: slot.need.category, preferred: slot.preferred, chosen: picks[i], saving: roundCents((slot.preferred.price - picks[i].price) * slot.need.quantity) }],
        )
  return {
    status,
    lines,
    costs,
    budget,
    difference: budget === undefined ? undefined : roundCents(budget - costs.estimatedTotal),
    searchMode,
    combinations,
    unpriced,
    tradeoffs,
    demoCount: lines.filter((l) => l.item.source === 'demo-catalog').length,
    liveCount: lines.filter((l) => l.item.source === 'live-listing').length,
    createdAt: (input.now ?? new Date()).toISOString(),
  }
}
