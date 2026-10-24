export type PriceableItem={price:number;store:string;quantity?:number}
export type PricingTotals={subtotal:number;tax:number;delivery:number;discounts:number;total:number;storeCount:number;itemCount:number}

export const TAX_RATE=.09375
export const DELIVERY_PER_STORE=49

export function calculatePricing(items:PriceableItem[],discounts=0):PricingTotals{
 const selected=items.filter(item=>(item.quantity??1)>0)
 const subtotal=selected.reduce((sum,item)=>sum+item.price*(item.quantity??1),0)
 const storeCount=new Set(selected.map(item=>item.store)).size
 const tax=subtotal*TAX_RATE
 const delivery=storeCount*DELIVERY_PER_STORE
 return{subtotal,tax,delivery,discounts,total:subtotal+tax+delivery-discounts,storeCount,itemCount:selected.reduce((sum,item)=>sum+(item.quantity??1),0)}
}

export const formatMoney=(value:number)=>Math.round(value).toLocaleString('en-US')
