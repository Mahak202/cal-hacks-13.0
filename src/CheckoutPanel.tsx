import { useMemo, useState } from 'react'
import { products } from '../data/products'
import { approvalNeededAgent, financeCompleteAgent, financeDecisionAgent, financeStartedAgent, financeStoppedAgent, mandateAuthorizedAgent } from '../agents/financeAgent'
import { createMerchantOrders, deliveryDate, installmentPlans, mockOrderNumber, ORDER_STAGES, validateMandate, type Mandate, type MerchantOrder, type PaymentMode } from '../services/payments'
import { runVisaCheckout, runVisaRefund } from '../services/visa'
import { useRoomwise } from '../state/RoomwiseContext'

const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
export default function CheckoutPanel(){
 const s=useRoomwise();const cart=useMemo(()=>s.roomItems.map(i=>products.find(p=>p.id===i.productId)!).filter(Boolean),[s.roomItems])
 const stores=useMemo(()=>[...new Set(cart.map(p=>p.store))],[cart])
 const [mandate,setMandate]=useState<Mandate>({totalLimit:s.budget,itemLimit:800,autoApprove:150,allowedStores:stores,waitForDrops:true})
 const [authorized,setAuthorized]=useState(false),[editing,setEditing]=useState(false),[mode,setMode]=useState<PaymentMode>('full')
 const [people,setPeople]=useState<string[]>(['Alex']),[split,setSplit]=useState<'even'|'item'>('even'),[orders,setOrders]=useState<MerchantOrder[]>([])
 const [active,setActive]=useState(-1),[stage,setStage]=useState(-1),[awaiting,setAwaiting]=useState<number|null>(null),[complete,setComplete]=useState(false)
 const [log,setLog]=useState<{time:string;text:string;reason:string}[]>([])
 const stamp=(text:string,reason:string)=>setLog(v=>[...v,{time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),text,reason}])
 const authorize=()=>{setAuthorized(true);setEditing(false);s.postAgent(mandateAuthorizedAgent(mandate))}
 const finish=async(index:number,current:MerchantOrder[])=>{
  const order=current[index]
  let visaTransactionId:string|undefined,visaSimulated=false
  try{visaTransactionId=(await runVisaCheckout(order.store,order.total)).transactionId}
  catch(err){visaSimulated=true;console.warn('CyberSource sandbox checkout failed, falling back to simulated order:',err)}
  const confirmed={...order,status:'confirmed' as const,orderNumber:mockOrderNumber(order.store,index),visaTransactionId,visaSimulated}
  const next=current.map((o,i)=>i===index?confirmed:o);setOrders(next);setStage(4)
  stamp(`Confirmed ${order.store} order`,visaTransactionId?`${confirmed.orderNumber} · $${order.total.toLocaleString()} · CyberSource txn ${visaTransactionId}`:`${confirmed.orderNumber} · $${order.total.toLocaleString()}${visaSimulated?' · CyberSource sandbox unreachable, simulated':''}`)
  await wait(650);process(index+1,next)
 }
 const process=async(index:number,current:MerchantOrder[])=>{
  if(index>=current.length){const confirmed=current.filter(o=>o.status==='confirmed');const paid=confirmed.reduce((n,o)=>n+o.total,0),saved=Math.max(0,s.originalTotal-s.total)+confirmed.reduce((n,o)=>n+o.savings,0);setComplete(true);setActive(-1);s.setCheckoutSummary(paid,saved);s.postAgent(financeCompleteAgent(paid,saved,confirmed.length));return}
  const order=current[index];setActive(index);const reason=validateMandate(order,mandate,current.filter(o=>o.status==='confirmed').reduce((n,o)=>n+o.total,0))
  if(reason){const next=current.map((o,i)=>i===index?{...o,status:'skipped' as const}:o);setOrders(next);stamp(`Skipped ${order.store}`,reason);s.postAgent(financeStoppedAgent(reason));await wait(400);process(index+1,next);return}
  for(let i=0;i<4;i++){setStage(i);if(i===0&&order.event?.includes('Price')){stamp(order.event,'Applied automatically because it lowers the authorized total.');s.postAgent(financeDecisionAgent(order.event,'The verified merchant price was lower than the quote.'))}if(i===2&&order.event?.includes('10%')){stamp(order.event,'Best valid promotion found for this merchant.');s.postAgent(financeDecisionAgent(order.event,'The promo was tested and applied before purchase.'))}await wait(520)}
  if(order.total>mandate.autoApprove){setAwaiting(index);setOrders(current.map((o,i)=>i===index?{...o,status:'approval'}:o));s.postAgent(approvalNeededAgent(order));return}
  stamp(`Auto-approved ${order.store}`,`$${order.total.toLocaleString()} is within the $${mandate.autoApprove.toLocaleString()} threshold.`);finish(index,current)
 }
 const start=()=>{const next=createMerchantOrders(cart);setOrders(next);setComplete(false);setLog([]);s.postAgent(financeStartedAgent(next.length));process(0,next)}
 const approve=()=>{if(awaiting===null)return;const i=awaiting;setAwaiting(null);stamp(`Approved ${orders[i].store}`,`One-tap approval for $${orders[i].total.toLocaleString()}.`);finish(i,orders)}
 const skip=()=>{if(awaiting===null)return;const i=awaiting;const next=orders.map((o,n)=>n===i?{...o,status:'skipped' as const}:o);setOrders(next);setAwaiting(null);stamp(`Skipped ${orders[i].store}`,'User chose not to place this order.');process(i+1,next)}
 const cheaper=()=>{if(awaiting===null)return;const order=orders[awaiting],old=order.items[0],replacement=products.find(p=>p.category===old.category&&p.tier==='budget')!;s.selectProduct(replacement.id);const saving=old.price-replacement.price;const updated={...order,items:[replacement,...order.items.slice(1)],subtotal:order.subtotal-saving,total:order.total-saving,tax:Math.round((order.subtotal-saving)*.09375),savings:order.savings+saving,status:'pending' as const};const next=orders.map((o,i)=>i===awaiting?updated:o);setOrders(next);setAwaiting(null);stamp(`Found a cheaper ${old.category}`,`${replacement.name} saves $${saving.toLocaleString()}; re-checking mandate.`);process(active,next)}
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
 const paid=orders.filter(o=>o.status==='confirmed').reduce((n,o)=>n+o.total,0),saved=Math.max(0,s.originalTotal-s.total)+orders.reduce((n,o)=>n+o.savings,0)
 const plans=installmentPlans(s.grandTotal)
 return <div className="checkout"><div className="panel-title"><span>06</span><h1>Checkout</h1><p>Your Finance Agent follows your rules, store by store.</p></div>
 {s.grandTotal>s.budget&&<div className="tip"><span>i</span>This order is ${(s.grandTotal-s.budget).toLocaleString()} over your ${s.budget.toLocaleString()} room budget. The agent will still place every order within its mandate — anything over the mandate limit will be skipped with a note, not block checkout.</div>}
 {!authorized||editing?<div className="checkout-card"><h3>Give your Finance Agent a mandate</h3><label>Total spending limit<input type="number" value={mandate.totalLimit} onChange={e=>setMandate({...mandate,totalLimit:+e.target.value})}/></label><label>Per-item limit<input type="number" value={mandate.itemLimit} onChange={e=>setMandate({...mandate,itemLimit:+e.target.value})}/></label><label>Auto-approve purchases under<input type="number" value={mandate.autoApprove} onChange={e=>setMandate({...mandate,autoApprove:+e.target.value})}/></label><fieldset><legend>Allowed stores</legend>{stores.map(store=><label className="check" key={store}><input type="checkbox" checked={mandate.allowedStores.includes(store)} onChange={e=>setMandate({...mandate,allowedStores:e.target.checked?[...mandate.allowedStores,store]:mandate.allowedStores.filter(x=>x!==store)})}/>{store}</label>)}</fieldset><label className="check"><input type="checkbox" checked={mandate.waitForDrops} onChange={e=>setMandate({...mandate,waitForDrops:e.target.checked})}/>Wait up to 7 days when savings exceed 10%</label><button className="primary" onClick={authorize}>Authorize agent</button></div>:<><button className="mandate-chip" onClick={()=>setEditing(true)}>Up to ${mandate.totalLimit.toLocaleString()} · ${mandate.itemLimit}/item · Auto ${mandate.autoApprove} ✎</button>
 <div className="checkout-card"><h3>Payment method</h3><div className="test-card"><span>VISA</span><b>•••• 4242</b><small>Test card</small></div><div className="pay-modes">{(['full','split','installments'] as PaymentMode[]).map(x=><button className={mode===x?'active':''} onClick={()=>setMode(x)}>{x==='full'?'Pay in full':x==='split'?'Split with roommates':'Pay over time'}</button>)}</div>
 {mode==='split'&&<div className="split-box"><div><button className={split==='even'?'active':''} onClick={()=>setSplit('even')}>Split evenly</button><button className={split==='item'?'active':''} onClick={()=>setSplit('item')}>By item</button></div>{people.map((name,i)=><label key={i}><input value={name} onChange={e=>setPeople(v=>v.map((n,j)=>j===i?e.target.value:n))}/><span>${Math.round(s.grandTotal/(people.length+1)).toLocaleString()} · Request sent</span></label>)}{people.length<3&&<button onClick={()=>setPeople(v=>[...v,`Roommate ${v.length+1}`])}>+ Add person</button>}</div>}
 {mode==='installments'&&<div className="plans">{plans.map(p=><div className={p.recommended?'recommended':''}><b>{p.label}</b><span>${p.monthly}/payment</span><small>${p.interest} interest · ${p.total} total</small>{p.recommended&&<em>Recommended · $0 interest and fits your mandate</em>}</div>)}</div>}</div>
 {!orders.length&&!complete&&<button className="primary checkout-go" onClick={start}>Place order</button>}
 {!!orders.length&&<div className="merchant-list">{orders.map((o,i)=><div className={`merchant ${o.status}`}><div><b>{o.store}</b><span>${o.total.toLocaleString()}</span></div><small>{o.items.length} item{o.items.length!==1?'s':''} · Tax ${o.tax} · Delivery ${o.delivery}</small>{active===i&&o.status!=='approval'&&<div className="stage-line">{ORDER_STAGES.map((x,n)=><span className={n<=stage?'done':''}>{n<stage?'✓':n===stage?'•':'○'} {x}</span>)}</div>}{o.event&&<em>{o.event}</em>}{o.orderNumber&&<strong>{o.orderNumber}</strong>}</div>)}</div>}
 {awaiting!==null&&<div className="approval-card"><b>{orders[awaiting].event?.includes('Stock')?'Approve in-stock alternative?':`Approve $${orders[awaiting].total.toLocaleString()} order at ${orders[awaiting].store}?`}</b><div><button onClick={approve}>Approve</button><button onClick={skip}>Skip</button><button onClick={cheaper}>Find cheaper</button></div></div>}
 {complete&&<div className="confirmation"><h3>Checkout complete</h3><div className="paid-summary"><span><small>Total paid</small><b>${paid.toLocaleString()}</b></span><span><small>Total saved</small><b>${saved.toLocaleString()}</b></span><span><small>Orders</small><b>{orders.filter(o=>o.status==='confirmed').length}</b></span></div><div className="ledger"><i style={{width:`${Math.min(100,paid/mandate.totalLimit*100)}%`}}/><label>Budget ${mandate.totalLimit.toLocaleString()} · Paid ${paid.toLocaleString()} · Remaining ${Math.max(0,mandate.totalLimit-paid).toLocaleString()}</label></div><h4>Receipts & delivery</h4>{orders.filter(o=>o.status==='confirmed').map((o,i)=><div className="receipt" key={o.id}><span><b>{o.store}</b><small>{o.orderNumber} · Arrives {deliveryDate(i)}</small>{o.visaTransactionId?<small>CyberSource sandbox txn {o.visaTransactionId}</small>:o.visaSimulated?<small>CyberSource sandbox unreachable · simulated</small>:null}{o.refundId&&<small>Refunded · CyberSource txn {o.refundId}</small>}{o.refundError&&<small>Refund failed: {o.refundError}</small>}</span><div className="receipt-actions"><button onClick={()=>window.print()}>Download receipt</button>{o.visaTransactionId&&!o.refundId&&<button disabled={o.refunding} onClick={()=>requestRefund(o.id)}>{o.refunding?'Refunding…':'Refund'}</button>}</div></div>)}<h4>Agent activity</h4><div className="audit">{log.map(x=><div><time>{x.time}</time><span><b>{x.text}</b><small>{x.reason}</small></span></div>)}</div></div>}</>}</div>
}
