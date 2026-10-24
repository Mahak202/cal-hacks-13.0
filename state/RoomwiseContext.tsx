import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { products, premiumSelection, registerLiveProducts, type Category } from '../data/products'
import { agentSpeak, budgetAlreadyAgent, budgetEditAgent, budgetSummaryAgent, budgetSwapAgent, comparisonAgent, designAgent, designReply, planRoomBudget, productInspectAgent, productSwapAgent, quotationAgent, unknownAgent, wabiSabiAgent, type AgentKind, type AgentMessage, type Swap } from '../agents/mockAgents'
import { fetchLiveProducts, type LiveProduct } from '../services/apify'
import { runAgentCommand as callClaudeAgent, type HistoryTurn } from '../services/claude'

export type MyItem = { id: string; name: string; height: number; kind: 'imported' | 'generated'; imageUrl?: string }
export type RoomItem = { id:string; productId:string; category:Category; x:number; z:number; rotation:number }
type Store = {
  step:number;maxStep:number;setStep:(n:number)=>void;budget:number;setBudget:(n:number)=>void
  selected:Record<Category,string>;selectProduct:(id:string)=>void;optimize:()=>void
  category:Category;setCategory:(c:Category)=>void;messages:AgentMessage[];typing:boolean
  captured:boolean;capture:()=>void;resetCapture:()=>void;style:string;setStyle:(s:string)=>void;roomImage:string;setRoomImage:(s:string)=>void
  total:number;tax:number;delivery:number;grandTotal:number
  libraryOpen:boolean;setLibraryOpen:(v:boolean)=>void;inspectProduct:(c:Category)=>void
  myItems:MyItem[];addMyItem:(item:Omit<MyItem,'id'>)=>void
  selectedObject:Category|null;highlightCategory:Category|null;placedItems:string[];placeMyItem:(id:string)=>void
  compareProducts:(ids:string[])=>void;runCommand:(text:string)=>Promise<void>;revertSwap:(swap:Swap)=>void
  undoAll:()=>void;originalTotal:number;budgetRan:boolean;wallTone:number
  quoteScreenshot:string;setQuoteScreenshot:(v:string)=>void;postQuote:()=>void
  roomBuilt:boolean;roomItems:RoomItem[];selectedItemId:string|null;setSelectedItemId:(id:string|null)=>void
  moveItem:(id:string,x:number,z:number,rotation?:number)=>boolean;rotateItem:(id:string,amount?:number)=>void
  duplicateItem:(id:string)=>void;deleteItem:(id:string)=>void;addProduct:(id:string,x?:number,z?:number)=>void
  undo:()=>void;redo:()=>void;canUndo:boolean;canRedo:boolean
  beginTransform:()=>void;dragging:boolean;setDragging:(v:boolean)=>void
  postAgent:(m:AgentMessage,delay?:number)=>void;paidTotal:number;checkoutSaved:number;setCheckoutSummary:(paid:number,saved:number)=>void
  shopLive:(category:Category,stores?:string[],query?:string)=>Promise<LiveProduct[]>;liveLoading:boolean
}
const Context=createContext<Store|null>(null)
const initialTotal=Object.values(premiumSelection).reduce((sum,id)=>sum+(products.find(p=>p.id===id)?.price||0),0)
export function RoomwiseProvider({children}:{children:ReactNode}){
 const [step,setStepState]=useState(1),[maxStep,setMaxStep]=useState(1),[budget,setBudget]=useState(2000)
 const setStep=(n:number)=>{setStepState(n);setMaxStep(v=>Math.max(v,n))}
 const [selected,setSelected]=useState(premiumSelection),[category,setCategory]=useState<Category>('bed')
 const [captured,setCaptured]=useState(false),[roomBuilt,setRoomBuilt]=useState(false),[style,setStyleState]=useState('Japandi Calm'),[roomImage,setRoomImage]=useState('')
 const [libraryOpen,setLibraryOpen]=useState(false),[myItems,setMyItems]=useState<MyItem[]>([])
 const [selectedObject,setSelectedObject]=useState<Category|null>(null),[highlightCategory,setHighlightCategory]=useState<Category|null>(null)
 const [placedItems,setPlacedItems]=useState<string[]>([]),[typing,setTyping]=useState(false),[wallTone,setWallTone]=useState(0)
 const [messages,setMessages]=useState<AgentMessage[]>([{id:0,agent:'Design',text:'Upload a room photo and I’ll map the space into an editable scene.',detail:'I’ll identify architecture, furniture and lighting.'}])
 const [snapshot,setSnapshot]=useState<Record<Category,string>|null>(null),[budgetRan,setBudgetRan]=useState(false),[quoteScreenshot,setQuoteScreenshot]=useState('')
 const [roomItems,setRoomItems]=useState<RoomItem[]>([]),[selectedItemId,setSelectedItemId]=useState<string|null>(null)
 const [dragging,setDragging]=useState(false)
 const [past,setPast]=useState<RoomItem[][]>([]),[future,setFuture]=useState<RoomItem[][]>([])
 const [paidTotal,setPaidTotal]=useState(0),[checkoutSaved,setCheckoutSaved]=useState(0)
 const [liveLoading,setLiveLoading]=useState(false)
 const captureTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const agentHistoryRef=useRef<HistoryTurn[]>([])
 const total=useMemo(()=>roomItems.reduce((sum,item)=>sum+(products.find(p=>p.id===item.productId)?.price||0),0),[roomItems])
 const tax=Math.round(total*.09375),delivery=new Set(roomItems.map(item=>products.find(p=>p.id===item.productId)?.store)).size*49,grandTotal=total+tax+delivery
 const post=(message:AgentMessage,delay=0)=>setTimeout(()=>{setTyping(true);setTimeout(()=>{setMessages(v=>[...v,message]);setTyping(false)},700)},delay)
 const setCheckoutSummary=(paid:number,saved:number)=>{setPaidTotal(paid);setCheckoutSaved(saved)}
 const setStyle=(next:string)=>{setStyleState(next);if(next==='Wabi-Sabi Warmth')post(wabiSabiAgent(),2100)}
 const commit=(next:RoomItem[])=>{setPast(v=>[...v.slice(-39),roomItems]);setFuture([]);setRoomItems(next)}
 const addProduct=(id:string,x=0,z=0)=>{const p=products.find(v=>v.id===id)!;const item={id:`room-${Date.now()}-${Math.random()}`,productId:id,category:p.category,x,z,rotation:0};commit([...roomItems,item]);setSelectedItemId(item.id);setSelected(v=>({...v,[p.category]:id}));post(productSwapAgent(p.name,p.price))}
 const selectProduct=(id:string)=>{const p=products.find(x=>x.id===id)!;const active=roomItems.find(i=>i.id===selectedItemId);if(active&&active.category===p.category){const old=products.find(x=>x.id===active.productId)!;commit(roomItems.map(i=>i.id===active.id?{...i,productId:id}:i));setSelected(v=>({...v,[p.category]:id}));post(productSwapAgent(p.name,p.price-old.price))}else addProduct(id)}
 const inspectProduct=(c:Category)=>{const p=products.find(x=>x.id===selected[c])!;setSelectedObject(c);setHighlightCategory(c);setTimeout(()=>setHighlightCategory(null),900);setCategory(c);setStep(3);setLibraryOpen(true);post(productInspectAgent(p))}
 const capture=()=>{if(captureTimer.current)clearTimeout(captureTimer.current);setCaptured(true);post(designAgent(),1800);captureTimer.current=setTimeout(()=>{const order:Category[]=['bed','rug','bench','sideTables','pendants','artwork','planter'];setRoomBuilt(true);setRoomItems(order.map(category=>({id:`initial-${category}`,productId:premiumSelection[category],category,x:0,z:0,rotation:0})));setStep(2);captureTimer.current=null},2500)}
 const resetCapture=()=>{if(captureTimer.current)clearTimeout(captureTimer.current);captureTimer.current=null;setCaptured(false);setRoomBuilt(false);setRoomImage('');setRoomItems([]);setSelectedItemId(null);setPast([]);setFuture([]);setPaidTotal(0);setCheckoutSaved(0);setMessages([{id:0,agent:'Design',text:'Upload a room photo and I’ll map the space into an editable scene.',detail:'I’ll identify architecture, furniture and lighting.'}]);setStepState(1);setMaxStep(1)}
 const optimize=(target=budget)=>{
  const plan=planRoomBudget(roomItems,target,style)
  if(!plan.swaps.length){const upgrade=products.find(p=>p.category==='rug'&&p.price+total<=target&&p.price>(products.find(x=>x.id===selected.rug)?.price||0));post(budgetAlreadyAgent(total,target,upgrade));return}
  setSnapshot({...selected});setBudgetRan(true)
  let running={...selected}
  plan.swaps.forEach((swap,i)=>setTimeout(()=>{setHighlightCategory(swap.category);setTimeout(()=>{running={...running,[swap.category]:swap.to.id};setSelected(running);setRoomItems(items=>items.map(item=>item.id===swap.itemId?{...item,productId:swap.to.id}:item));setTimeout(()=>setHighlightCategory(null),450)},300);post(budgetSwapAgent(swap))},i*800))
  setTimeout(()=>post(budgetSummaryAgent(total,plan.total,plan.swaps.length)),plan.swaps.length*800)
 }
 const revertSwap=(swap:Swap)=>{setSelected(v=>({...v,[swap.category]:swap.from.id}));setHighlightCategory(swap.category);setTimeout(()=>setHighlightCategory(null),900);post(designReply(`Reverted ${swap.category} to ${swap.from.name}.`))}
 const undoAll=()=>{if(snapshot){setSelected(snapshot);setBudgetRan(false);setSnapshot(null);post(designReply('All budget swaps have been undone.'))}}
 const compareProducts=(ids:string[])=>post(comparisonAgent(ids.map(id=>products.find(p=>p.id===id)!),style))
 const shopLive=async(targetCategory:Category,targetStores?:string[],query?:string):Promise<LiveProduct[]>=>{
  setLiveLoading(true)
  const label=targetStores?.length?`${targetStores.join(', ')} `:''
  try{
   const result=await fetchLiveProducts(targetCategory,style,targetStores,query)
   registerLiveProducts(result.products)
   const warningNote=result.warnings.length?` ${result.warnings.join(' ')}`:''
   post(designReply(result.products.length?`Found ${result.products.length} live ${label}${targetCategory} listing${result.products.length===1?'':'s'} via Apify.${warningNote}`:`Apify didn't find priced ${label}${targetCategory} listings for this search.${warningNote}`))
   return result.products
  }catch(err:any){
   post(designReply(`Couldn't fetch live listings: ${err?.message||err}`))
   throw err
  }finally{
   setLiveLoading(false)
  }
 }
 const TOOL_HANDLERS:Record<string,(input:any)=>void>={
  swap_tier:({category,tier})=>{
   const p=products.find(p=>p.category===category&&p.tier===tier);if(!p)return
   const existing=roomItems.find(i=>i.category===category)
   if(existing){const old=products.find(x=>x.id===existing.productId)!;commit(roomItems.map(i=>i.id===existing.id?{...i,productId:p.id}:i));setSelected(v=>({...v,[category]:p.id}));post(productSwapAgent(p.name,p.price-old.price))}
   else addProduct(p.id)
  },
  add_item:({category})=>{
   // Every category is pre-populated when the room is first built, so
   // "add X" almost always finds one already there — treat that as "add
   // one more" (duplicate) rather than silently asking a clarifying
   // question the user didn't ask for.
   const existing=roomItems.find(i=>i.category===category)
   if(existing)duplicateItem(existing.id)
   else{const p=products.find(p=>p.category===category&&p.tier==='mid');if(p)addProduct(p.id)}
  },
  remove_item:({category})=>{const item=roomItems.find(i=>i.category===category);if(item)deleteItem(item.id);else post(designReply(`There's no ${category} in the room to remove.`))},
  duplicate_item:({category})=>{const existing=roomItems.find(i=>i.category===category);if(existing)duplicateItem(existing.id);else post(designReply(`There's no ${category} in the room yet to duplicate.`))},
  change_style:({style:newStyle})=>{if(newStyle&&newStyle!==style)setStyle(newStyle)},
  adjust_wall_tone:({direction})=>{const warm=direction==='warmer';setWallTone(v=>v+(warm?1:-1));post(designReply(`I shifted the walls ${warm?'warmer':'cooler'}.`,'The room finish has been updated live.'))},
  optimize_budget:({targetAmount})=>{const target=typeof targetAmount==='number'?targetAmount:budget;if(typeof targetAmount==='number')setBudget(target);optimize(target)},
  undo_budget_swaps:()=>undoAll(),
  undo_last_action:()=>undo(),
  inspect_product:({category})=>inspectProduct(category),
  compare_category:({category})=>compareProducts(products.filter(p=>p.category===category).map(p=>p.id)),
  shop_live:({category,store})=>{shopLive(category,store?[store]:undefined).catch(()=>{})},
  create_quote:()=>{setStep(5);post(quotationAgent(grandTotal))},
  go_to_step:({step:target})=>{if(typeof target==='number')setStep(Math.max(1,Math.min(6,Math.round(target))))},
  speak:({agent,text}:{agent:AgentKind;text:string})=>{if(agent&&text)post(agentSpeak(agent,text))},
 }
 const runCommand=async(raw:string)=>{
  setTyping(true)
  const context={
   style,budget,roomTotal:grandTotal,
   roomItems:roomItems.map(i=>{const p=products.find(x=>x.id===i.productId);return p?{category:i.category,name:p.name,price:p.price,tier:p.tier,store:p.store}:null}).filter(Boolean),
  }
  try{
   const{reply,toolCalls}=await callClaudeAgent(raw,context,agentHistoryRef.current)
   if(reply)post(designReply(reply))
   if(toolCalls.length)toolCalls.forEach(call=>TOOL_HANDLERS[call.name]?.(call.input))
   else if(!reply)runCommandFallback(raw)
   const spoken=toolCalls.filter(c=>c.name==='speak').map(c=>(c.input as any).text).filter(Boolean)
   const actions=toolCalls.filter(c=>c.name!=='speak').map(c=>`${c.name}(${JSON.stringify(c.input)})`)
   const summary=[...spoken,reply,actions.length?`Did: ${actions.join(', ')}`:''].filter(Boolean).join(' ')||'(no action taken)'
   agentHistoryRef.current=[...agentHistoryRef.current,{role:'user' as const,content:raw},{role:'assistant' as const,content:summary}].slice(-16)
  }catch(err:any){
   console.warn('Claude agent command failed, falling back to keyword parser:',err)
   runCommandFallback(raw)
  }
 }
 const runCommandFallback=(raw:string)=>{
  const text=raw.toLowerCase();const aliases:Record<Category,string[]>={
   bed:['bed'],rug:['rug'],pendants:['pendant','light','lamp'],sideTables:['side table','sidetable','table','nightstand'],
   bench:['bench'],planter:['planter','olive','tree','plant'],artwork:['art','canvas','painting'],
  };const found=(Object.keys(aliases) as Category[]).find(c=>aliases[c].some(k=>text.includes(k)))
  const styleAliases:Record<string,string[]>={
   'Wabi-Sabi Warmth':['wabi-sabi','wabi sabi'],'Japandi Calm':['japandi'],
   'Warm Mid-Century':['mid-century','midcentury','mid century'],'Coastal Light':['coastal'],
  };const foundStyle=Object.keys(styleAliases).find(name=>styleAliases[name].some(k=>text.includes(k)))
  if(text.includes('wall')&&(text.includes('warm')||text.includes('cool'))){const warm=text.includes('warm');setWallTone(v=>v+(warm?1:-1));post(designReply(`I shifted the walls ${warm?'warmer':'cooler'}.`,'The room finish has been updated live.'));return}
  if(foundStyle&&foundStyle!==style){setStyle(foundStyle);return}
  if(found&&(text.includes('remove')||text.includes('delete')||text.includes('take out')||text.includes('get rid of'))){const item=roomItems.find(i=>i.category===found);if(item)deleteItem(item.id);else post(designReply(`There's no ${found} in the room to remove.`));return}
  if(found&&(text.includes('upgrade')||text.includes('nicer')||text.includes('premium')||text.includes('fancier')||text.includes('better quality'))){const p=products.find(p=>p.category===found&&p.tier==='premium')!;selectProduct(p.id);return}
  if(found&&(text.includes('replace')||text.includes('cheap')||text.includes('affordable')||text.includes('swap')||text.includes('budget option')||text.includes('lower cost'))){const p=products.find(p=>p.category===found&&p.tier==='budget')!;selectProduct(p.id);return}
  if(found&&(text.includes('show')||text.includes('exact')||text.includes('which')||text.includes('what is')||text.includes('tell me about')||text.includes('details'))){inspectProduct(found);return}
  if(text.includes('budget')||text.includes('under')||text.includes('optimize')||text.includes('reduce')||text.match(/\$[\d,]+/)){const amount=text.match(/\$?\s?([\d,]{3,})/)?.[1];const target=amount?Number(amount.replace(/,/g,'')):budget;if(amount)setBudget(target);optimize(target);return}
  if(text.includes('quote')||text.includes('checkout')||text.includes('finalize')||text.includes('ready to buy')){setStep(5);post(quotationAgent(grandTotal));return}
  if(found){post(designReply(`I see you mentioned the ${found}, but I'm not sure what to do with it.`,`Try: "swap it for something cheaper", "upgrade the ${found}", "show me the exact one", or "remove the ${found}".`));return}
  post(unknownAgent())
 }
 const postQuote=()=>post(quotationAgent(grandTotal))
 const addMyItem=(item:Omit<MyItem,'id'>)=>setMyItems(v=>[...v,{...item,id:`custom-${Date.now()}`}])
 const placeMyItem=(id:string)=>setPlacedItems(v=>v.includes(id)?v:[...v,id])
 const moveItem=(id:string,x:number,z:number,rotation?:number)=>{const item=roomItems.find(i=>i.id===id);if(!item)return false;const nx=Math.max(-6,Math.min(6,x)),nz=item.category==='artwork'?0:Math.max(-7,Math.min(7,z));const bases:Record<Category,[number,number]>={bed:[0,-3.7],rug:[0,1],pendants:[0,-4.5],sideTables:[0,-4.25],bench:[0,2],planter:[5.25,-4.8],artwork:[0,-7.78]};const collidable=!['rug','pendants','artwork'].includes(item.category);const blocked=collidable&&roomItems.some(other=>other.id!==id&&!['rug','pendants','artwork'].includes(other.category)&&Math.hypot(bases[item.category][0]+nx-(bases[other.category][0]+other.x),bases[item.category][1]+nz-(bases[other.category][1]+other.z))<1.5);if(blocked)return false;setRoomItems(v=>v.map(i=>i.id===id?{...i,x:nx,z:nz,rotation:rotation??i.rotation}:i));return true}
 const rotateItem=(id:string,amount=Math.PI/4)=>{const next=roomItems.map(i=>i.id===id?{...i,rotation:i.rotation+amount}:i);commit(next)}
 const duplicateItem=(id:string)=>{const source=roomItems.find(i=>i.id===id);if(!source)return;const copy={...source,id:`room-${Date.now()}`,x:source.x+1};commit([...roomItems,copy]);setSelectedItemId(copy.id);const p=products.find(v=>v.id===copy.productId)!;post(budgetEditAgent('Added',p.name,p.price,total+p.price,budget))}
 const deleteItem=(id:string)=>{const item=roomItems.find(i=>i.id===id);if(!item)return;const p=products.find(v=>v.id===item.productId)!;commit(roomItems.filter(i=>i.id!==id));setSelectedItemId(null);post(budgetEditAgent('Removed',p.name,-p.price,total-p.price,budget))}
 const undo=()=>{const prev=past[past.length-1];if(!prev)return;setFuture(v=>[roomItems,...v]);setRoomItems(prev);setPast(v=>v.slice(0,-1));setSelectedItemId(null)}
 const redo=()=>{const next=future[0];if(!next)return;setPast(v=>[...v,roomItems]);setRoomItems(next);setFuture(v=>v.slice(1));setSelectedItemId(null)}
 const beginTransform=()=>{setPast(v=>[...v.slice(-39),roomItems]);setFuture([])}
 return <Context.Provider value={{step,maxStep,setStep,budget,setBudget,selected,selectProduct,optimize,category,setCategory,messages,typing,captured,capture,resetCapture,style,setStyle,roomImage,setRoomImage,total,tax,delivery,grandTotal,libraryOpen,setLibraryOpen,inspectProduct,myItems,addMyItem,selectedObject,highlightCategory,placedItems,placeMyItem,compareProducts,runCommand,revertSwap,undoAll,originalTotal:initialTotal,budgetRan,wallTone,quoteScreenshot,setQuoteScreenshot,postQuote,roomBuilt,roomItems,selectedItemId,setSelectedItemId,moveItem,rotateItem,duplicateItem,deleteItem,addProduct,undo,redo,canUndo:past.length>0,canRedo:future.length>0,beginTransform,dragging,setDragging,postAgent:post,paidTotal,checkoutSaved,setCheckoutSummary,shopLive,liveLoading}}>{children}</Context.Provider>
}
export const useRoomwise=()=>useContext(Context)!
