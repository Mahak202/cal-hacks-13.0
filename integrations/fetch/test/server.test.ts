import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { readConfig } from '../src/config'
import { createPlannerServer } from '../src/server'
import { chatDeps } from './helpers'

const KEY = 'test-key-0123456789-abcdefghij'

describe('planner HTTP API', () => {
  const deps = chatDeps()
  const server = createPlannerServer(deps, { apiKey: KEY, status: () => ({ liveSearchConfigured: false }) })
  let base = ''
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => server.close())

  const post = (path: string, body: unknown, key: string | null = KEY) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  it('serves an unauthenticated health check without details', async () => {
    const res = await fetch(`${base}/healthz`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })

  it('requires the bearer key', async () => {
    assert.equal((await post('/v1/chat', { sender: 'agent1qa', session_id: 's', message: 'a bed' }, null)).status, 401)
    assert.equal((await post('/v1/chat', { sender: 'agent1qa', session_id: 's', message: 'a bed' }, 'wrong')).status, 401)
    assert.equal((await fetch(`${base}/v1/status`)).status, 401)
  })

  it('rejects invalid input', async () => {
    const cases: [unknown, RegExp][] = [
      ['not json', /valid JSON/],
      [[1, 2], /JSON object/],
      [{ session_id: 's', message: 'hi' }, /sender must be/],
      [{ sender: 'agent1q a', session_id: 's', message: 'hi' }, /sender must be/],
      [{ sender: 'agent1qa', session_id: '../etc', message: 'hi' }, /session_id must be/],
      [{ sender: 'agent1qa', session_id: 's', message: 42 }, /message must be text/],
      [{ sender: 'agent1qa', session_id: 's', message: '   ' }, /must not be empty/],
      [{ sender: 'agent1qa', session_id: 's', message: 'x'.repeat(4001) }, /at most 4000/],
    ]
    for (const [body, pattern] of cases) {
      const res = await post('/v1/chat', body)
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60))
      assert.match(((await res.json()) as { error: string }).error, pattern)
    }
    assert.equal((await post('/v1/chat', { sender: 'a', session_id: 's', message: 'x'.repeat(70_000) })).status, 413)
    assert.equal((await post('/v1/nope', {})).status, 404)
  })

  it('runs a chat turn and ends the session', async () => {
    const res = await post('/v1/chat', { sender: 'agent1qa', session_id: 'abc-123', message: 'a bed, budget $5,000' })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { planStatus: string; reply: string }
    assert.equal(body.planStatus, 'within_budget')
    assert.match(body.reply, /Roomwise shopping plan/)
    assert.ok(deps.sessions.peek('agent1qa', 'abc-123'))

    const status = (await (await fetch(`${base}/v1/status`, { headers: { Authorization: `Bearer ${KEY}` } })).json()) as { sessions: number }
    assert.equal(status.sessions, 1)

    const ended = await post('/v1/sessions/end', { sender: 'agent1qa', session_id: 'abc-123' })
    assert.deepEqual(await ended.json(), { ended: true })
    assert.equal(deps.sessions.peek('agent1qa', 'abc-123'), undefined)
  })
})

describe('readConfig', () => {
  it('requires a strong API key and validates numbers', () => {
    assert.throws(() => readConfig({}), /ROOMWISE_PLANNER_API_KEY/)
    assert.throws(() => readConfig({ ROOMWISE_PLANNER_API_KEY: KEY, ROOMWISE_PLANNER_PORT: 'abc' }), /ROOMWISE_PLANNER_PORT/)
    const config = readConfig({ ROOMWISE_PLANNER_API_KEY: KEY })
    assert.equal(config.host, '127.0.0.1')
    assert.equal(config.port, 8787)
    assert.equal(config.liveSearchConfigured, false)
    assert.deepEqual(config.interpreter, { provider: 'keyword' })
  })

  it('selects the LLM interpreter: ASI:One first in auto mode, then Claude', () => {
    const base = { ROOMWISE_PLANNER_API_KEY: KEY }
    assert.deepEqual(readConfig({ ...base, ASI1_API_KEY: 'a', ANTHROPIC_API_KEY: 'c' }).interpreter, { provider: 'asi1', apiKey: 'a', model: 'asi1', baseUrl: 'https://api.asi1.ai/v1' })
    assert.deepEqual(readConfig({ ...base, ANTHROPIC_API_KEY: 'c' }).interpreter, { provider: 'claude', apiKey: 'c', model: 'claude-opus-5-5' })
    assert.deepEqual(readConfig({ ...base, ASI1_API_KEY: 'a', ROOMWISE_LLM_PROVIDER: 'keyword' }).interpreter, { provider: 'keyword' })
    assert.throws(() => readConfig({ ...base, ROOMWISE_LLM_PROVIDER: 'asi1' }), /needs ASI1_API_KEY/)
    assert.throws(() => readConfig({ ...base, ROOMWISE_LLM_PROVIDER: 'gpt' }), /must be auto, asi1, claude or keyword/)
  })
})
