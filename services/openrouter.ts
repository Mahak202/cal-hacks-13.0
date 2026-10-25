export type ProductVisionAnalysis = {
  objectType: string
  description: string
  styleNote: string
  confidence: number
  provider: 'openrouter' | 'fallback'
}

// Sends an Apify-sourced live product photo to an OpenRouter vision model
// for a real analysis of what's actually in the image, not just scraped text.
export async function analyzeLiveProduct(input: { name: string; category: string; imageUrl: string; style: string }): Promise<ProductVisionAnalysis> {
  const res = await fetch('/api/ai/analyze-product', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Vision analysis failed: ${res.status}`)
  return (await res.json()).analysis
}
