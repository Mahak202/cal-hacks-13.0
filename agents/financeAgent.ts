import type { AgentMessage } from './mockAgents'
import type { Mandate, MerchantOrder } from '../services/payments'
let financeId=5000
const finance=(text:string,detail?:string):AgentMessage=>({id:financeId++,agent:'Finance',text,detail})
export const mandateAuthorizedAgent=(m:Mandate)=>finance(`Mandate authorized up to $${m.totalLimit.toLocaleString()}.`,`I’ll auto-approve orders under $${m.autoApprove.toLocaleString()} and stop whenever your rules require approval.`)
export const financeStartedAgent=(count:number)=>finance(`I’m checking out across ${count} stores in test mode.`,'I’ll verify price, stock, promotions and your mandate before every order.')
export const approvalNeededAgent=(order:MerchantOrder)=>finance(`Approve $${order.total.toLocaleString()} order at ${order.store}?`,'This order is above your auto-approval threshold.')
export const financeDecisionAgent=(text:string,reason:string)=>finance(text,reason)
export const financeCompleteAgent=(paid:number,saved:number,count:number)=>finance(`Checkout complete: $${paid.toLocaleString()} paid across ${count} orders.`,`The agents saved $${saved.toLocaleString()} in total. No real charges were made.`)
export const financeStoppedAgent=(reason:string)=>finance('I paused checkout to protect your mandate.',reason)
