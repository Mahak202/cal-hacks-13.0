import type { Category } from '../../../data/products'
import { searchShopping, type ShoppingResult } from '../../../server/apifyClient'
import { liveCandidates } from './candidates'
import type { CategorySearch } from './types'
import { CATEGORY_LABELS } from './vocabulary'

export type ShoppingSearchFn = (searchTerm: string, maxResults: number) => Promise<ShoppingResult[]>

// The existing Roomwise Apify client (server/apifyClient.ts), imported as-is.
export const apifyShoppingSearch: ShoppingSearchFn = (term, max) => searchShopping(term, max)

export type SearchOptions = { style?: string; store?: string; keywords?: string }

// Words appear once, case-insensitively ("japandi japandi bed" -> "japandi bed").
export function buildSearchTerm(category: Category, { style, store, keywords }: SearchOptions): string {
  const seen = new Set<string>()
  return [style, keywords, CATEGORY_LABELS[category], store]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter((word) => word && !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()))
    .join(' ')
}

// Shared keywords plus the item's own keywords.
export function itemKeywords(shared: string | undefined, item: string | undefined): string | undefined {
  return [shared, item].filter(Boolean).join(' ') || undefined
}

// Public search results only (no user data), shared across sessions for a
// short time so follow-up questions don't re-run the same paid search.
export class SearchCache {
  private entries = new Map<string, { at: number; results: ShoppingResult[] }>()
  constructor(
    private ttlMs = 15 * 60 * 1000,
    private now: () => number = Date.now,
  ) {}
  get(term: string): ShoppingResult[] | undefined {
    const hit = this.entries.get(term.toLowerCase())
    if (!hit) return undefined
    if (this.now() - hit.at > this.ttlMs) {
      this.entries.delete(term.toLowerCase())
      return undefined
    }
    return hit.results
  }
  set(term: string, results: ShoppingResult[]) {
    this.entries.set(term.toLowerCase(), { at: this.now(), results })
  }
}

export function redactError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message
    .replace(/token=[^&\s"')]+/gi, 'token=[redacted]')
    .replace(/apify_api_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Live search timed out after ${Math.round(ms / 1000)}s.`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export type LiveSearchDeps = {
  search: ShoppingSearchFn
  cache: SearchCache
  timeoutMs: number
  maxResults: number
  now: () => Date
}

export async function searchCategory(category: Category, options: SearchOptions, deps: LiveSearchDeps): Promise<CategorySearch> {
  const searchTerm = buildSearchTerm(category, options)
  const retrievedAt = deps.now().toISOString()
  let results = deps.cache.get(searchTerm)
  if (!results) {
    try {
      results = await withTimeout(deps.search(searchTerm, deps.maxResults), deps.timeoutMs)
    } catch (err) {
      return { status: 'failed', searchTerm, retrievedAt, error: redactError(err) }
    }
    if (!Array.isArray(results)) return { status: 'failed', searchTerm, retrievedAt, error: 'Live search returned an unexpected response.' }
    deps.cache.set(searchTerm, results)
  }
  const { candidates, excluded } = liveCandidates(category, results, searchTerm, retrievedAt, options.store)
  return candidates.length ? { status: 'ok', searchTerm, retrievedAt, candidates, excluded } : { status: 'empty', searchTerm, retrievedAt, excluded }
}
