import type { Product } from '../data/products'
import { calculatePricing, type PricingTotals } from './pricing'

export type Mandate = {
  totalLimit:number;itemLimit:number;autoApprove:number;allowedStores:string[];waitForDrops:boolean
}
export type PaymentMode='full'|'split'|'installments'
export type MerchantOrder = {
  id:string;store:string;items:Product[];subtotal:number;tax:number;delivery:number;total:number
  status:'pending'|'approval'|'confirmed'|'skipped';orderNumber?:string;event?:string;savings:number
  visaTransactionId?:string;visaSimulated?:boolean
  refundId?:string;refunding?:boolean;refundError?:string
  approvalMode?:'autonomous'|'human'
}
export type InstallmentPlan={id:string;label:string;payments:number;monthly:number;interest:number;total:number;recommended?:boolean}
export type TestCardResult={ok:boolean;declined:boolean;error?:string;last4:string}
// Invoice/InvoiceLine feed the Finance module's Invoices tab — populated by
// our CheckoutPanel (real CyberSource transaction ids) via createInvoice,
// not by any simulated payment-gateway flow.
export type CheckoutSummary=PricingTotals
export type InvoiceLine={itemId:string;name:string;store:string;quantity:number;unitPrice:number;total:number;productId:string}
export type Invoice={
 id:string;date:string;billedTo:string;address:string;lines:InvoiceLine[];subtotal:number;tax:number;delivery:number
 discounts:number;total:number;saved:number;paymentMethod:string;transactions:{store:string;id:string}[];status:'PAID'
}
export const ORDER_STAGES=['Checking price','Checking stock','Applying best promo','Placing order','Confirmed'] as const
export function createMerchantOrders(items:Product[]):MerchantOrder[]{
 const groups=new Map<string,Product[]>();items.forEach(item=>groups.set(item.store,[...(groups.get(item.store)||[]),item]))
 return [...groups.entries()].map(([store,storeItems],index)=>{
  const raw=storeItems.reduce((n,p)=>n+p.price,0);const priceDrop=index===0?Math.min(40,raw):0;const promo=index===1?Math.round(raw*.1):0
  const subtotal=raw-priceDrop-promo,tax=Math.round(subtotal*.09375),delivery=49
  return{id:`order-${index}`,store,items:storeItems,subtotal,tax,delivery,total:subtotal+tax+delivery,status:'pending',savings:priceDrop+promo,event:index===0?'Price drop applied: −$40':index===1?'ROOMWISE10 applied: 10% off':index===2?'Stock check found one unavailable item; closest alternative reserved':undefined}
 })
}
export function validateMandate(order:MerchantOrder,mandate:Mandate,committed:number){
 if(!mandate.allowedStores.includes(order.store))return`${order.store} is not an allowed merchant.`
 const expensive=order.items.find(i=>i.price>mandate.itemLimit);if(expensive)return`${expensive.name} exceeds the $${mandate.itemLimit.toLocaleString()} per-item limit.`
 if(committed+order.total>mandate.totalLimit)return`This order would exceed the $${mandate.totalLimit.toLocaleString()} total mandate.`
 return null
}
export function checkoutSummary(items:Product[]):CheckoutSummary{
 return calculatePricing(items)
}
export function validateTestCard(number:string,expiry:string,cvc:string,name:string,zip:string):TestCardResult{
 const digits=number.replace(/\D/g,''),last4=digits.slice(-4)
 if(!name.trim())return{ok:false,declined:false,error:'Enter the name shown on the test card.',last4}
 if(!/^\d{2}\/\d{2}$/.test(expiry))return{ok:false,declined:false,error:'Use expiry format MM/YY.',last4}
 if(!/^\d{3,4}$/.test(cvc))return{ok:false,declined:false,error:'Enter a 3 or 4 digit CVC.',last4}
 if(!/^\d{5}$/.test(zip))return{ok:false,declined:false,error:'Enter a 5 digit ZIP code.',last4}
 if(digits==='4000000000000002')return{ok:false,declined:true,error:'Your card was declined. Try another card or pay over time.',last4}
 if(digits!=='4242424242424242')return{ok:false,declined:false,error:'Use a supported test card number.',last4}
 return{ok:true,declined:false,last4}
}
export function createInvoice(lines:InvoiceLine[],summary:CheckoutSummary,billedTo:string,address:string,transactions:{store:string;id:string}[],saved:number,paymentMethod='CyberSource sandbox'):Invoice{
 const suffix=String(Math.floor(1000+Math.random()*9000))
 return{
  id:`RW-2026-${suffix}`,date:new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}),billedTo,address,lines,
  subtotal:summary.subtotal,tax:summary.tax,delivery:summary.delivery,discounts:summary.discounts,total:summary.total,
  saved,paymentMethod,transactions,status:'PAID',
 }
}
export function installmentPlans(total:number):InstallmentPlan[]{
 return[
  {id:'four',label:'4 interest-free payments',payments:4,monthly:Math.round(total/4),interest:0,total,recommended:true},
  {id:'six',label:'6 months · 10% APR',payments:6,monthly:Math.round(total*1.05/6),interest:Math.round(total*.05),total:Math.round(total*1.05)},
  {id:'twelve',label:'12 months · 15% APR',payments:12,monthly:Math.round(total*1.081/12),interest:Math.round(total*.081),total:Math.round(total*1.081)},
 ]
}
export function mockOrderNumber(store:string,index:number){return`RW-${store.replace(/\W/g,'').slice(0,3).toUpperCase()}-${24051+index}`}
export function deliveryDate(index:number){const d=new Date();d.setDate(d.getDate()+4+index*2);return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}
