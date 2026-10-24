import type { Category } from '../data/products'

export type LiveProduct = {
  id: string; name: string; category: Category; store: string
  price: number; url: string; imageUrl: string; source: 'apify-live'
}

export async function fetchLiveProducts(category: Category, style: string, store?: string): Promise<LiveProduct[]> {
  const res = await fetch('/api/apify/search-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, style, store }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Live product search failed: ${res.status}`)
  return (await res.json()).products
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
