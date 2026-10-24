import { useEffect, useMemo, useState } from 'react'
import { products, type Product } from '../data/products'
import { approvalNeededAgent, financeCompleteAgent, financeDecisionAgent, financeStartedAgent, financeStoppedAgent, mandateAuthorizedAgent } from '../agents/financeAgent'
import {
  ORDER_STAGES,
  checkoutSummary,
  createInvoice,
  createMerchantOrders,
  deliveryDate,
  mockOrderNumber,
  validateMandate,
  validateTestCard,
  type Invoice,
  type Mandate,
  type MerchantOrder,
  type PaymentMode,
} from '../services/payments'
import { runVisaCheckout, runVisaRefund } from '../services/visa'
import { useRoomwise } from '../state/RoomwiseContext'
import ProductThumb from './ProductThumb'
import { formatMoney } from '../services/pricing'

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
type CheckoutStep='select'|'pay'|'confirm'|'processing'|'invoice'
type CartEntry={instanceId:string;product:Product}
const progressSteps=['Select','Pay','Confirm','Invoice']

export default function CheckoutPanel({onClose}:{onClose:()=>void}){
 const s=useRoomwise()
 const cart=useMemo<CartEntry[]>(()=>s.roomItems.map(item=>{
  const product=products.find(p=>p.id===item.productId),custom=s.myItems.find(p=>p.id===item.productId)
  return{instanceId:item.id,product:product||(custom?{id:custom.id,name:custom.name,category:'artwork',store:'My Studio',price:custom.price,url:'#',imageUrl:custom.imageUrl||'',material:'Custom generated object',durability:4,styleTags:['custom'],tier:'mid'} as Product:null)!}
 }).filter(entry=>Boolean(entry.product)),[s.roomItems,s.myItems])
 const stores=useMemo(()=>[...new Set(cart.map(entry=>entry.product.store))],[cart])
 const [step,setStep]=useState<CheckoutStep>('select')
 const [mandate,setMandate]=useState<Mandate>({totalLimit:s.budget,itemLimit:800,autoApprove:150,allowedStores:stores,waitForDrops:true})
 const [approval,setApproval]=useState(false),[method,setMethod]=useState<'saved'|'different'>('saved'),[mode,setMode]=useState<PaymentMode>('full')
 const [card,setCard]=useState({number:'',expiry:'',cvc:'',name:'',zip:''}),[cardError,setCardError]=useState('')
 const [address,setAddress]=useState({name:'Alex Morgan',line:'125 Willow Street, Brooklyn, NY 11201'}),[editingAddress,setEditingAddress]=useState(false),[terms,setTerms]=useState(false)
 const [orders,setOrders]=useState<MerchantOrder[]>([]),[active,setActive]=useState(-1),[stage,setStage]=useState(-1),[awaiting,setAwaiting]=useState<number|null>(null)
 const [log,setLog]=useState<{time:string;text:string;reason:string}[]>([])
 const [declined,setDeclined]=useState(false),[invoice,setInvoice]=useState<Invoice|null>(null),[sent,setSent]=useState(false)
 useEffect(()=>{if(s.checkoutItemIds===null)s.setCheckoutItemIds(cart.map(entry=>entry.instanceId));return()=>{s.setCheckoutItemIds(null);s.setSelectedItemId(null)}},[])
 const quantities=s.checkoutQuantities,selectedIds=s.checkoutItemIds||[],selected=cart.filter(entry=>selectedIds.includes(entry.instanceId)),selectedProducts=selected.flatMap(entry=>Array.from({length:quantities[entry.instanceId]||1},()=>entry.product))
 const summary=useMemo(()=>checkoutSummary(selectedProducts),[selectedProducts])
 useEffect(()=>{if(s.purchaseApproval)setApproval(true)},[s.purchaseApproval])
 const budgetRemaining=s.budget-summary.total
 const grouped=useMemo(()=>stores.map(store=>({store,entries:cart.filter(entry=>entry.product.store===store)})).filter(group=>group.entries.length),[stores,cart])
 const plannedOrders=useMemo(()=>createMerchantOrders(selectedProducts),[selectedProducts])
 const mandateIssue=plannedOrders.map((order,index)=>validateMandate(order,mandate,plannedOrders.slice(0,index).reduce((sum,item)=>sum+item.total,0))).find(Boolean)
 const withinMandate=!mandateIssue&&summary.total<=mandate.totalLimit
 const activeProgress=step==='select'?0:step==='pay'?1:step==='invoice'?3:2
 const setGroup=(ids:string[],checked:boolean)=>s.setCheckoutItemIds(checked?[...new Set([...selectedIds,...ids])]:selectedIds.filter(id=>!ids.includes(id)))
 const stamp=(text:string,reason:string)=>setLog(v=>[...v,{time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),text,reason}])
 const requestApproval=()=>{const item=[...selectedProducts].sort((a,b)=>b.price-a.price)[0];s.requestPurchaseApproval(item?.price||summary.total,item?.name||'order');s.postAgent(mandateAuthorizedAgent({...mandate,totalLimit:Math.max(mandate.totalLimit,summary.total)}))}
 const review=()=>{
  if(method==='different'){const result=validateTestCard(card.number,card.expiry,card.cvc,card.name,card.zip);if(!result.ok&&!result.declined){setCardError(result.error||'Check your test card details.');return}}
  setCardError('');setStep('confirm')
 }
 const buildInvoice=(current:MerchantOrder[])=>{
  const confirmed=current.filter(o=>o.status==='confirmed'),paid=confirmed.reduce((n,o)=>n+o.total,0)
  const saved=Math.max(0,s.originalTotal-s.total)+confirmed.reduce((n,o)=>n+o.savings,0),realCount=confirmed.filter(o=>o.visaTransactionId).length
  const transactions=confirmed.map(o=>({store:o.store,id:o.visaTransactionId||`SIM-${o.orderNumber||o.id}`}))
  const next=createInvoice(selected.map(entry=>{const quantity=quantities[entry.instanceId]||1;return{itemId:entry.instanceId,name:entry.product.name,store:entry.product.store,quantity,unitPrice:entry.product.price,total:entry.product.price*quantity,productId:entry.product.id}}),summary,address.name,address.line,transactions,saved,realCount<confirmed.length?'CyberSource sandbox (partially simulated)':'CyberSource sandbox')
  setInvoice(next);s.addInvoice(next);s.setCheckoutSummary(paid,saved);s.postAgent(financeCompleteAgent(paid,saved,confirmed.length,realCount));setStep('invoice')
 }
 const finish=async(index:number,current:MerchantOrder[],approvalMode:'autonomous'|'human')=>{
  const order=current[index]
  let visaTransactionId:string|undefined,visaSimulated=false
  try{visaTransactionId=(await runVisaCheckout(order.store,order.total)).transactionId}
  catch(err){visaSimulated=true;console.warn('CyberSource sandbox checkout failed, falling back to simulated order:',err)}
  const confirmed={...order,status:'confirmed' as const,orderNumber:mockOrderNumber(order.store,index),visaTransactionId,visaSimulated,approvalMode}
  const next=current.map((o,i)=>i===index?confirmed:o);setOrders(next);setStage(4)
  stamp(`Confirmed ${order.store} order`,visaTransactionId?`${confirmed.orderNumber} · $${order.total.toLocaleString()} · CyberSource txn ${visaTransactionId}`:`${confirmed.orderNumber} · $${order.total.toLocaleString()}${visaSimulated?' · CyberSource sandbox unreachable, simulated':''}`)
  await wait(650);process(index+1,next)
 }
 const process=async(index:number,current:MerchantOrder[])=>{
  if(index>=current.length){buildInvoice(current);return}
  const order=current[index];setActive(index);const reason=validateMandate(order,mandate,current.filter(o=>o.status==='confirmed').reduce((n,o)=>n+o.total,0))
  if(reason){const next=current.map((o,i)=>i===index?{...o,status:'skipped' as const}:o);setOrders(next);stamp(`Skipped ${order.store}`,reason);s.postAgent(financeStoppedAgent(reason));await wait(400);process(index+1,next);return}
  for(let i=0;i<4;i++){setStage(i);if(i===0&&order.event?.includes('Price')){stamp(order.event,'Applied automatically because it lowers the authorized total.');s.postAgent(financeDecisionAgent(order.event,'The verified merchant price was lower than the quote.'))}if(i===2&&order.event?.includes('10%')){stamp(order.event,'Best valid promotion found for this merchant.');s.postAgent(financeDecisionAgent(order.event,'The promo was tested and applied before purchase.'))}await wait(520)}
  if(order.total>mandate.autoApprove){setAwaiting(index);setOrders(current.map((o,i)=>i===index?{...o,status:'approval'}:o));s.postAgent(approvalNeededAgent(order));return}
  stamp(`Auto-approved ${order.store}`,`$${order.total.toLocaleString()} is within the $${mandate.autoApprove.toLocaleString()} threshold.`);finish(index,current,'autonomous')
 }
 const pay=async()=>{
  if(!terms)return
  const result=method==='saved'?{ok:true,declined:false,last4:'4242'}:validateTestCard(card.number,card.expiry,card.cvc,card.name,card.zip)
  setStep('processing')
  if(!result.ok){setDeclined(true);setCardError(result.error||'Your card was declined.');return}
  setDeclined(false);setActive(-1);setStage(-1);setAwaiting(null);setLog([])
  const next=plannedOrders.map(o=>({...o}));setOrders(next);s.postAgent(financeStartedAgent(next.length));process(0,next)
 }
 const approve=()=>{if(awaiting===null)return;const i=awaiting;setAwaiting(null);stamp(`Approved ${orders[i].store}`,`One-tap approval for $${orders[i].total.toLocaleString()}.`);finish(i,orders,'human')}
 const skip=()=>{if(awaiting===null)return;const i=awaiting;const next=orders.map((o,n)=>n===i?{...o,status:'skipped' as const}:o);setOrders(next);setAwaiting(null);stamp(`Skipped ${orders[i].store}`,'User chose not to place this order.');process(i+1,next)}
 const cheaper=()=>{
  if(awaiting===null)return;const order=orders[awaiting],old=order.items[0],replacement=products.find(p=>p.category===old.category&&p.tier==='budget')
  if(!replacement){skip();return}
  const saving=old.price-replacement.price;const updated={...order,items:[replacement,...order.items.slice(1)],subtotal:order.subtotal-saving,total:order.total-saving,tax:Math.round((order.subtotal-saving)*.09375),savings:order.savings+saving,status:'pending' as const}
  const next=orders.map((o,i)=>i===awaiting?updated:o);setOrders(next);setAwaiting(null);stamp(`Found a cheaper ${old.category}`,`${replacement.name} saves $${saving.toLocaleString()}; re-checking mandate.`);process(awaiting,next)
 }
 const requestRefund=async(orderId:string)=>{
  const order=orders.find(o=>o.id===orderId);if(!order||!order.visaTransactionId||order.refundId||order.refunding)return
  setOrders(v=>v.map(o=>o.id===orderId?{...o,refunding:true,refundError:undefined}:o))
  try{
   const{refundId}=await runVisaRefund(order.visaTransactionId,order.total,order.store)
   setOrders(v=>v.map(o=>o.id===orderId?{...o,refunding:false,refundId}:o))
   stamp(`Refunded ${order.store} order`,`CyberSource refund txn ${refundId} · $${order.total.toLocaleString()}`)
   s.postAgent(financeDecisionAgent(`Refunded the ${order.store} order.`,`CyberSource refund confirmed: ${refundId}`))
  }catch(err:any){
   setOrders(v=>v.map(o=>o.id===orderId?{...o,refunding:false,refundError:err?.message||'Refund failed'}:o))
   stamp(`Refund failed for ${order.store}`,err?.message||'Unknown error')
  }
 }
 const allSelected=cart.length>0&&selectedIds.length===cart.length
 return <div className="checkout-gateway"><header className="gateway-header"><div className="gateway-brand"><b>Roomwise</b><span><i className="gateway-lock"/>Secure checkout · CyberSource sandbox</span></div><div className="checkout-progress" aria-label="Checkout progress">{progressSteps.map((label,index)=><div className={index<activeProgress?'done':index===activeProgress?'active':''} key={label}><i/><span>{label}</span></div>)}</div><button onClick={onClose}>Back to room</button></header><div className="checkout checkout-flow">
  {step==='select'&&<section className="checkout-screen">
   <div className="gateway-left"><div className="checkout-heading"><span>Choose items</span><h1>Select what to purchase now</h1><p>Unchecked items stay in your room and are saved for later.</p></div>
   <label className="select-all"><input type="checkbox" checked={allSelected} onChange={event=>s.setCheckoutItemIds(event.target.checked?cart.map(entry=>entry.instanceId):[])}/><span><b>Select all</b><small>{cart.length} items in room</small></span></label>
   <div className="checkout-store-list">{grouped.map(group=>{const ids=group.entries.map(entry=>entry.instanceId),checked=ids.every(id=>selectedIds.includes(id));return <section className="checkout-store" key={group.store}><label className="store-check"><input type="checkbox" checked={checked} onChange={event=>setGroup(ids,event.target.checked)}/><b>{group.store}</b><span>{group.entries.length} items</span></label>{group.entries.map(({instanceId,product})=><label className={`checkout-item ${selectedIds.includes(instanceId)?'selected':''}`} key={instanceId} onFocus={()=>s.setSelectedItemId(instanceId)}><input type="checkbox" checked={selectedIds.includes(instanceId)} onChange={()=>s.toggleCheckoutItem(instanceId)}/><ProductThumb p={product} className="checkout-thumb"/><span><b>{product.name}</b><small>{product.store} · Save for later if unchecked</small></span><span className="qty-stepper"><button type="button" aria-label={`Decrease ${product.name} quantity`} onClick={event=>{event.preventDefault();s.setCheckoutQuantities({...quantities,[instanceId]:Math.max(1,(quantities[instanceId]||1)-1)})}}>−</button><b>{quantities[instanceId]||1}</b><button type="button" aria-label={`Increase ${product.name} quantity`} onClick={event=>{event.preventDefault();s.setCheckoutQuantities({...quantities,[instanceId]:(quantities[instanceId]||1)+1})}}>+</button></span><strong>${(product.price*(quantities[instanceId]||1)).toLocaleString()}</strong></label>)}</section>})}</div></div>
   <div className="gateway-right"><div className="checkout-summary sticky"><span><b>{selected.length}</b><small>items selected</small></span><dl><div><dt>Subtotal</dt><dd>${formatMoney(summary.subtotal)}</dd></div><div><dt>Tax</dt><dd>${formatMoney(summary.tax)}</dd></div><div><dt>Delivery</dt><dd>${formatMoney(summary.delivery)}</dd></div><div className="summary-total"><dt>Total</dt><dd>${formatMoney(summary.total)}</dd></div><div><dt>Budget remaining</dt><dd className={budgetRemaining<0?'negative':''}>${formatMoney(budgetRemaining)}</dd></div></dl><button className="primary" disabled={!selected.length} onClick={()=>setStep('pay')}>Continue to payment · ${formatMoney(summary.total)}</button></div></div>
  </section>}
  {step==='pay'&&<section className="checkout-screen gateway-pay"><div className="gateway-left"><div className="checkout-heading"><span>Selected items</span><h1>{selected.length} items from {plannedOrders.length} stores</h1></div><div className="gateway-review-list">{selected.map(entry=><div key={entry.instanceId}><ProductThumb p={entry.product} className="checkout-thumb"/><span><b>{entry.product.name}</b><small>{entry.product.store}</small></span><strong>${entry.product.price.toLocaleString()}</strong></div>)}</div></div><div className="gateway-right payment-gateway"><div className="checkout-heading with-total"><span>Payment gateway</span><h1>How would you like to pay?</h1><strong>${formatMoney(summary.total)}</strong></div>
   <div className="payment-card"><div className="saved-card"><span>VISA</span><b>Visa •••• 4242</b><em>Sandbox</em></div><button className="text-action" onClick={()=>setMethod(method==='saved'?'different':'saved')}>{method==='saved'?'Use a different card':'Use saved test card'}</button>
   {method==='different'&&<div className="card-fields">{cardError&&<div className="inline-error" role="alert">{cardError}</div>}<label>Card number<input aria-invalid={cardError.includes('card number')} inputMode="numeric" autoComplete="off" value={card.number} onChange={e=>setCard({...card,number:e.target.value})} placeholder="4242 4242 4242 4242"/>{cardError.includes('card number')&&<small className="field-error">{cardError}</small>}</label><div><label>Expiry<input aria-invalid={cardError.includes('expiry')} autoComplete="off" value={card.expiry} onChange={e=>setCard({...card,expiry:e.target.value})} placeholder="MM/YY"/>{cardError.includes('expiry')&&<small className="field-error">{cardError}</small>}</label><label>CVC<input aria-invalid={cardError.includes('CVC')} inputMode="numeric" autoComplete="off" value={card.cvc} onChange={e=>setCard({...card,cvc:e.target.value})} placeholder="123"/>{cardError.includes('CVC')&&<small className="field-error">{cardError}</small>}</label></div><label>Name on card<input aria-invalid={cardError.includes('name')} autoComplete="off" value={card.name} onChange={e=>setCard({...card,name:e.target.value})}/>{cardError.includes('name')&&<small className="field-error">{cardError}</small>}</label><label>ZIP<input aria-invalid={cardError.includes('ZIP')} inputMode="numeric" autoComplete="off" value={card.zip} onChange={e=>setCard({...card,zip:e.target.value})}/>{cardError.includes('ZIP')&&<small className="field-error">{cardError}</small>}</label></div>}</div>
   <fieldset className="payment-options"><legend>Pay options</legend>{[{id:'full',label:'Pay in full',detail:`$${formatMoney(summary.total)} today`},{id:'split',label:'Split with family / roommates',detail:`Share a secure sandbox request`},{id:'installments',label:'4 interest-free payments',detail:`$${formatMoney(summary.total/4)} per payment`}].map(option=><label className={mode===option.id?'selected':''} key={option.id}><input type="radio" name="payment-option" checked={mode===option.id} onChange={()=>setMode(option.id as PaymentMode)}/><span><b>{option.label}</b><small>{option.detail}</small></span></label>)}</fieldset>
   <div className={`finance-check ${withinMandate||approval?'ok':'warning'}`}><span>{withinMandate||approval?'✓':'!'}</span><div><b>{withinMandate||approval?`Within your $${mandate.totalLimit.toLocaleString()} mandate`:'Finance Agent approval required'}</b>{mandateIssue&&<small>{mandateIssue}</small>}</div>{!withinMandate&&!approval&&<button onClick={requestApproval}>Request approval</button>}</div>
   <details className="order-details"><summary>Order details <span>${formatMoney(summary.total)}</span></summary><dl><div><dt>{selected.length} items</dt><dd>${formatMoney(summary.subtotal)}</dd></div><div><dt>Tax and delivery</dt><dd>${formatMoney(summary.tax+summary.delivery)}</dd></div><div><dt>Savings</dt><dd>−${formatMoney(summary.discounts)}</dd></div></dl></details>
   <button className="primary checkout-primary" disabled={!withinMandate&&!approval} onClick={review}>Pay ${formatMoney(summary.total)}</button></div>
  </section>}
  {step==='confirm'&&<section className="checkout-screen">
   <div className="checkout-heading"><span>Review</span><h1>Confirm your order</h1><p>Nothing happens until you select Pay.</p></div>
   <div className="review-total"><small>Total</small><strong>${formatMoney(summary.total)}</strong></div>
   <details className="review-items"><summary>{selected.length} items from {plannedOrders.length} stores</summary>{selected.map(entry=><div key={entry.instanceId}><span>{entry.product.name}<small>{entry.product.store}</small></span><b>${entry.product.price.toLocaleString()}</b></div>)}</details>
   <div className="review-card"><span><b>Payment</b><small>{method==='saved'?'Visa •••• 4242':`Visa •••• ${card.number.replace(/\D/g,'').slice(-4)}`}</small></span><button onClick={()=>setStep('pay')}>Edit</button></div>
   <div className="review-card shipping">{editingAddress?<div className="shipping-fields"><label>Name<input value={address.name} onChange={event=>setAddress({...address,name:event.target.value})}/></label><label>Address<input value={address.line} onChange={event=>setAddress({...address,line:event.target.value})}/></label></div>:<span><b>Shipping address</b><small>{address.name}<br/>{address.line}</small></span>}<button onClick={()=>setEditingAddress(value=>!value)}>{editingAddress?'Done':'Edit'}</button></div>
   <label className="terms-check"><input type="checkbox" checked={terms} onChange={event=>setTerms(event.target.checked)}/><span>I agree to the store terms</span></label>
   <button className="primary checkout-primary" disabled={!terms} onClick={pay}>Pay ${formatMoney(summary.total)}</button>
  </section>}
  {step==='processing'&&<section className="checkout-screen">
   {declined?<div className="decline-card" role="alert"><span>!</span><h1>Your card was declined</h1><p>Try another test card or pay over time. Your entered details are preserved.</p><button className="primary" onClick={()=>{setDeclined(false);setStep('pay')}}>Try again</button></div>:<><div className="checkout-heading with-total"><span>Processing</span><h1>Placing your orders</h1><strong>${formatMoney(summary.total)}</strong><p>Keep this panel open. Each store is confirmed separately via the CyberSource sandbox.</p></div><div className="processing-list">{orders.map((order,i)=><div className="processing-store" key={order.id}><span><b>{order.store}</b><small>${formatMoney(order.total)}</small></span>{active===i&&order.status!=='approval'&&<div className="stage-line">{ORDER_STAGES.map((label,n)=><span className={n<=stage?'done':''} key={label}>{n<stage?'✓':n===stage?'•':'○'} {label}</span>)}</div>}{order.event&&<em>{order.event}</em>}{order.orderNumber&&<strong>{order.orderNumber}</strong>}</div>)}</div>{awaiting!==null&&<div className="approval-card"><b>{orders[awaiting].event?.includes('Stock')?'Approve in-stock alternative?':`Approve $${orders[awaiting].total.toLocaleString()} order at ${orders[awaiting].store}?`}</b><div><button onClick={approve}>Approve</button><button onClick={skip}>Skip</button><button onClick={cheaper}>Find cheaper</button></div></div>}</>}
  </section>}
  {step==='invoice'&&invoice&&<section className="checkout-screen invoice-screen">
   <div className="success-heading"><span>✓</span><div><h1>Payment complete</h1><p>${formatMoney(invoice.total)} paid · ${formatMoney(invoice.saved)} saved</p></div></div>
   <article className="invoice-document"><header><div><b>Roomwise</b><small>AI spatial studio</small></div><strong>PAID</strong></header><div className="invoice-meta"><span><small>Invoice</small><b>{invoice.id}</b></span><span><small>Date</small><b>{invoice.date}</b></span></div><div className="billed-to"><small>Billed to</small><b>{invoice.billedTo}</b><span>{invoice.address}</span></div><div className="invoice-lines"><div className="head"><span>Item</span><span>Qty</span><span>Unit</span><span>Total</span></div>{invoice.lines.map(line=><div key={line.itemId}><span><b>{line.name}</b><small>{line.store}</small></span><span>{line.quantity}</span><span>${formatMoney(line.unitPrice)}</span><span>${formatMoney(line.total)}</span></div>)}</div><dl className="invoice-totals"><div><dt>Subtotal</dt><dd>${formatMoney(invoice.subtotal)}</dd></div><div><dt>Tax</dt><dd>${formatMoney(invoice.tax)}</dd></div><div><dt>Delivery</dt><dd>${formatMoney(invoice.delivery)}</dd></div><div><dt>Discounts / savings</dt><dd>−${formatMoney(invoice.discounts)}</dd></div><div><dt>Total paid</dt><dd>${formatMoney(invoice.total)}</dd></div></dl><div className="invoice-payment"><span>{invoice.paymentMethod}</span>{invoice.transactions.map(transaction=><small key={transaction.id}>{transaction.store} · {transaction.id}</small>)}</div></article>
   <div className="invoice-actions"><button className="primary" onClick={()=>window.print()}>Download PDF</button><button onClick={()=>{setSent(true);setTimeout(()=>setSent(false),2500)}}>Email invoice</button><button onClick={onClose}>Back to room</button></div>{sent&&<div className="invoice-toast" role="status">Sent ✓</div>}
   {(()=>{const autonomous=orders.filter(o=>o.approvalMode==='autonomous').length,human=orders.filter(o=>o.approvalMode==='human').length,skipped=orders.filter(o=>o.status==='skipped').length;return<div className="tip"><span>i</span>Autonomous: {autonomous} order{autonomous===1?'':'s'} approved by the agent on its own within its mandate · Human sign-off: {human}{skipped?` · Skipped (exceeded mandate): ${skipped}`:''}.</div>})()}
   <h4>Receipts & refunds</h4>{orders.filter(o=>o.status==='confirmed').map((o,i)=><div className="receipt" key={o.id}><span><b>{o.store}</b><small>{o.orderNumber} · Arrives {deliveryDate(i)}</small>{o.visaTransactionId?<small>CyberSource sandbox txn {o.visaTransactionId}</small>:o.visaSimulated?<small>CyberSource sandbox unreachable · simulated</small>:null}{o.refundId&&<small>Refunded · CyberSource txn {o.refundId}</small>}{o.refundError&&<small>Refund failed: {o.refundError}</small>}</span><div className="receipt-actions">{o.visaTransactionId&&!o.refundId&&<button disabled={o.refunding} onClick={()=>requestRefund(o.id)}>{o.refunding?'Refunding…':'Refund'}</button>}</div></div>)}
   <h4>Agent activity</h4><div className="audit">{log.map((x,i)=><div key={i}><time>{x.time}</time><span><b>{x.text}</b><small>{x.reason}</small></span></div>)}</div>
  </section>}
 </div></div>
}

export function CheckoutPanelSummary({onContinue}:{onContinue:()=>void}){
 const s=useRoomwise()
 return <div className="checkout-launch"><div className="panel-title"><span>06</span><h1>Checkout</h1><p>Review your room total, then continue in the secure CyberSource sandbox gateway.</p></div><div className="quote-summary"><span>ORDER TOTAL</span><b>${Math.round(s.grandTotal).toLocaleString()}</b><small>{s.roomItems.length} items · tax and delivery included</small></div><button className="primary" onClick={onContinue}>Continue to payment</button><p>CyberSource sandbox — real API calls, no real card is charged.</p></div>
}
