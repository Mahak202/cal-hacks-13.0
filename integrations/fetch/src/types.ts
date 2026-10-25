import type { Category, Tier } from '../../../data/products'
import type { CostEstimate } from './pricing'

// 'live-listing': returned by a live Google Shopping search (via the existing
// Apify client), priced as listed at retrievedAt.
// 'demo-catalog': from data/products.ts. Illustrative names and prices only,
// not purchasable, never linked, and only used when the user opts in.
export type ListingSource = 'live-listing' | 'demo-catalog'

export type Candidate = {
  id: string
  category: Category
  name: string
  store: string
  price: number
  currency: 'USD'
  // false when the source did not report a currency (US-only search, so USD
  // is assumed and labelled as such).
  currencyReported: boolean
  url: string | null
  source: ListingSource
  // Internal ranking heuristic (higher is better); see candidates.ts.
  score: number
  tier?: Tier
  rating?: number
  reviewsCount?: number
  searchTerm?: string
  retrievedAt?: string
}

export type CategorySearch =
  | { status: 'ok'; searchTerm: string; retrievedAt: string; candidates: Candidate[]; excluded: number }
  | { status: 'empty'; searchTerm: string; retrievedAt: string; excluded: number }
  | { status: 'failed'; searchTerm: string; retrievedAt: string; error: string }

// keywords: item-specific search words (e.g. "jute" for the rug only).
export type Need = { category: Category; quantity: number; keywords?: string }

export type Preferences = {
  style?: string
  budget?: number
  needs: Need[]
  store?: string
  keywords?: string
  taxRate?: number
  // Categories the user explicitly allowed to use demo catalog prices.
  demoOptIn: Category[]
}

export type PlanLine = {
  category: Category
  quantity: number
  item: Candidate
  lineTotal: number
  pinned: boolean
  optionsConsidered: number
}

export type Tradeoff = { category: Category; preferred: Candidate; chosen: Candidate; saving: number }

// within_budget / over_budget: every requested category is priced.
// incomplete: some categories have no priced item, so feasibility can't be
// confirmed (unless the priced part alone already exceeds the budget, which
// is reported as over_budget).
export type PlanStatus = 'within_budget' | 'over_budget' | 'incomplete' | 'no_budget'

export type Plan = {
  status: PlanStatus
  lines: PlanLine[]
  costs: CostEstimate
  budget?: number
  // budget - estimated total of the priced lines; negative when over.
  difference?: number
  // 'exhaustive' = every combination of the options considered was accounted
  // for (branch and bound); 'heuristic' = the search hit its limit.
  searchMode: 'exhaustive' | 'heuristic'
  combinations: number
  unpriced: { category: Category; reason: string }[]
  tradeoffs: Tradeoff[]
  demoCount: number
  liveCount: number
  createdAt: string
}

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

export type SessionState = {
  sender: string
  sessionId: string
  createdAt: number
  updatedAt: number
  preferences: Preferences
  searches: Partial<Record<Category, CategorySearch>>
  pinned: Partial<Record<Category, string>>
  // Option order from the last comparison shown, so "option 2" is stable.
  lastComparison: Partial<Record<Category, string[]>>
  plan?: Plan
  history: HistoryTurn[]
}
