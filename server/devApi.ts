import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import { runRagWebBrowser, generateProductImage, searchShopping } from './apifyClient'
import { createSandboxPayment, refundSandboxPayment } from './cybersourceClient'
import { runAgentCommand } from './claudeAgent'

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

async function searchProducts({ category, style, store }: { category: string; style: string; store?: string }) {
  // Google Shopping Scraper queries Google's own shopping index rather than
  // crawling retailer sites directly — real structured price/rating/seller
  // per product (no regex-guessing), and it surfaces listings from sites
  // (e.g. Wayfair) that block direct scraping outright. Store filtering
  // happens post-hoc against the real `seller` field since the actor has
  // no site-scoping input.
  const label = CATEGORY_LABELS[category] || category
  const searchTerm = `${style} ${label}${store ? ` ${store}` : ''}`.trim()
  const results = await searchShopping(searchTerm, 8)
  const filtered = store ? results.filter((r) => r.seller?.toLowerCase().includes(store.toLowerCase())) : results
  const products = filtered
    .filter((r) => r.price !== null)
    .map((r, i) => ({
      id: `live-${category}-${i}-${Date.now()}`,
      name: r.title,
      category,
      store: r.seller || store || 'Web',
      price: r.price!,
      url: r.url || '',
      imageUrl: r.image || '',
      rating: r.rating ?? undefined,
      reviewsCount: r.reviewsCount ?? undefined,
      source: 'apify-live' as const,
    }))
  return { products }
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

async function generateImage({ prompt }: { prompt: string }) {
  return generateProductImage(prompt)
}

// Keyed by product id so every catalog product is only ever generated once
// per server session, no matter how many times/places it's rendered.
const productImageCache = new Map<string, Promise<{ dataUrl: string }>>()
async function productImage({ id, prompt }: { id: string; prompt: string }) {
  if (!productImageCache.has(id)) {
    const promise = generateProductImage(prompt)
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
