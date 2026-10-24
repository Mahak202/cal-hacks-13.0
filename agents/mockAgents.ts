import { products, type Category, type Product, type Tier } from '../data/products'

export type AgentKind = 'Design' | 'Product' | 'Budget' | 'Comparison' | 'Quotation' | 'Finance'
export type Swap = { category: Category; from: Product; to: Product; saving: number }
export type AgentMessage = {
  id: number; agent: AgentKind; text: string; detail?: string
  kind?: 'swap'|'budget-summary'|'comparison'|'quote'|'payment-complete'; swap?: Swap
  products?: Product[]; original?: number; total?: number; saved?: number; swaps?: number; orders?: number
}
let id = 1
const msg = (agent: AgentKind, text: string, detail?: string, extra:Partial<AgentMessage>={}): AgentMessage => ({ id: id++, agent, text, detail, ...extra })
export const agentSpeak = (agent: AgentKind, text: string): AgentMessage => msg(agent, text)
const tiers:Tier[]=['premium','mid','budget']
const styleTags:Record<string,string[]> = {
  'Wabi-Sabi Warmth':['wabi-sabi','warm','natural','earthy','artisan'],
  'Japandi Calm':['japandi','natural','warm'],
  'Warm Mid-Century':['warm','premium','mid-century'],
  'Coastal Light':['natural','light','coastal'],
}
export const styleMatch = (p:Product,style:string) => Math.min(100,60+p.styleTags.filter(t=>styleTags[style]?.includes(t)).length*20)
export function planBudget(selected:Record<Category,string>,budget:number,style:string){
  const working={...selected}; const swaps:Swap[]=[]; const price=()=>Object.values(working).reduce((n,x)=>n+(products.find(p=>p.id===x)?.price||0),0)
  while(price()>budget){
    const options=(Object.keys(working) as Category[]).flatMap(category=>{
      const from=products.find(p=>p.id===working[category])!; const index=tiers.indexOf(from.tier)
      if(index===tiers.length-1)return []
      const to=products.find(p=>p.category===category&&p.tier===tiers[index+1])!
      const loss=Math.max(0,styleMatch(from,style)-styleMatch(to,style))
      return [{category,from,to,saving:from.price-to.price,score:(from.price-to.price)/(1+loss/20)}]
    }).sort((a,b)=>b.score-a.score)
    if(!options.length)break
    const best=options[0]; working[best.category]=best.to.id; swaps.push(best)
  }
  return {swaps,selection:working,total:price()}
}
export function planRoomBudget(items:{id:string;productId:string;category:Category|'custom'}[],budget:number,style:string){
 const working=items.map(i=>({...i}));const swaps:(Swap&{itemId:string})[]=[];const price=()=>working.reduce((n,i)=>n+(products.find(p=>p.id===i.productId)?.price||0),0)
 while(price()>budget){const options=working.flatMap(item=>{const from=products.find(p=>p.id===item.productId);if(!from||item.category==='custom')return[];const index=tiers.indexOf(from.tier);if(index===tiers.length-1)return[];const to=products.find(p=>p.category===item.category&&p.tier===tiers[index+1])!;const loss=Math.max(0,styleMatch(from,style)-styleMatch(to,style));return[{itemId:item.id,category:item.category,from,to,saving:from.price-to.price,score:(from.price-to.price)/(1+loss/20)}]}).sort((a,b)=>b.score-a.score);if(!options.length)break;const best=options[0];working.find(i=>i.id===best.itemId)!.productId=best.to.id;swaps.push(best)}
 return{swaps,total:price()}
}
export const designAgent = (length=16,width=14,height=11) => msg('Design', `I found an empty ${Number(width.toFixed(1))}×${Number(length.toFixed(1))} ft room with a ${Number(height.toFixed(1))} ft beamed ceiling, a tall arched window, and light oak herringbone floors. I'll keep the window, beams and floor as fixed features while we design.`)
export const wabiSabiAgent = () => msg('Design',"This looks like Wabi-Sabi: raw wood, linen, limewash and imperfect natural forms. I've applied it to your room.")
export const designReply = (text:string,detail?:string) => msg('Design',text,detail)
export const unknownAgent = () => msg('Design',"I can help restyle walls, find a cheaper item, identify products, optimize your budget, or create a quote.",'Try one of the suggestions below.')
export const productInspectAgent = (p:Product) => msg('Product',`This is the ${p.name} from ${p.store}, $${p.price.toLocaleString()}. Want cheaper or similar options?`,p.url)
export const productSwapAgent = (name: string, difference: number) => msg('Product', `${name} is now in your room.`, difference === 0 ? 'Your room total is unchanged.' : `That ${difference < 0 ? 'saves' : 'adds'} $${Math.abs(difference).toLocaleString()} ${difference < 0 ? 'to' : 'from'} your room total.`)
export const budgetSwapAgent = (swap:Swap) => msg('Budget',`Swapped the ${swap.from.store} ${swap.from.name} ($${swap.from.price.toLocaleString()}) for the ${swap.to.store} ${swap.to.name} ($${swap.to.price.toLocaleString()}).`,`Saves $${swap.saving.toLocaleString()}, similar ${swap.to.styleTags[0]} form, durability drops ${swap.from.durability}→${swap.to.durability}.`,{kind:'swap',swap})
export const budgetSummaryAgent = (original:number,total:number,count:number) => msg('Budget',`Your optimized room is now under budget.`,undefined,{kind:'budget-summary',original,total,saved:original-total,swaps:count})
export const budgetAlreadyAgent = (total:number,budget:number,upgrade?:Product) => msg('Budget',`You’re already $${(budget-total).toLocaleString()} under budget.`,upgrade?`Optional upgrade: ${upgrade.name} from ${upgrade.store} for $${upgrade.price.toLocaleString()}.`:'There are no higher-tier upgrades needed.')
export const budgetEditAgent = (action:string,name:string,amount:number,total:number,budget:number) => msg('Budget',`${action} the ${name}, ${amount<0?'−':'+'}$${Math.abs(amount).toLocaleString()}.`,`You're now $${Math.abs(total-budget).toLocaleString()} ${total>budget?'over':'under'} budget.`)
export const comparisonAgent = (items:Product[],style:string) => {
  const best=[...items].sort((a,b)=>(styleMatch(b,style)/b.price)-(styleMatch(a,style)/a.price))[0]
  const highest=Math.max(...items.map(p=>p.price))
  return msg('Comparison',`I compared ${items.length} ${items[0].category} options.`,`Best value: the ${best.store} ${best.name} saves $${(highest-best.price).toLocaleString()} with ${styleMatch(best,style)}% style match.`,{kind:'comparison',products:items})
}
export const quotationAgent = (total:number) => msg('Quotation',`Your room-ready quote is complete: $${total.toLocaleString()}.`,'All retailer links, tax and delivery costs are included.',{kind:'quote',total})
