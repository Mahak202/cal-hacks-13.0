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
