import Anthropic from '@anthropic-ai/sdk'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}. Add it to .env (see .env.example).`)
  return value
}

const CATEGORY_ENUM = ['bed', 'rug', 'pendants', 'sideTables', 'bench', 'planter', 'artwork']

// Tool set mirrors the app's existing internal actions one-to-one (see
// RoomwiseContext.tsx's TOOL_HANDLERS) so Claude only ever picks *which*
// already-tested action to run, never has to improvise app behavior itself.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'swap_tier',
    description: "Change the item in a category (adding it if the category is empty) to a specific quality tier — 'upgrade the rug', 'make the bed cheaper', 'swap the bench for something nicer'.",
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORY_ENUM },
        tier: { type: 'string', enum: ['premium', 'mid', 'budget'] },
      },
      required: ['category', 'tier'],
    },
  },
  {
    name: 'add_item',
    description: "Add an item of this category to the room when the user doesn't specify a tier — 'add a table', 'put in a planter'. Rooms are pre-furnished in every category by default, so this usually means adding a second one alongside the existing item (defaults new items to the mid tier).",
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string', enum: CATEGORY_ENUM } },
      required: ['category'],
    },
  },
  {
    name: 'remove_item',
    description: "Remove an item from the room entirely — 'get rid of the planter', 'remove the bench'.",
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string', enum: CATEGORY_ENUM } },
      required: ['category'],
    },
  },
  {
    name: 'duplicate_item',
    description: "Add a second copy of the item already in a category — 'add another side table like this one'.",
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string', enum: CATEGORY_ENUM } },
      required: ['category'],
    },
  },
  {
    name: 'change_style',
    description: "Switch the room's overall design style/palette.",
    input_schema: {
      type: 'object',
      properties: { style: { type: 'string', enum: ['Wabi-Sabi Warmth', 'Japandi Calm', 'Warm Mid-Century', 'Coastal Light'] } },
      required: ['style'],
    },
  },
  {
    name: 'adjust_wall_tone',
    description: "Shift the room's wall color warmer or cooler.",
    input_schema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['warmer', 'cooler'] } },
      required: ['direction'],
    },
  },
  {
    name: 'optimize_budget',
    description: "Run the Budget Agent to bring the room's total under a target budget (swaps items to cheaper tiers). If the user gives a dollar amount, pass it; otherwise omit to use the current budget.",
    input_schema: {
      type: 'object',
      properties: { targetAmount: { type: 'number', description: 'Target budget in USD, if the user specified one' } },
    },
  },
  {
    name: 'undo_budget_swaps',
    description: "Undo the most recent Budget Agent optimization specifically, restoring the selection from before it ran.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'undo_last_action',
    description: "Undo the single most recent change to the room (any kind — move, swap, add, delete), not specifically a budget optimization. Use for generic 'undo that' / 'put it back'.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'inspect_product',
    description: "Show details about the exact product currently used in a category — 'what pendants are these', 'show me the exact rug'.",
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string', enum: CATEGORY_ENUM } },
      required: ['category'],
    },
  },
  {
    name: 'compare_category',
    description: "Show a side-by-side comparison of the premium/mid/budget options for one category.",
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string', enum: CATEGORY_ENUM } },
      required: ['category'],
    },
  },
  {
    name: 'shop_live',
    description: "Search the live web (via Apify) for real, currently-purchasable furniture matching the room's style, optionally scoped to one retailer — 'find me a real rug from Etsy', 'shop live for a bench'.",
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORY_ENUM },
        store: { type: 'string', description: 'Retailer name, if the user mentioned one (e.g. "Etsy", "West Elm"). Omit otherwise.' },
      },
      required: ['category'],
    },
  },
  {
    name: 'create_quote',
    description: "Jump to the final quote step and generate a room-ready quote — 'create my quote', 'I'm ready to check out', 'finalize this'.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'go_to_step',
    description: "Navigate to a different step in the workflow without otherwise changing anything — 'take me back to the budget step', 'show me the room'.",
    input_schema: {
      type: 'object',
      properties: { step: { type: 'integer', description: '1=Capture, 2=Inspire, 3=Personalize, 4=Budget, 5=Quote, 6=Checkout', minimum: 1, maximum: 6 } },
      required: ['step'],
    },
  },
  {
    name: 'speak',
    description: "Say something to the user in natural language, voiced as one of the specialist agents. Use this for ANY conversational reply, clarifying question, or explanation that isn't already fully covered by another tool's own automatic confirmation message — including when no other tool applies. Pick whichever agent persona best fits what you're saying.",
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['Design', 'Product', 'Budget', 'Comparison', 'Quotation', 'Finance'], description: 'Design=style/room/walls, Product=specific items/stores, Budget=cost/optimization, Comparison=comparing options, Quotation=quotes/pricing summaries, Finance=checkout/payments/mandate' },
        text: { type: 'string', description: 'What to say. Keep it short and concrete — 1-2 sentences, this is a sidebar chat.' },
      },
      required: ['agent', 'text'],
    },
  },
]

export type ToolCall = { name: string; input: Record<string, unknown> }
export type AgentCommandResult = { reply: string; toolCalls: ToolCall[] }
export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

export async function runAgentCommand(message: string, context: Record<string, unknown>, history: HistoryTurn[] = []): Promise<AgentCommandResult> {
  const apiKey = requireEnv('ANTHROPIC_API_KEY')
  const client = new Anthropic({ apiKey })

  const system = `You are the coordinating voice for Roomwise, an AI interior-design app, made up of six specialist personas: Design (style/room/walls), Product (specific items/stores), Budget (cost/optimization), Comparison (comparing options), Quotation (quotes/pricing), and Finance (checkout/payments).

The user is mid-session designing one room. Current room state (JSON): ${JSON.stringify(context)}

Decide what the user wants and call the matching tool(s) — call more than one if the request has multiple parts (e.g. "upgrade the rug and make the walls warmer"). Several action tools (swap_tier, remove_item, optimize_budget, etc.) already produce their own confirmation message in the UI, so don't also call speak to restate what you just did — only call speak for genuine conversation: answering a question, clarifying ambiguity, small talk, or anything no other tool covers. Use the conversation history to resolve follow-ups like "no, the other one" or "undo that" in context.`

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 500,
    system,
    tools: TOOLS,
    messages: [...history.map((h) => ({ role: h.role, content: h.content })), { role: 'user' as const, content: message }],
  })

  const toolCalls: ToolCall[] = []
  let reply = ''
  for (const block of response.content) {
    if (block.type === 'tool_use') toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> })
    if (block.type === 'text') reply += block.text
  }
  return { reply: reply.trim(), toolCalls }
}
