import type { AgentMessage } from './mockAgents'
import type { Mandate, MerchantOrder } from '../services/payments'
let financeId=5000
const finance=(text:string,detail?:string):AgentMessage=>({id:financeId++,agent:'Finance',text,detail})
export const mandateAuthorizedAgent=(m:Mandate)=>finance(`Mandate authorized up to $${m.totalLimit.toLocaleString()}.`,`I’ll auto-approve orders under $${m.autoApprove.toLocaleString()} and stop whenever your rules require approval.`)
export const financeStartedAgent=(count:number)=>finance(`I’m checking out across ${count} stores in test mode.`,'I’ll verify price, stock, promotions and your mandate before every order.')
export const approvalNeededAgent=(order:MerchantOrder)=>finance(`Approve $${order.total.toLocaleString()} order at ${order.store}?`,'This order is above your auto-approval threshold.')
export const financeDecisionAgent=(text:string,reason:string)=>finance(text,reason)
export const financeCompleteAgent=(paid:number,saved:number,count:number,realCount:number)=>finance(`Checkout complete: $${paid.toLocaleString()} paid across ${count} order${count===1?'':'s'}.`,`Saved $${saved.toLocaleString()} total. ${realCount} order${realCount===1?'':'s'} settled via the real CyberSource sandbox${realCount<count?`, ${count-realCount} simulated (sandbox unreachable)`:''}.`)
export const financeStoppedAgent=(reason:string)=>finance('I paused checkout to protect your mandate.',reason)
