import type { Category } from '../../../data/products'
import type { Comparison, ComparisonOption } from './engine'
import type { FinanceBreakdown } from './finance'
import { buildSearchTerm, itemKeywords } from './liveSearch'
import { formatMoney } from './pricing'
import type { Candidate, CategorySearch, Plan, Preferences } from './types'
import { categoryLabel, CATEGORY_LABELS } from './vocabulary'

const title = (category: Category, quantity = 1) => {
  const label = categoryLabel(category, quantity)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const when = (iso?: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'unknown time')

function stars(rating?: number, reviews?: number): string {
  if (typeof rating !== 'number') return 'no rating reported'
  return `rated ${rating.toFixed(1)}/5${typeof reviews === 'number' ? ` (${reviews.toLocaleString('en-US')} review${reviews === 1 ? '' : 's'})` : ''}`
}

function link(url: string | null): string {
  return url ? `[listing link](${url})` : 'no link reported'
}

function sourceLine(item: Candidate | ComparisonOption & { retrievedAt?: string }): string {
  if (item.source === 'demo-catalog') return 'DEMO CATALOG PRICE: illustrative Roomwise sample, not a real listing; no link'
  const currency = item.currencyReported ? 'USD' : 'USD assumed (currency not reported; US search)'
  const retrieved = 'retrievedAt' in item && item.retrievedAt ? ` · retrieved ${when(item.retrievedAt)}` : ''
  return `Live listing · ${currency} · ${stars(item.rating, item.reviewsCount)} · ${link(item.url)}${retrieved}`
}

export function renderPreferences(prefs: Preferences): string {
  const parts = [
    `style: ${prefs.style ?? 'not set'}`,
    `budget: ${prefs.budget !== undefined ? formatMoney(prefs.budget) : 'not set'}`,
    `items: ${
      prefs.needs.length
        ? prefs.needs.map((n) => `${n.quantity > 1 ? `${n.quantity}× ${categoryLabel(n.category, n.quantity)}` : CATEGORY_LABELS[n.category]}${n.keywords ? ` (${n.keywords})` : ''}`).join(', ')
        : 'none yet'
    }`,
  ]
  if (prefs.store) parts.push(`store: ${prefs.store}`)
  if (prefs.keywords) parts.push(`keywords: ${prefs.keywords}`)
  if (prefs.taxRate !== undefined) parts.push(`tax rate: ${(prefs.taxRate * 100).toFixed(3).replace(/\.?0+$/, '')}% (your figure)`)
  if (prefs.demoOptIn.length) parts.push(`demo prices allowed for: ${prefs.demoOptIn.map((c) => CATEGORY_LABELS[c]).join(', ')}`)
  return parts.join(' · ')
}

export function renderPlan(plan: Plan, prefs: Preferences): string {
  const out: string[] = ['**Roomwise shopping plan**', renderPreferences(prefs), '']
  if (!plan.lines.length) out.push('No item could be priced yet.')
  plan.lines.forEach((line, i) => {
    const qty = line.quantity > 1 ? ` × ${line.quantity} = ${formatMoney(line.lineTotal)}` : ''
    out.push(`${i + 1}. **${title(line.category, line.quantity)}**: ${line.item.name} (${line.item.store}) ${formatMoney(line.item.price)}${qty}${line.pinned ? ' · your choice' : ''}`)
    out.push(`   ${sourceLine(line.item)}`)
  })
  for (const u of plan.unpriced) {
    const label = CATEGORY_LABELS[u.category]
    out.push(`- **${title(u.category)}**: not included. ${u.reason} Nothing was substituted. Say "retry ${label}", try other keywords or stores, or "use demo prices for the ${label}" for an illustrative placeholder.`)
  }

  const c = plan.costs
  if (plan.lines.length) {
    const taxSource = prefs.taxRate !== undefined ? 'your stated rate' : 'assumed flat rate; actual tax depends on the delivery address'
    out.push(
      '',
      `Subtotal: ${formatMoney(c.subtotal)}`,
      `Estimated sales tax (${(c.taxRate * 100).toFixed(3).replace(/\.?0+$/, '')}%, ${taxSource}): ${formatMoney(c.estimatedTax)}`,
      `Estimated delivery (${formatMoney(c.deliveryPerRetailer)} × ${c.retailerCount} retailer${c.retailerCount === 1 ? '' : 's'}, assumed flat fee; retailer shipping not checked): ${formatMoney(c.estimatedDelivery)}`,
      `**Estimated total: ${formatMoney(c.estimatedTotal)}**`,
    )
  }

  out.push('', renderFeasibility(plan))
  for (const t of plan.tradeoffs) {
    const verb = t.saving >= 0 ? `saves ${formatMoney(t.saving)}` : `costs ${formatMoney(-t.saving)} more`
    out.push(`- Trade-off: ${CATEGORY_LABELS[t.category]}: ${t.chosen.name} instead of the top-ranked ${t.preferred.name} (${verb}).`)
  }
  if (plan.demoCount) out.push(`- ${plan.demoCount} line(s) use demo catalog prices, so this is not a purchasable total.`)
  out.push(
    '',
    '_Not checked: stock or availability, discounts or promo codes, exact shipping and tax. Nothing has been reserved or purchased; checkout is not part of this agent._',
    'Next: "compare rugs", "choose option 2 for the rug", "set my budget to 1500", "add a bench", or "start over".',
  )
  return out.join('\n')
}

export function renderFeasibility(plan: Plan): string {
  const total = formatMoney(plan.costs.estimatedTotal)
  switch (plan.status) {
    case 'no_budget':
      return 'Budget: none set yet. Tell me your budget and I will optimize against it.'
    case 'within_budget':
      return `Budget: feasible on these estimates: ${total} is ${formatMoney(plan.difference ?? 0)} under your ${formatMoney(plan.budget ?? 0)} budget.`
    case 'incomplete': {
      const missing = plan.unpriced.map((u) => CATEGORY_LABELS[u.category]).join(', ')
      if (!plan.lines.length) return `Budget: can't assess feasibility yet because no item could be priced (${missing}).`
      return `Budget: can't confirm feasibility because ${missing} ${plan.unpriced.length === 1 ? 'has' : 'have'} no priced item. The priced items come to ${total}, leaving ${formatMoney(plan.difference ?? 0)} of your ${formatMoney(plan.budget ?? 0)} budget.`
    }
    case 'over_budget': {
      const over = formatMoney(-(plan.difference ?? 0))
      const scope = plan.unpriced.length ? ' (even before pricing the missing items)' : ''
      const basis =
        plan.searchMode === 'exhaustive'
          ? `No combination of the ${plan.combinations.toLocaleString('en-US')} option combinations considered fits your ${formatMoney(plan.budget ?? 0)} budget${scope}.`
          : `I couldn't find a combination within your ${formatMoney(plan.budget ?? 0)} budget${scope} (the search was not exhaustive).`
      return `Budget: NOT feasible. ${basis} The cheapest combination found is ${total}, ${over} over. Options: raise the budget, remove an item, or try other stores or keywords.`
    }
  }
}

function optionLine(o: ComparisonOption & { retrievedAt?: string }): string {
  const delta = o.inPlan ? ' · in your plan' : o.differenceVsPlan !== undefined ? ` · ${o.differenceVsPlan >= 0 ? '+' : '−'}${formatMoney(Math.abs(o.differenceVsPlan))} per item vs plan` : ''
  return `${o.option}. ${o.name} (${o.store}) ${formatMoney(o.price)}${delta}\n   ${sourceLine(o)}`
}

export function renderComparison(comparison: Comparison): string {
  const label = CATEGORY_LABELS[comparison.category]
  const out: string[] = []
  const s = comparison.search
  if (!comparison.options.length) {
    out.push(`**${title(comparison.category)} alternatives**: none available.`)
    out.push(s.status === 'failed' ? `Live search for "${s.searchTerm}" failed: ${s.error}` : `Live search for "${s.searchTerm}" returned no usable USD-priced listings.`)
  } else {
    const fromDemo = comparison.options[0].source === 'demo-catalog'
    const header = fromDemo ? 'demo catalog prices (you allowed these; live search unavailable)' : `live listings for "${s.searchTerm}", retrieved ${when(s.retrievedAt)}`
    out.push(`**${title(comparison.category)} alternatives**: top ${comparison.options.length} of ${comparison.totalAvailable}, ${header}`)
    for (const o of comparison.options) out.push(optionLine(o))
    out.push(`To switch, say "choose option N for the ${label}".`)
  }
  if (comparison.demoReference.length) {
    out.push('', '_Demo catalog reference prices (illustrative only, not listings, not selectable unless you allow demo prices):_')
    for (const o of comparison.demoReference) out.push(`- ${o.name} (${o.store}) ${formatMoney(o.price)}`)
  }
  return out.join('\n')
}

export function renderSearch(category: Category, search: CategorySearch): string {
  const label = CATEGORY_LABELS[category]
  if (search.status === 'failed') return `Live search for ${label} ("${search.searchTerm}") failed: ${search.error} Nothing was substituted. Say "retry ${label}", or "use demo prices for the ${label}" for an illustrative (non-purchasable) placeholder.`
  if (search.status === 'empty') return `Live search for ${label} ("${search.searchTerm}") returned no usable USD-priced listings. Try other keywords or a different store.`
  return `Live search for ${label} ("${search.searchTerm}") found ${search.candidates.length} priced listing(s).`
}

export const HELP_TEXT = [
  "I'm the Roomwise shopping planner. Tell me what you want to furnish and I'll search live product listings, compare options and fit them to your budget (with estimated tax and delivery).",
  'Items I can plan: bed, rug, pendant lights, side tables, bench, planter, wall art, curtains, chair, ceiling fan, and for outdoors an outdoor planter, outdoor chair, pergola and string lights.',
  'Example: "Japandi bedroom with a bed, a rug and 2 side tables, budget $2,000."',
].join('\n')

export function renderFinance(fb: FinanceBreakdown): string {
  const out = ['**Finance breakdown** (planning only: nothing is charged, reserved or ordered)']
  if (!fb.orders.length) out.push('No priced items to break down yet.')
  fb.orders.forEach((order, i) => {
    const c = order.costs
    out.push(`${i + 1}. **${order.store}**: subtotal ${formatMoney(c.subtotal)} · est. tax ${formatMoney(c.estimatedTax)} · est. delivery ${formatMoney(c.estimatedDelivery)} · **est. order total ${formatMoney(c.estimatedTotal)}**`)
    for (const line of order.lines) out.push(`   - ${line.name}${line.quantity > 1 ? ` × ${line.quantity}` : ''}: ${formatMoney(line.lineTotal)}${line.source === 'demo-catalog' ? ' (DEMO price)' : ''}`)
  })
  if (fb.orders.length) out.push(`Plan estimated total: ${formatMoney(fb.planTotal.estimatedTotal)} across ${fb.orders.length} retailer order${fb.orders.length === 1 ? '' : 's'} (per-order tax is rounded separately, so the sum can differ by a few cents).`)
  if (fb.checks.length) {
    out.push('', 'Spending checks:')
    for (const check of fb.checks) out.push(`- ${check.ok ? 'OK' : 'NOT MET'}: ${check.detail}`)
  }
  if (fb.unpricedCategories.length) out.push(`Not included (no priced item): ${fb.unpricedCategories.map((c) => CATEGORY_LABELS[c as Category]).join(', ')}.`)
  if (fb.demoLines) out.push(`${fb.demoLines} line(s) use demo catalog prices and can't be ordered.`)
  return out.join('\n')
}

export function renderListings(category: Category, search: CategorySearch, max = 5): string {
  if (search.status !== 'ok') return renderSearch(category, search)
  const out = [`**${title(category)} listings** for "${search.searchTerm}": ${search.candidates.length} priced, showing the top ${Math.min(max, search.candidates.length)} by rating`]
  ;[...search.candidates]
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, max)
    .forEach((c, i) => out.push(`${i + 1}. ${c.name} (${c.store}) ${formatMoney(c.price)}\n   ${sourceLine(c)}`))
  return out.join('\n')
}

export function renderBrief(prefs: Preferences): string {
  const out = ['**Room brief**', renderPreferences(prefs)]
  if (prefs.needs.length) {
    out.push('Live searches will use:')
    for (const need of prefs.needs) out.push(`- ${CATEGORY_LABELS[need.category]}: "${buildSearchTerm(need.category, { ...prefs, keywords: itemKeywords(prefs.keywords, need.keywords) })}"`)
  }
  return out.join('\n')
}
