import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import { runRagWebBrowser, generateProductImage, searchShopping, type ShoppingResult } from './apifyClient'
import { createSandboxPayment, refundSandboxPayment } from './cybersourceClient'
import { runAgentCommand } from './claudeAgent'
import { analyzeProductImage } from './openRouterClient'

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const CATEGORY_LABELS: Record<string, string> = {
  bed: 'bed', rug: 'rug', pendants: 'pendant lights', sideTables: 'side table',
  bench: 'bench', planter: 'planter', artwork: 'wall art',
}

// Store filtering happens post-hoc against the real `seller` field since the
// Google Shopping Scraper has no site-scoping input — appending the store
// name to the search term biases results toward it, then we filter.
async function searchOneStore(baseTerm: string, store: string): Promise<ShoppingResult[]> {
  const results = await searchShopping(`${baseTerm} ${store}`.trim(), 8)
  return results.filter((r) => r.seller?.toLowerCase().includes(store.toLowerCase()))
}

function idFromUrl(category: string, url: string, fallback: string): string {
  // A real hash, not a truncated base64 encoding — these URLs commonly
  // share a long identical prefix (same Google Shopping search base), so
  // truncating the encoded string instead of hashing it collided every
  // product in a result set onto the same id.
  const key = url || fallback
  const hash = crypto.createHash('sha1').update(key).digest('base64url').slice(0, 16)
  return `live-${category}-${hash}`
}

async function searchProducts({ category, style, stores, store, query }: { category: string; style: string; stores?: string[]; store?: string; query?: string }) {
  const label = CATEGORY_LABELS[category] || category
  const baseTerm = (query || `${style} ${label}`).trim()
  const selectedStores = stores?.length ? stores : store ? [store] : undefined

  let raw: ShoppingResult[] = []
  const warnings: string[] = []
  if (selectedStores) {
    // One scoped search per selected retailer, in parallel — each store gets
    // a genuine chance to surface instead of one combined query possibly
    // missing some of them entirely.
    const outcomes = await Promise.allSettled(selectedStores.map((s) => searchOneStore(baseTerm, s)))
    outcomes.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') raw.push(...outcome.value)
      else warnings.push(`${selectedStores[i]} search failed: ${outcome.reason?.message || 'unknown error'}`)
    })
  } else {
    raw = await searchShopping(baseTerm, 8)
  }

  const priced = raw.filter((r) => r.price !== null && r.url)
  // Dedupe by original product URL (the same real item can surface from
  // multiple search terms), then sort cheapest-first.
  const deduped = [...new Map(priced.map((r) => [r.url as string, r])).values()]
  deduped.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))

  const products = deduped.map((r, i) => ({
    id: idFromUrl(category, r.url || '', `${i}-${Date.now()}`),
    name: r.title,
    category,
    store: r.seller || 'Web',
    price: r.price!,
    originalPrice: r.oldPrice,
    availability: r.availability ?? undefined,
    url: r.url || '',
    imageUrl: r.image || '',
    rating: r.rating ?? undefined,
    reviewsCount: r.reviewsCount ?? undefined,
    scrapedAt: r.scrapedAt,
    source: 'apify-live' as const,
  }))
  return { products, meta: { searchedStores: selectedStores || ['any'], returnedCount: products.length, warnings } }
}

async function scrapeInspiration({ url }: { url: string }) {
  const [item] = await runRagWebBrowser({ query: url, maxResults: 1 })
  return {
    title: item?.metadata?.title ?? null,
    description: item?.metadata?.description ?? null,
    text: (item?.markdown || '').slice(0, 2000),
  }
}

async function visaCheckout({ store, amount }: { store: string; amount: number }) {
  const referenceCode = `${store.replace(/\s+/g, '-')}-${crypto.randomUUID()}`
  const result = await createSandboxPayment({ amount, referenceCode })
  console.log(`[dev-api] /api/visa/checkout — CyberSource response id=${result.id} status=${result.status}`)
  return { transactionId: result.id, status: result.status }
}

async function visaRefund({ transactionId, amount, store }: { transactionId: string; amount: number; store: string }) {
  const referenceCode = `refund-${store.replace(/\s+/g, '-')}-${crypto.randomUUID()}`
  const result = await refundSandboxPayment({ transactionId, amount, referenceCode })
  console.log(`[dev-api] /api/visa/refund — CyberSource response id=${result.id} status=${result.status}`)
  return { refundId: result.id, status: result.status }
}

async function agentCommand({ message, context, history }: { message: string; context: Record<string, unknown>; history?: { role: 'user' | 'assistant'; content: string }[] }) {
  return runAgentCommand(message, context, history ?? [])
}

async function analyzeProduct({ name, category, imageUrl, style }: { name: string; category: string; imageUrl: string; style: string }) {
  if (!name || !category) throw new Error('Product name and category are required.')
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) throw new Error('A valid product image URL is required.')
  return { analysis: await analyzeProductImage({ name, category, imageUrl, style: style || 'any' }) }
}

async function generateImage({ prompt }: { prompt: string }) {
  return withImageSlot(() => generateProductImage(prompt))
}

// The Library grid can mount 40+ product thumbnails at once, each wanting a
// generated image — Apify's sandbox plan allows only 5 concurrent actor runs,
// so a simple queue (not a flood of parallel requests) keeps every request
// under that cap instead of most of them failing with 402.
const IMAGE_CONCURRENCY = 3
let imageRunning = 0
const imageQueue: (() => void)[] = []
async function withImageSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (imageRunning >= IMAGE_CONCURRENCY) await new Promise<void>((resolve) => imageQueue.push(resolve))
  imageRunning++
  try {
    return await fn()
  } finally {
    imageRunning--
    imageQueue.shift()?.()
  }
}

// Keyed by product id so every catalog product is only ever generated once
// per server session, no matter how many times/places it's rendered.
const productImageCache = new Map<string, Promise<{ dataUrl: string }>>()
async function productImage({ id, prompt }: { id: string; prompt: string }) {
  if (!productImageCache.has(id)) {
    const promise = withImageSlot(() => generateProductImage(prompt))
    promise.catch(() => productImageCache.delete(id)) // don't cache failures
    productImageCache.set(id, promise)
  }
  return productImageCache.get(id)!
}

const ROUTES: Record<string, (body: any) => Promise<unknown>> = {
  '/api/apify/search-products': searchProducts,
  '/api/apify/inspiration': scrapeInspiration,
  '/api/apify/generate-image': generateImage,
  '/api/apify/product-image': productImage,
  '/api/visa/checkout': visaCheckout,
  '/api/visa/refund': visaRefund,
  '/api/agent/command': agentCommand,
  '/api/ai/analyze-product': analyzeProduct,
}

/** Dev-only backend for Apify + Visa calls, so API secrets stay off the client. */
export function devApiRoutes(): Plugin {
  return {
    name: 'dev-api-routes',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0]
        const handler = req.method === 'POST' ? ROUTES[url] : undefined
        if (!handler) return next()
        try {
          const body = await readJsonBody(req)
          send(res, 200, await handler(body))
        } catch (err: any) {
          console.error(`[dev-api] ${url} failed:`, err)
          send(res, 502, { error: err?.message ?? 'Unknown error' })
        }
      })
    },
  }
}
