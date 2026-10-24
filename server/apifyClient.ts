const APIFY_BASE = 'https://api.apify.com/v2'

function requireToken(): string {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('Missing APIFY_TOKEN. Add it to .env (see .env.example).')
  return token
}

export type RagBrowserInput = {
  // A search phrase to search the web, OR a direct URL to fetch that page.
  query: string
  maxResults?: number
}

export type RagBrowserItem = {
  markdown?: string
  metadata?: {
    title?: string
    description?: string
    url?: string
    openGraph?: { property: string; content: string }[]
  }
}

export function ogImage(item: RagBrowserItem): string {
  return item.metadata?.openGraph?.find((og) => og.property === 'og:image')?.content || ''
}

// apify/rag-web-browser: pass a search phrase (DuckDuckGo/Google) in `query`
// to search, or a direct URL in `query` to fetch that page. Either way each
// result item carries metadata.{title,description,url} and a markdown body.
// Note: explicitly passing outputFormats breaks the response (markdown comes
// back empty) — omit it and take the actor's default.
export async function runRagWebBrowser(input: RagBrowserInput): Promise<RagBrowserItem[]> {
  const token = requireToken()
  const res = await fetch(`${APIFY_BASE}/actors/apify~rag-web-browser/run-sync-get-dataset-items?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxResults: 5, ...input }),
  })
  if (!res.ok) throw new Error(`Apify run failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<RagBrowserItem[]>
}

// akash9078/ai-image-generator: $0.001/image, FLUX-based, returns a ready
// data: URL directly in imageBase64 — no separate mimeType wrapping needed.
export async function generateProductImage(prompt: string): Promise<{ dataUrl: string }> {
  const token = requireToken()
  const res = await fetch(`${APIFY_BASE}/actors/akash9078~ai-image-generator/run-sync-get-dataset-items?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ratio: '1:1' }),
  })
  if (!res.ok) throw new Error(`Apify image run failed: ${res.status} ${await res.text()}`)
  const [item] = (await res.json()) as { ok?: boolean; imageBase64?: string; error?: string }[]
  if (!item?.ok || !item.imageBase64) throw new Error(item?.error || 'Apify image generator returned no image.')
  return { dataUrl: item.imageBase64 }
}

export type ShoppingResult = {
  title: string
  price: number | null
  oldPrice: number | null
  currency: string | null
  seller: string | null
  rating: number | null
  reviewsCount: number | null
  availability: string | null
  image: string | null
  url: string | null
  scrapedAt: string
}

// cheapapi/google-shopping-scraper: queries Google's own Shopping index
// rather than crawling retailer sites directly — real structured price/
// rating/seller per product, and it routinely surfaces listings (e.g.
// Wayfair) that block direct scraping outright.
export async function searchShopping(searchTerm: string, maxResults = 8): Promise<ShoppingResult[]> {
  const token = requireToken()
  const res = await fetch(`${APIFY_BASE}/actors/cheapapi~google-shopping-scraper/run-sync-get-dataset-items?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'search', searchTerms: [searchTerm], maxProductsPerSearch: maxResults, country: 'US' }),
  })
  if (!res.ok) throw new Error(`Apify shopping run failed: ${res.status} ${await res.text()}`)
  const items = (await res.json()) as any[]
  const scrapedAt = new Date().toISOString()
  return items.map((it) => ({
    title: it.title ?? '',
    price: typeof it.price === 'number' ? it.price : null,
    oldPrice: typeof it.oldPrice === 'number' ? it.oldPrice : null,
    currency: it.currency ?? null,
    seller: it.seller ?? null,
    rating: typeof it.rating === 'number' ? it.rating : null,
    reviewsCount: typeof it.reviewsCount === 'number' ? it.reviewsCount : null,
    availability: it.condition ?? it.delivery ?? null,
    image: it.image ?? null,
    url: it.googleShoppingUrl ?? it.url ?? null,
    scrapedAt: it.scrapedAt ?? scrapedAt,
  }))
}
