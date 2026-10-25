import OpenAI from 'openai'
import { MAX_TOOL_STEPS, stateMessage, SYSTEM_PROMPT, type Interpreter } from './prompt'
import { executeTool, TOOL_SPECS } from './tools'

// ASI:One LLM through its OpenAI-compatible API (https://docs.asi1.ai).

export const ASI1_BASE_URL = 'https://api.asi1.ai/v1'
export const ASI1_DEFAULT_MODEL = 'asi1'

export type ChatCompletionsClient = {
  create(params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<OpenAI.Chat.Completions.ChatCompletion>
}

export function asi1Client(apiKey: string, baseURL = ASI1_BASE_URL): ChatCompletionsClient {
  const client = new OpenAI({ apiKey, baseURL })
  return { create: (params) => client.chat.completions.create(params) }
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = TOOL_SPECS.map((spec) => ({
  type: 'function',
  function: { name: spec.name, description: spec.description, parameters: spec.input_schema },
}))

export function asi1Interpreter(client: ChatCompletionsClient, model = ASI1_DEFAULT_MODEL): Interpreter {
  return {
    name: 'asi1',
    async run(state, message, engine, turn) {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: `${stateMessage(state)}\n\n${message}` },
      ]
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const response = await client.create({ model, messages, tools: TOOLS, tool_choice: 'auto' })
        const reply = response.choices[0]?.message
        if (!reply) throw new Error('ASI:One returned no choices.')
        const calls = (reply.tool_calls ?? []).filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function')
        if (!calls.length) return (reply.content ?? '').trim()
        messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: calls })
        // Run in order: later calls (e.g. build_plan) depend on earlier ones.
        for (const call of calls) {
          let input: unknown
          try {
            input = JSON.parse(call.function.arguments || '{}')
          } catch {
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'Arguments were not valid JSON.' }) })
            turn.calls.push({ name: call.function.name, ok: false, error: `Invalid arguments for ${call.function.name}: not valid JSON.` })
            continue
          }
          const outcome = await executeTool(state, { name: call.function.name, input }, engine, turn)
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }) })
        }
      }
      return ''
    },
  }
}
