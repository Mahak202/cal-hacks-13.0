import Anthropic from '@anthropic-ai/sdk'
import { MAX_TOOL_STEPS, stateMessage, SYSTEM_PROMPT, type Interpreter } from './prompt'
import { executeTool, TOOL_SPECS } from './tools'

// Claude through the Anthropic SDK (alternative to ASI:One).

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5'

export type LlmClient = {
  create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>
}

export function anthropicClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey })
  return { create: (params) => client.beta.messages.create(params) }
}

export function claudeInterpreter(llm: LlmClient, model = CLAUDE_DEFAULT_MODEL): Interpreter {
  return {
    name: 'claude',
    async run(state, message, engine, turn) {
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        ...state.history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: [{ type: 'text', text: stateMessage(state) }, { type: 'text', text: message }] },
      ]
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const response = await llm.create({
          model,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          tools: TOOL_SPECS as Anthropic.Beta.BetaTool[],
          messages,
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
        if (response.stop_reason === 'refusal') return "I can't help with that request."
        const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim()
        if (response.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: response.content })
          continue
        }
        const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        if (response.stop_reason !== 'tool_use' || !toolUses.length) return text
        messages.push({ role: 'assistant', content: response.content })
        // Run in order: later calls (e.g. build_plan) depend on earlier ones.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
        for (const use of toolUses) {
          const outcome = await executeTool(state, { name: use.name, input: use.input }, engine, turn)
          results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }), is_error: !outcome.ok })
        }
        messages.push({ role: 'user', content: results })
      }
      return ''
    },
  }
}
