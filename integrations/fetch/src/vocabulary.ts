import type { Category } from '../../../data/products'

// The planner covers the same furniture categories as the Roomwise catalog.

export const CATEGORIES: Category[] = [
  'bed', 'rug', 'pendants', 'sideTables', 'bench', 'planter', 'artwork', 'curtains', 'chair', 'fan',
  'outdoorPlanter', 'outdoorChair', 'pergola', 'stringLights',
]

export const CATEGORY_LABELS: Record<Category, string> = {
  bed: 'bed',
  rug: 'rug',
  pendants: 'pendant lights',
  sideTables: 'side table',
  bench: 'bench',
  planter: 'planter',
  artwork: 'wall art',
  curtains: 'curtains',
  chair: 'chair',
  fan: 'ceiling fan',
  outdoorPlanter: 'outdoor planter',
  outdoorChair: 'outdoor chair',
  pergola: 'pergola',
  stringLights: 'string lights',
}

// Matched on word boundaries with an optional plural, so "start" never
// matches "art" and "streetlight" never matches "light". Longer aliases win,
// so "string lights" is never read as pendant lights.
export const CATEGORY_ALIASES: Record<Category, string[]> = {
  bed: ['bed frame', 'platform bed', 'bed'],
  rug: ['area rug', 'rug', 'carpet'],
  pendants: ['pendant lights', 'pendant light', 'pendant', 'ceiling light', 'chandelier', 'lighting', 'lamp', 'light'],
  sideTables: ['side table', 'bedside table', 'end table', 'nightstand', 'night stand', 'table'],
  bench: ['bench'],
  planter: ['olive tree', 'planter', 'plant', 'tree'],
  artwork: ['wall art', 'artwork', 'art print', 'canvas', 'painting', 'print', 'poster', 'art'],
  curtains: ['curtain', 'drapery', 'drape', 'blind'],
  chair: ['accent chair', 'lounge chair', 'armchair', 'chair'],
  fan: ['ceiling fan', 'fan'],
  outdoorPlanter: ['outdoor planter', 'patio planter', 'balcony planter', 'flower box'],
  outdoorChair: ['outdoor chair', 'patio chair', 'balcony chair', 'bistro chair'],
  pergola: ['pergola', 'shade sail', 'canopy'],
  stringLights: ['string light', 'fairy light', 'cafe light', 'patio light'],
}

export const KNOWN_STYLES = [
  'wabi-sabi', 'japandi', 'mid-century', 'coastal', 'scandinavian', 'minimalist', 'modern', 'contemporary',
  'industrial', 'bohemian', 'boho', 'rustic', 'farmhouse', 'traditional', 'transitional', 'art deco', 'mediterranean',
]

export const STYLE_SYNONYMS: Record<string, string> = {
  'wabi sabi': 'wabi-sabi', 'mid century': 'mid-century', midcentury: 'mid-century', scandi: 'scandinavian',
}

export const KNOWN_RETAILERS = [
  'IKEA', 'West Elm', 'Wayfair', 'Target', 'Article', 'CB2', 'Etsy', 'Pottery Barn', 'Amazon', 'Walmart',
  'Crate & Barrel', 'Overstock', 'Home Depot', "Lowe's", 'Anthropologie', 'World Market', 'Room & Board', 'Castlery',
]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as string[]).includes(value)
}

export function categoryLabel(category: Category, quantity = 1): string {
  const label = CATEGORY_LABELS[category]
  return quantity > 1 && !label.endsWith('s') ? `${label}s` : label
}
