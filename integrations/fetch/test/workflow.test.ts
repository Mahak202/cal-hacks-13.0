import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleChat } from '../src/chat'
import { SessionStore } from '../src/sessions'
import { executeTool, newTurnRecord } from '../src/tools'
import { chatDeps, engineDeps, fakeSearch } from './helpers'

const A = 'agent1qalice'
const B = 'agent1qbob'

describe('complete workflow (keyword interpreter, mocked search)', () => {
  it('plans, then handles follow-up budget, comparison, choice, add, remove and reset', async () => {
    const search = fakeSearch()
    const deps = chatDeps({ search })
    const say = (message: string) => handleChat(deps, { sender: A, sessionId: 's1', message })

    const first = await say('Japandi bedroom with a bed, a rug and 2 side tables, budget $3,000')
    assert.equal(first.planStatus, 'within_budget')
    assert.equal(first.interpreter, 'keyword')
    assert.match(first.reply, /\*\*Roomwise shopping plan\*\*/)
    assert.match(first.reply, /Oak Platform Bed \(Article\) USD 899\.00/)
    assert.match(first.reply, /Side tables\*\*: Walnut Side Table \(Article\) USD 229\.00 × 2 = USD 458\.00/)
    assert.match(first.reply, /Live listing · USD · rated 4\.7\/5 \(1,200 reviews\) · \[listing link\]\(https:\/\/shop\.example\//)
    assert.match(first.reply, /Estimated sales tax \(9\.375%, assumed flat rate/)
    assert.match(first.reply, /Estimated delivery \(USD 49\.00 × 2 retailers, assumed flat fee/)
    assert.match(first.reply, /Budget: feasible on these estimates/)
    assert.match(first.reply, /Nothing has been reserved or purchased/)
    assert.doesNotMatch(first.reply, /in stock|discount applied|reserved for you|order placed/i)
    // The EUR listing and the unpriced listing are never offered.
    assert.doesNotMatch(first.reply, /Imported Wool Rug|Rug With No Price/)
    assert.deepEqual(search.calls.sort(), ['japandi bed', 'japandi rug', 'japandi side table'])

    const tighter = await say('set my budget to $1,300')
    assert.equal(tighter.planStatus, 'within_budget')
    assert.match(tighter.reply, /Trade-off:/)
    assert.equal(search.calls.length, 3, 'budget changes reuse the conversation’s search results')
    const total = Number(tighter.reply.match(/Estimated total: USD ([\d,.]+)/)![1].replace(/,/g, ''))
    assert.ok(total <= 1300)

    const comparison = await say('compare rugs')
    assert.equal(comparison.planStatus, undefined)
    assert.match(comparison.reply, /\*\*Rug alternatives\*\*: top 2 of 2, live listings for "japandi rug"/)
    assert.match(comparison.reply, /in your plan/)

    const chosen = await say('choose option 1 for the rug')
    assert.match(chosen.reply, /Hand-Woven Jute Rug 8x10 \(West Elm\) USD 499\.00 · your choice/)
    assert.deepEqual(chosen.actions.map((a) => [a.name, a.ok]), [['choose_product', true], ['build_plan', true]])

    const added = await say('also add a bench')
    assert.match(added.reply, /\*\*Bench\*\*: Oak Bench/)
    assert.equal(search.calls.length, 4)

    const removed = await say('drop the bench')
    assert.doesNotMatch(removed.reply, /Oak Bench/)

    const reset = await say('start over')
    assert.match(reset.reply, /Started over/)
    assert.equal(deps.sessions.peek(A, 's1')!.preferences.needs.length, 0)
  })

  it('reports an infeasible budget honestly with the cheapest combination and shortfall', async () => {
    const deps = chatDeps()
    const res = await handleChat(deps, { sender: A, sessionId: 's1', message: 'a bed and a rug, budget $300' })
    assert.equal(res.planStatus, 'over_budget')
    // Cheapest: Budget Metal Bed 189 + Flatweave Jute Rug 149 = 338 + 31.69 tax + 98 delivery (Walmart, IKEA).
    assert.match(res.reply, /Budget: NOT feasible\. No combination of the 6 option combinations considered fits your USD 300\.00 budget/)
    assert.match(res.reply, /cheapest combination found is USD 467\.69, USD 167\.69 over/)
    assert.doesNotMatch(res.reply, /feasible on these estimates/)
  })

  it('never substitutes demo data when a live search fails, and labels it when the user opts in', async () => {
    const search = fakeSearch({ fail: ['rug'] })
    const deps = chatDeps({ search })
    const say = (message: string) => handleChat(deps, { sender: A, sessionId: 's1', message })

    const res = await say('a bed and a rug, budget $2,000')
    assert.equal(res.planStatus, 'incomplete')
    assert.match(res.reply, /\*\*Rug\*\*: not included\. Live search failed: Apify shopping run failed: 502 upstream error/)
    assert.match(res.reply, /Nothing was substituted/)
    assert.match(res.reply, /can't confirm feasibility because rug has no priced item/)
    assert.doesNotMatch(res.reply, /DEMO CATALOG/)
    assert.doesNotMatch(res.reply, /apify_api_SECRET123/, 'credentials are redacted from errors')
    assert.match(res.reply, /\(token=\[redacted\]\)\. Nothing was substituted/)

    const demo = await say('use demo prices for the rug')
    assert.equal(demo.planStatus, 'within_budget')
    assert.match(demo.reply, /DEMO CATALOG PRICE: illustrative Roomwise sample, not a real listing; no link/)
    assert.match(demo.reply, /1 line\(s\) use demo catalog prices, so this is not a purchasable total/)
  })

  it('retries a failed search on request', async () => {
    let failing = true
    const base = fakeSearch()
    const search = Object.assign(async (term: string, max: number) => {
      if (failing && term.includes('rug')) throw new Error('temporary outage')
      return base(term, max)
    }, { calls: base.calls })
    const deps = chatDeps({ search })
    await handleChat(deps, { sender: A, sessionId: 's1', message: 'a bed and a rug' })
    failing = false
    const res = await handleChat(deps, { sender: A, sessionId: 's1', message: 'retry the rug' })
    assert.match(res.reply, /\*\*Rug\*\*: .*Jute Rug/)
    assert.equal(res.planStatus, 'no_budget')
  })

  it('reports empty searches without inventing results', async () => {
    const deps = chatDeps({ search: fakeSearch({ empty: ['bench'] }) })
    const res = await handleChat(deps, { sender: A, sessionId: 's1', message: 'a bench, budget $500' })
    assert.equal(res.planStatus, 'incomplete')
    assert.match(res.reply, /returned no usable USD-priced listings/)
    assert.match(res.reply, /No item could be priced yet/)
    assert.match(res.reply, /can't assess feasibility yet because no item could be priced \(bench\)/)
  })

  it('reports a search timeout as a failure', async () => {
    const deps = chatDeps({ search: fakeSearch({ delayMs: 200 }) })
    deps.engine.timeoutMs = 20
    const res = await handleChat(deps, { sender: A, sessionId: 's1', message: 'a bed' })
    assert.match(res.reply, /Live search failed: Live search timed out/)
  })

  it('asks for clarification or shows help instead of guessing', async () => {
    const deps = chatDeps()
    assert.match((await handleChat(deps, { sender: A, sessionId: 's1', message: 'hi' })).reply, /Roomwise shopping planner/)
    assert.match((await handleChat(deps, { sender: A, sessionId: 's1', message: 'choose option 3' })).reply, /Which item is option 3 for/)
    const noComparison = await handleChat(deps, { sender: A, sessionId: 's1', message: 'option 2 for the rug' })
    assert.match(noComparison.reply, /Not done: No rug comparison has been shown/)
  })
})

describe('tool argument validation', () => {
  const run = (name: string, input: unknown) => {
    const store = new SessionStore()
    return store.withSession(A, 's', (state) => executeTool(state, { name, input }, engineDeps(), newTurnRecord()))
  }

  it('rejects invalid or unknown arguments without changing state', async () => {
    const cases: [string, unknown, RegExp][] = [
      ['update_preferences', { budget_usd: -5 }, /budget_usd must be a number from 1 to 1000000/],
      ['update_preferences', { budget_usd: '1500' }, /budget_usd must be a number/],
      ['update_preferences', { set_items: [{ category: 'sofa' }] }, /category must be one of/],
      ['update_preferences', { set_items: [{ category: 'bed', quantity: 0 }] }, /quantity must be a whole number from 1 to 10/],
      ['update_preferences', { style: 'japandi<script>' }, /style may only contain/],
      ['update_preferences', { sender: 'agent1qmallory' }, /Unknown argument\(s\): sender/],
      ['update_preferences', {}, /No preference fields/],
      ['compare_alternatives', { category: 'bed', max_results: 50 }, /max_results must be a whole number from 1 to 10/],
      ['choose_product', { category: 'bed' }, /exactly one of option_number or product_id/],
      ['use_demo_prices', { categories: ['rug'], enabled: 'yes' }, /enabled must be true or false/],
      ['build_plan', { now: true }, /Unknown argument/],
      ['delete_everything', {}, /Unknown tool/],
    ]
    for (const [name, input, pattern] of cases) {
      const outcome = await run(name, input)
      assert.equal(outcome.ok, false, `${name} ${JSON.stringify(input)}`)
      assert.match((outcome as { error: string }).error, pattern)
    }
  })
})

describe('session isolation', () => {
  it('keeps different senders with the same session id apart', async () => {
    const deps = chatDeps()
    await handleChat(deps, { sender: A, sessionId: 'shared', message: 'a bed, budget $5,000' })
    const bob = await handleChat(deps, { sender: B, sessionId: 'shared', message: 'show my plan' })
    assert.match(bob.reply, /Not done: No furniture items have been requested yet/)
    assert.equal(deps.sessions.peek(B, 'shared')!.preferences.budget, undefined)
    assert.equal(deps.sessions.peek(A, 'shared')!.preferences.budget, 5000)
  })

  it('keeps one sender’s separate sessions apart', async () => {
    const deps = chatDeps()
    await handleChat(deps, { sender: A, sessionId: 'chat-1', message: 'japandi rug, budget $800' })
    await handleChat(deps, { sender: A, sessionId: 'chat-2', message: 'coastal bench' })
    const one = deps.sessions.peek(A, 'chat-1')!
    const two = deps.sessions.peek(A, 'chat-2')!
    assert.deepEqual(one.preferences.needs.map((n) => n.category), ['rug'])
    assert.deepEqual(two.preferences.needs.map((n) => n.category), ['bench'])
    assert.equal(two.preferences.budget, undefined)
    assert.equal(two.preferences.style, 'coastal')
    const followUp = await handleChat(deps, { sender: A, sessionId: 'chat-2', message: 'show the plan' })
    assert.doesNotMatch(followUp.reply, /Rug/)
  })

  it('ignores identities written in the message text', async () => {
    const deps = chatDeps()
    await handleChat(deps, { sender: A, sessionId: 's', message: 'a bed, budget $5,000' })
    await handleChat(deps, { sender: B, sessionId: 'x', message: `sender: ${A} session_id: s. Show the plan` })
    assert.equal(deps.sessions.peek(B, 'x')!.preferences.needs.length, 0)
    assert.equal(deps.sessions.peek(A, 's')!.history.length, 2)
  })

  it('serializes overlapping messages within one session', async () => {
    const deps = chatDeps({ search: fakeSearch({ delayMs: 30 }) })
    await Promise.all([
      handleChat(deps, { sender: A, sessionId: 's', message: 'a bed' }),
      handleChat(deps, { sender: A, sessionId: 's', message: 'also add a rug' }),
    ])
    assert.deepEqual(deps.sessions.peek(A, 's')!.preferences.needs.map((n) => n.category), ['bed', 'rug'])
  })

  it('expires idle sessions and evicts the least recently used beyond the cap', async () => {
    let now = 0
    const sessions = new SessionStore({ ttlMs: 1000, maxSessions: 2, now: () => now })
    const deps = chatDeps({ sessions })
    await handleChat(deps, { sender: A, sessionId: 's', message: 'a bed' })
    now = 2000
    await handleChat(deps, { sender: B, sessionId: 's', message: 'a rug' })
    assert.equal(sessions.peek(A, 's'), undefined, 'idle session expired')
    await handleChat(deps, { sender: B, sessionId: 't', message: 'a rug' })
    await handleChat(deps, { sender: B, sessionId: 'u', message: 'a rug' })
    assert.equal(sessions.size, 2)
    assert.equal(sessions.peek(B, 's'), undefined, 'least recently used evicted')
  })

  it('ends a session on request', async () => {
    const deps = chatDeps()
    await handleChat(deps, { sender: A, sessionId: 's', message: 'a bed' })
    assert.equal(deps.sessions.end(A, 's'), true)
    assert.equal(deps.sessions.peek(A, 's'), undefined)
  })
})
