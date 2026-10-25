import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleChat } from '../src/chat'
import { asi1Interpreter } from '../src/asi1'
import { claudeInterpreter } from '../src/claude'
import { chatDeps, fakeAsi1, fakeLlm, fakeSearch } from './helpers'

const A = 'agent1qalice'

describe('Claude interpreter (scripted fake client)', () => {
  it('executes validated tool calls, returns real results to the model, and renders the plan', async () => {
    const llm = fakeLlm([
      [
        { type: 'text', text: 'Setting that up.' },
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'update_preferences',
          input: { style: 'Japandi', budget_usd: 1300, set_items: [{ category: 'bed' }, { category: 'rug' }, { category: 'sideTables', quantity: 2 }] },
        },
        { type: 'tool_use', id: 'tu_2', name: 'build_plan', input: {} },
      ],
      [{ type: 'text', text: 'Here is a Japandi plan that fits your budget.' }],
    ])
    const search = fakeSearch()
    const deps = chatDeps({ interpreter: claudeInterpreter(llm, 'test-model'), search })
    const res = await handleChat(deps, { sender: A, sessionId: 's1', message: 'Japandi bedroom, bed + rug + two side tables, $1300 all-in' })

    assert.equal(res.interpreter, 'claude')
    assert.deepEqual(res.actions.map((a) => [a.name, a.ok]), [['update_preferences', true], ['build_plan', true]])
    assert.equal(search.calls.length, 3, 'searches really ran')
    assert.match(res.reply, /^Here is a Japandi plan that fits your budget\.\n\n\*\*Roomwise shopping plan\*\*/)
    assert.match(res.reply, /Budget: feasible on these estimates/)

    // The second request carried the actual execution results back to the model.
    const toolResults = llm.requests[1].messages.at(-1).content
    assert.deepEqual(toolResults.map((r: any) => [r.tool_use_id, r.is_error]), [['tu_1', false], ['tu_2', false]])
    const plan = JSON.parse(toolResults[1].content)
    assert.equal(plan.status, 'within_budget')
    assert.equal(plan.lines.length, 3)
    assert.ok(plan.costs.estimatedTotal <= 1300)

    // Request shape: default model override, low effort, server-side fallback.
    const req = llm.requests[0]
    assert.equal(req.model, 'test-model')
    assert.deepEqual(req.output_config, { effort: 'low' })
    assert.equal(req.fallbacks, 'default')
    assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01'])
  })

  it('returns validation errors to the model as is_error results and lets it correct them', async () => {
    const llm = fakeLlm([
      [{ type: 'tool_use', id: 'bad', name: 'update_preferences', input: { budget_usd: 'lots', set_items: [{ category: 'sofa' }] } }],
      [
        { type: 'tool_use', id: 'good', name: 'update_preferences', input: { set_items: [{ category: 'bench' }] } },
        { type: 'tool_use', id: 'plan', name: 'build_plan', input: {} },
      ],
      [{ type: 'text', text: 'Sofas aren’t supported yet, so I planned the bench.' }],
    ])
    const deps = chatDeps({ interpreter: claudeInterpreter(llm, 'test-model') })
    const res = await handleChat(deps, { sender: A, sessionId: 's1', message: 'a sofa and a bench' })
    const first = llm.requests[1].messages.at(-1).content[0]
    assert.equal(first.is_error, true)
    assert.match(JSON.parse(first.content).error, /budget_usd must be a number/)
    assert.match(res.reply, /\*\*Bench\*\*: Oak Bench/)
    assert.doesNotMatch(res.reply, /Not done/, 'a failure later fixed by a successful call is not reported as outstanding')
  })

  it('reports failed actions even if the model claims success', async () => {
    const llm = fakeLlm([
      [{ type: 'tool_use', id: 'c', name: 'choose_product', input: { category: 'rug', option_number: 3 } }],
      [{ type: 'text', text: 'Done, the rug is locked in!' }],
    ])
    const res = await handleChat(chatDeps({ interpreter: claudeInterpreter(llm, 'test-model') }), { sender: A, sessionId: 's1', message: 'lock rug option 3' })
    assert.match(res.reply, /Not done: No rug comparison has been shown/)
  })

  it('builds the plan itself if the model changed preferences but forgot to plan', async () => {
    const llm = fakeLlm([
      [{ type: 'tool_use', id: 'p', name: 'update_preferences', input: { set_items: [{ category: 'bed' }] } }],
      [{ type: 'text', text: 'Noted.' }],
    ])
    const res = await handleChat(chatDeps({ interpreter: claudeInterpreter(llm, 'test-model') }), { sender: A, sessionId: 's1', message: 'a bed' })
    assert.deepEqual(res.actions.map((a) => a.name), ['update_preferences', 'build_plan'])
    assert.match(res.reply, /\*\*Bed\*\*:/)
  })

  it('falls back to the keyword interpreter when the LLM call fails', async () => {
    const llm = { async create(): Promise<never> { throw new Error('API down') } }
    const logged: string[] = []
    const res = await handleChat(chatDeps({ interpreter: claudeInterpreter(llm, 'test-model'), log: (m) => logged.push(m) }), { sender: A, sessionId: 's1', message: 'a bed, budget $5,000' })
    assert.equal(res.interpreter, 'keyword')
    assert.equal(res.planStatus, 'within_budget')
    assert.equal(logged.length, 1)
  })

  it('sends prior turns of the same conversation as history', async () => {
    const llm = fakeLlm([[{ type: 'text', text: 'Which items?' }], [{ type: 'text', text: 'Sure.' }]])
    const deps = chatDeps({ interpreter: claudeInterpreter(llm, 'test-model') })
    await handleChat(deps, { sender: A, sessionId: 's1', message: 'hello' })
    await handleChat(deps, { sender: A, sessionId: 's1', message: 'just browsing' })
    const msgs = llm.requests[1].messages
    assert.deepEqual(msgs.slice(0, 2), [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Which items?' },
    ])
    assert.match(msgs[2].content[0].text, /^Current conversation state/)
  })
})

describe('ASI:One interpreter (scripted fake OpenAI-compatible client)', () => {
  it('executes tool calls and sends the actual results back as tool messages', async () => {
    const client = fakeAsi1([
      {
        toolCalls: [
          { id: 'call_1', name: 'update_preferences', arguments: JSON.stringify({ style: 'coastal', budget_usd: 2500, set_items: [{ category: 'bed' }, { category: 'bench' }] }) },
          { id: 'call_2', name: 'build_plan', arguments: '{}' },
        ],
      },
      { content: 'Here is a coastal plan for your bed and bench.' },
    ])
    const search = fakeSearch()
    const res = await handleChat(chatDeps({ interpreter: asi1Interpreter(client), search }), { sender: A, sessionId: 's1', message: 'coastal bed and bench, $2500' })

    assert.equal(res.interpreter, 'asi1')
    assert.deepEqual(res.actions.map((a) => [a.name, a.ok]), [['update_preferences', true], ['build_plan', true]])
    assert.deepEqual(search.calls.sort(), ['coastal bed', 'coastal bench'])
    assert.match(res.reply, /^Here is a coastal plan for your bed and bench\.\n\n\*\*Roomwise shopping plan\*\*/)

    const first = client.requests[0]
    assert.equal(first.model, 'asi1')
    assert.equal(first.tool_choice, 'auto')
    assert.equal(first.messages[0].role, 'system')
    assert.match(first.messages[0].content, /You are Roomwise, an interior-design shopping planner/)
    assert.deepEqual(first.tools.map((t: any) => t.function.name).slice(0, 2), ['update_preferences', 'build_plan'])

    const followUp = client.requests[1].messages
    const toolMessages = followUp.filter((m: any) => m.role === 'tool')
    assert.deepEqual(toolMessages.map((m: any) => m.tool_call_id), ['call_1', 'call_2'])
    const plan = JSON.parse(toolMessages[1].content)
    assert.equal(plan.status, 'within_budget')
    assert.deepEqual(plan.lines.map((l: any) => l.category), ['bed', 'bench'])
  })

  it('rejects malformed JSON and invalid arguments, letting the model correct itself', async () => {
    const client = fakeAsi1([
      { toolCalls: [{ id: 'bad_json', name: 'update_preferences', arguments: '{"set_items": [' }] },
      { toolCalls: [{ id: 'bad_args', name: 'update_preferences', arguments: JSON.stringify({ set_items: [{ category: 'sofa' }] }) }] },
      { toolCalls: [{ id: 'ok', name: 'update_preferences', arguments: JSON.stringify({ set_items: [{ category: 'rug' }] }) }, { id: 'plan', name: 'build_plan', arguments: '' }] },
      { content: 'Sofas are not supported yet, so I planned the rug.' },
    ])
    const res = await handleChat(chatDeps({ interpreter: asi1Interpreter(client) }), { sender: A, sessionId: 's1', message: 'a sofa and a rug' })
    const errors = (i: number) => client.requests[i].messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content).error)
    assert.deepEqual(errors(1), ['Arguments were not valid JSON.'])
    assert.match(errors(2)[1], /category must be one of/)
    assert.match(res.reply, /\*\*Rug\*\*: Hand-Woven Jute Rug/)
    assert.doesNotMatch(res.reply, /Not done/)
  })

  it('falls back to the keyword interpreter when ASI:One fails', async () => {
    const client = { async create(): Promise<never> { throw new Error('401 invalid api key') } }
    const res = await handleChat(chatDeps({ interpreter: asi1Interpreter(client) }), { sender: A, sessionId: 's1', message: 'a rug, budget $900' })
    assert.equal(res.interpreter, 'keyword')
    assert.equal(res.planStatus, 'within_budget')
  })
})
