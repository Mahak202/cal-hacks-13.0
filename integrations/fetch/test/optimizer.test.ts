import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Category } from '../../../data/products'
import { liveScore } from '../src/candidates'
import { optimizePlan } from '../src/optimizer'
import { estimateCosts } from '../src/pricing'
import type { Candidate } from '../src/types'

const c = (category: Category, id: string, price: number, score: number, store = 'StoreA'): Candidate => ({
  id,
  category,
  name: id,
  store,
  price,
  currency: 'USD',
  currencyReported: true,
  url: `https://x/${id}`,
  source: 'live-listing',
  score,
})

describe('estimateCosts', () => {
  it('applies the stated tax rate and a flat fee per distinct retailer', () => {
    const costs = estimateCosts([
      { price: 100, quantity: 2, store: 'IKEA' },
      { price: 50.5, quantity: 1, store: 'ikea' },
      { price: 10, quantity: 1, store: 'Target' },
    ])
    assert.equal(costs.subtotal, 260.5)
    assert.equal(costs.estimatedTax, 24.42) // 260.5 × 9.375%
    assert.equal(costs.retailerCount, 2)
    assert.equal(costs.estimatedDelivery, 98)
    assert.equal(costs.estimatedTotal, 382.92)
    assert.equal(costs.currency, 'USD')
  })
})

describe('liveScore', () => {
  it('discounts ratings backed by few reviews', () => {
    assert.ok(liveScore(4.4, 94) > liveScore(5.0, 1), 'one 5-star review does not beat 4.4 from 94 reviews')
    assert.ok(liveScore(4.7, 1200) > liveScore(4.2, 800))
    assert.equal(liveScore(undefined, undefined), 65)
  })
})

describe('optimizePlan', () => {
  const pools = {
    bed: [c('bed', 'bed-best', 900, 90), c('bed', 'bed-mid', 400, 80), c('bed', 'bed-cheap', 150, 60)],
    rug: [c('rug', 'rug-best', 500, 90), c('rug', 'rug-cheap', 100, 70)],
  }
  const needs = [
    { category: 'bed' as const, quantity: 1 },
    { category: 'rug' as const, quantity: 1 },
  ]

  it('picks the top-ranked items when the budget allows', () => {
    const plan = optimizePlan({ needs, pools, budget: 10_000 })
    assert.equal(plan.status, 'within_budget')
    assert.deepEqual(plan.lines.map((l) => l.item.id), ['bed-best', 'rug-best'])
    assert.equal(plan.tradeoffs.length, 0)
    assert.ok(plan.difference! > 0)
  })

  it('trades down to fit the budget including tax and delivery, and reports the trade-off', () => {
    // bed-mid + rug-best = 900 subtotal → 900 + 84.38 tax + 49 delivery = 1033.38
    const plan = optimizePlan({ needs, pools, budget: 1100 })
    assert.equal(plan.status, 'within_budget')
    assert.deepEqual(plan.lines.map((l) => l.item.id), ['bed-mid', 'rug-best'])
    assert.equal(plan.costs.estimatedTotal, 1033.38)
    assert.ok(plan.costs.estimatedTotal <= 1100)
    assert.deepEqual(plan.tradeoffs.map((t) => [t.preferred.id, t.chosen.id, t.saving]), [['bed-best', 'bed-mid', 500]])
    assert.equal(plan.searchMode, 'exhaustive')
  })

  it('does not ignore tax and delivery: a plan that fits on subtotal alone can still be infeasible', () => {
    // Cheapest subtotal is 250, but the estimated total is 250 + 23.44 + 49 = 322.44.
    const plan = optimizePlan({ needs, pools, budget: 300 })
    assert.equal(plan.status, 'over_budget')
    assert.equal(plan.costs.estimatedTotal, 322.44)
    assert.equal(plan.difference, -22.44)
    assert.equal(plan.searchMode, 'exhaustive')
  })

  it('reports the cheapest combination and the real shortfall when nothing fits', () => {
    const plan = optimizePlan({ needs, pools, budget: 100 })
    assert.equal(plan.status, 'over_budget')
    assert.deepEqual(plan.lines.map((l) => l.item.id), ['bed-cheap', 'rug-cheap'])
    assert.equal(plan.difference, -(plan.costs.estimatedTotal - 100))
  })

  it('accounts for per-retailer delivery when choosing between stores', () => {
    const storePools = {
      bed: [c('bed', 'bed-a', 300, 80, 'A'), c('bed', 'bed-b', 290, 80, 'B')],
      rug: [c('rug', 'rug-a', 100, 80, 'A')],
    }
    // Same score; bed-b is $10 cheaper but adds a second $49 delivery.
    const plan = optimizePlan({ needs, pools: storePools, budget: 2000 })
    assert.deepEqual(plan.lines.map((l) => l.item.id), ['bed-a', 'rug-a'])
    assert.equal(plan.costs.retailerCount, 1)
  })

  it('respects quantities', () => {
    const plan = optimizePlan({ needs: [{ category: 'sideTables', quantity: 2 }], pools: { sideTables: [c('sideTables', 'st', 60, 70)] }, budget: 500 })
    assert.equal(plan.lines[0].lineTotal, 120)
    assert.equal(plan.costs.subtotal, 120)
  })

  it('keeps a pinned item even when it is not the optimizer’s choice', () => {
    const plan = optimizePlan({ needs, pools, budget: 1100, pinned: { bed: 'bed-cheap' } })
    assert.equal(plan.lines[0].item.id, 'bed-cheap')
    assert.equal(plan.lines[0].pinned, true)
    assert.equal(plan.lines[1].item.id, 'rug-best')
  })

  it('marks plans with unpriced categories as incomplete instead of feasible', () => {
    const plan = optimizePlan({ needs, pools: { bed: pools.bed }, budget: 5000, unpricedReasons: { rug: 'Live search failed: boom' } })
    assert.equal(plan.status, 'incomplete')
    assert.deepEqual(plan.unpriced, [{ category: 'rug', reason: 'Live search failed: boom' }])
    assert.equal(plan.lines.length, 1)
  })

  it('reports over_budget when even the priced part exceeds the budget', () => {
    const plan = optimizePlan({ needs, pools: { bed: pools.bed }, budget: 100 })
    assert.equal(plan.status, 'over_budget')
    assert.equal(plan.unpriced.length, 1)
  })

  it('without a budget, picks the top-ranked items and makes no feasibility claim', () => {
    const plan = optimizePlan({ needs, pools })
    assert.equal(plan.status, 'no_budget')
    assert.equal(plan.difference, undefined)
  })

  it('falls back to a labelled heuristic search when the node limit is hit', () => {
    const plan = optimizePlan({ needs, pools, budget: 1100, nodeLimit: 2 })
    assert.equal(plan.searchMode, 'heuristic')
    assert.ok(plan.costs.estimatedTotal <= 1100)
    assert.equal(plan.status, 'within_budget')
  })
})
