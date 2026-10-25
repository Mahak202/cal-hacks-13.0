// The Roomwise agent team. Each specialist uAgent may execute only its own
// tools; the orchestrator routes work between them. The six specialists mirror
// the personas of the Roomwise web app.

export const SPECIALISTS = ['design', 'product', 'budget', 'comparison', 'quotation', 'finance'] as const
export type Specialist = (typeof SPECIALISTS)[number]
export type AgentRole = Specialist | 'orchestrator'

export const ROLE_TOOLS: Record<AgentRole, readonly string[]> = {
  orchestrator: ['reset_session'],
  design: ['set_room_brief'],
  product: ['search_products', 'choose_product', 'clear_choice', 'use_demo_prices'],
  budget: ['set_budget', 'optimize_plan'],
  comparison: ['compare_alternatives'],
  quotation: ['get_quote'],
  finance: ['finance_breakdown'],
}

export const ROLE_LABELS: Record<AgentRole, string> = {
  orchestrator: 'Roomwise orchestrator',
  design: 'Design agent',
  product: 'Product agent',
  budget: 'Budget agent',
  comparison: 'Comparison agent',
  quotation: 'Quotation agent',
  finance: 'Finance agent',
}

export const TOOL_OWNER: Record<string, AgentRole> = Object.fromEntries(
  (Object.entries(ROLE_TOOLS) as [AgentRole, readonly string[]][]).flatMap(([role, tools]) => tools.map((tool) => [tool, role])),
)

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && value in ROLE_TOOLS
}

// Tools whose success changes what the plan should contain.
export const PLAN_AFFECTING = new Set(['set_room_brief', 'set_budget', 'choose_product', 'clear_choice', 'use_demo_prices', 'search_products'])
