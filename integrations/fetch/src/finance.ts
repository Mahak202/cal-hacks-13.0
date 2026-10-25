import { estimateCosts, roundCents, type CostEstimate } from './pricing'
import type { Plan, PlanLine } from './types'

// Finance agent, planning only: how the plan would split into one order per
// retailer, and whether it respects the user's spending limits. Nothing is
// charged, reserved or ordered.

export type SpendingLimits = { totalCap?: number; perItemCap?: number; allowedStores?: string[] }

export type RetailerOrder = {
  store: string
  lines: { category: PlanLine['category']; name: string; quantity: number; lineTotal: number; source: PlanLine['item']['source'] }[]
  costs: CostEstimate
}

export type LimitCheck = { rule: 'total_cap' | 'per_item_cap' | 'allowed_stores'; ok: boolean; detail: string }

export type FinanceBreakdown = {
  orders: RetailerOrder[]
  planTotal: CostEstimate
  checks: LimitCheck[]
  unpricedCategories: string[]
  demoLines: number
}

const usd = (n: number) => `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function financeBreakdown(plan: Plan, limits: SpendingLimits = {}): FinanceBreakdown {
  const byStore = new Map<string, PlanLine[]>()
  for (const line of plan.lines) {
    const key = line.item.store.toLowerCase()
    byStore.set(key, [...(byStore.get(key) ?? []), line])
  }
  const orders: RetailerOrder[] = [...byStore.values()].map((lines) => ({
    store: lines[0].item.store,
    lines: lines.map((l) => ({ category: l.category, name: l.item.name, quantity: l.quantity, lineTotal: l.lineTotal, source: l.item.source })),
    costs: estimateCosts(lines.map((l) => ({ price: l.item.price, quantity: l.quantity, store: l.item.store })), plan.costs.taxRate),
  }))

  const checks: LimitCheck[] = []
  if (limits.totalCap !== undefined) {
    const ok = plan.costs.estimatedTotal <= limits.totalCap
    checks.push({
      rule: 'total_cap',
      ok,
      detail: ok
        ? `Estimated total ${usd(plan.costs.estimatedTotal)} is within the ${usd(limits.totalCap)} cap.`
        : `Estimated total ${usd(plan.costs.estimatedTotal)} exceeds the ${usd(limits.totalCap)} cap by ${usd(roundCents(plan.costs.estimatedTotal - limits.totalCap))}.`,
    })
  }
  if (limits.perItemCap !== undefined) {
    const over = plan.lines.filter((l) => l.item.price > limits.perItemCap!)
    checks.push({
      rule: 'per_item_cap',
      ok: !over.length,
      detail: over.length ? `Over the ${usd(limits.perItemCap)} per-item cap: ${over.map((l) => `${l.item.name} (${usd(l.item.price)})`).join(', ')}.` : `Every item is at or under the ${usd(limits.perItemCap)} per-item cap.`,
    })
  }
  if (limits.allowedStores?.length) {
    const allowed = limits.allowedStores.map((s) => s.toLowerCase())
    const outside = orders.filter((o) => !allowed.some((a) => o.store.toLowerCase().includes(a)))
    checks.push({
      rule: 'allowed_stores',
      ok: !outside.length,
      detail: outside.length ? `Not in your allowed stores (${limits.allowedStores.join(', ')}): ${outside.map((o) => o.store).join(', ')}.` : `Every retailer is in your allowed list (${limits.allowedStores.join(', ')}).`,
    })
  }
  return {
    orders,
    planTotal: plan.costs,
    checks,
    unpricedCategories: plan.unpriced.map((u) => u.category),
    demoLines: plan.demoCount,
  }
}
