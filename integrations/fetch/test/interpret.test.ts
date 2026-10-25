import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { interpret, parseBudget } from '../src/interpret'
import { emptySession } from '../src/sessions'
import type { SessionState } from '../src/types'

const fresh = () => emptySession('agent1qsender', 'session-1', 0)
const withNeeds = (): SessionState => {
  const s = fresh()
  s.preferences.needs = [{ category: 'bed', quantity: 1 }]
  return s
}
const prefsOf = (message: string, state = fresh()) => interpret(message, state).calls.find((c) => c.name === 'update_preferences')?.input as Record<string, unknown> | undefined

describe('interpret', () => {
  it('parses a full furnishing request', () => {
    const { calls } = interpret('Japandi bedroom: a bed, a rug and 2 side tables, budget $1,800 from IKEA', fresh())
    assert.deepEqual(calls.map((c) => c.name), ['update_preferences', 'build_plan'])
    assert.deepEqual(calls[0].input, {
      budget_usd: 1800,
      style: 'japandi',
      store: 'IKEA',
      set_items: [
        { category: 'bed', quantity: 1 },
        { category: 'rug', quantity: 1 },
        { category: 'sideTables', quantity: 2 },
      ],
    })
  })

  it('parses budgets in several forms', () => {
    assert.equal(parseBudget('budget is 2k'), 2000)
    assert.equal(parseBudget('i have $950.50 to spend'), 950.5)
    assert.equal(parseBudget('about 1500 dollars'), 1500)
    assert.equal(parseBudget('no budget'), null)
    assert.equal(parseBudget('a budget-friendly rug'), undefined)
    assert.equal(parseBudget('2 side tables'), undefined)
  })

  it('adds items on follow-ups and replaces them with "only"', () => {
    assert.deepEqual(prefsOf('also add a bench', withNeeds())?.add_items, [{ category: 'bench', quantity: 1 }])
    assert.deepEqual(prefsOf('only a rug', withNeeds())?.set_items, [{ category: 'rug', quantity: 1 }])
  })

  it('removes items without misreading other uses of "no"', () => {
    assert.deepEqual(prefsOf('drop the bench', withNeeds())?.remove_items, ['bench'])
    assert.deepEqual(prefsOf('a bed, no rug', fresh())?.remove_items, ['rug'])
    const p = prefsOf('no more than $1500 for a bed', fresh())
    assert.equal(p?.remove_items, undefined)
    assert.deepEqual(p?.set_items, [{ category: 'bed', quantity: 1 }])
    assert.equal(p?.budget_usd, 1500)
  })

  it('does not treat words that contain a category name as that category', () => {
    assert.equal(interpret('start over', fresh()).calls.some((c) => c.name === 'update_preferences'), false)
    assert.equal(prefsOf('art deco bedroom with a bed')?.style, 'art deco')
    assert.deepEqual(prefsOf('art deco bedroom with a bed')?.set_items, [{ category: 'bed', quantity: 1 }])
  })

  it('only reads a store after a preposition', () => {
    assert.equal(prefsOf('my target budget is $900 for a bed')?.store, undefined)
    assert.equal(prefsOf('a bed from target')?.store, 'Target')
    assert.equal(prefsOf('any store is fine for the bed')?.store, null)
  })

  it('compares named categories without adding them as items', () => {
    const { calls } = interpret('compare rugs', withNeeds())
    assert.deepEqual(calls, [{ name: 'compare_alternatives', input: { category: 'rug' } }])
    assert.ok(interpret('compare options', withNeeds()).clarification)
  })

  it('chooses only on an explicit option reference', () => {
    assert.deepEqual(interpret('choose option 2 for the rug', withNeeds()).calls[0], { name: 'choose_product', input: { category: 'rug', option_number: 2 } })
    assert.deepEqual(interpret('the second one for the bed', withNeeds()).calls[0], { name: 'choose_product', input: { category: 'bed', option_number: 2 } })
    assert.deepEqual(prefsOf('use 2 side tables', withNeeds())?.add_items, [{ category: 'sideTables', quantity: 2 }])
  })

  it('opts into demo prices only on an explicit request', () => {
    const { calls } = interpret('use demo prices for the rug', withNeeds())
    assert.deepEqual(calls[0], { name: 'use_demo_prices', input: { categories: ['rug'], enabled: true } })
    assert.equal(interpret('a rug like the demo', withNeeds()).calls.some((c) => c.name === 'use_demo_prices'), false)
  })

  it('resets and can apply new preferences in the same message', () => {
    const { calls } = interpret('start over: coastal bench, budget $400', withNeeds())
    assert.deepEqual(calls.map((c) => c.name), ['reset_session', 'update_preferences', 'build_plan'])
    assert.deepEqual((calls[1].input as any).set_items, [{ category: 'bench', quantity: 1 }])
  })

  it('recognises the newer indoor and outdoor categories without overlap', () => {
    assert.deepEqual(prefsOf('balcony with string lights, an outdoor planter and 2 patio chairs')?.set_items, [
      { category: 'stringLights', quantity: 1 },
      { category: 'outdoorPlanter', quantity: 1 },
      { category: 'outdoorChair', quantity: 2 },
    ])
    assert.deepEqual(prefsOf('linen curtains, a ceiling fan, an accent chair and a pendant light')?.set_items, [
      { category: 'curtains', quantity: 1 },
      { category: 'fan', quantity: 1 },
      { category: 'chair', quantity: 1 },
      { category: 'pendants', quantity: 1 },
    ])
  })

  it('returns no calls for unrelated text', () => {
    assert.deepEqual(interpret('hello there', fresh()).calls, [])
  })
})
