// Client-side cache on top of the server's — avoids re-fetching the same
// product's image across re-renders/remounts within one page session.
const cache = new Map<string, Promise<string>>()

export function getProductImage(id: string, prompt: string): Promise<string> {
  if (!cache.has(id)) {
    const promise = fetch('/api/apify/product-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, prompt }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Image fetch failed: ${res.status}`)
        return (await res.json()).dataUrl as string
      })
    promise.catch(() => cache.delete(id))
    cache.set(id, promise)
  }
  return cache.get(id)!
}
