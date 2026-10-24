export type ToolCall = { name: string; input: Record<string, unknown> }
export type AgentCommandResult = { reply: string; toolCalls: ToolCall[] }
export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

export async function runAgentCommand(message: string, context: Record<string, unknown>, history: HistoryTurn[] = []): Promise<AgentCommandResult> {
  const res = await fetch('/api/agent/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context, history }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Agent command failed: ${res.status}`)
  return res.json()
}
