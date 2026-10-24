import { useEffect, useState } from 'react'
import type { Product } from '../data/products'
import { getProductImage } from '../services/productImages'

// Live (Apify-scraped) products already carry a real imageUrl. Everything
// else (the static catalog) gets one generated on first render and cached,
// so a product is only ever paid-for/generated once per session regardless
// of how many places it's shown.
export default function ProductThumb({ p, className, children }: { p: Product; className: string; children?: React.ReactNode }) {
  const [url, setUrl] = useState(p.styleTags.includes('live') ? p.imageUrl : '')
  useEffect(() => {
    if (url) return
    let active = true
    getProductImage(p.id, `${p.name}, ${p.material}, furniture product photo`)
      .then((u) => { if (active) setUrl(u) })
      .catch(() => {})
    return () => { active = false }
  }, [p.id])
  return (
    <div className={className}>
      {url ? <img src={url} alt={p.name} onError={() => setUrl('')} /> : p.category.slice(0, 1).toUpperCase()}
      {children}
    </div>
  )
}
