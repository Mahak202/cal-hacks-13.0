const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export type ProductVisionAnalysis = {
  objectType: string
  description: string
  styleNote: string
  confidence: number
  provider: 'openrouter' | 'fallback'
}

function fallback(input: { name: string; category: string }, reason: string): ProductVisionAnalysis {
  return {
    objectType: input.category,
    description: `${input.name} — a ${input.category} piece from the live listing.`,
    styleNote: reason,
    confidence: 0.4,
    provider: 'fallback',
  }
}

// Analyzes a REAL Apify-sourced product photo (not our static catalog or
// AI-generated images) with an OpenRouter vision model, so the analysis
// reflects what the scraped listing actually shows.
export async function analyzeProductImage(input: { name: string; category: string; imageUrl: string; style: string }): Promise<ProductVisionAnalysis> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return fallback(input, 'No live vision analysis — OPENROUTER_API_KEY is not set, using a category-based placeholder.')
  const model = process.env.OPENROUTER_VISION_MODEL || 'google/gemini-3.8-flash'
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        reasoning: { effort: 'low', exclude: true },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `This is a real product photo from a live Apify shopping search for a "${input.category}" listed as "${input.name}", being considered for a room styled "${input.style}". Look at the actual image and in two short sentences describe what you see (materials, color, form), then say whether it fits that style. Respond with JSON only, no markdown fences: {"objectType":"...","description":"...","styleNote":"...","confidence":0.0-1.0}`,
              },
              { type: 'image_url', image_url: { url: input.imageUrl } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenRouter vision call failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as any
    const text: string = data.choices?.[0]?.message?.content ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('OpenRouter did not return structured output.')
    const parsed = JSON.parse(match[0])
    return {
      objectType: parsed.objectType || input.category,
      description: parsed.description || '',
      styleNote: parsed.styleNote || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      provider: 'openrouter',
    }
  } catch (err: any) {
    console.warn('[openrouter] vision analysis failed, falling back:', err)
    return fallback(input, `Live vision analysis failed (${err?.message || 'unknown error'}) — using a category-based placeholder.`)
  }
}
