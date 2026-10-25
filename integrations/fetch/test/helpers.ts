import type { ShoppingResult } from '../../../server/apifyClient'
import type { ChatDeps } from '../src/chat'
import type { EngineDeps } from '../src/engine'
import { SearchCache, type ShoppingSearchFn } from '../src/liveSearch'
import type { ChatCompletionsClient } from '../src/asi1'
import type { LlmClient } from '../src/claude'
import { SessionStore } from '../src/sessions'

export const NOW = new Date('2026-10-24T12:00:00Z')

const item = (title: string, seller: string, price: number | null, extra: Partial<ShoppingResult> = {}): ShoppingResult => ({
  title,
  price,
  currency: 'USD',
  seller,
  rating: null,
  reviewsCount: null,
  oldPrice: null,
  availability: null,
  image: null,
  url: `https://shop.example/${encodeURIComponent(title)}`,
  scrapedAt: NOW.toISOString(),
  ...extra,
})

// Fake Google Shopping results keyed by the category label in the search term.
export const FIXTURES: Record<string, ShoppingResult[]> = {
  bed: [
    item('Oak Platform Bed', 'Article', 899, { rating: 4.7, reviewsCount: 1200 }),
    item('Low Pine Bed Frame', 'IKEA', 349, { rating: 4.2, reviewsCount: 800 }),
    item('Budget Metal Bed', 'Walmart', 189, { rating: 3.9, reviewsCount: 50 }),
  ],
  rug: [
    item('Hand-Woven Jute Rug 8x10', 'West Elm', 499, { rating: 4.6, reviewsCount: 300 }),
    item('Flatweave Jute Rug', 'IKEA', 149, { rating: 4.3, reviewsCount: 900 }),
    item('Imported Wool Rug', 'EuroShop', 120, { currency: 'EUR', rating: 4.9, reviewsCount: 10 }),
    item('Rug With No Price', 'Somewhere', null),
  ],
  'side table': [
    item('Walnut Side Table', 'Article', 229, { rating: 4.8, reviewsCount: 400 }),
    item('Round Side Table', 'IKEA', 59, { rating: 4.4, reviewsCount: 2000 }),
  ],
  bench: [item('Oak Bench', 'Article', 299, { rating: 4.5, reviewsCount: 90 })],
}

export type FakeSearch = ShoppingSearchFn & { calls: string[] }

export function fakeSearch(options: { fail?: string[]; empty?: string[]; delayMs?: number } = {}): FakeSearch {
  const calls: string[] = []
  const fn = async (term: string) => {
    calls.push(term)
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs))
    const label = Object.keys(FIXTURES).sort((a, b) => b.length - a.length).find((l) => term.includes(l))
    if (label && options.fail?.includes(label)) throw new Error('Apify shopping run failed: 502 upstream error (token=apify_api_SECRET123)')
    if (!label || options.empty?.includes(label)) return []
    return FIXTURES[label]
  }
  return Object.assign(fn, { calls })
}

export function engineDeps(search: ShoppingSearchFn = fakeSearch(), overrides: Partial<EngineDeps> = {}): EngineDeps {
  return { search, cache: new SearchCache(), timeoutMs: 2000, maxResults: 8, searchConcurrency: 3, now: () => NOW, ...overrides }
}

export function chatDeps(overrides: Partial<ChatDeps> & { search?: ShoppingSearchFn } = {}): ChatDeps {
  const { search, ...rest } = overrides
  return { engine: engineDeps(search), sessions: new SessionStore(), ...rest }
}

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }

// Scripted stand-in for the Anthropic client: returns queued responses and
// records every request so tests can inspect the tool results it was sent.
export function fakeLlm(script: Block[][]): LlmClient & { requests: any[] } {
  const requests: any[] = []
  return {
    requests,
    async create(params: Parameters<LlmClient['create']>[0]) {
      requests.push(structuredClone(params))
      const content = script.shift()
      if (!content) throw new Error('fake LLM script exhausted')
      const stop_reason = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
      return { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'test-model', content, stop_reason } as any
    },
  }
}

type Asi1Turn = { content?: string; toolCalls?: { id: string; name: string; arguments: string }[] }

// Scripted stand-in for the OpenAI-compatible ASI:One client.
export function fakeAsi1(script: Asi1Turn[]): ChatCompletionsClient & { requests: any[] } {
  const requests: any[] = []
  return {
    requests,
    async create(params: Parameters<ChatCompletionsClient['create']>[0]) {
      requests.push(structuredClone(params))
      const turn = script.shift()
      if (!turn) throw new Error('fake ASI:One script exhausted')
      const tool_calls = turn.toolCalls?.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } }))
      return {
        id: `chatcmpl_${requests.length}`,
        object: 'chat.completion',
        created: 0,
        model: params.model,
        choices: [{ index: 0, finish_reason: tool_calls ? 'tool_calls' : 'stop', logprobs: null, message: { role: 'assistant', content: turn.content ?? null, refusal: null, tool_calls } }],
      } as any
    },
  }
}
