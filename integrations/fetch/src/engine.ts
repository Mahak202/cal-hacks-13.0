import type { Category } from '../../../data/products'
import { demoCandidates } from './candidates'
import { itemKeywords, searchCategory, type LiveSearchDeps } from './liveSearch'
import { optimizePlan } from './optimizer'
import { roundCents } from './pricing'
import { emptySession } from './sessions'
import type { Candidate, CategorySearch, Need, Plan, SessionState } from './types'

export type EngineDeps = LiveSearchDeps & { searchConcurrency: number }

export type PreferenceUpdate = {
  style?: string | null
  budget?: number | null
  setItems?: Need[]
  addItems?: Need[]
  removeItems?: Category[]
  store?: string | null
  keywords?: string | null
  taxRatePercent?: number | null
}

export type OperationError = { error: string }

export function isError(value: unknown): value is OperationError {
  return typeof value === 'object' && value !== null && 'error' in value
}

export function resetSession(state: SessionState) {
  const fresh = emptySession(state.sender, state.sessionId, state.updatedAt)
  Object.assign(state, { ...fresh, createdAt: state.createdAt })
}

export function updatePreferences(state: SessionState, update: PreferenceUpdate): { changed: string[] } {
  const prefs = state.preferences
  const changed: string[] = []
  let searchTermsChanged = false
  const setText = (key: 'style' | 'store' | 'keywords', value: string | null | undefined) => {
    if (value === undefined) return
    const next = value ?? undefined
    if ((prefs[key] ?? undefined) === next) return
    prefs[key] = next
    changed.push(key)
    searchTermsChanged = true
  }
  setText('style', update.style)
  setText('store', update.store)
  setText('keywords', update.keywords)
  if (update.budget !== undefined && (update.budget ?? undefined) !== prefs.budget) {
    prefs.budget = update.budget ?? undefined
    changed.push('budget')
  }
  if (update.taxRatePercent !== undefined) {
    const rate = update.taxRatePercent === null ? undefined : update.taxRatePercent / 100
    if (rate !== prefs.taxRate) {
      prefs.taxRate = rate
      changed.push('taxRate')
    }
  }
  const keywordsBefore = new Map(prefs.needs.map((n) => [n.category, n.keywords ?? '']))
  if (update.setItems) {
    prefs.needs = dedupeNeeds(update.setItems)
    changed.push('items')
  }
  if (update.addItems?.length) {
    const needs = [...prefs.needs]
    for (const item of update.addItems) {
      const existing = needs.findIndex((n) => n.category === item.category)
      if (existing >= 0) needs[existing] = item
      else needs.push(item)
    }
    prefs.needs = needs
    changed.push('items')
  }
  if (update.removeItems?.length) {
    prefs.needs = prefs.needs.filter((n) => !update.removeItems!.includes(n.category))
    for (const category of update.removeItems) {
      delete state.pinned[category]
      prefs.demoOptIn = prefs.demoOptIn.filter((c) => c !== category)
    }
    changed.push('items')
  }
  // Style/store/keyword changes alter every search term: earlier results and
  // choices made from them no longer apply.
  if (searchTermsChanged) {
    state.searches = {}
    state.lastComparison = {}
    for (const [category, id] of Object.entries(state.pinned)) if (id?.startsWith('live-')) delete state.pinned[category as Category]
  }
  // An item whose own keywords changed needs a fresh search for that item only.
  for (const need of prefs.needs) {
    const before = keywordsBefore.get(need.category)
    if (before !== undefined && before !== (need.keywords ?? '')) {
      delete state.searches[need.category]
      delete state.lastComparison[need.category]
      if (state.pinned[need.category]?.startsWith('live-')) delete state.pinned[need.category]
    }
  }
  return { changed: [...new Set(changed)] }
}

function dedupeNeeds(needs: Need[]): Need[] {
  const map = new Map<Category, Need>()
  for (const need of needs) map.set(need.category, need)
  return [...map.values()]
}

export async function runSearch(state: SessionState, category: Category, deps: EngineDeps, overrides: { store?: string; keywords?: string } = {}): Promise<CategorySearch> {
  const prefs = state.preferences
  const need = prefs.needs.find((n) => n.category === category)
  const keywords = itemKeywords(prefs.keywords, overrides.keywords ?? need?.keywords)
  const search = await searchCategory(category, { style: prefs.style, store: overrides.store ?? prefs.store, keywords }, deps)
  state.searches[category] = search
  delete state.lastComparison[category]
  const pin = state.pinned[category]
  if (pin?.startsWith('live-') && !(search.status === 'ok' && search.candidates.some((c) => c.id === pin))) delete state.pinned[category]
  return search
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// Searches every category that has no result yet. Failed searches are
// retried (failures are usually transient); empty results are not.
export async function ensureSearches(state: SessionState, categories: Category[], deps: EngineDeps): Promise<Category[]> {
  const pending = categories.filter((c) => !state.searches[c] || state.searches[c]!.status === 'failed')
  await mapLimit(pending, deps.searchConcurrency, (c) => runSearch(state, c, deps))
  return pending
}

export function poolFor(state: SessionState, category: Category): { pool: Candidate[]; reason?: string } {
  const search = state.searches[category]
  if (search?.status === 'ok') return { pool: search.candidates }
  const reason = !search
    ? 'Not searched yet.'
    : search.status === 'failed'
      ? `Live search failed: ${search.error}${/[.!?]$/.test(search.error) ? '' : '.'}`
      : `Live search for "${search.searchTerm}" returned no usable USD-priced listings${search.excluded ? ` (${search.excluded} excluded)` : ''}.`
  // Demo prices only ever stand in for a missing live result when the user
  // explicitly opted in for this category.
  if (state.preferences.demoOptIn.includes(category)) return { pool: demoCandidates(category, state.preferences.style ?? ''), reason }
  return { pool: [], reason }
}

export async function buildPlan(state: SessionState, deps: EngineDeps): Promise<Plan | OperationError> {
  const needs = state.preferences.needs
  if (!needs.length) return { error: 'No furniture items have been requested yet, so there is nothing to plan.' }
  await ensureSearches(state, needs.map((n) => n.category), deps)
  const pools: Partial<Record<Category, Candidate[]>> = {}
  const unpricedReasons: Partial<Record<Category, string>> = {}
  for (const { category } of needs) {
    const { pool, reason } = poolFor(state, category)
    pools[category] = pool
    if (reason) unpricedReasons[category] = reason
  }
  const plan = optimizePlan({
    needs,
    pools,
    unpricedReasons,
    pinned: state.pinned,
    budget: state.preferences.budget,
    taxRate: state.preferences.taxRate,
    now: deps.now(),
  })
  state.plan = plan
  return plan
}

export type ComparisonOption = {
  option: number
  id: string
  name: string
  store: string
  price: number
  currency: 'USD'
  currencyReported: boolean
  url: string | null
  source: Candidate['source']
  rating?: number
  reviewsCount?: number
  inPlan: boolean
  differenceVsPlan?: number
}

export type Comparison = {
  category: Category
  search: Pick<CategorySearch, 'status' | 'searchTerm' | 'retrievedAt'> & { error?: string }
  options: ComparisonOption[]
  totalAvailable: number
  demoReference: ComparisonOption[]
}

export async function compareCategory(state: SessionState, category: Category, deps: EngineDeps, maxResults = 5, includeDemoReference = false): Promise<Comparison> {
  if (!state.searches[category] || state.searches[category]!.status === 'failed') await runSearch(state, category, deps)
  const search = state.searches[category]!
  const inPlan = state.plan?.lines.find((l) => l.category === category)?.item
  const toOption = (c: Candidate, i: number): ComparisonOption => ({
    option: i + 1,
    id: c.id,
    name: c.name,
    store: c.store,
    price: c.price,
    currency: c.currency,
    currencyReported: c.currencyReported,
    url: c.url,
    source: c.source,
    rating: c.rating,
    reviewsCount: c.reviewsCount,
    inPlan: inPlan?.id === c.id,
    differenceVsPlan: inPlan && inPlan.id !== c.id ? roundCents(c.price - inPlan.price) : undefined,
  })
  const { pool } = poolFor(state, category)
  const ranked = [...pool].sort((a, b) => b.score - a.score || a.price - b.price)
  const options = ranked.slice(0, maxResults).map(toOption)
  state.lastComparison[category] = options.map((o) => o.id)
  const demoReference = includeDemoReference && pool[0]?.source !== 'demo-catalog' ? demoCandidates(category, state.preferences.style ?? '').map((c, i) => toOption(c, i)) : []
  return {
    category,
    search: { status: search.status, searchTerm: search.searchTerm, retrievedAt: search.retrievedAt, error: search.status === 'failed' ? search.error : undefined },
    options,
    totalAvailable: pool.length,
    demoReference,
  }
}

export function chooseProduct(state: SessionState, category: Category, choice: { productId?: string; optionNumber?: number }): Candidate | OperationError {
  let id = choice.productId
  if (choice.optionNumber !== undefined) {
    const shown = state.lastComparison[category]
    if (!shown?.length) return { error: `No ${category} comparison has been shown in this conversation yet, so there is no option ${choice.optionNumber} to choose.` }
    id = shown[choice.optionNumber - 1]
    if (!id) return { error: `Option ${choice.optionNumber} doesn't exist; the last ${category} comparison showed ${shown.length} option(s).` }
  }
  const { pool } = poolFor(state, category)
  const item = pool.find((c) => c.id === id)
  if (!item) return { error: `Product "${id}" is not among the current ${category} options in this conversation.` }
  state.pinned[category] = item.id
  return item
}

export function clearChoice(state: SessionState, category: Category): boolean {
  const had = category in state.pinned
  delete state.pinned[category]
  return had
}

export function setDemoOptIn(state: SessionState, categories: Category[], enabled: boolean): Category[] {
  const set = new Set(state.preferences.demoOptIn)
  for (const c of categories) {
    if (enabled) set.add(c)
    else {
      set.delete(c)
      if (state.pinned[c]?.startsWith('demo-')) delete state.pinned[c]
    }
  }
  state.preferences.demoOptIn = [...set]
  return state.preferences.demoOptIn
}
