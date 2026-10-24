export type VisaCheckoutResult = { transactionId: string; status: string }
export type VisaRefundResult = { refundId: string; status: string }

export async function runVisaCheckout(store: string, amount: number): Promise<VisaCheckoutResult> {
  const res = await fetch('/api/visa/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store, amount }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Visa checkout failed: ${res.status}`)
  return res.json()
}

export async function runVisaRefund(transactionId: string, amount: number, store: string): Promise<VisaRefundResult> {
  const res = await fetch('/api/visa/refund', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId, amount, store }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Visa refund failed: ${res.status}`)
  return res.json()
}
