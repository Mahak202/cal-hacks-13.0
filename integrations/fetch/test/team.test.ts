import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { SPECIALISTS } from '../src/roles'
import { createPlannerServer } from '../src/server'
import { appendHistory, conversationState, executeAsAgent, handleRoleChat, interpretForTeam, RoleError, toRoleCalls } from '../src/team'
import { chatDeps, fakeSearch } from './helpers'

const USER = { sender: 'agent1qasioneuser', sessionId: 'chat-1' }

describe('agent team operations', () => {
  it('only lets each agent run its own tools', async () => {
    const deps = chatDeps()
    await assert.rejects(executeAsAgent(deps, USER, 'design', { name: 'optimize_plan', input: {} }), RoleError)
    await assert.rejects(executeAsAgent(deps, USER, 'quotation', { name: 'finance_breakdown', input: {} }), /not allowed/)
    await assert.rejects(executeAsAgent(deps, USER, 'janitor', { name: 'get_quote', input: {} }), /Unknown agent role/)
    assert.equal(deps.sessions.peek(USER.sender, USER.sessionId), undefined, 'rejected calls never touch state')
  })

  it('runs the Design → Budget → Quotation → Finance pipeline on real results', async () => {
    const search = fakeSearch()
    const deps = chatDeps({ search })
    const brief = await executeAsAgent(deps, USER, 'design', { name: 'set_room_brief', input: { style: 'japandi', set_items: [{ category: 'bed' }, { category: 'rug' }] } })
    assert.equal(brief.ok, true)
    assert.equal(search.calls.length, 0, 'the brief alone does not search')
    assert.equal((await executeAsAgent(deps, USER, 'budget', { name: 'set_budget', input: { budget_usd: 1500 } })).ok, true)

    const noQuote = await executeAsAgent(deps, USER, 'quotation', { name: 'get_quote', input: {} })
    assert.equal(noQuote.ok, false)
    assert.match((noQuote as { error: string }).error, /No plan has been optimized/)

    const optimized = await executeAsAgent(deps, USER, 'budget', { name: 'optimize_plan', input: {} })
    assert.equal(optimized.ok, true)
    assert.deepEqual(search.calls.sort(), ['japandi bed', 'japandi rug'])
    assert.deepEqual(optimized.sections, [])

    const quote = await executeAsAgent(deps, USER, 'quotation', { name: 'get_quote', input: {} })
    assert.equal(quote.sections.length, 1)
    assert.match(quote.sections[0], /\*\*Roomwise shopping plan\*\*/)
    assert.match(quote.sections[0], /Budget: feasible on these estimates/)

    const finance = await executeAsAgent(deps, USER, 'finance', {
      name: 'finance_breakdown',
      input: { total_cap_usd: 1200, per_item_cap_usd: 500, allowed_stores: ['ikea', 'West Elm'] },
    })
    assert.equal(finance.ok, true)
    const text = finance.sections[0]
    assert.match(text, /\*\*Finance breakdown\*\* \(planning only: nothing is charged, reserved or ordered\)/)
    assert.match(text, /est\. order total USD/)
    // Plan: Oak Platform Bed (Article, 899) + Hand-Woven Jute Rug (West Elm, 499).
    assert.match(text, /NOT MET: Estimated total USD [\d,.]+ exceeds the USD 1,200\.00 cap/)
    assert.match(text, /NOT MET: Over the USD 500\.00 per-item cap: Oak Platform Bed \(USD 899\.00\)/)
    assert.match(text, /NOT MET: Not in your allowed stores \(IKEA, West Elm\): Article/)
  })

  it('applies item keywords to that item only and never repeats words in a search', async () => {
    const search = fakeSearch()
    const deps = chatDeps({ search })
    await executeAsAgent(deps, USER, 'design', {
      name: 'set_room_brief',
      input: { style: 'japandi', keywords: 'Japandi', set_items: [{ category: 'bed' }, { category: 'rug', keywords: 'jute' }] },
    })
    await executeAsAgent(deps, USER, 'budget', { name: 'optimize_plan', input: {} })
    assert.deepEqual(search.calls.sort(), ['japandi bed', 'japandi jute rug'])

    // Changing one item's keywords re-searches that item only.
    await executeAsAgent(deps, USER, 'design', { name: 'set_room_brief', input: { add_items: [{ category: 'rug', keywords: 'wool' }] } })
    await executeAsAgent(deps, USER, 'budget', { name: 'optimize_plan', input: {} })
    assert.deepEqual(search.calls.slice(2), ['japandi wool rug'])
    const quote = await executeAsAgent(deps, USER, 'quotation', { name: 'get_quote', input: {} })
    assert.match(quote.sections[0], /items: bed, rug \(wool\)/)
  })

  it('validates finance limits', async () => {
    const deps = chatDeps()
    const bad = await executeAsAgent(deps, USER, 'finance', { name: 'finance_breakdown', input: { per_item_cap_usd: -1 } })
    assert.equal(bad.ok, false)
    assert.match((bad as { error: string }).error, /per_item_cap_usd must be a number/)
    const unknown = await executeAsAgent(deps, USER, 'design', { name: 'set_room_brief', input: { budget_usd: 900 } })
    assert.match((unknown as { error: string }).error, /Unknown argument\(s\): budget_usd/, 'design cannot set the budget')
  })

  it('maps keyword interpretation onto the agents that own each step', async () => {
    assert.deepEqual(
      toRoleCalls([
        { name: 'update_preferences', input: { style: 'japandi', budget_usd: 900, set_items: [{ category: 'bed', quantity: 1 }] } },
        { name: 'build_plan', input: {} },
      ]),
      [
        { agent: 'design', name: 'set_room_brief', input: { style: 'japandi', set_items: [{ category: 'bed', quantity: 1 }] } },
        { agent: 'budget', name: 'set_budget', input: { budget_usd: 900 } },
        { agent: 'budget', name: 'optimize_plan', input: {} },
      ],
    )
    const deps = chatDeps()
    const names = async (message: string) => (await interpretForTeam(deps, USER, message)).calls.map((c) => `${c.agent}.${c.name}`)
    assert.deepEqual(await names('Japandi bed and a rug, budget $1,500'), ['design.set_room_brief', 'budget.set_budget', 'budget.optimize_plan'])
    assert.deepEqual(await names('compare rugs'), ['comparison.compare_alternatives'])
    assert.deepEqual(await names('split my plan by store'), ['budget.optimize_plan', 'finance.finance_breakdown'])
    const capped = (await interpretForTeam(deps, USER, 'Split my plan by store, max $600 per item')).calls
    assert.deepEqual(capped, [
      { agent: 'budget', name: 'optimize_plan', input: {} },
      { agent: 'finance', name: 'finance_breakdown', input: { per_item_cap_usd: 600 } },
    ], 'a per-item cap is not mistaken for a new budget')
    assert.deepEqual(await names('start over'), ['orchestrator.reset_session'])
  })

  it('keeps conversation context and history for the orchestrator', async () => {
    const deps = chatDeps()
    await executeAsAgent(deps, USER, 'design', { name: 'set_room_brief', input: { set_items: [{ category: 'bench' }] } })
    await appendHistory(deps, USER, 'a bench please', 'Added a bench.')
    const ctx = await conversationState(deps, USER)
    assert.match(ctx.state, /^Current conversation state/)
    assert.equal(ctx.itemCount, 1)
    assert.equal(ctx.hasPlan, false)
    assert.deepEqual(ctx.history, [
      { role: 'user', content: 'a bench please' },
      { role: 'assistant', content: 'Added a bench.' },
    ])
  })
})

describe('direct chat with one specialist', () => {
  const chat = (role: (typeof SPECIALISTS)[number], message: string, deps = chatDeps()) => handleRoleChat(deps, USER, role, message)

  it('each specialist does its own job', async () => {
    const design = await chat('design', 'japandi bedroom with a bed and a rug from IKEA')
    assert.match(design.reply, /^\*\*Roomwise Design agent\.\*\*/)
    assert.match(design.reply, /- bed: "japandi bed IKEA"/)

    const product = await chat('product', 'a japandi rug')
    assert.match(product.reply, /\*\*Rug listings\*\* for "japandi rug": 2 priced/)

    const comparison = await chat('comparison', 'compare japandi rugs')
    assert.match(comparison.reply, /\*\*Rug alternatives\*\*/)

    const quotation = await chat('quotation', 'a bed and a rug, budget $1,500')
    assert.match(quotation.reply, /\*\*Roomwise shopping plan\*\*/)

    const finance = await chat('finance', 'a bed and a rug, budget $1,500')
    assert.match(finance.reply, /\*\*Finance breakdown\*\* \(planning only/)
    assert.doesNotMatch(finance.reply, /Roomwise shopping plan/)
    assert.match(finance.reply, /chat with the Roomwise orchestrator agent/)
  })

  it('asks for items instead of guessing', async () => {
    const res = await chat('budget', 'hello')
    assert.match(res.reply, /Tell me the items you want/)
  })

  it('does not run other agents’ actions', async () => {
    const res = await chat('design', 'a bed, then choose option 2 for the bed')
    assert.equal(res.actions.some((a) => a.name === 'choose_product'), false)
  })
})

describe('agent team HTTP endpoints', () => {
  const KEY = 'team-test-key-0123456789-abcdef'
  const deps = chatDeps()
  const server = createPlannerServer(deps, { apiKey: KEY })
  let base = ''
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => server.close())
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) })
    return { status: res.status, body: (await res.json()) as any }
  }
  const who = { sender: 'agent1qhttpuser', session_id: 'abc-1' }

  it('executes, rejects wrong roles with 403, and validates input', async () => {
    const ok = await post('/v1/agent/execute', { ...who, agent: 'design', tool: 'set_room_brief', arguments: { set_items: [{ category: 'bed' }] } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.ok, true)
    const forbidden = await post('/v1/agent/execute', { ...who, agent: 'design', tool: 'get_quote', arguments: {} })
    assert.equal(forbidden.status, 403)
    assert.match(forbidden.body.error, /not allowed to run get_quote/)
    assert.equal((await post('/v1/agent/execute', { ...who, agent: 'design' })).status, 400)
    assert.equal((await post('/v1/agent/chat', { ...who, agent: 'orchestrator', message: 'hi' })).status, 400)
  })

  it('serves interpret, state, history and specialist chat', async () => {
    const interp = await post('/v1/agent/interpret', { ...who, message: 'compare rugs' })
    assert.deepEqual(interp.body.calls, [{ agent: 'comparison', name: 'compare_alternatives', input: { category: 'rug' } }])
    assert.equal((await post('/v1/agent/history', { ...who, user: 'hi', assistant: 'hello' })).body.ok, true)
    const state = await post('/v1/agent/state', who)
    assert.equal(state.body.history.length, 2)
    const chat = await post('/v1/agent/chat', { ...who, agent: 'product', message: 'a bed' })
    assert.match(chat.body.reply, /Roomwise Product agent/)
  })
})
