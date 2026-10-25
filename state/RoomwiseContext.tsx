import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { products, premiumSelection, registerLiveProducts, type Category } from '../data/products'
import { agentSpeak, budgetAlreadyAgent, budgetEditAgent, budgetSummaryAgent, budgetSwapAgent, comparisonAgent, designAgent, designReply, planRoomBudget, productInspectAgent, productSwapAgent, quotationAgent, styleMatch, unknownAgent, wabiSabiAgent, type AgentKind, type AgentMessage, type Swap } from '../agents/mockAgents'
import type { Invoice } from '../services/payments'
import { calculatePricing } from '../services/pricing'
import { fetchLiveProducts, type LiveProduct } from '../services/apify'
import { runAgentCommand as callClaudeAgent, type HistoryTurn } from '../services/claude'

export type MyItem = { id:string;name:string;height:number;width:number;depth:number;price:number;kind:'imported'|'generated';template:string;imageUrl?:string }
export type RoomItem = { id:string;productId:string;category:Category|'custom';x:number;y?:number;z:number;rotation:number;scaleX:number;scaleY:number;scaleZ:number }
export type RoomDimensions={length:number|null;width:number|null;height:number|null;unit:'ft'|'m';estimated:boolean}
export type BudgetScenario={id:'A'|'B';budget:number;items:RoomItem[];total:number;swaps:(Swap&{itemId:string})[];durability:number;styleMatch:number;saved:number;snapshot?:string}
export type Collaborator={id:string;name:string;color:string;role:'edit'|'view'|'approve';activity:string;lastSeen:number;simulated?:boolean}
export type TeamComment={id:string;itemId:string;authorId:string;author:string;color:string;text:string;createdAt:number}
export type TeamActivity={id:string;authorId:string;author:string;text:string;createdAt:number;undoable?:boolean}
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
  resizeItem:(id:string,x:number,y:number,z:number)=>void
  roomDimensions:RoomDimensions;setRoomDimensions:(next:Partial<RoomDimensions>)=>void
  budgetScenarios:BudgetScenario[];activeScenario:'A'|'B'|null;previewItems:RoomItem[]|null;runBudgetComparison:(a:number,b:number)=>void;previewScenario:(id:'A'|'B')=>void;applyScenario:(id:'A'|'B')=>void;setScenarioSnapshot:(id:'A'|'B',image:string)=>void
  scenarioChange:{itemId:string;label:string}|null
  postAgent:(m:AgentMessage,delay?:number)=>void;paidTotal:number;checkoutSaved:number;setCheckoutSummary:(paid:number,saved:number)=>void
  invoices:Invoice[];addInvoice:(invoice:Invoice)=>void;purchasedProductIds:string[]
  checkoutItemIds:string[]|null;checkoutHighlightId:string|null;setCheckoutItemIds:(ids:string[]|null)=>void;toggleCheckoutItem:(id:string)=>void
  checkoutQuantities:Record<string,number>;setCheckoutQuantities:(value:Record<string,number>)=>void
  roomId:string;clientId:string;collaboratorName:string;setCollaboratorName:(name:string)=>void;collaboratorRole:Collaborator['role']
  inviteRole:Collaborator['role'];setInviteRole:(role:Collaborator['role'])=>void;collaborators:Collaborator[]
  cursors:Record<string,{x:number;y:number;color:string;name:string}>;broadcastCursor:(x:number,y:number)=>void
  locks:Record<string,Collaborator>;acquireLock:(itemId:string)=>boolean;releaseLock:(itemId:string)=>void
  comments:TeamComment[];addComment:(itemId:string,text:string)=>void;activities:TeamActivity[]
  votes:Record<string,string[]>;vote:(key:string)=>void;simulateTeammate:boolean;setSimulateTeammate:(value:boolean)=>void
  purchaseApproval:{amount:number;by:string}|null;requestPurchaseApproval:(amount:number,label:string)=>void
  shopLive:(category:Category,stores?:string[],query?:string)=>Promise<LiveProduct[]>;liveLoading:boolean
}
const Context=createContext<Store|null>(null)
const defaultCategories:Category[]=['bed','rug','bench','sideTables','pendants','artwork','planter','curtains']
const mudPotItems:MyItem[]=[
 {id:'decor-matka-large',name:'Large hand-painted matka',height:2,width:1.7,depth:1.7,price:120,kind:'imported',template:'mudPot'},
 {id:'decor-matka-medium',name:'Medium plain terracotta',height:1.2,width:1.05,depth:1.05,price:45,kind:'imported',template:'mudPot'},
 {id:'decor-matka-small',name:'Small rough clay pot',height:.75,width:.7,depth:.7,price:15,kind:'imported',template:'mudPot'},
]
const roomId=typeof window!=='undefined'?new URL(window.location.href).searchParams.get('room')||Math.random().toString(36).slice(2,8):'demo'
if(typeof window!=='undefined'&&!new URL(window.location.href).searchParams.get('room')){const url=new URL(window.location.href);url.searchParams.set('room',roomId);window.history.replaceState({},'',url)}
const clientId=typeof window!=='undefined'?crypto.randomUUID():'server'
const collaboratorColors=['#6c63a8','#3f7b62','#b36a45','#4777a8','#9a5b7b']
const colorFor=(id:string)=>collaboratorColors[[...id].reduce((sum,char)=>sum+char.charCodeAt(0),0)%collaboratorColors.length]
const initialTotal=defaultCategories.reduce((sum,category)=>sum+(products.find(p=>p.id===premiumSelection[category])?.price||0),0)
export function RoomwiseProvider({children}:{children:ReactNode}){
 const [step,setStepState]=useState(1),[maxStep,setMaxStep]=useState(1),[budget,setBudget]=useState(4000)
 const setStep=(n:number)=>{setStepState(n);setMaxStep(v=>Math.max(v,n))}
 const [selected,setSelected]=useState(premiumSelection),[category,setCategory]=useState<Category>('bed')
 const [captured,setCaptured]=useState(false),[roomBuilt,setRoomBuilt]=useState(false),[style,setStyleState]=useState('Japandi Calm'),[roomImage,setRoomImage]=useState('')
 const [libraryOpen,setLibraryOpen]=useState(false),[myItems,setMyItems]=useState<MyItem[]>(mudPotItems)
 const [selectedObject,setSelectedObject]=useState<Category|null>(null),[highlightCategory,setHighlightCategory]=useState<Category|null>(null)
 const [placedItems,setPlacedItems]=useState<string[]>([]),[typing,setTyping]=useState(false),[wallTone,setWallTone]=useState(0)
 const [messages,setMessages]=useState<AgentMessage[]>([{id:0,agent:'Design',text:'Upload a room photo and I’ll map the space into an editable scene.',detail:'I’ll identify architecture, furniture and lighting.'}])
 const [snapshot,setSnapshot]=useState<Record<Category,string>|null>(null),[budgetRan,setBudgetRan]=useState(false),[quoteScreenshot,setQuoteScreenshot]=useState('')
 const [roomItems,setRoomItems]=useState<RoomItem[]>([]),[selectedItemId,setSelectedItemId]=useState<string|null>(null)
 const [dragging,setDragging]=useState(false)
 const [past,setPast]=useState<RoomItem[][]>([]),[future,setFuture]=useState<RoomItem[][]>([])
 const [paidTotal,setPaidTotal]=useState(0),[checkoutSaved,setCheckoutSaved]=useState(0)
 const [invoices,setInvoices]=useState<Invoice[]>([]),[purchasedProductIds,setPurchasedProductIds]=useState<string[]>([])
 const [checkoutItemIds,setCheckoutItemIdsState]=useState<string[]|null>(null),[checkoutHighlightId,setCheckoutHighlightId]=useState<string|null>(null)
 const [checkoutQuantities,setCheckoutQuantities]=useState<Record<string,number>>({})
 const [roomDimensions,setRoomDimensionsState]=useState<RoomDimensions>({length:null,width:null,height:null,unit:'ft',estimated:false})
 const [budgetScenarios,setBudgetScenarios]=useState<BudgetScenario[]>([]),[activeScenario,setActiveScenario]=useState<'A'|'B'|null>(null)
 const [previewItems,setPreviewItems]=useState<RoomItem[]|null>(null)
 const [scenarioChange,setScenarioChange]=useState<{itemId:string;label:string}|null>(null)
 const initialRole=(typeof window!=='undefined'?new URL(window.location.href).searchParams.get('role'):null) as Collaborator['role']|null
 const [collaboratorName,setCollaboratorNameState]=useState(()=>typeof window!=='undefined'?sessionStorage.getItem('roomwise-name')||'':'')
 const [inviteRole,setInviteRole]=useState<Collaborator['role']>('edit'),collaboratorRole=initialRole&&['edit','view','approve'].includes(initialRole)?initialRole:'edit'
 const [collaborators,setCollaborators]=useState<Collaborator[]>([]),[cursors,setCursors]=useState<Record<string,{x:number;y:number;color:string;name:string}>>({})
 const [locks,setLocks]=useState<Record<string,Collaborator>>({}),[comments,setComments]=useState<TeamComment[]>([]),[activities,setActivities]=useState<TeamActivity[]>([])
 const [votes,setVotes]=useState<Record<string,string[]>>({}),[simulateTeammate,setSimulateTeammateState]=useState(false),[purchaseApproval,setPurchaseApproval]=useState<{amount:number;by:string}|null>(null)
 const [liveLoading,setLiveLoading]=useState(false)
 const scenarioBase=useRef<RoomItem[]>([])
 const captureTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const agentHistoryRef=useRef<HistoryTurn[]>([])
 const collabChannel=useRef<BroadcastChannel|null>(null),applyingRemote=useRef(false),syncSnapshot=useRef<Record<string,unknown>>({}),identityRef=useRef({name:'',role:'edit' as Collaborator['role']})
 const pricing=useMemo(()=>calculatePricing(roomItems.map(item=>{const product=products.find(p=>p.id===item.productId),custom=myItems.find(p=>p.id===item.productId);return{price:product?.price||custom?.price||0,store:product?.store||'My Studio'}})),[roomItems,myItems])
 const total=pricing.subtotal,tax=pricing.tax,delivery=pricing.delivery,grandTotal=pricing.total
 syncSnapshot.current={roomItems,style,budget,selected,selectedItemId,wallTone}
 identityRef.current={name:collaboratorName,role:collaboratorRole}
 const send=(type:string,payload:unknown)=>collabChannel.current?.postMessage({type,payload,sender:clientId})
 const me=():Collaborator=>({id:clientId,name:collaboratorName||'Guest',color:colorFor(clientId),role:collaboratorRole,activity:selectedItemId?`editing ${roomItems.find(item=>item.id===selectedItemId)?.category||'an object'}`:'viewing the room',lastSeen:Date.now()})
 const setCollaboratorName=(name:string)=>{const clean=name.trim();setCollaboratorNameState(clean);if(clean&&typeof window!=='undefined')sessionStorage.setItem('roomwise-name',clean)}
 useEffect(()=>{if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel(`roomwise:${roomId}`);collabChannel.current=channel;channel.onmessage=event=>{const message=event.data;if(!message||message.sender===clientId)return;const {type,payload}=message;if(type==='request-state'){send('state',syncSnapshot.current);return}if(type==='state'){applyingRemote.current=true;setRoomItems(payload.roomItems||[]);setStyleState(payload.style||'Japandi Calm');setBudget(payload.budget??4000);setSelected(payload.selected||premiumSelection);setSelectedItemId(payload.selectedItemId||null);setWallTone(payload.wallTone||0);setTimeout(()=>applyingRemote.current=false,60)}if(type==='presence'){setCollaborators(current=>[...current.filter(person=>person.id!==payload.id),payload])}if(type==='cursor')setCursors(current=>({...current,[message.sender]:payload}));if(type==='lock')setLocks(current=>payload.active?{...current,[payload.itemId]:payload.person}:Object.fromEntries(Object.entries(current).filter(([id])=>id!==payload.itemId)));if(type==='comment')setComments(current=>current.some(item=>item.id===payload.id)?current:[payload,...current]);if(type==='activity')setActivities(current=>current.some(item=>item.id===payload.id)?current:[payload,...current]);if(type==='vote')setVotes(current=>({...current,[payload.key]:payload.voters}));if(type==='approval'){setPurchaseApproval(payload);setActivities(current=>[{id:`approval-${Date.now()}`,authorId:message.sender,author:payload.by,text:`approved the $${Math.round(payload.amount).toLocaleString()} ${payload.label}`,createdAt:Date.now()},...current])}if(type==='approval-request'&&identityRef.current.role==='approve'){const approval={amount:payload.amount,by:identityRef.current.name||'Approver'};send('approval',approval);setPurchaseApproval(approval)}};send('request-state',{});return()=>{channel.close();collabChannel.current=null}},[])
 useEffect(()=>{if(!collaboratorName)return;const publish=()=>{const person=me();send('presence',person);setCollaborators(current=>[...current.filter(item=>item.id!==clientId&&Date.now()-item.lastSeen<12000),person])};publish();const timer=setInterval(publish,4000);return()=>clearInterval(timer)},[collaboratorName,selectedItemId,collaboratorRole,roomItems])
 useEffect(()=>{if(!collabChannel.current||applyingRemote.current)return;const timer=setTimeout(()=>send('state',{roomItems,style,budget,selected,selectedItemId,wallTone}),80);return()=>clearTimeout(timer)},[roomItems,style,budget,selected,selectedItemId,wallTone])
 const broadcastCursor=(x:number,y:number)=>{if(!collaboratorName)return;send('cursor',{x,y,color:colorFor(clientId),name:collaboratorName});setCursors(current=>({...current,[clientId]:{x,y,color:colorFor(clientId),name:collaboratorName}}))}
 const acquireLock=(itemId:string)=>{const existing=locks[itemId];if(existing&&existing.id!==clientId)return false;if(collaboratorRole==='view')return false;const person=me();setLocks(current=>({...current,[itemId]:person}));send('lock',{itemId,active:true,person});setTimeout(()=>setLocks(current=>current[itemId]?.id===clientId?Object.fromEntries(Object.entries(current).filter(([id])=>id!==itemId)):current),10000);return true}
 const releaseLock=(itemId:string)=>{setLocks(current=>Object.fromEntries(Object.entries(current).filter(([id])=>id!==itemId)));send('lock',{itemId,active:false})}
 const addActivity=(text:string,undoable=false)=>{const activity:TeamActivity={id:crypto.randomUUID(),authorId:clientId,author:collaboratorName||'Guest',text,createdAt:Date.now(),undoable};setActivities(current=>[activity,...current]);send('activity',activity)}
 const addComment=(itemId:string,text:string)=>{if(!text.trim())return;const comment:TeamComment={id:crypto.randomUUID(),itemId,authorId:clientId,author:collaboratorName||'Guest',color:colorFor(clientId),text:text.trim(),createdAt:Date.now()};setComments(current=>[comment,...current]);send('comment',comment);addActivity('added a comment')}
 const vote=(key:string)=>{setVotes(current=>{const voters=current[key]||[],next=voters.includes(clientId)?voters.filter(id=>id!==clientId):[...voters,clientId];send('vote',{key,voters:next});return{...current,[key]:next}})}
 const requestPurchaseApproval=(amount:number,label:string)=>{
  setPurchaseApproval(null);send('approval-request',{amount,label})
  const approver=collaborators.find(person=>person.role==='approve'&&person.id!==clientId)
  const othersActive=collaborators.some(person=>person.id!==clientId&&Date.now()-person.lastSeen<15000)
  if(approver?.simulated)setTimeout(()=>{const approval={amount,by:approver.name};setPurchaseApproval(approval);send('approval',approval);addActivity(`${approver.name} approved the $${Math.round(amount).toLocaleString()} ${label}`)},700)
  // Solo session, nobody else to delegate to — the owner is the de facto
  // approver rather than a dead-end "request approval" button.
  else if(!othersActive)setTimeout(()=>{const approval={amount,by:collaboratorName||'You'};setPurchaseApproval(approval);addActivity(`You approved the $${Math.round(amount).toLocaleString()} ${label}`)},500)
 }
 const setSimulateTeammate=(value:boolean)=>{setSimulateTeammateState(value);const priya:Collaborator={id:'sim-priya',name:'Priya',color:'#9a5b7b',role:'approve',activity:'reviewing Option B',lastSeen:Date.now(),simulated:true};if(!value){setCollaborators(current=>current.filter(person=>person.id!=='sim-priya'));setCursors(current=>Object.fromEntries(Object.entries(current).filter(([id])=>id!=='sim-priya')));return}setCollaborators(current=>[...current.filter(person=>person.id!=='sim-priya'),priya]);setCursors(current=>({...current,'sim-priya':{x:64,y:58,color:priya.color,name:'Priya'}}));send('presence',priya);send('cursor',{x:64,y:58,color:priya.color,name:'Priya'});setTimeout(()=>{setRoomItems(items=>items.map(item=>item.category==='planter'?{...item,x:item.x-.75,z:item.z+.5}:item));const activity={id:'sim-move',authorId:'sim-priya',author:'Priya',text:'moved the planter',createdAt:Date.now()};setActivities(current=>[activity,...current]);send('activity',activity)},900);setTimeout(()=>{const itemId=roomItems.find(item=>item.category==='bed')?.id||roomItems[0]?.id,comment={id:'sim-comment',itemId,authorId:'sim-priya',author:'Priya',color:priya.color,text:'Love this but can we go cheaper on the bed?',createdAt:Date.now()};if(itemId){setComments(current=>[comment,...current]);send('comment',comment)}setVotes(current=>{const voters=[...(current['budget:B']||[]).filter(id=>id!=='sim-priya'),'sim-priya'];send('vote',{key:'budget:B',voters});return{...current,'budget:B':voters}})},1500)}
 const post=(message:AgentMessage,delay=0)=>setTimeout(()=>{setTyping(true);setTimeout(()=>{setMessages(v=>[...v,message]);setTyping(false)},700)},delay)
 const setCheckoutSummary=(paid:number,saved:number)=>{setPaidTotal(paid);setCheckoutSaved(saved)}
 const addInvoice=(invoice:Invoice)=>{setInvoices(v=>[invoice,...v]);setPurchasedProductIds(v=>[...new Set([...v,...invoice.lines.map(line=>line.productId)])])}
 const setCheckoutItemIds=(ids:string[]|null)=>{setCheckoutItemIdsState(ids);if(ids===null)setCheckoutHighlightId(null)}
 const toggleCheckoutItem=(id:string)=>{setCheckoutItemIdsState(v=>{if(!v)return v;const included=v.includes(id),next=included?v.filter(x=>x!==id):[...v,id];setCheckoutHighlightId(included?null:id);return next})}
 const setStyle=(next:string)=>{setStyleState(next);if(next==='Wabi-Sabi Warmth')post(wabiSabiAgent(),2100)}
 const commit=(next:RoomItem[])=>{setPast(v=>[...v.slice(-39),roomItems]);setFuture([]);setRoomItems(next)}
 const addProduct=(id:string,x=0,z=0)=>{const p=products.find(v=>v.id===id)!;const item:RoomItem={id:`room-${Date.now()}-${Math.random()}`,productId:id,category:p.category,x,z,rotation:0,scaleX:1,scaleY:1,scaleZ:1};commit([...roomItems,item]);setSelectedItemId(item.id);setSelected(v=>({...v,[p.category]:id}));post(productSwapAgent(p.name,p.price))}
 const selectProduct=(id:string)=>{const p=products.find(x=>x.id===id)!;const active=roomItems.find(i=>i.id===selectedItemId);if(active&&active.category===p.category){const old=products.find(x=>x.id===active.productId)!;commit(roomItems.map(i=>i.id===active.id?{...i,productId:id}:i));setSelected(v=>({...v,[p.category]:id}));post(productSwapAgent(p.name,p.price-old.price));addActivity(`swapped the ${p.category}`,true)}else addProduct(id)}
 const inspectProduct=(c:Category)=>{const p=products.find(x=>x.id===selected[c])!;setSelectedObject(c);setHighlightCategory(c);setTimeout(()=>setHighlightCategory(null),900);setCategory(c);setStep(3);setLibraryOpen(true);post(productInspectAgent(p))}
 const capture=()=>{if(captureTimer.current)clearTimeout(captureTimer.current);setCaptured(true);captureTimer.current=setTimeout(()=>{const dimensions={length:roomDimensions.length??16,width:roomDimensions.width??14,height:roomDimensions.height??11};setRoomDimensionsState(v=>({...v,...dimensions,estimated:v.length===null||v.width===null||v.height===null}));post(designAgent(dimensions.length,dimensions.width,dimensions.height));setRoomBuilt(true);setRoomItems(defaultCategories.map(category=>({id:`initial-${category}`,productId:premiumSelection[category],category,x:0,z:0,rotation:0,scaleX:1,scaleY:1,scaleZ:1})));setStep(2);captureTimer.current=null},2500)}
 const resetCapture=()=>{if(captureTimer.current)clearTimeout(captureTimer.current);captureTimer.current=null;setCaptured(false);setRoomBuilt(false);setRoomImage('');setRoomItems([]);setRoomDimensionsState({length:null,width:null,height:null,unit:'ft',estimated:false});setBudgetScenarios([]);setActiveScenario(null);setPreviewItems(null);setSelectedItemId(null);setPast([]);setFuture([]);setPaidTotal(0);setCheckoutSaved(0);setMessages([{id:0,agent:'Design',text:'Upload a room photo and I’ll map the space into an editable scene.',detail:'I’ll identify architecture, furniture and lighting.'}]);setStepState(1);setMaxStep(1)}
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
   bed:['bed'],rug:['rug'],pendants:['pendant','light'],sideTables:['side table','sidetable','table'],
   bench:['bench'],planter:['planter','olive','tree'],artwork:['art','canvas'],
   curtains:['curtain','drape','blind','voile'],chair:['chair','seat','lounge','café'],fan:['fan','ceiling fan'],
   outdoorPlanter:['outdoor planter','planter box','lavender','grass'],outdoorChair:['outdoor chair','lounge chair','patio chair'],pergola:['pergola','shade sail','outdoor shade'],stringLights:['string light','cafe light','patio light'],
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
 const placeMyItem=(id:string)=>{const custom=myItems.find(x=>x.id===id);if(!custom)return;const instance:RoomItem={id:`room-${Date.now()}-${Math.random()}`,productId:id,category:'custom',x:0,z:3,rotation:0,scaleX:1,scaleY:1,scaleZ:1};commit([...roomItems,instance]);setSelectedItemId(instance.id);setPlacedItems(v=>[...v,id])}
 const moveItem=(id:string,x:number,z:number,rotation?:number)=>{const item=roomItems.find(i=>i.id===id);if(!item)return false;const wall=['artwork','curtains'].includes(item.category),outdoor=['outdoorPlanter','outdoorChair','pergola','stringLights'].includes(item.category),bases:Record<Category|'custom',[number,number]>={bed:[0,-3.7],rug:[0,1],pendants:[0,-4.5],sideTables:[0,-4.25],bench:[0,2],planter:[5.25,-4.8],artwork:[0,-7.78],curtains:[6.5,1.3],chair:[-4,2],fan:[0,0],outdoorPlanter:[9,0],outdoorChair:[10,0],pergola:[9.5,0],stringLights:[9.5,0],custom:[0,0]},base=bases[item.category],halfW=(roomDimensions.width||14)/2-.65,halfL=(roomDimensions.length||16)/2-.65,nx=item.category==='curtains'?0:outdoor?Math.max(-6,Math.min(12.5,x)):THREEClamp(x,-halfW-base[0],halfW-base[0]),nz=wall?0:outdoor?Math.max(-7,Math.min(7,z)):THREEClamp(z,-halfL-base[1],halfL-base[1]);const collidable=!['rug','pendants','artwork','curtains','fan','stringLights','pergola'].includes(item.category);const blocked=collidable&&roomItems.some(other=>other.id!==id&&!['rug','pendants','artwork','curtains','fan','stringLights','pergola'].includes(other.category)&&Math.hypot(base[0]+nx-(bases[other.category][0]+other.x),base[1]+nz-(bases[other.category][1]+other.z))<1.5);if(blocked)return false;const custom=myItems.find(v=>v.id===item.productId),surface=custom?.template==='mudPot'?(roomItems.flatMap(other=>other.category==='bench'?[[other.x,other.z+2,1.4]]:other.category==='sideTables'?[[-3.35+other.x,-4.25+other.z,1.2],[3.35+other.x,-4.25+other.z,1.2]]:[]) as [number,number,number][]).find(([sx,sz])=>Math.hypot(nx-sx,nz-sz)<1.05):undefined;setRoomItems(v=>v.map(i=>i.id===id?{...i,x:nx,y:surface?.[2]||0,z:nz,rotation:rotation??i.rotation}:i));return true}
 const rotateItem=(id:string,amount=Math.PI/4)=>{const next=roomItems.map(i=>i.id===id?{...i,rotation:i.rotation+amount}:i);commit(next)}
 const resizeItem=(id:string,x:number,y:number,z:number)=>{const next=roomItems.map(i=>i.id===id?{...i,scaleX:Math.max(.1,x),scaleY:Math.max(.1,y),scaleZ:Math.max(.1,z)}:i);commit(next)}
 const duplicateItem=(id:string)=>{const source=roomItems.find(i=>i.id===id);if(!source)return;const copy={...source,id:`room-${Date.now()}`,x:source.x+1};commit([...roomItems,copy]);setSelectedItemId(copy.id);const p=products.find(v=>v.id===copy.productId),custom=myItems.find(v=>v.id===copy.productId),price=p?.price||custom?.price||0;post(budgetEditAgent('Added',p?.name||custom?.name||'item',price,total+price,budget))}
 const deleteItem=(id:string)=>{const item=roomItems.find(i=>i.id===id);if(!item)return;const p=products.find(v=>v.id===item.productId),custom=myItems.find(v=>v.id===item.productId),price=p?.price||custom?.price||0;commit(roomItems.filter(i=>i.id!==id));setSelectedItemId(null);post(budgetEditAgent('Removed',p?.name||custom?.name||'item',-price,total-price,budget))}
 const undo=()=>{const prev=past[past.length-1];if(!prev)return;setFuture(v=>[roomItems,...v]);setRoomItems(prev);setPast(v=>v.slice(0,-1));setSelectedItemId(null)}
 const redo=()=>{const next=future[0];if(!next)return;setPast(v=>[...v,roomItems]);setRoomItems(next);setFuture(v=>v.slice(1));setSelectedItemId(null)}
 const beginTransform=()=>{setPast(v=>[...v.slice(-39),roomItems]);setFuture([])}
 const setRoomDimensions=(next:Partial<RoomDimensions>)=>{setRoomDimensionsState(v=>{const merged={...v,...next,estimated:next.estimated??false},halfW=(merged.width||14)/2-.65,halfL=(merged.length||16)/2-.65,bases:Record<Category|'custom',[number,number]>={bed:[0,-3.7],rug:[0,1],pendants:[0,-4.5],sideTables:[0,-4.25],bench:[0,2],planter:[5.25,-4.8],artwork:[0,-7.78],curtains:[6.5,1.3],chair:[-4,2],fan:[0,0],outdoorPlanter:[9,0],outdoorChair:[10,0],pergola:[9.5,0],stringLights:[9.5,0],custom:[0,0]};if(roomBuilt)setRoomItems(items=>items.map(item=>{if(['outdoorPlanter','outdoorChair','pergola','stringLights'].includes(item.category))return item;const base=bases[item.category];return{...item,x:THREEClamp(base[0]+item.x,-halfW,halfW)-base[0],z:THREEClamp(base[1]+item.z,-halfL,halfL)-base[1]}}));return merged})}
 const buildScenario=(id:'A'|'B',target:number):BudgetScenario=>{const customTotal=roomItems.reduce((n,i)=>n+(myItems.find(x=>x.id===i.productId)?.price||0),0),plan=planRoomBudget(roomItems,Math.max(0,target-customTotal),style),targets=new Map<string,string>();plan.swaps.forEach(swap=>targets.set(swap.itemId,swap.to.id));if(id==='B'){const prominent:(Category|'custom')[]=['bed','rug','planter','pendants','pergola'];roomItems.filter(item=>prominent.includes(item.category)).slice(0,5).forEach(item=>{if(item.category==='custom')return;const current=products.find(p=>p.id===item.productId),budgetProduct=products.find(p=>p.category===item.category&&p.tier==='budget');if(current&&budgetProduct&&current.id!==budgetProduct.id)targets.set(item.id,budgetProduct.id)})}const items=roomItems.map(item=>({...item,productId:targets.get(item.id)||item.productId})),swaps=roomItems.flatMap(item=>{const from=products.find(p=>p.id===item.productId),to=products.find(p=>p.id===targets.get(item.id));return from&&to&&from.id!==to.id?[{itemId:item.id,category:from.category,from,to,saving:from.price-to.price}]:[]}),catalog=items.map(i=>products.find(p=>p.id===i.productId)).filter((p):p is NonNullable<typeof p>=>Boolean(p)),scenarioTotal=calculatePricing(items.map(i=>{const product=products.find(p=>p.id===i.productId),custom=myItems.find(x=>x.id===i.productId);return{price:product?.price||custom?.price||0,store:product?.store||'My Studio'}})).total;return{id,budget:target,items,total:scenarioTotal,swaps,durability:catalog.length?catalog.reduce((n,p)=>n+p.durability,0)/catalog.length:0,styleMatch:catalog.length?catalog.reduce((n,p)=>n+styleMatch(p,style),0)/catalog.length:0,saved:grandTotal-scenarioTotal}}
 const runBudgetComparison=(a:number,b:number)=>{scenarioBase.current=roomItems;const scenarios=[buildScenario('A',a),buildScenario('B',b)];setBudgetScenarios(scenarios);setActiveScenario('A');setPreviewItems(scenarios[0].items);setSelectedItemId(null);const sa=scenarios[0],sb=scenarios[1],changed=sb.swaps.map(x=>x.category).join(', ')||'no items';post({id:Date.now(),agent:'Budget',text:`Option B saves $${sb.saved.toLocaleString()} by swapping ${changed}; style match ${sb.styleMatch<sa.styleMatch?`drops from ${Math.round(sa.styleMatch)}% to ${Math.round(sb.styleMatch)}%`:`holds at ${Math.round(sb.styleMatch)}%`}.`,detail:`Option A targets $${a.toLocaleString()} and Option B targets $${b.toLocaleString()}.`})}
 const previewScenario=(id:'A'|'B')=>{const scenario=budgetScenarios.find(x=>x.id===id);if(!scenario)return;setPreviewItems(scenario.items);setSelectedItemId(null);setActiveScenario(id);scenario.swaps.slice(0,5).forEach((swap,index)=>setTimeout(()=>{setHighlightCategory(swap.category);setScenarioChange({itemId:swap.itemId,label:`${swap.category}: ${swap.from.name} → ${swap.to.name}, −$${swap.saving.toLocaleString()}`});setTimeout(()=>{setHighlightCategory(null);setScenarioChange(null)},700)},index*760))}
 const applyScenario=(id:'A'|'B')=>{const scenario=budgetScenarios.find(x=>x.id===id);if(!scenario)return;setPast(v=>[...v.slice(-39),roomItems]);setFuture([]);setRoomItems(scenario.items);setPreviewItems(null);scenarioBase.current=scenario.items;setSelected(Object.fromEntries((Object.keys(selected) as Category[]).map(c=>[c,scenario.items.find(i=>i.category===c)?.productId||selected[c]])) as Record<Category,string>);setBudget(scenario.budget);setBudgetRan(true);setSnapshot(null);setActiveScenario(id);post(designReply(`Option ${id} is now your current design.`,`The $${scenario.total.toLocaleString()} version is applied and can be undone.`))}
 const setScenarioSnapshot=(id:'A'|'B',image:string)=>setBudgetScenarios(v=>v.map(x=>x.id===id?{...x,snapshot:image}:x))
 return <Context.Provider value={{step,maxStep,setStep,budget,setBudget,selected,selectProduct,optimize,category,setCategory,messages,typing,captured,capture,resetCapture,style,setStyle,roomImage,setRoomImage,total,tax,delivery,grandTotal,libraryOpen,setLibraryOpen,inspectProduct,myItems,addMyItem,selectedObject,highlightCategory,placedItems,placeMyItem,compareProducts,runCommand,revertSwap,undoAll,originalTotal:initialTotal,budgetRan,wallTone,quoteScreenshot,setQuoteScreenshot,postQuote,roomBuilt,roomItems,selectedItemId,setSelectedItemId,moveItem,rotateItem,resizeItem,duplicateItem,deleteItem,addProduct,undo,redo,canUndo:past.length>0,canRedo:future.length>0,beginTransform,dragging,setDragging,roomDimensions,setRoomDimensions,budgetScenarios,activeScenario,previewItems,scenarioChange,runBudgetComparison,previewScenario,applyScenario,setScenarioSnapshot,postAgent:post,paidTotal,checkoutSaved,setCheckoutSummary,invoices,addInvoice,purchasedProductIds,checkoutItemIds,checkoutHighlightId,setCheckoutItemIds,toggleCheckoutItem,checkoutQuantities,setCheckoutQuantities,roomId,clientId,collaboratorName,setCollaboratorName,collaboratorRole,inviteRole,setInviteRole,collaborators,cursors,broadcastCursor,locks,acquireLock,releaseLock,comments,addComment,activities,votes,vote,simulateTeammate,setSimulateTeammate,purchaseApproval,requestPurchaseApproval,shopLive,liveLoading}}>{children}</Context.Provider>
}
export const useRoomwise=()=>useContext(Context)!
const THREEClamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value))
