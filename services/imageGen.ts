export async function generateItemImage(prompt: string): Promise<{ dataUrl: string }> {
  const res = await fetch('/api/apify/generate-image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Image generation failed: ${res.status}`)
  return res.json()
}
