import { DELIVERY_PER_STORE, TAX_RATE } from '../../../services/pricing'

// Cost estimate for a shopping plan. These are stated assumptions, not
// retailer quotes, and every reply labels them that way. The rates come from
// the web app's own services/pricing.ts so the agent and the app always
// estimate the same way.

export const ESTIMATED_TAX_RATE = TAX_RATE
export const ESTIMATED_DELIVERY_PER_RETAILER = DELIVERY_PER_STORE
export const CURRENCY = 'USD'

export type CostLine = { price: number; quantity: number; store: string }

export type CostEstimate = {
  currency: typeof CURRENCY
  subtotal: number
  estimatedTax: number
  estimatedDelivery: number
  estimatedTotal: number
  retailerCount: number
  taxRate: number
  deliveryPerRetailer: number
}

export const roundCents = (n: number) => Math.round(n * 100) / 100

export function estimateCosts(lines: CostLine[], taxRate = ESTIMATED_TAX_RATE): CostEstimate {
  const subtotal = roundCents(lines.reduce((sum, line) => sum + line.price * line.quantity, 0))
  const retailerCount = new Set(lines.map((line) => line.store.toLowerCase())).size
  const estimatedTax = roundCents(subtotal * taxRate)
  const estimatedDelivery = retailerCount * ESTIMATED_DELIVERY_PER_RETAILER
  return {
    currency: CURRENCY,
    subtotal,
    estimatedTax,
    estimatedDelivery,
    estimatedTotal: roundCents(subtotal + estimatedTax + estimatedDelivery),
    retailerCount,
    taxRate,
    deliveryPerRetailer: ESTIMATED_DELIVERY_PER_RETAILER,
  }
}

export function formatMoney(amount: number): string {
  return `${CURRENCY} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
