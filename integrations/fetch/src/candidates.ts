import crypto from 'node:crypto'
import { products, type Category } from '../../../data/products'
import { styleMatch } from '../../../agents/mockAgents'
import type { ShoppingResult } from '../../../server/apifyClient'
import type { Candidate } from './types'

// Ranking heuristic: orders options and decides what to keep when the budget
// forces a trade-off. It is never presented to the user as a rating.
// - Live listings have no style data, so they rank on their real Google
//   Shopping rating and review volume; unrated listings get a neutral score.
// - Demo items use the web app's style-tag match plus a durability bonus.
// Ratings with few reviews are pulled toward a neutral 4.0 (as if 10 extra
// 4-star reviews existed), so one 5-star review can't outrank 4.4 from 94.
const PRIOR_RATING = 4
const PRIOR_REVIEWS = 10

export function liveScore(rating?: number, reviewsCount?: number): number {
  if (typeof rating !== 'number') return 65
  const n = Math.max(0, reviewsCount ?? 0)
  const adjusted = (rating * n + PRIOR_RATING * PRIOR_REVIEWS) / (n + PRIOR_REVIEWS)
  const ratingPart = Math.max(-20, Math.min(10, (adjusted - 4) * 10))
  const volumePart = Math.min(5, Math.log10(n + 1) * 2)
  return 70 + ratingPart + volumePart
}

const USD_CODES = new Set(['USD', 'US$', '$'])

export function liveCandidates(
  category: Category,
  results: ShoppingResult[],
  searchTerm: string,
  retrievedAt: string,
  storeFilter?: string,
): { candidates: Candidate[]; excluded: number } {
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  let excluded = 0
  for (const r of results) {
    const store = (r.seller ?? '').trim()
    const priced = typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0
    const usd = !r.currency || USD_CODES.has(r.currency.trim().toUpperCase())
    const storeOk = !storeFilter || store.toLowerCase().includes(storeFilter.toLowerCase())
    if (!priced || !usd || !storeOk || !r.title.trim()) {
      excluded++
      continue
    }
    const id = `live-${category}-${crypto.createHash('sha1').update(`${r.title}|${store}|${r.price}|${r.url ?? ''}`).digest('hex').slice(0, 8)}`
    if (seen.has(id)) {
      excluded++
      continue
    }
    seen.add(id)
    candidates.push({
      id,
      category,
      name: r.title.trim(),
      store: store || 'Unknown seller',
      price: r.price as number,
      currency: 'USD',
      currencyReported: !!r.currency,
      url: r.url || null,
      source: 'live-listing',
      score: liveScore(r.rating ?? undefined, r.reviewsCount ?? undefined),
      rating: r.rating ?? undefined,
      reviewsCount: r.reviewsCount ?? undefined,
      searchTerm,
      // When the source says it scraped the listing; reused cache entries keep
      // their original time rather than looking fresher than they are.
      retrievedAt: r.scrapedAt || retrievedAt,
    })
  }
  return { candidates, excluded }
}

// The web app's style names, which styleMatch() understands.
const APP_STYLES: Record<string, string> = {
  'wabi-sabi': 'Wabi-Sabi Warmth', japandi: 'Japandi Calm', 'mid-century': 'Warm Mid-Century', coastal: 'Coastal Light',
}

// Read-only view of the shared demo catalog. Filters out anything the web app
// may have merged in at runtime and never mutates `products`.
export function demoCandidates(category: Category, style: string): Candidate[] {
  const appStyle = APP_STYLES[style.toLowerCase()] ?? style
  return products
    .filter((p) => p.category === category && p.id === `${category}-${p.tier}`)
    .map((p) => ({
      id: `demo-${p.id}`,
      category,
      name: p.name,
      store: p.store,
      price: p.price,
      currency: 'USD' as const,
      currencyReported: true,
      url: null,
      source: 'demo-catalog' as const,
      score: styleMatch(p, appStyle) + p.durability * 2,
      tier: p.tier,
    }))
}
