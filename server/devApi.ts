import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import { runRagWebBrowser, ogImage } from './apifyClient'
import { createSandboxPayment } from './cybersourceClient'

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

const STORE_DOMAINS: Record<string, string> = {
  wayfair: 'wayfair.com', ikea: 'ikea.com', cb2: 'cb2.com', 'west elm': 'westelm.com',
  article: 'article.com', 'pottery barn': 'potterybarn.com', etsy: 'etsy.com', target: 'target.com',
}

async function searchProducts({ category, style, store }: { category: string; style: string; store?: string }) {
  // Scope the search to one retailer's domain with a site: operator — far
  // more reliable than just mentioning the store name in the query text.
  // "buy"/"for sale" and excluding Pinterest biases results toward actual
  // shoppable listings instead of inspiration boards, which never have a
  // price and otherwise crowd out real results for moodboard-y style names.
  const domain = store ? STORE_DOMAINS[store.toLowerCase()] || `${store.toLowerCase().replace(/\s+/g, '')}.com` : undefined
  const query = `buy ${style} ${category} furniture for sale price${domain ? ` site:${domain}` : ' -site:pinterest.com'}`.trim()
  const items = await runRagWebBrowser({ query, maxResults: 5 })
  const products = items
    .map((item, i) => {
      const text = item.markdown || ''
      const priceMatch = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/)
      const pageUrl = item.metadata?.url
      let host = ''
      try {
        host = pageUrl ? new URL(pageUrl).hostname.replace(/^www\./, '') : ''
      } catch {}
      return {
        id: `live-${category}-${i}-${Date.now()}`,
        name: item.metadata?.title || `${style} ${category}`,
        category,
        store: store || host || 'Web',
        price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null,
        url: pageUrl || '',
        imageUrl: ogImage(item),
        source: 'apify-live' as const,
      }
    })
    .filter((p) => p.price !== null)
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

const ROUTES: Record<string, (body: any) => Promise<unknown>> = {
  '/api/apify/search-products': searchProducts,
  '/api/apify/inspiration': scrapeInspiration,
  '/api/visa/checkout': visaCheckout,
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
