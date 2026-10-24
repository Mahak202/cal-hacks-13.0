import type { Category } from '../data/products'

export type LiveProduct = {
  id: string; name: string; category: Category; store: string
  price: number; url: string; imageUrl: string; source: 'apify-live'
  rating?: number; reviewsCount?: number
  originalPrice?: number | null; availability?: string; scrapedAt?: string
}
export type LiveSearchResult = { products: LiveProduct[]; warnings: string[] }

export async function fetchLiveProducts(category: Category, style: string, stores?: string[], query?: string): Promise<LiveSearchResult> {
  const res = await fetch('/api/apify/search-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, style, stores, query }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Live product search failed: ${res.status}`)
  const body = await res.json()
  return { products: body.products || [], warnings: body.meta?.warnings || [] }
}

export type Inspiration = { title: string | null; description: string | null; text: string }

export async function fetchInspiration(url: string): Promise<Inspiration> {
  const res = await fetch('/api/apify/inspiration', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Inspiration scrape failed: ${res.status}`)
  return res.json()
}
