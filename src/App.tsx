import { useEffect, useRef, useState } from 'react'
import { products, type Category } from '../data/products'
import { styleMatch, type AgentMessage } from '../agents/mockAgents'
import { RoomwiseProvider, useRoomwise } from '../state/RoomwiseContext'
import { fetchInspiration, type Inspiration } from '../services/apify'
import SpatialCanvas, { LibraryPanel } from './SpatialCanvas'
import './AgentFeatures.css'
import './LayoutFixes.css'
import './DemoAssets.css'
import './EditableRoom.css'
import CheckoutPanel from './CheckoutPanel'
import './Checkout.css'
import './TestMode.css'

const roomImage = '/room-empty.jpg'
const inspoImage = '/inspo-wabisabi.jpg'
const steps = ['Capture','Inspire','Personalize','Budget','Quote','Checkout']
const cats: Category[] = ['bed','rug','pendants','sideTables','bench','planter','artwork']
const palettes = {
  'Wabi-Sabi Warmth': ['#CFC4B4','#E9E2D6','#6B4E36','#B89B72','#6E7350'],
  'Japandi Calm': ['#332f2a','#8d7c68','#c7baa5','#e4ded2','#f2f0e9'],
  'Coastal Light': ['#53666a','#90a9aa','#c3d1ce','#d8d3c5','#f4f1ea'],
}
function Mark({ className='' }: { className?: string }) { return <svg className={className} viewBox="0 0 32 32" fill="none"><path d="M5 13.2 16 6l11 7.2V26H5V13.2Z" stroke="currentColor" strokeWidth="2.4"/><path d="m10 17 6-4 6 4v9H10v-9Z" fill="currentColor"/></svg> }
function Header() {
  const s = useRoomwise(); return <header className="topbar">
    <div className="brand"><span className="brandmark"><Mark/></span><span>Roomwise</span><em>AI spatial studio</em></div>
    <nav className="steps">{steps.map((x,i)=>{const done=i+1<s.maxStep;return <button disabled={!s.roomBuilt&&i===3} key={x} onClick={()=>{s.setStep(i+1);s.setLibraryOpen(false)}} className={s.step===i+1?'active':done?'done':''}><span>{done?'✓':i+1}</span>{x}</button>})}</nav>
    <div className="top-actions"><span className="test-badge">Test mode · no real charges</span><div className={`total-pill ${!s.paidTotal&&s.total>s.budget?'over':''}`}><i/> {s.paidTotal?<>Paid ${s.paidTotal.toLocaleString()} <span>· Saved ${s.checkoutSaved.toLocaleString()}</span></>:<>${s.total.toLocaleString()} <span>/ ${s.budget.toLocaleString()}</span></>}</div></div>
  </header>
}
function CapturePanel() {
  const s=useRoomwise(); const [progress,setProgress]=useState(s.captured?6:0); const picker=useRef<HTMLInputElement>(null)
  const upload=(file?:File)=>{if(file)s.setRoomImage(URL.createObjectURL(file));setProgress(0);s.capture();let n=0;const t=setInterval(()=>{n++;setProgress(n);if(n===6)clearInterval(t)},400)}
  const useDemo=()=>{s.setRoomImage(roomImage);upload()}
  const checks=['Detecting walls, floor and ceiling','Found arched window (east wall)','Found 4 exposed ceiling beams','Floor: light oak herringbone','Room is empty — ready to furnish','Building 3D scene']
  return <><PanelTitle n="01" title="Capture your room" text="Start with one clear photo. We'll do the spatial work."/><input ref={picker} className="hidden-picker" type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/>
    {!s.captured?<button className="dropzone" onClick={()=>picker.current?.click()}><span className="upload-icon">↑</span><b>Upload a photo of your room</b><small>JPG or PNG · up to 20 MB</small></button>:
    <div className="analysis"><div className="scan-thumb"><img src={s.roomImage}/><button onClick={()=>picker.current?.click()}>Replace photo</button></div><p>{progress<6?'Analyzing your room…':'Room analysis complete'}</p>{checks.map((x,i)=><div className={progress>i?'checked':''} key={x}><span>{progress>i?'✓':i+1}</span>{x}</div>)}<button className="start-over" onClick={s.resetCapture}>Start over</button></div>}
    {!s.captured&&<button className="demo-link" onClick={useDemo}>Use demo images</button>}
    {s.captured&&<Tip>Best results come from a wide-angle photo taken from a corner.</Tip>}</>
}
function InspirePanel() {
 const s=useRoomwise();const [uploaded,setUploaded]=useState(false),[analyzing,setAnalyzing]=useState(false),[image,setImage]=useState(inspoImage);const picker=useRef<HTMLInputElement>(null);const load=(file?:File)=>{if(file)setImage(URL.createObjectURL(file));else setImage(inspoImage);setAnalyzing(true);setUploaded(false);setTimeout(()=>{setAnalyzing(false);setUploaded(true)},2000)};
 const [linkUrl,setLinkUrl]=useState(''),[linkLoading,setLinkLoading]=useState(false),[linkResult,setLinkResult]=useState<Inspiration|null>(null),[linkError,setLinkError]=useState('')
 const analyzeLink=async()=>{if(!linkUrl.trim())return;setLinkLoading(true);setLinkError('');setLinkResult(null);try{setLinkResult(await fetchInspiration(linkUrl.trim()))}catch(err:any){setLinkError(err?.message||'Could not fetch that link.')}finally{setLinkLoading(false)}}
 return <><PanelTitle n="02" title="Choose a direction" text="We extracted the mood, materials and color story."/><input ref={picker} className="hidden-picker" type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&load(e.target.files[0])}/>
 {!uploaded&&!analyzing?<><button className="inspo-upload" onClick={()=>picker.current?.click()}><span>＋</span> Add Pinterest inspiration</button><button className="demo-link" onClick={()=>load()}>Use demo images</button></>:<div className="inspo-thumb"><img src={image}/><button onClick={()=>picker.current?.click()}>Replace image</button>{analyzing&&<span className="extracting">Extracting style…</span>}</div>}
 {uploaded&&<div className="extraction extraction-in"><span className="eyebrow">EXTRACTED STYLE</span><b>Wabi-Sabi Warmth</b><div className="swatches">{palettes['Wabi-Sabi Warmth'].map(c=><i key={c} style={{background:c}}/>)}</div><div className="chips">{['limewash plaster','reclaimed wood','linen','jute','woven rattan','stoneware'].map(x=><span key={x}>{x}</span>)}</div><div className="chips mood">{['earthy','imperfect','calm','sun-washed'].map(x=><span key={x}>{x}</span>)}</div></div>}
 <label className="section-label">OR ANALYZE A LINK (APIFY)</label>
 <div className="ask"><input placeholder="Paste a Pinterest or retailer URL…" value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&analyzeLink()}/><button onClick={analyzeLink} disabled={linkLoading}>{linkLoading?'…':'↑'}</button></div>
 {linkError&&<Tip>{linkError}</Tip>}
 {linkResult&&<div className="extraction extraction-in"><span className="eyebrow">SCRAPED FROM LINK</span><b>{linkResult.title||linkUrl}</b>{linkResult.description&&<small>{linkResult.description}</small>}<p>{linkResult.text.slice(0,280)}{linkResult.text.length>280?'…':''}</p></div>}
 <label className="section-label">CURATED DIRECTIONS</label>
 <div className="style-list">{Object.entries(palettes).map(([name,colors])=><button key={name} onClick={()=>s.setStyle(name)} className={s.style===name?'selected':''}><div className="mini-palette">{colors.map(c=><i key={c} style={{background:c}}/>)}</div><span><b>{name}</b><small>{name==='Wabi-Sabi Warmth'?'From your inspiration':name==='Coastal Light'?'Chalk walls · fixed herringbone':'Oat walls · fixed herringbone'}</small></span><em>✓</em></button>)}</div></>
}
const liveStoreSuggestions=['Wayfair','IKEA','CB2','West Elm','Article','Pottery Barn','Etsy','Target']
function PersonalizePanel() {
 const s=useRoomwise(); const list=products.filter(p=>p.category===s.category)
 const [liveStore,setLiveStore]=useState(''),[liveMsg,setLiveMsg]=useState('')
 const runShopLive=async()=>{
  setLiveMsg('')
  const store=liveStore.trim()
  try{
   const items=await s.shopLive(s.category,store||undefined)
   setLiveMsg(items.length?`Added ${items.length} live result${items.length===1?'':'s'}${store?` from ${store}`:''} — see them in the list above.`:`No priced results${store?` for ${store}`:''}. Some big retailers (e.g. Wayfair) block scrapers — try another store or leave it blank for any store.`)
  }catch(err:any){setLiveMsg(`Couldn't fetch live listings: ${err?.message||err}`)}
 }
 return <><PanelTitle n="03" title="Make it yours" text="Select an object, then swap it with a shoppable piece."/>
 <div className="category-tabs">{cats.map(c=><button className={s.category===c?'active':''} onClick={()=>s.setCategory(c)} key={c}>{c}</button>)}</div>
 <div className="product-list">{list.map(p=><button className={s.selected[p.category]===p.id?'selected':''} onClick={()=>s.selectProduct(p.id)} key={p.id}><div className="product-art">{p.styleTags.includes('live')&&p.imageUrl?<img src={p.imageUrl} alt={p.name} onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>:p.category.slice(0,1).toUpperCase()}</div><span><b>{p.name}</b><small>{p.store} · {p.material}{p.styleTags.includes('live')?' · Live via Apify':''}</small><strong>${p.price.toLocaleString()}</strong></span><em>{p.tier}</em></button>)}</div>
 <div className="ask">
  <input list="live-store-options" value={liveStore} onChange={e=>setLiveStore(e.target.value)} placeholder="Any store (or type one, e.g. Etsy)" onKeyDown={e=>e.key==='Enter'&&runShopLive()}/>
  <datalist id="live-store-options">{liveStoreSuggestions.map(x=><option key={x} value={x}/>)}</datalist>
  <button disabled={s.liveLoading} onClick={runShopLive}>{s.liveLoading?'…':'🔎 Shop live (Apify)'}</button>
 </div>
 {liveMsg&&<Tip>{liveMsg}</Tip>}
 <div className="ask"><input placeholder="Ask the Design Agent…"/><button>↑</button></div><div className="suggestions">{['Make the walls warmer','Replace the rug with something affordable','Show me the exact lamp used'].map(x=><button key={x}>{x}</button>)}</div></>
}
function BudgetPanel() {
 const s=useRoomwise(); return <><PanelTitle n="04" title="Set your budget" text="Your agent balances cost, quality and the look you chose."/>
 <div className="budget-card"><label>ROOM BUDGET</label><div><span>$</span><input type="number" value={s.budget} onChange={e=>s.setBudget(+e.target.value)}/><em>USD</em></div><small>Current selection <b>${s.total.toLocaleString()}</b></small></div>
 <div className="budget-status"><div><span>Design total</span><b>${s.total.toLocaleString()}</b></div><div><span>Your budget</span><b>${s.budget.toLocaleString()}</b></div><div className={s.total>s.budget?'negative':'positive'}><span>{s.total>s.budget?'Over budget':'Remaining'}</span><b>${Math.abs(s.budget-s.total).toLocaleString()}</b></div></div>
 <button className="primary" onClick={s.optimize}>✦ Optimize with Budget Agent</button><Tip>The agent protects the pieces with the highest visual impact.</Tip></>
}
function QuotePanel() {
 const s=useRoomwise(); const selected=s.roomItems.map(item=>products.find(p=>p.id===item.productId)!).filter(Boolean)
 useEffect(()=>{const timer=setTimeout(()=>{const canvas=document.querySelector('.three-room canvas') as HTMLCanvasElement|null;if(canvas)try{s.setQuoteScreenshot(canvas.toDataURL('image/png'))}catch{}s.postQuote()},120);return()=>clearTimeout(timer)},[])
 return <><PanelTitle n="05" title="Your room, quoted" text="Everything you need to bring the design home."/>
 <div className="quote-summary"><span>FINAL TOTAL</span><b>${s.grandTotal.toLocaleString()}</b><small>{selected.length} items · estimated tax included</small></div>
 {s.budgetRan&&<div className="quote-saved">Saved ${(s.originalTotal-s.total).toLocaleString()} vs. original design</div>}
 <div className="thumbs"><div><img src={s.roomImage}/><span>Before</span></div><div><img src={s.quoteScreenshot||s.roomImage}/><span>After</span></div></div>
 <div className="quote-table"><div className="quote-tr head"><span>Item / product</span><span>Store</span><span>Price</span></div>{selected.map(p=><div className="quote-tr" key={p.id}><span><b>{p.category}</b><small>{p.name}</small></span><span>{p.store}<a href={p.url}>View ↗</a></span><strong>${p.price.toLocaleString()}</strong></div>)}<div className="quote-totals"><span>Subtotal <b>${s.total.toLocaleString()}</b></span><span>Est. tax 9.375% <b>${s.tax.toLocaleString()}</b></span><span>Delivery ($49/store) <b>${s.delivery.toLocaleString()}</b></span><span>Total <b>${s.grandTotal.toLocaleString()}</b></span></div></div>
 <button className="primary" onClick={()=>window.print()}>⇩ Export quote</button></>
}
function PanelTitle({n,title,text}:{n:string,title:string,text:string}) {return <div className="panel-title"><span>{n}</span><h1>{title}</h1><p>{text}</p></div>}
function Tip({children}:{children:React.ReactNode}) { return <div className="tip"><span>i</span>{children}</div> }
function LeftPanel(){const s=useRoomwise();return <aside className="left"><div className="left-main-tabs"><button className={!s.libraryOpen?'active':''} onClick={()=>s.setLibraryOpen(false)}>Steps</button><button disabled={!s.roomBuilt} className={s.libraryOpen?'active':''} onClick={()=>s.setLibraryOpen(true)}>Library</button></div><div className="left-scroll">{s.libraryOpen?<LibraryPanel/>:<>{s.step===1?<CapturePanel/>:s.step===2?<InspirePanel/>:s.step===3?<PersonalizePanel/>:s.step===4?<BudgetPanel/>:s.step===5?<QuotePanel/>:<CheckoutPanel/>}<div className="step-nav"><button disabled={s.step===1} onClick={()=>s.setStep(Math.max(1,s.step-1))}>← Back</button><button disabled={s.step===6||(!s.roomBuilt&&s.step===3)} onClick={()=>s.setStep(Math.min(6,s.step+1))}>Next →</button></div></>}</div></aside>}
const agentColors:Record<string,string>={Design:'purple',Product:'blue',Budget:'green',Comparison:'amber',Quotation:'slate',Finance:'teal'}
function RichMessage({m}:{m:AgentMessage}){
 const s=useRoomwise()
 return <div className={`message ${m.kind||''}`}><div className={`agent-badge ${agentColors[m.agent]}`}><span>✦</span>{m.agent} Agent</div><p>{m.text}</p>{m.detail&&m.kind!=='comparison'&&<small>{m.detail}</small>}
 {m.kind==='swap'&&m.swap&&<button className="message-link" onClick={()=>s.revertSwap(m.swap!)}>↶ Revert</button>}
 {m.kind==='budget-summary'&&<div className="budget-result"><div><span>Original</span><b>${m.original?.toLocaleString()}</b></div><div><span>New total</span><b>${m.total?.toLocaleString()}</b></div><strong>Saved ${m.saved?.toLocaleString()}</strong><small>{m.swaps} smart swaps</small><button onClick={s.undoAll}>Undo all</button></div>}
 {m.kind==='comparison'&&m.products&&<div className="compare-table">{m.products.map(p=><div key={p.id}><div className="compare-img">{p.category[0].toUpperCase()}</div><b>{p.name}</b><strong>${p.price}</strong><small>{p.store}<br/>{p.material}</small><div className="dots">{[1,2,3,4,5].map(n=><i className={n<=p.durability?'on':''} key={n}/>)}</div><em>{styleMatch(p,s.style)}% match</em><button onClick={()=>s.selectProduct(p.id)}>Use in room</button></div>)}<p>{m.detail}</p></div>}
 {m.kind==='quote'&&<button className="message-action" onClick={()=>s.setStep(5)}>View quote</button>}</div>
}
function Agents(){
 const s=useRoomwise();const [input,setInput]=useState('');const suggestions=['Make the walls warmer','Replace the rug with something affordable','Show me the exact pendants used','Keep it under $2,000','Create my quote'];const send=(text=input)=>{if(!text.trim())return;s.runCommand(text);setInput('')}
 return <aside className="agents"><div className="agents-head"><div><span className="spark">✦</span><span><b>Agents</b><small>5 specialists online</small></span></div><button>•••</button></div>
 <div className="messages">{s.messages.map(m=><RichMessage key={m.id} m={m}/>)}{s.typing&&<div className="typing"><i/><i/><i/><span>Agent is thinking</span></div>}</div>
 <div className="agent-compose"><div className="agent-suggestions">{suggestions.map(x=><button onClick={()=>send(x)} key={x}>{x}</button>)}</div><div className="agent-input"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Message your agents…"/><button onClick={()=>send()}>↑</button></div></div><small className="agent-note">Agents use your room, style and budget context</small></aside>
}
function AppInner(){return <div className="app"><Header/><div className="workspace"><LeftPanel/><SpatialCanvas/><Agents/></div></div>}
export default function App(){return <RoomwiseProvider><AppInner/></RoomwiseProvider>}
